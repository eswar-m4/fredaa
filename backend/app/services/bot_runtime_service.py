"""
Bot onboarding runtime orchestration.
"""

from __future__ import annotations

import ast
import asyncio
import contextlib
import importlib.util
import inspect
import json
import os
import subprocess
import threading
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings
from app.core.database import get_connection
from app.core.logger import setup_logger
from app.services.admin_request_audit_service import admin_request_audit_service
from app.services.bot_catalog_service import bot_catalog_service

logger = setup_logger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_DATASETS_DIR = _BACKEND_ROOT / "datasets"
_WORKER_PATH = Path(__file__).resolve().with_name("bot_runtime_worker.py")


def _compute_next_refresh_at(frequency: str, now: Optional[datetime] = None) -> Optional[datetime]:
    from datetime import timedelta

    current = now or datetime.utcnow()
    freq = str(frequency or "").strip().lower()
    if freq in {"one time", "one-time", "once", "single run", "single"}:
        return None
    if freq == "hourly":
        return current + timedelta(hours=1)
    if freq == "2 minutes":
        return current + timedelta(minutes=2)
    if freq == "daily":
        return current + timedelta(days=1)
    if freq == "weekly":
        return current + timedelta(weeks=1)
    if freq == "monthly":
        return current + timedelta(days=30)
    if freq == "quarterly":
        return current + timedelta(days=90)
    return current + timedelta(days=7)


def _load_json_records(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return payload if isinstance(payload, list) else []


def _safe_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class BotRuntimePreflightError(ValueError):
    def __init__(self, message: str, *, missing_modules: List[str] | None = None, checked_modules: List[str] | None = None):
        super().__init__(message)
        self.missing_modules = missing_modules or []
        self.checked_modules = checked_modules or []


class BotRuntimeTimeoutError(TimeoutError):
    def __init__(
        self,
        message: str,
        *,
        timeout_sec: int,
        command: List[str],
        stdout_text: str = "",
        stderr_text: str = "",
    ) -> None:
        super().__init__(message)
        self.timeout_sec = timeout_sec
        self.command = command
        self.stdout_text = stdout_text
        self.stderr_text = stderr_text


class BotRuntimeExecutionError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        exit_code: int | None = None,
        stdout_text: str = "",
        stderr_text: str = "",
        duration_seconds: float | None = None,
        artifact_path: str = "",
        artifact_format: str = "",
    ) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.stdout_text = stdout_text
        self.stderr_text = stderr_text
        self.duration_seconds = duration_seconds
        self.artifact_path = artifact_path
        self.artifact_format = artifact_format


class BotRuntimeService:
    def get_request_row(self, job_id: str) -> Optional[Dict[str, Any]]:
        row = admin_request_audit_service.get_request(job_id)
        return dict(row) if row else None

    def _get_job_row(self, job_id: str) -> Dict[str, Any]:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT source, scope, filters, custom_criteria, frequency, mode, records, status, delivery, output_format,
                          is_custom_source, refresh_count, planner_json, complexity, estimated_onboarding_time,
                          refresh_history_json
                   FROM scraper_jobs WHERE id = ?""",
                (job_id,),
            ).fetchone()
        return dict(row) if row else {}

    def _load_bot_target(self, bot: Dict[str, Any]) -> Dict[str, Any]:
        manifest = bot.get("package_manifest") if isinstance(bot.get("package_manifest"), dict) else {}
        runtime_type = str(bot.get("runtime_type") or manifest.get("runtime_type") or "").strip().lower()
        entrypoint_file = str(bot.get("entrypoint_file") or "").strip()
        entrypoint_command = str(bot.get("entrypoint_command") or manifest.get("entrypoint_command") or "").strip()
        entrypoint_mode = str(bot.get("entrypoint_mode") or manifest.get("entrypoint_mode") or "").strip().lower()
        entrypoint_args = bot.get("entrypoint_args") if isinstance(bot.get("entrypoint_args"), list) else manifest.get("entrypoint_args")
        if not isinstance(entrypoint_args, list):
            entrypoint_args = []
        if not runtime_type:
            runtime_type = "perl" if entrypoint_file.lower().endswith(".pl") else "python"
        if runtime_type not in {"python", "perl"}:
            raise ValueError(f"Unsupported bot runtime: {runtime_type}")
        if runtime_type == "perl" and not entrypoint_command:
            if not entrypoint_file:
                raise ValueError("Perl bot package must include an entrypoint file")
            entrypoint_command = f"perl {entrypoint_file}"
        if runtime_type == "python" and entrypoint_mode not in {"", "callable", "script"}:
            raise ValueError(f"Unsupported bot entrypoint mode: {entrypoint_mode}")
        return {
            "runtime_type": runtime_type,
            "entrypoint_file": entrypoint_file,
            "entrypoint_command": entrypoint_command,
            "entrypoint_mode": entrypoint_mode or ("callable" if str(bot.get("entrypoint_function") or "").strip() else "script"),
            "entrypoint_args": [str(arg) for arg in entrypoint_args],
        }

    def _normalize_result(self, result: Any) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        metadata: Dict[str, Any] = {}
        records: Any = result

        if isinstance(result, str):
            try:
                result = json.loads(result)
            except Exception as exc:
                raise ValueError("Bot output string was not valid JSON") from exc

        if isinstance(result, dict):
            metadata = result.get("execution_metadata") or result.get("metadata") or {}
            records = (
                result.get("records")
                if "records" in result
                else result.get("normalized_records")
                if "normalized_records" in result
                else result.get("output")
                if "output" in result
                else []
            )

        if inspect.isawaitable(records):
            raise ValueError("Bot entrypoint returned an awaitable records payload instead of a concrete value")

        if not isinstance(records, list):
            raise ValueError("Bot entrypoint must return a list of records or an object containing records")

        normalized: List[Dict[str, Any]] = []
        for idx, record in enumerate(records):
            if not isinstance(record, dict):
                raise ValueError(f"Bot record at index {idx} must be an object")
            normalized.append(record)

        return normalized, metadata if isinstance(metadata, dict) else {}

    def _runtime_timeout_overrides(self) -> Dict[str, int]:
        raw = str(getattr(settings, "BOT_RUNTIME_TIMEOUT_OVERRIDES_JSON", "") or "").strip()
        if not raw:
            return {}
        try:
            payload = json.loads(raw)
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        overrides: Dict[str, int] = {}
        for key, value in payload.items():
            try:
                timeout_value = int(value)
            except Exception:
                continue
            if timeout_value > 0:
                overrides[str(key)] = timeout_value
        return overrides

    def _resolve_runtime_timeout(self, bot: Dict[str, Any], job_id: str) -> int:
        default_timeout = int(getattr(settings, "BOT_RUNTIME_TIMEOUT_SEC", 1800) or 1800)
        candidates = [
            bot.get("runtime_timeout_sec"),
            bot.get("timeout_sec"),
            bot.get("package_manifest", {}).get("runtime_timeout_sec") if isinstance(bot.get("package_manifest"), dict) else None,
            bot.get("package_manifest", {}).get("timeout_sec") if isinstance(bot.get("package_manifest"), dict) else None,
        ]
        for candidate in candidates:
            try:
                timeout_value = int(candidate)
            except Exception:
                continue
            if timeout_value > 0:
                return timeout_value

        overrides = self._runtime_timeout_overrides()
        for key in (str(bot.get("id") or ""), str(job_id or "")):
            if key in overrides:
                return overrides[key]
        return default_timeout

    def _preflight_bot_package(self, bot: Dict[str, Any], bot_target: Dict[str, Any]) -> Dict[str, Any]:
        package_root = Path(str(bot.get("package_root") or "")).expanduser().resolve()
        entrypoint_file = str(bot.get("entrypoint_file") or "").strip()
        if not package_root.exists():
            raise BotRuntimePreflightError(f"Bot package root not found: {package_root}")
        if not entrypoint_file:
            raise BotRuntimePreflightError("Bot entrypoint file is required")

        entrypoint_path = Path(entrypoint_file)
        if not entrypoint_path.is_absolute():
            entrypoint_path = (package_root / entrypoint_path).resolve()
        try:
            entrypoint_path.relative_to(package_root)
        except ValueError as exc:
            raise BotRuntimePreflightError("Bot entrypoint file must stay within the extracted package root") from exc
        if not entrypoint_path.exists():
            raise BotRuntimePreflightError(f"Bot entrypoint file not found: {entrypoint_path}")

        try:
            source = entrypoint_path.read_text(encoding="utf-8", errors="ignore")
            tree = ast.parse(source, filename=str(entrypoint_path))
        except SyntaxError as exc:
            raise BotRuntimePreflightError(f"Bot entrypoint file has invalid syntax: {exc}") from exc
        except Exception as exc:
            raise BotRuntimePreflightError(f"Failed to read bot entrypoint: {exc}") from exc

        local_modules = {path.stem for path in package_root.rglob("*.py")}
        local_modules.update(
            path.parent.name
            for path in package_root.rglob("__init__.py")
            if path.parent.name
        )
        stdlib_modules = set(getattr(sys, "stdlib_module_names", set()))
        imported_roots: List[str] = []
        seen = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root = str(alias.name or "").split(".", 1)[0].strip()
                    if root and root not in seen:
                        imported_roots.append(root)
                        seen.add(root)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                root = str(node.module).split(".", 1)[0].strip()
                if root and root not in seen:
                    imported_roots.append(root)
                    seen.add(root)

        missing_modules: List[str] = []
        checked_modules: List[str] = []
        for module_name in imported_roots:
            if module_name in local_modules or module_name in stdlib_modules:
                continue
            checked_modules.append(module_name)
            try:
                spec = importlib.util.find_spec(module_name)
            except Exception:
                spec = None
            if spec is None:
                missing_modules.append(module_name)

        if missing_modules:
            raise BotRuntimePreflightError(
                "Missing runtime dependencies for bot package: " + ", ".join(sorted(missing_modules)),
                missing_modules=sorted(missing_modules),
                checked_modules=sorted(checked_modules),
            )

        return {
            "package_root": str(package_root),
            "entrypoint_file": str(entrypoint_path.relative_to(package_root)),
            "entrypoint_mode": str(bot_target.get("entrypoint_mode") or ""),
            "runtime_type": str(bot_target.get("runtime_type") or ""),
            "checked_modules": sorted(checked_modules),
        }

    def _run_worker_streaming(self, bot: Dict[str, Any], context: Dict[str, Any], timeout_sec: int) -> Dict[str, Any]:
        bot_target = self._load_bot_target(bot)
        package_root = Path(str(bot.get("package_root") or "")).expanduser().resolve()
        if not _WORKER_PATH.exists():
            raise ValueError(f"Bot runtime worker not found: {_WORKER_PATH}")

        cmd = [
            sys.executable,
            "-u",
            str(_WORKER_PATH),
            "--runtime-type",
            bot_target["runtime_type"],
            "--package-root",
            str(package_root),
            "--entrypoint-file",
            bot_target["entrypoint_file"],
            "--entrypoint-function",
            str(bot.get("entrypoint_function") or "run"),
            "--entrypoint-mode",
            str(bot_target.get("entrypoint_mode") or "callable"),
            "--entrypoint-args-json",
            json.dumps(bot_target.get("entrypoint_args") or [], ensure_ascii=False),
        ]

        started_at = time.perf_counter()
        pythonpath_parts = [str(_BACKEND_ROOT)]
        existing_pythonpath = os.environ.get("PYTHONPATH")
        if existing_pythonpath:
            pythonpath_parts.append(existing_pythonpath)

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(package_root),
            env={
                **os.environ,
                "BOT_RUNTIME_TIMEOUT_SEC": str(timeout_sec),
                "PYTHONPATH": os.pathsep.join(pythonpath_parts),
            },
            text=True,
            encoding="utf-8",
            errors="ignore",
            bufsize=1,
        )

        stdout_lines: List[str] = []
        stderr_lines: List[str] = []

        def _drain_stdout() -> None:
            if proc.stdout is None:
                return
            for line in iter(proc.stdout.readline, ""):
                stdout_lines.append(line)

        def _drain_stderr() -> None:
            if proc.stderr is None:
                return
            for line in iter(proc.stderr.readline, ""):
                stderr_lines.append(line)

        stdout_thread = threading.Thread(target=_drain_stdout, daemon=True)
        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        try:
            if proc.stdin is not None:
                try:
                    proc.stdin.write(json.dumps(context, ensure_ascii=False, default=str))
                    proc.stdin.close()
                except BrokenPipeError:
                    with contextlib.suppress(Exception):
                        proc.stdin.close()
            proc.wait(timeout=timeout_sec)
        except subprocess.TimeoutExpired as exc:
            with contextlib.suppress(Exception):
                proc.kill()
            with contextlib.suppress(Exception):
                proc.wait(timeout=5)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            stdout_tail = "".join(stdout_lines).strip()
            stderr_tail = "".join(stderr_lines).strip()
            tail_bits = []
            if stdout_tail:
                tail_bits.append(f"last stdout: {stdout_tail}")
            if stderr_tail:
                tail_bits.append(f"last stderr: {stderr_tail}")
            tail_text = f" ({'; '.join(tail_bits)})" if tail_bits else ""
            raise BotRuntimeTimeoutError(
                f"Bot execution timed out after {timeout_sec} seconds{tail_text}",
                timeout_sec=timeout_sec,
                command=cmd,
                stdout_text=stdout_tail,
                stderr_text=stderr_tail,
            ) from exc
        finally:
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)

        duration_seconds = round(time.perf_counter() - started_at, 3)
        stdout_text = "".join(stdout_lines).strip()
        stderr_text = "".join(stderr_lines).strip()
        if proc.returncode != 0:
            try:
                parsed_failure = json.loads(stdout_text) if stdout_text else None
            except Exception:
                parsed_failure = None
            if isinstance(parsed_failure, dict) and isinstance(parsed_failure.get("error"), dict):
                error_payload = parsed_failure["error"]
                raise BotRuntimeExecutionError(
                    str(error_payload.get("message") or stderr_text or f"Bot runtime worker exited with code {proc.returncode}"),
                    exit_code=int(error_payload.get("exit_code") or proc.returncode or 1),
                    stdout_text=str(error_payload.get("stdout_text") or ""),
                    stderr_text=str(error_payload.get("stderr_text") or stderr_text or ""),
                    duration_seconds=float(error_payload.get("duration_seconds") or duration_seconds),
                    artifact_path=str(error_payload.get("artifact_path") or ""),
                    artifact_format=str(error_payload.get("artifact_format") or ""),
                )
            raise ValueError(stderr_text or f"Bot runtime worker exited with code {proc.returncode}")
        if not stdout_text:
            raise ValueError("Bot runtime worker did not return any JSON output")

        try:
            payload = json.loads(stdout_text)
        except Exception as exc:
            raise ValueError("Bot runtime worker output was not valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("Bot runtime worker output must be a JSON object")
        if stderr_text:
            payload.setdefault("bot_stderr", stderr_text)
        return payload

    def _run_worker(self, bot: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        timeout_sec = self._resolve_runtime_timeout(bot, str(bot.get("job_id") or ""))
        return self._run_worker_streaming(bot, context, timeout_sec)

    def _persist_onboarded_bot_failure(
        self,
        *,
        job_id: str,
        bot: Dict[str, Any],
        bot_target: Dict[str, Any],
        exc: Exception,
        stage: str,
    ) -> None:
        error_type = type(exc).__name__
        error_message = str(exc).strip() or error_type
        error_traceback = traceback.format_exc()
        extra_metadata: Dict[str, Any] = {
            "bot_catalog_id": bot.get("id"),
            "bot_name": bot.get("name"),
            "bot_package_path": bot.get("package_path"),
            "bot_package_root": bot.get("package_root"),
            "bot_runtime_type": bot_target.get("runtime_type"),
            "bot_failure_stage": stage,
            "bot_error_type": error_type,
            "bot_error_message": error_message,
            "bot_error_traceback": error_traceback,
        }
        timeout_sec = getattr(exc, "timeout_sec", None)
        if timeout_sec is not None:
            extra_metadata["bot_timeout_sec"] = timeout_sec
        command = getattr(exc, "command", None)
        if command is not None:
            extra_metadata["bot_timeout_command"] = command
        exit_code = getattr(exc, "exit_code", None)
        if exit_code is not None:
            extra_metadata["bot_exit_code"] = exit_code
        duration_seconds = getattr(exc, "duration_seconds", None)
        if duration_seconds is None and timeout_sec is not None:
            duration_seconds = float(timeout_sec)
        if duration_seconds is not None:
            extra_metadata["bot_execution_duration_seconds"] = duration_seconds
        stdout_text = getattr(exc, "stdout_text", "")
        stderr_text = getattr(exc, "stderr_text", "")
        if stdout_text:
            extra_metadata["bot_last_stdout"] = stdout_text
            extra_metadata["bot_stdout"] = stdout_text
        if stderr_text:
            extra_metadata["bot_last_stderr"] = stderr_text
            extra_metadata["bot_stderr"] = stderr_text
        artifact_path = getattr(exc, "artifact_path", "")
        artifact_format = getattr(exc, "artifact_format", "")
        if artifact_path:
            extra_metadata["bot_output_artifact_path"] = artifact_path
        if artifact_format:
            extra_metadata["bot_output_artifact_format"] = artifact_format
        missing_modules = getattr(exc, "missing_modules", None)
        checked_modules = getattr(exc, "checked_modules", None)
        if missing_modules:
            extra_metadata["bot_missing_modules"] = list(missing_modules)
        if checked_modules:
            extra_metadata["bot_preflight_checked_modules"] = list(checked_modules)
        if not stderr_text:
            extra_metadata["bot_stderr"] = error_message

        with get_connection() as conn:
            conn.execute(
                "UPDATE scraper_jobs SET status = 'Failed', fresh = 0, next_refresh = NULL WHERE id = ?",
                (job_id,),
            )
            conn.commit()

        admin_request_audit_service.update_job_state(
            job_id=job_id,
            request_status="Failed",
            job_status="Failed",
            status_reason=f"{error_type}: {error_message}",
            execution_metadata=extra_metadata,
            event="runtime_failed",
        )

    async def execute_catalog_bot(
        self,
        job_id: str,
        bot: Dict[str, Any],
        *,
        job_row: Optional[Dict[str, Any]] = None,
        request_row: Optional[Dict[str, Any]] = None,
    ) -> None:
        job_row = job_row or self._get_job_row(job_id)
        if not job_row:
            raise ValueError("Job not found")

        request_row = request_row or self.get_request_row(job_id) or {}
        if not bot or not bot.get("package_root"):
            from app.api.demo_routes import run_scraper_background

            await run_scraper_background(job_id)
            return

        bot_target = self._load_bot_target(bot)
        source = str(job_row.get("source") or request_row.get("source") or bot.get("url") or bot.get("name") or job_id).strip()
        scope = str(job_row.get("scope") or request_row.get("scope") or bot.get("scope") or "").strip()
        frequency = str(job_row.get("frequency") or request_row.get("execution_metadata", {}).get("frequency") or "").strip()
        mode = str(job_row.get("mode") or request_row.get("mode") or "Site-Specific").strip()
        now = datetime.utcnow()

        try:
            preflight = self._preflight_bot_package(bot, bot_target)
        except BotRuntimePreflightError as exc:
            self._persist_onboarded_bot_failure(
                job_id=job_id,
                bot=bot,
                bot_target=bot_target,
                exc=exc,
                stage="preflight",
            )
            return

        with get_connection() as conn:
            conn.execute(
                "UPDATE scraper_jobs SET status = 'Running', is_custom_source = COALESCE(is_custom_source, 1) WHERE id = ?",
                (job_id,),
            )
            conn.commit()

        admin_request_audit_service.update_job_state(
            job_id=job_id,
            request_status="Running",
            job_status="Running",
            status_reason="Executing onboarded bot package",
            execution_metadata={
                "bot_catalog_id": bot.get("id"),
                "bot_name": bot.get("name"),
                "bot_package_path": bot.get("package_path"),
                "bot_package_root": bot.get("package_root"),
                "bot_runtime_type": bot_target["runtime_type"],
                "bot_entrypoint_file": bot.get("entrypoint_file"),
                "bot_entrypoint_function": bot.get("entrypoint_function"),
                "bot_entrypoint_command": bot.get("entrypoint_command"),
                "bot_preflight_checked_modules": preflight.get("checked_modules", []),
            },
            event="bot_running",
        )

        try:
            context = {
                "job_id": job_id,
                "request_id": bot.get("request_id"),
                "bot_id": bot.get("id"),
                "bot_name": bot.get("name"),
                "source": source,
                "scope": scope,
                "mode": mode,
                "frequency": frequency,
                "session": request_row,
                "request": request_row,
                "job": job_row,
                "bot": bot,
                "manifest": bot.get("package_manifest") or {},
                "package_root": bot.get("package_root"),
                "entrypoint_file": bot.get("entrypoint_file"),
                "entrypoint_function": bot.get("entrypoint_function"),
                "uploads": bot.get("package_files") or [],
                "artifacts_dir": str(_DATASETS_DIR),
                "outputs_dir": str(_DATASETS_DIR),
                "now": now.isoformat(),
            }

            worker_output = await asyncio.to_thread(self._run_worker, bot, context)
            records, execution_metadata = self._normalize_result(worker_output)
            if not records:
                raise ValueError("Bot returned no records")
            entrypoint_path = str(bot.get("entrypoint_file") or "")

            _DATASETS_DIR.mkdir(parents=True, exist_ok=True)
            current_refresh_count = int(job_row.get("refresh_count") or 0)
            next_run_num = max(1, current_refresh_count + 1)
            run_file_path = _DATASETS_DIR / f"{job_id}_run_{next_run_num}.json"
            _safe_write_json(run_file_path, records)

            baseline_candidates = [
                _DATASETS_DIR / f"{job_id}_final.json",
                _DATASETS_DIR / f"{job_id}_run_{max(1, next_run_num - 1)}.json",
                _DATASETS_DIR / f"{job_id}_input.json",
            ]
            baseline_records: List[Dict[str, Any]] = []
            baseline_file = ""
            for candidate in baseline_candidates:
                if candidate.exists():
                    baseline_records = _load_json_records(candidate)
                    baseline_file = candidate.name
                    if baseline_records:
                        break

            from app.services.wcm_comparison_service import compare_records

            flattened_rows, _ = compare_records(
                source,
                baseline_records,
                records,
                is_dataset=False,
            )
            record_groups: Dict[str, set[str]] = {}
            for row in flattened_rows:
                if not isinstance(row, dict):
                    continue
                record_key = str(row.get("recordKey") or f"record_{row.get('recordIndex', 0)}")
                record_groups.setdefault(record_key, set()).add(str(row.get("changeType") or "V"))
            records_compared = len(record_groups) or len(records)
            comparison_log = {
                "baseline_file": baseline_file,
                "current_file": run_file_path.name,
                "records_compared": records_compared,
                "added": sum(1 for types in record_groups.values() if "A" in types),
                "modified": sum(1 for types in record_groups.values() if "M" in types),
                "deleted": sum(1 for types in record_groups.values() if "D" in types),
                "verified": sum(1 for types in record_groups.values() if types == {"V"}),
                "change_percentage": round(
                    (
                        sum(1 for types in record_groups.values() if any(flag in types for flag in ("A", "M", "D")))
                        / records_compared
                    )
                    * 100,
                    2,
                )
                if records_compared
                else 0.0,
                "entrypoint_file": entrypoint_path,
                "runtime_type": bot_target["runtime_type"],
                "entrypoint_function": bot.get("entrypoint_function"),
                "entrypoint_command": bot.get("entrypoint_command"),
            }
            _safe_write_json(_DATASETS_DIR / f"{job_id}_comparison.json", comparison_log)

            next_refresh_at = _compute_next_refresh_at(frequency, now)
            next_refresh_str = next_refresh_at.isoformat() + "Z" if next_refresh_at else None
            refresh_history = []
            try:
                refresh_history = json.loads(str(job_row.get("refresh_history_json") or "[]"))
                if not isinstance(refresh_history, list):
                    refresh_history = []
            except Exception:
                refresh_history = []
            refresh_history.append(
                {
                    "timestamp": now.isoformat() + "Z",
                    "records_scraped": len(records),
                    "accuracy_rate": 100,
                    "status": "Success",
                    "execution_time_seconds": 0,
                }
            )
            with get_connection() as conn:
                conn.execute(
                    """UPDATE scraper_jobs
                       SET status = 'Review Pending',
                           records = ?,
                           fresh = 100,
                           last_refresh = ?,
                           next_refresh = ?,
                           refresh_count = ?,
                           changes_detected = ?,
                           refresh_history_json = ?
                       WHERE id = ?""",
                    (
                        len(records),
                        now.isoformat() + "Z",
                        next_refresh_str,
                        next_run_num,
                        len(records),
                        json.dumps(refresh_history),
                        job_id,
                    ),
                )
                conn.commit()

            admin_request_audit_service.update_job_state(
                job_id=job_id,
                request_status="Review Pending",
                job_status="Review Pending",
                execution_metadata={
                    "records_count": len(records),
                    "bot_catalog_id": bot.get("id"),
                    "bot_name": bot.get("name"),
                    "bot_package_path": bot.get("package_path"),
                    "bot_package_root": bot.get("package_root"),
                    "bot_runtime_type": bot_target["runtime_type"],
                    "bot_entrypoint_file": bot.get("entrypoint_file"),
                    "bot_entrypoint_function": bot.get("entrypoint_function"),
                    "bot_entrypoint_command": bot.get("entrypoint_command"),
                    "comparison_file": f"{job_id}_comparison.json",
                    "run_file": run_file_path.name,
                    **(execution_metadata if isinstance(execution_metadata, dict) else {}),
                },
                event="review_pending",
            )

            from app.services.workflow_service import workflow_service

            workflow_service.runs[job_id] = {
                "run_id": job_id,
                "dataset_id": job_id,
                "dataset_name": source,
                "processed_dataset": records,
                "bot_execution": {
                    "bot_id": bot.get("id"),
                    "runtime_type": bot_target["runtime_type"],
                    "entrypoint_file": bot.get("entrypoint_file"),
                    "entrypoint_function": bot.get("entrypoint_function"),
                    "entrypoint_command": bot.get("entrypoint_command"),
                    "package_root": bot.get("package_root"),
                },
                "comparison_log": comparison_log,
            }
            try:
                from app.services.wcm_comparison_service import warm_review_cache
                asyncio.create_task(warm_review_cache(job_id, 2.0))
            except Exception:
                pass
            return
        except Exception as exc:
            stage = "timeout" if isinstance(exc, BotRuntimeTimeoutError) else "execution"
            try:
                self._persist_onboarded_bot_failure(
                    job_id=job_id,
                    bot=bot,
                    bot_target=bot_target,
                    exc=exc,
                    stage=stage,
                )
            except Exception as persist_exc:
                logger.error(
                    "Failed to persist onboarded bot failure for %s after execution error: %s",
                    job_id,
                    persist_exc,
                    exc_info=True,
                )
            logger.error("Onboarded bot execution failed for %s: %s", job_id, exc, exc_info=True)
            return

    async def execute_onboarded_bot(self, job_id: str) -> None:
        job_row = self._get_job_row(job_id)
        if not job_row:
            raise ValueError("Job not found")

        request_row = self.get_request_row(job_id) or {}
        bot = bot_catalog_service.get_by_job_id(job_id)
        if not bot or not bot.get("package_root"):
            from app.api.demo_routes import run_scraper_background

            await run_scraper_background(job_id)
            return

        await self.execute_catalog_bot(job_id, bot, job_row=job_row, request_row=request_row)

    def onboard_request(
        self,
        *,
        request_id: str,
        job_id: str,
        session: Dict[str, Any],
        notes: Optional[str],
        uploads: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        row = admin_request_audit_service.get_request(request_id)
        if not row:
            raise ValueError("Request not found")
        updated_row = self.get_request_row(job_id) or {}

        execution_metadata = dict(row.get("execution_metadata") or {})
        execution_metadata["bot_uploads"] = uploads
        execution_metadata["bot_uploaded_by"] = session.get("display_name") or session.get("username") or "admin"
        execution_metadata["bot_uploaded_at"] = datetime.utcnow().isoformat()
        if notes:
            execution_metadata["bot_onboarding_notes"] = notes

        with get_connection() as conn:
            conn.execute(
                "UPDATE scraper_jobs SET status = 'Running', is_custom_source = COALESCE(is_custom_source, 1) WHERE id = ?",
                (job_id,),
            )
            conn.commit()

        admin_request_audit_service.update_job_state(
            job_id=job_id,
            request_status="Running",
            job_status="Running",
            status_reason=notes or "Bot package uploaded; preparing execution",
            execution_metadata={
                **execution_metadata,
                "bot_onboarding_state": "uploaded",
            },
            event="bot_running",
        )

        threading.Thread(
            target=lambda: asyncio.run(
                self._launch_and_run_onboarded_bot(
                    job_id=job_id,
                    request_id=request_id,
                    session=session,
                    notes=notes,
                    uploads=uploads,
                )
            ),
            daemon=False,
            name=f"bot-onboard-runner-{job_id}",
        ).start()

        admin_request_audit_service.update_job_state(
            job_id=job_id,
            execution_metadata={
                **execution_metadata,
                "bot_onboarding_state": "queued",
            },
            event="bot_queued",
        )
        return {
            "id": f"bot_{job_id}",
            "job_id": job_id,
            "request_id": request_id,
            "status": "queued",
            "message": "Bot package accepted and queued for execution",
        }

    async def _launch_and_run_onboarded_bot(
        self,
        *,
        job_id: str,
        request_id: str,
        session: Dict[str, Any],
        notes: Optional[str],
        uploads: List[Dict[str, Any]],
    ) -> None:
        try:
            bot_payload = bot_catalog_service.register_onboarded_bot(
                job_id=job_id,
                request_id=request_id,
                request_row=self.get_request_row(job_id) or {},
                session=session,
                uploads=uploads,
                notes=notes,
            )
        except Exception as exc:
            logger.error("Onboarded bot registration failed for %s: %s", job_id, exc, exc_info=True)
            with get_connection() as conn:
                conn.execute(
                    "UPDATE scraper_jobs SET status = 'Failed', fresh = 0 WHERE id = ?",
                    (job_id,),
                )
                conn.commit()
            error_type = type(exc).__name__
            error_message = str(exc).strip() or error_type
            admin_request_audit_service.update_job_state(
                job_id=job_id,
                request_status="Failed",
                job_status="Failed",
                status_reason=f"{error_type}: {error_message}",
                execution_metadata={
                    "bot_uploaded_by": session.get("display_name") or session.get("username") or "admin",
                    "bot_uploaded_at": datetime.utcnow().isoformat(),
                    "bot_uploads": uploads,
                    "bot_failure_stage": "registration",
                    "bot_error_type": error_type,
                    "bot_error_message": error_message,
                    "bot_error_traceback": traceback.format_exc(),
                },
                event="runtime_failed",
            )
            return

        admin_request_audit_service.update_job_state(
            job_id=job_id,
            execution_metadata={
                "bot_catalog_entry": bot_payload,
                "bot_catalog_id": bot_payload.get("id"),
                "bot_onboarding_state": "registered",
            },
            event="bot_registered",
        )
        await self.execute_onboarded_bot(job_id)

    async def _run_bot(self, job_id: str) -> None:
        await self.execute_onboarded_bot(job_id)


bot_runtime_service = BotRuntimeService()
