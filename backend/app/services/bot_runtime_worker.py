"""
Isolated bot execution worker used by the onboarding runtime.

The API process spawns this worker in a child Python interpreter so bot imports,
package installation, and runtime failures cannot block the API worker.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import importlib.util
import inspect
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import textwrap
import threading
from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.services.legacy_bot_artifact_service import (
    discover_new_artifact,
    parse_output_artifact,
    snapshot_artifact_state,
)


SUPPORTED_RUNTIMES = {"python", "perl"}


class BotRuntimeExecutionError(ValueError):
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


def _tail_text(lines: List[str], limit: int = 40) -> str:
    if not lines:
        return ""
    return "".join(lines[-limit:]).strip()


def _run_streaming_subprocess(
    cmd: List[str],
    *,
    input_text: str,
    cwd: str,
    env: Dict[str, str] | None = None,
    timeout: int = 1800,
) -> Tuple[str, str, int]:
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env=env,
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
            sys.stderr.write(line)
            sys.stderr.flush()

    stdout_thread = threading.Thread(target=_drain_stdout, daemon=True)
    stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    try:
        if proc.stdin is not None:
            try:
                proc.stdin.write(input_text)
                proc.stdin.close()
            except BrokenPipeError:
                with contextlib.suppress(Exception):
                    proc.stdin.close()
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        with contextlib.suppress(Exception):
            proc.kill()
        with contextlib.suppress(Exception):
            proc.wait(timeout=5)
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        raise TimeoutError(
            f"Subprocess timed out after {timeout} seconds. "
            f"Last stdout: {_tail_text(stdout_lines) or '—'}. "
            f"Last stderr: {_tail_text(stderr_lines) or '—'}."
        ) from exc
    finally:
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)

    stdout_text = "".join(stdout_lines)
    stderr_text = "".join(stderr_lines)
    return stdout_text, stderr_text, int(proc.returncode or 0)


def _normalize_result(result: Any) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    metadata: Dict[str, Any] = {}
    records: Any = result

    if isinstance(result, str):
        result = json.loads(result)

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


def _resolve_entrypoint_path(package_root: Path, entrypoint_file: str) -> Path:
    if not entrypoint_file:
        raise ValueError("Bot entrypoint file is required")
    module_path = Path(entrypoint_file)
    if not module_path.suffix:
        module_path = module_path.with_suffix(".py")
    if not module_path.is_absolute():
        module_path = (package_root / module_path).resolve()
    try:
        module_path.relative_to(package_root)
    except ValueError as exc:
        raise ValueError("Bot entrypoint file must stay within the extracted package root") from exc
    if not module_path.exists():
        raise ValueError(f"Bot entrypoint file not found: {module_path}")
    return module_path


def _python_adapter_source() -> str:
    return textwrap.dedent(
        r"""
        import asyncio
        import contextlib
        import importlib.util
        import inspect
        import io
        import json
        import os
        import runpy
        import sys
        import traceback
        from pathlib import Path

        def _normalize_result(result):
            metadata = {}
            records = result
            if isinstance(result, str):
                result = json.loads(result)
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
            normalized = []
            for idx, record in enumerate(records):
                if not isinstance(record, dict):
                    raise ValueError(f"Bot record at index {idx} must be an object")
                normalized.append(record)
            return normalized, metadata if isinstance(metadata, dict) else {}

        def _module_name(module_path):
            return f"onboarded_bot_{module_path.stem}_{abs(hash(str(module_path)))}"

        def _load_module(module_path, package_root):
            module_name = _module_name(module_path)
            spec = importlib.util.spec_from_file_location(module_name, module_path)
            if spec is None or spec.loader is None:
                raise ValueError("Failed to load bot entrypoint module")
            module = importlib.util.module_from_spec(spec)
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                spec.loader.exec_module(module)  # type: ignore[union-attr]
            return module

        def _callable_entrypoint(module, entrypoint_function, context):
            entrypoint = getattr(module, entrypoint_function, None)
            if not callable(entrypoint):
                raise ValueError(f"Bot entrypoint function not found: {entrypoint_function}")
            try:
                sig = inspect.signature(entrypoint)
            except Exception:
                sig = None
            stdout_buffer = io.StringIO()
            stderr_buffer = io.StringIO()
            error_text = ""
            result = None
            with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
                try:
                    if sig is None:
                        result = entrypoint(context)
                    else:
                        params = list(sig.parameters.values())
                        accepts_context = any(
                            p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.VAR_POSITIONAL)
                            for p in params
                        )
                        result = entrypoint(context) if accepts_context else entrypoint()
                    if inspect.isawaitable(result):
                        result = asyncio.run(result)
                except Exception:
                    error_text = traceback.format_exc().strip()
            return result, stdout_buffer.getvalue().strip(), stderr_buffer.getvalue().strip(), error_text

        def _script_entrypoint(script_path, entrypoint_args, context):
            class _LiveCapture(io.TextIOBase):
                def __init__(self, label):
                    self._label = label
                    self._buffer = io.StringIO()
                    self._pending = ""

                def write(self, text):
                    if not text:
                        return 0
                    self._buffer.write(text)
                    self._pending += text
                    while "\n" in self._pending:
                        line, self._pending = self._pending.split("\n", 1)
                        sys.__stderr__.write(f"[{self._label}] {line}\n")
                        sys.__stderr__.flush()
                    return len(text)

                def flush(self):
                    if self._pending:
                        sys.__stderr__.write(f"[{self._label}] {self._pending}")
                        sys.__stderr__.flush()
                        self._pending = ""

                def getvalue(self):
                    self.flush()
                    return self._buffer.getvalue()

            stdout_buffer = _LiveCapture("bot stdout")
            stderr_buffer = _LiveCapture("bot stderr")
            old_cwd = os.getcwd()
            old_argv = list(sys.argv)
            error_text = ""
            try:
                os.chdir(str(script_path.parent))
                sys.argv = [str(script_path.name), *entrypoint_args]
                with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
                    globals_after = runpy.run_path(str(script_path), run_name="__main__")
            except Exception:
                error_text = traceback.format_exc().strip()
                globals_after = {}
            finally:
                os.chdir(old_cwd)
                sys.argv = old_argv
            stdout_text = stdout_buffer.getvalue().strip()
            stderr_text = stderr_buffer.getvalue().strip()
            if stdout_text:
                try:
                    parsed = json.loads(stdout_text)
                except Exception:
                    parsed = None
                if parsed is not None:
                    return parsed, stdout_text, stderr_text, globals_after, error_text
            for key in ("BOT_RESULT", "RESULT", "RESULTS", "records"):
                if key in globals_after:
                    return globals_after[key], stdout_text, stderr_text, globals_after, error_text
            return None, stdout_text, stderr_text, globals_after, error_text

        def main():
            package_root = Path(os.environ["BOT_PACKAGE_ROOT"]).resolve()
            entrypoint_file = os.environ["BOT_ENTRYPOINT_FILE"].strip()
            entrypoint_function = os.environ.get("BOT_ENTRYPOINT_FUNCTION", "").strip()
            entrypoint_mode = os.environ.get("BOT_ENTRYPOINT_MODE", "callable").strip().lower()
            entrypoint_args = json.loads(os.environ.get("BOT_ENTRYPOINT_ARGS", "[]"))
            context = json.loads(sys.stdin.read() or "{}")
            if not isinstance(context, dict):
                raise ValueError("Bot execution context must be a JSON object")
            module_path = Path(entrypoint_file)
            if not module_path.suffix:
                module_path = module_path.with_suffix(".py")
            if not module_path.is_absolute():
                module_path = (package_root / module_path).resolve()
            if not module_path.exists():
                raise ValueError(f"Bot entrypoint file not found: {module_path}")
            module_path.relative_to(package_root)

            sys.path.insert(0, str(package_root))
            sys.path.insert(0, str(module_path.parent))
            try:
                error_text = ""
                if entrypoint_mode == "script":
                    result, stdout_text, stderr_text, _globals, error_text = _script_entrypoint(module_path, entrypoint_args, context)
                else:
                    module = _load_module(module_path, package_root)
                    result, stdout_text, stderr_text, error_text = _callable_entrypoint(module, entrypoint_function or "run", context)
                if result is None:
                    error_payload = {
                        "message": error_text or "Bot entrypoint did not produce normalized records",
                        "stdout_text": stdout_text,
                        "stderr_text": stderr_text,
                        "traceback": error_text,
                        "error_type": "BotRuntimeEntrypointError",
                    }
                    sys.stdout.write(json.dumps({"error": error_payload}, ensure_ascii=False, default=str))
                    sys.stdout.flush()
                    return 1
                records, execution_metadata = _normalize_result(result)
                payload = {
                    "runtime_type": "python",
                    "entrypoint_file": str(module_path.name),
                    "records": records,
                    "execution_metadata": execution_metadata,
                }
                if stdout_text:
                    payload["bot_stdout"] = stdout_text
                if stderr_text:
                    payload["bot_stderr"] = stderr_text
                sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))
                sys.stdout.flush()
                return 0
            finally:
                for path in [str(module_path.parent), str(package_root)]:
                    try:
                        sys.path.remove(path)
                    except ValueError:
                        pass

        if __name__ == "__main__":
            raise SystemExit(main())
        """
    ).strip()


def _execute_python(package_root: Path, entrypoint_file: str, entrypoint_function: str, entrypoint_mode: str, entrypoint_args: List[str], context: Dict[str, Any]) -> Dict[str, Any]:
    timeout_sec = int(os.environ.get("BOT_RUNTIME_TIMEOUT_SEC", "1800") or 1800)
    module_path = _resolve_entrypoint_path(package_root, entrypoint_file)
    artifact_snapshot = snapshot_artifact_state(package_root)
    started_at_ns = time.time_ns()
    started_at = time.perf_counter()

    with tempfile.TemporaryDirectory(prefix="bot_adapter_") as temp_dir:
        adapter_path = Path(temp_dir) / "adapter.py"
        adapter_path.write_text(_python_adapter_source(), encoding="utf-8")
        env = os.environ.copy()
        env["BOT_PACKAGE_ROOT"] = str(package_root)
        env["BOT_ENTRYPOINT_FILE"] = entrypoint_file
        env["BOT_ENTRYPOINT_FUNCTION"] = entrypoint_function
        env["BOT_ENTRYPOINT_MODE"] = entrypoint_mode or "callable"
        env["BOT_ENTRYPOINT_ARGS"] = json.dumps(entrypoint_args or [], ensure_ascii=False)
        stdout_text, stderr_text, returncode = _run_streaming_subprocess(
            [sys.executable, "-u", str(adapter_path)],
            input_text=json.dumps(context, ensure_ascii=False, default=str),
            cwd=str(package_root),
            env=env,
            timeout=timeout_sec,
        )

    duration_seconds = round(time.perf_counter() - started_at, 3)
    worker_stdout_text = stdout_text.strip()
    worker_stderr_text = stderr_text.strip()
    bot_exit_code = int(returncode)
    execution_payload: Any = None
    execution_error = ""
    error_payload: Dict[str, Any] = {}
    payload_bot_stdout = ""
    payload_bot_stderr = ""

    if worker_stdout_text:
        try:
            parsed = json.loads(worker_stdout_text)
            if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
                error_payload = parsed["error"]
                execution_error = str(error_payload.get("message") or "")
            elif isinstance(parsed, dict):
                execution_payload = parsed
                payload_bot_stdout = str(parsed.get("bot_stdout") or "")
                payload_bot_stderr = str(parsed.get("bot_stderr") or "")
            else:
                execution_payload = {"records": parsed}
        except Exception:
            execution_error = worker_stdout_text

    if execution_payload is None and not error_payload:
        execution_error = worker_stderr_text

    records: List[Dict[str, Any]] = []
    execution_metadata: Dict[str, Any] = {}
    normalization_error = ""
    if execution_payload is not None:
        try:
            records, execution_metadata = _normalize_result(execution_payload)
        except Exception as exc:
            normalization_error = str(exc).strip()

    artifact_path = discover_new_artifact(package_root, artifact_snapshot, started_at_ns=started_at_ns)
    artifact_metadata: Dict[str, Any] = {}
    if not records and artifact_path is not None:
        try:
            artifact_records, artifact_metadata = parse_output_artifact(artifact_path)
            records = artifact_records
        except Exception as exc:
            artifact_metadata = {"artifact_parse_error": str(exc).strip()}
            if not execution_error:
                execution_error = str(exc).strip()

    if not records:
        message = execution_error or normalization_error or "Python bot did not produce normalized records"
        raise BotRuntimeExecutionError(
            message,
            exit_code=bot_exit_code,
            stdout_text=str(error_payload.get("stdout_text") or worker_stdout_text),
            stderr_text=str(error_payload.get("stderr_text") or worker_stderr_text or execution_error or normalization_error),
            duration_seconds=duration_seconds,
            artifact_path=str(artifact_path) if artifact_path else "",
            artifact_format=str(artifact_metadata.get("artifact_format") or ""),
        )

    runtime_metadata: Dict[str, Any] = dict(execution_metadata)
    runtime_metadata.update(artifact_metadata)
    if error_payload:
        runtime_metadata.setdefault("bot_stdout", str(error_payload.get("stdout_text") or ""))
        runtime_metadata.setdefault("bot_stderr", str(error_payload.get("stderr_text") or ""))
        runtime_metadata.setdefault("bot_exit_code", int(error_payload.get("exit_code") or bot_exit_code))
        runtime_metadata.setdefault(
            "bot_execution_duration_seconds",
            float(error_payload.get("duration_seconds") or duration_seconds),
        )
        runtime_metadata.setdefault("bot_output_artifact_path", str(error_payload.get("artifact_path") or artifact_path or ""))
        if error_payload.get("error_type"):
            runtime_metadata["bot_runtime_error_type"] = str(error_payload.get("error_type"))
        runtime_metadata["bot_runtime_error_message"] = str(error_payload.get("message") or execution_error or "")
    else:
        runtime_metadata.setdefault("bot_stdout", payload_bot_stdout)
        runtime_metadata.setdefault("bot_stderr", payload_bot_stderr)
        runtime_metadata.setdefault("bot_exit_code", bot_exit_code)
        runtime_metadata.setdefault("bot_execution_duration_seconds", duration_seconds)
        runtime_metadata.setdefault("bot_output_artifact_path", str(artifact_path) if artifact_path else "")

    payload: Dict[str, Any] = {
        "runtime_type": "python",
        "entrypoint_file": str(module_path.name),
        "records": records,
        "execution_metadata": runtime_metadata,
    }
    return payload


def _execute_perl(package_root: Path, entrypoint_file: str, context: Dict[str, Any]) -> Dict[str, Any]:
    timeout_sec = int(os.environ.get("BOT_RUNTIME_TIMEOUT_SEC", "1800") or 1800)
    script_path = _resolve_entrypoint_path(package_root, entrypoint_file)
    perl_exe = shutil.which("perl")
    if not perl_exe:
        raise ValueError("Perl runtime is not available on this server")

    artifact_snapshot = snapshot_artifact_state(package_root)
    started_at_ns = time.time_ns()
    started_at = time.perf_counter()
    stdout_text, stderr_text, returncode = _run_streaming_subprocess(
        [perl_exe, str(script_path)],
        input_text=json.dumps(context, ensure_ascii=False, default=str),
        cwd=str(package_root),
        timeout=timeout_sec,
    )
    duration_seconds = round(time.perf_counter() - started_at, 3)
    worker_stdout_text = stdout_text.strip()
    worker_stderr_text = stderr_text.strip()
    bot_exit_code = int(returncode)

    execution_payload: Any = None
    execution_error = ""
    error_payload: Dict[str, Any] = {}
    payload_bot_stdout = worker_stdout_text
    payload_bot_stderr = worker_stderr_text
    if worker_stdout_text:
        try:
            parsed = json.loads(worker_stdout_text)
            if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
                error_payload = parsed["error"]
                execution_error = str(error_payload.get("message") or "")
            elif isinstance(parsed, dict):
                execution_payload = parsed
            else:
                execution_payload = {"records": parsed}
        except Exception:
            execution_error = worker_stdout_text
    if execution_payload is None and not error_payload:
        execution_error = worker_stderr_text or f"Perl bot exited with code {bot_exit_code}"

    records: List[Dict[str, Any]] = []
    execution_metadata: Dict[str, Any] = {}
    normalization_error = ""
    if execution_payload is not None:
        try:
            records, execution_metadata = _normalize_result(execution_payload)
        except Exception as exc:
            normalization_error = str(exc).strip()

    artifact_path = discover_new_artifact(package_root, artifact_snapshot, started_at_ns=started_at_ns)
    artifact_metadata: Dict[str, Any] = {}
    if not records and artifact_path is not None:
        try:
            artifact_records, artifact_metadata = parse_output_artifact(artifact_path)
            records = artifact_records
        except Exception as exc:
            artifact_metadata = {"artifact_parse_error": str(exc).strip()}
            if not execution_error:
                execution_error = str(exc).strip()

    if not records:
        message = execution_error or normalization_error or "Perl bot did not produce normalized records"
        raise BotRuntimeExecutionError(
            message,
            exit_code=bot_exit_code,
            stdout_text=str(error_payload.get("stdout_text") or worker_stdout_text),
            stderr_text=str(error_payload.get("stderr_text") or worker_stderr_text or execution_error or normalization_error),
            duration_seconds=duration_seconds,
            artifact_path=str(artifact_path) if artifact_path else "",
            artifact_format=str(artifact_metadata.get("artifact_format") or ""),
        )

    runtime_metadata: Dict[str, Any] = dict(execution_metadata)
    runtime_metadata.update(artifact_metadata)
    if error_payload:
        runtime_metadata.setdefault("bot_stdout", str(error_payload.get("stdout_text") or ""))
        runtime_metadata.setdefault("bot_stderr", str(error_payload.get("stderr_text") or ""))
        runtime_metadata.setdefault("bot_exit_code", int(error_payload.get("exit_code") or bot_exit_code))
        runtime_metadata.setdefault(
            "bot_execution_duration_seconds",
            float(error_payload.get("duration_seconds") or duration_seconds),
        )
        runtime_metadata.setdefault("bot_output_artifact_path", str(error_payload.get("artifact_path") or artifact_path or ""))
        if error_payload.get("error_type"):
            runtime_metadata["bot_runtime_error_type"] = str(error_payload.get("error_type"))
        runtime_metadata["bot_runtime_error_message"] = str(error_payload.get("message") or execution_error or "")
    else:
        runtime_metadata.setdefault("bot_stdout", payload_bot_stdout)
        runtime_metadata.setdefault("bot_stderr", payload_bot_stderr)
        runtime_metadata.setdefault("bot_exit_code", bot_exit_code)
        runtime_metadata.setdefault("bot_execution_duration_seconds", duration_seconds)
        runtime_metadata.setdefault("bot_output_artifact_path", str(artifact_path) if artifact_path else "")

    payload: Dict[str, Any] = {
        "runtime_type": "perl",
        "entrypoint_file": str(script_path.name),
        "records": records,
        "execution_metadata": runtime_metadata,
    }
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Run an onboarded bot in an isolated child process.")
    parser.add_argument("--runtime-type", required=True, choices=sorted(SUPPORTED_RUNTIMES))
    parser.add_argument("--package-root", required=True)
    parser.add_argument("--entrypoint-file", required=True)
    parser.add_argument("--entrypoint-function", default="run")
    parser.add_argument("--entrypoint-mode", default="callable")
    parser.add_argument("--entrypoint-args-json", default="[]")
    args = parser.parse_args()

    raw_context = sys.stdin.read().strip()
    context: Dict[str, Any] = json.loads(raw_context) if raw_context else {}
    if not isinstance(context, dict):
        raise ValueError("Bot execution context must be a JSON object")

    package_root = Path(args.package_root).expanduser().resolve()
    if not package_root.exists():
        raise ValueError(f"Bot package root not found: {package_root}")

    if args.runtime_type == "python":
        try:
            entrypoint_args = json.loads(args.entrypoint_args_json)
        except Exception as exc:
            raise ValueError("Bot entrypoint args must be a JSON array") from exc
        if not isinstance(entrypoint_args, list):
            raise ValueError("Bot entrypoint args must be a JSON array")
        payload = _execute_python(
            package_root,
            args.entrypoint_file,
            args.entrypoint_function,
            args.entrypoint_mode,
            [str(arg) for arg in entrypoint_args],
            context,
        )
    else:
        payload = _execute_perl(package_root, args.entrypoint_file, context)

    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        if isinstance(exc, BotRuntimeExecutionError):
            error_payload = {
                "error": {
                    "message": str(exc),
                    "exit_code": exc.exit_code,
                    "stdout_text": exc.stdout_text,
                    "stderr_text": exc.stderr_text,
                    "duration_seconds": exc.duration_seconds,
                    "artifact_path": exc.artifact_path,
                    "artifact_format": exc.artifact_format,
                    "error_type": type(exc).__name__,
                }
            }
            sys.stdout.write(json.dumps(error_payload, ensure_ascii=False, default=str))
            sys.stdout.flush()
        sys.stderr.write(f"{exc}\n")
        tb = traceback.format_exc().strip()
        if tb:
            sys.stderr.write(f"{tb}\n")
        raise SystemExit(1)
