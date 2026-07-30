"""
Persistent bot catalog for built-in and admin-onboarded bots.
"""

from __future__ import annotations

import json
import shlex
import shutil
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from app.core.database import get_connection, init_db, json_dumps, json_loads
from app.core.logger import setup_logger

logger = setup_logger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SEED_PATH = _REPO_ROOT / "frontend" / "src" / "data" / "bots.json"
_BOT_PACKAGE_ROOT = _REPO_ROOT / "backend" / "data" / "bot_packages"
_SUPPORTED_RUNTIME_TYPES = {"python", "perl"}
_GASUNIE_BUILTIN_NAME = "Gasunie Deutschland TSO Demand Prod"
_GASUNIE_BUILTIN_URL = "https://tron-gud.publication.virtimo.cloud/?language=en"
_GASUNIE_BUILTIN_PACKAGE_ROOT = (
    _BOT_PACKAGE_ROOT
    / "gasunie_deutschland_tso_demand_prod"
    / "ICIS_TSO13_GasunieDeutschland_TSO_Demand_Prod"
)
_NATIONALGRID_BUILTIN_NAME = "NationalGrid TSO29 Gasflow SSO Nomrenom Prod Dem"
_NATIONALGRID_BUILTIN_URL = "https://data.nationalgas.com/reports/find-gas-reports/view"
_NATIONALGRID_BUILTIN_PACKAGE_ROOT = (
    _BOT_PACKAGE_ROOT
    / "nationalgrid_tso29_gasflow_sso_nomrenom_prod_dem"
    / "ICIS_TSO_TSO29_NationalGrid_Gasflow_SSO_Nomrenom_Prod_Dem"
)
_BSE_BUILTIN_NAME = "Bombay Stock Exchange"
_BSE_BUILTIN_URL = "https://www.bseindia.com/corporates/HistoricalAnnualReport.aspx"
_BSE_BUILTIN_PACKAGE_ROOT = (
    _BOT_PACKAGE_ROOT
    / "bse_stock_exchange"
    / "Bombay_Stock_Exchange"
)


def _now() -> str:
    return datetime.utcnow().isoformat()


def _normalize_key(value: Any) -> str:
    return "".join(ch for ch in str(value or "").strip().lower() if ch.isalnum())


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def _bot_identity(bot: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": bot.get("name"),
        "url": bot.get("url"),
        "project": bot.get("project"),
        "type": bot.get("type"),
        "industry": bot.get("industry"),
        "country": bot.get("country"),
        "dataType": bot.get("dataType"),
        "info": bot.get("info"),
        "category": bot.get("category"),
        "complexity": bot.get("complexity"),
        "datapoints": _safe_int(bot.get("datapoints")),
    }


class BotCatalogService:
    def __init__(self) -> None:
        init_db()
        self._seed_builtins()

    def _read_seed_catalog(self) -> List[Dict[str, Any]]:
        if not _SEED_PATH.exists():
            logger.warning("Built-in bot seed catalog missing: %s", _SEED_PATH)
            return []
        try:
            payload = json.loads(_SEED_PATH.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to read built-in bot catalog: %s", exc)
            return []
        bots = payload.get("bots") if isinstance(payload, dict) else []
        return [bot for bot in bots if isinstance(bot, dict)]

    def _seed_builtins(self) -> None:
        bots = self._read_seed_catalog()
        if not bots:
            return
        now = _now()
        with get_connection() as conn:
            for bot in bots:
                bot_id = str(bot.get("id") or bot.get("name") or bot.get("url") or _normalize_key(bot.get("name")))
                record = _bot_identity(bot)
                conn.execute(
                    """
                    INSERT OR IGNORE INTO bot_catalog (
                        id, catalog_kind, source_key, name, url, project, type, industry, country,
                        data_type, info, category, complexity, datapoints, bot_json,
                        package_path, package_files_json, request_id, job_id, active, created_at, updated_at
                    ) VALUES (?, 'built_in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?)
                    """,
                    (
                        bot_id,
                        _normalize_key(bot.get("name") or bot.get("url") or bot_id),
                        record["name"],
                        record["url"],
                        record["project"],
                        record["type"],
                        record["industry"],
                        record["country"],
                        record["dataType"],
                        record["info"],
                        record["category"],
                        record["complexity"],
                        record["datapoints"],
                        json_dumps({**bot, **record}),
                        None,
                        now,
                        now,
                    ),
                )
                self._attach_builtin_package_metadata(conn, bot_id, bot, record, now)
            conn.commit()

    def _attach_builtin_package_metadata(
        self,
        conn,
        bot_id: str,
        bot: Dict[str, Any],
        record: Dict[str, Any],
        now: str,
    ) -> None:
        source_url = str(bot.get("url") or "").strip()
        source_name = str(bot.get("name") or "").strip()
        if (
            (source_name != _GASUNIE_BUILTIN_NAME and source_url != _GASUNIE_BUILTIN_URL)
            and (source_name != _NATIONALGRID_BUILTIN_NAME and source_url != _NATIONALGRID_BUILTIN_URL)
            and (source_name != _BSE_BUILTIN_NAME and source_url != _BSE_BUILTIN_URL)
        ):
            return
        if source_name == _GASUNIE_BUILTIN_NAME or source_url == _GASUNIE_BUILTIN_URL:
            package_root = _GASUNIE_BUILTIN_PACKAGE_ROOT
            bot_name = _GASUNIE_BUILTIN_NAME
            source = _GASUNIE_BUILTIN_URL
            scope = "Full Dump"
        elif source_name == _NATIONALGRID_BUILTIN_NAME or source_url == _NATIONALGRID_BUILTIN_URL:
            package_root = _NATIONALGRID_BUILTIN_PACKAGE_ROOT
            bot_name = _NATIONALGRID_BUILTIN_NAME
            source = _NATIONALGRID_BUILTIN_URL
            scope = "Full Dump"
        else:
            package_root = _BSE_BUILTIN_PACKAGE_ROOT
            bot_name = _BSE_BUILTIN_NAME
            source = _BSE_BUILTIN_URL
            scope = "Full Dump"
        if not package_root.exists():
            logger.warning("%s builtin package root missing: %s", bot_name, package_root)
            return

        package_files = sorted(
            str(path.relative_to(package_root).as_posix())
            for path in package_root.rglob("*")
            if path.is_file()
        )
        bot_payload = {
            **bot,
            **record,
            "package_root": str(package_root),
            "package_files": package_files,
            "package_manifest": {
                "bot_name": bot_name,
                "source": source,
                "scope": scope,
                "runtime_type": "python",
                "entrypoint_file": "run.py",
                "entrypoint_function": "run",
                "entrypoint_mode": "callable",
            },
            "runtime_type": "python",
            "entrypoint_file": "run.py",
            "entrypoint_function": "run",
            "entrypoint_mode": "callable",
            "package_path": str(package_root),
        }
        conn.execute(
            """
            UPDATE bot_catalog
               SET package_path = ?,
                   package_files_json = ?,
                   bot_json = ?,
                   updated_at = ?
             WHERE id = ?
            """,
            (
                str(package_root),
                json_dumps(package_files),
                json_dumps(bot_payload),
                now,
                bot_id,
            ),
        )

    def _rows_to_bots(self, rows: Iterable[Any]) -> List[Dict[str, Any]]:
        bots: List[Dict[str, Any]] = []
        for row in rows:
            payload = json_loads(row["bot_json"], {}) if row["bot_json"] else {}
            if not isinstance(payload, dict):
                payload = {}
            bot = {
                **payload,
                "id": row["id"],
                "catalog_kind": row["catalog_kind"],
                "source_key": row["source_key"],
                "package_path": row["package_path"],
                "package_files": json_loads(row["package_files_json"], []),
                "request_id": row["request_id"],
                "job_id": row["job_id"],
                "active": bool(row["active"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            if not bot.get("name"):
                bot["name"] = row["name"]
            if not bot.get("url"):
                bot["url"] = row["url"]
            if not bot.get("project"):
                bot["project"] = row["project"]
            if not bot.get("type"):
                bot["type"] = row["type"]
            if not bot.get("industry"):
                bot["industry"] = row["industry"]
            if not bot.get("country"):
                bot["country"] = row["country"]
            if not bot.get("dataType"):
                bot["dataType"] = row["data_type"]
            if not bot.get("info"):
                bot["info"] = row["info"]
            if not bot.get("category"):
                bot["category"] = row["category"]
            if not bot.get("complexity"):
                bot["complexity"] = row["complexity"]
            if bot.get("datapoints") is None:
                bot["datapoints"] = row["datapoints"] or 0
            bots.append(bot)
        return bots

    def _bot_package_root(self, bot_id: str) -> Path:
        root = _BOT_PACKAGE_ROOT / bot_id
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _load_manifest_from_zip(self, package_path: str) -> Dict[str, Any]:
        package_file = Path(package_path)
        if not package_file.exists():
            raise ValueError(f"Bot package not found: {package_path}")
        if package_file.suffix.lower() != ".zip":
            raise ValueError("Bot package must be a zip archive")
        with zipfile.ZipFile(package_file, "r") as archive:
            try:
                manifest_bytes = archive.read("manifest.json")
            except KeyError as exc:
                return {}
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except Exception as exc:
            raise ValueError("Bot package manifest.json is not valid JSON") from exc
        if not isinstance(manifest, dict):
            raise ValueError("Bot package manifest must be a JSON object")
        return manifest

    def _validate_manifest(self, manifest: Dict[str, Any]) -> Dict[str, Any]:
        manifest = dict(manifest)
        if manifest.get("bot_name") or manifest.get("name"):
            manifest["bot_name"] = str(manifest.get("bot_name") or manifest.get("name") or "").strip()
        if manifest.get("source"):
            manifest["source"] = str(manifest.get("source") or "").strip()
        if manifest.get("scope"):
            manifest["scope"] = str(manifest.get("scope") or "").strip()
        runtime_value = str(
            manifest.get("runtime_type")
            or manifest.get("runtime")
            or manifest.get("language")
            or ""
        ).strip().lower()
        if runtime_value:
            if runtime_value in {"py", "python3"}:
                runtime_value = "python"
            elif runtime_value in {"pl", "perl5"}:
                runtime_value = "perl"
            manifest["runtime_type"] = runtime_value
        if manifest.get("entrypoint_file") or manifest.get("entrypoint_module") or manifest.get("entrypoint"):
            manifest["entrypoint_file"] = str(
                manifest.get("entrypoint_file")
                or manifest.get("entrypoint_module")
                or manifest.get("entrypoint")
                or ""
            ).strip()
        if manifest.get("entrypoint_function") or manifest.get("entrypoint_callable"):
            manifest["entrypoint_function"] = str(
                manifest.get("entrypoint_function")
                or manifest.get("entrypoint_callable")
                or ""
            ).strip()
        if manifest.get("entrypoint_args") is not None:
            raw_args = manifest.get("entrypoint_args")
            if isinstance(raw_args, list):
                manifest["entrypoint_args"] = [str(arg) for arg in raw_args if str(arg).strip()]
            elif isinstance(raw_args, str):
                manifest["entrypoint_args"] = [arg for arg in shlex.split(raw_args) if arg.strip()]
            else:
                manifest["entrypoint_args"] = []
        if manifest.get("argv") is not None and "entrypoint_args" not in manifest:
            raw_args = manifest.get("argv")
            if isinstance(raw_args, list):
                manifest["entrypoint_args"] = [str(arg) for arg in raw_args if str(arg).strip()]
            elif isinstance(raw_args, str):
                manifest["entrypoint_args"] = [arg for arg in shlex.split(raw_args) if arg.strip()]
            else:
                manifest["entrypoint_args"] = []
        return manifest

    def _safe_extract_zip(self, archive: zipfile.ZipFile, target_root: Path) -> List[str]:
        extracted_files: List[str] = []
        target_root = target_root.resolve()
        for member in archive.infolist():
            member_path = (target_root / member.filename).resolve()
            try:
                member_path.relative_to(target_root)
            except ValueError as exc:
                raise ValueError(f"Unsafe path in bot package: {member.filename}")
            if member.is_dir():
                member_path.mkdir(parents=True, exist_ok=True)
                continue
            member_path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member, "r") as source, open(member_path, "wb") as target:
                shutil.copyfileobj(source, target)
            extracted_files.append(str(member.filename))
        return extracted_files

    def _infer_execution_target(self, archive: zipfile.ZipFile, manifest: Dict[str, Any]) -> Dict[str, Any]:
        names = [info.filename for info in archive.infolist() if not info.is_dir()]
        python_files = [name for name in names if name.lower().endswith(".py")]
        perl_files = [name for name in names if name.lower().endswith(".pl")]
        preferred = ["bot.py", "main.py", "run.py", "scraper.py", "entrypoint.py"]
        main_guard_pattern = re.compile(r'if\s+__name__\s*==\s*[\'"]__main__[\'"]\s*:')
        runtime_type = str(manifest.get("runtime_type") or "").strip().lower()
        chosen_file = str(
            manifest.get("entrypoint_file")
            or manifest.get("entrypoint_module")
            or manifest.get("entrypoint")
            or ""
        ).strip()
        chosen_mode = str(manifest.get("entrypoint_mode") or "").strip().lower()
        chosen_args = manifest.get("entrypoint_args") if isinstance(manifest.get("entrypoint_args"), list) else []
        if not isinstance(chosen_args, list):
            chosen_args = []

        if chosen_file:
            suffix = Path(chosen_file).suffix.lower()
            if suffix == ".py":
                if runtime_type and runtime_type != "python":
                    raise ValueError("Bot manifest runtime_type does not match the Python entrypoint file")
                runtime_type = runtime_type or "python"
            elif suffix == ".pl":
                if runtime_type and runtime_type != "perl":
                    raise ValueError("Bot manifest runtime_type does not match the Perl entrypoint file")
                runtime_type = runtime_type or "perl"
            else:
                raise ValueError(f"Unsupported bot entrypoint file type: {chosen_file}")
        else:
            runtime_type = runtime_type or ("python" if python_files else "perl" if perl_files else "")
            if runtime_type == "python":
                callable_candidates: List[Tuple[str, str]] = []
                script_candidates: List[str] = []
                for candidate in python_files:
                    try:
                        source_text = archive.read(candidate).decode("utf-8", errors="ignore")
                    except Exception:
                        continue
                    if "def run(" in source_text:
                        callable_candidates.append((candidate, "run"))
                    elif "def execute(" in source_text:
                        callable_candidates.append((candidate, "execute"))
                    elif "def main(" in source_text:
                        callable_candidates.append((candidate, "main"))
                    if main_guard_pattern.search(source_text):
                        script_candidates.append(candidate)

                if len(callable_candidates) == 1:
                    chosen_file, chosen_function = callable_candidates[0]
                    chosen_mode = "callable"
                elif len(callable_candidates) > 1:
                    preferred_callable = [item for item in callable_candidates if item[0] in preferred]
                    if len(preferred_callable) == 1:
                        chosen_file, chosen_function = preferred_callable[0]
                        chosen_mode = "callable"
                    else:
                        raise ValueError("Python bot package has multiple possible callable entrypoints; add a manifest to choose one")
                elif len(script_candidates) == 1:
                    chosen_file = script_candidates[0]
                    chosen_mode = "script"
                elif len(script_candidates) > 1:
                    raise ValueError("Python bot package has multiple script entrypoints; add a manifest to choose one")
                elif len(python_files) == 1:
                    chosen_file = python_files[0]
                    chosen_mode = "script"
                else:
                    raise ValueError("Python bot package must include a supported entrypoint file")
            elif runtime_type == "perl":
                preferred_pl = ["bot.pl", "main.pl", "run.pl", "scraper.pl", "entrypoint.pl"]
                for candidate in preferred_pl:
                    if candidate in perl_files:
                        chosen_file = candidate
                        break
                if not chosen_file and perl_files:
                    chosen_file = perl_files[0]

        if not chosen_file:
            if python_files:
                raise ValueError("Python bot packages must expose a run(context), execute(context), or main() entrypoint")
            raise ValueError("Bot package must include a supported .py or .pl entrypoint file")

        chosen_function = str(
            manifest.get("entrypoint_function")
            or manifest.get("entrypoint_callable")
            or ""
        ).strip()
        if runtime_type == "python":
            source_text = ""
            try:
                source_bytes = archive.read(chosen_file)
                source_text = source_bytes.decode("utf-8", errors="ignore")
            except Exception:
                source_text = ""
            if not chosen_mode:
                chosen_mode = "callable" if "def run(" in source_text or "def execute(" in source_text or "def main(" in source_text else "script"
            if chosen_mode == "callable":
                if not chosen_function:
                    if "def run(" in source_text:
                        chosen_function = "run"
                    elif "def execute(" in source_text:
                        chosen_function = "execute"
                    elif "def main(" in source_text:
                        chosen_function = "main"
                if chosen_function not in {"run", "execute", "main"}:
                    raise ValueError("Python bot entrypoint function must be run, execute, or main")
            else:
                chosen_function = ""
        else:
            chosen_function = chosen_function or "run"
        if runtime_type not in _SUPPORTED_RUNTIME_TYPES:
            raise ValueError(f"Unsupported bot runtime: {runtime_type}")

        entrypoint_command = ""
        if runtime_type == "perl":
            entrypoint_command = f"perl {chosen_file}"
        elif chosen_mode == "script":
            entrypoint_command = f"python {chosen_file}"

        command_tokens: List[str] = []
        raw_command = str(manifest.get("entrypoint_command") or "").strip()
        if raw_command:
            try:
                command_tokens = shlex.split(raw_command, posix=False)
            except Exception:
                command_tokens = raw_command.split()
            lowered = [token.lower() for token in command_tokens]
            if command_tokens and (Path(command_tokens[0]).name.lower() in {"python", "python.exe", "py", "perl", "perl.exe"} or command_tokens[0].lower() in {"python", "python.exe", "py", "perl", "perl.exe"}):
                command_tokens = command_tokens[1:]
            if command_tokens and Path(command_tokens[0]).name == Path(chosen_file).name:
                command_tokens = command_tokens[1:]
        if not chosen_args and command_tokens:
            chosen_args = command_tokens
        return {
            "runtime_type": runtime_type or "python",
            "entrypoint_file": chosen_file,
            "entrypoint_function": chosen_function,
            "entrypoint_mode": chosen_mode or ("callable" if chosen_function else "script"),
            "entrypoint_args": [str(arg) for arg in chosen_args],
            "entrypoint_command": entrypoint_command,
        }

    def _extract_package(self, package_path: str, bot_id: str) -> Dict[str, Any]:
        package_file = Path(package_path)
        manifest = self._load_manifest_from_zip(package_path)
        manifest = self._validate_manifest(manifest)
        target_root = self._bot_package_root(bot_id)
        extracted_root = target_root / "source"
        if extracted_root.exists():
            shutil.rmtree(extracted_root)
        extracted_root.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(package_file, "r") as archive:
            inferred_entrypoint = self._infer_execution_target(archive, manifest)
            extracted_files = self._safe_extract_zip(archive, extracted_root)
        return {
            "manifest": manifest,
            "package_root": str(extracted_root),
            "package_archive": str(package_file),
            "package_files": extracted_files,
            **inferred_entrypoint,
        }

    def get_by_job_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM bot_catalog WHERE job_id = ? AND active = 1 LIMIT 1", (job_id,)).fetchone()
        if not row:
            return None
        bots = self._rows_to_bots([row])
        return bots[0] if bots else None

    def get_by_source(self, source: str) -> Optional[Dict[str, Any]]:
        source_text = str(source or "").strip()
        if not source_text:
            return None
        source_normalized = _normalize_key(source_text)
        source_lower = source_text.lower()
        for bot in self.list_bots():
            candidates = [
                bot.get("source_key"),
                bot.get("name"),
                bot.get("url"),
                bot.get("project"),
            ]
            for candidate in candidates:
                candidate_text = str(candidate or "").strip()
                if not candidate_text:
                    continue
                if _normalize_key(candidate_text) == source_normalized:
                    return bot
                candidate_lower = candidate_text.lower()
                if candidate_lower == source_lower:
                    return bot
                if source_lower in candidate_lower or candidate_lower in source_lower:
                    return bot
        return None

    def list_bots(self, *, include_inactive: bool = False) -> List[Dict[str, Any]]:
        with get_connection() as conn:
            if include_inactive:
                rows = conn.execute("SELECT * FROM bot_catalog ORDER BY catalog_kind ASC, created_at DESC, name ASC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM bot_catalog WHERE active = 1 ORDER BY catalog_kind ASC, created_at DESC, name ASC"
                ).fetchall()
        return self._rows_to_bots(rows)

    def get_category_counts(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for bot in self.list_bots():
            category = str(bot.get("category") or "Uncategorized").strip() or "Uncategorized"
            counts[category] = counts.get(category, 0) + 1
        return counts

    def prepare_uploaded_bot_package(self, package_path: str, *, upload_id: str) -> Dict[str, Any]:
        bundle = self._extract_package(package_path, upload_id)
        manifest = bundle["manifest"]
        package_files = bundle.get("package_files") or []
        return {
            "manifest": manifest,
            "package_root": bundle["package_root"],
            "package_archive": bundle["package_archive"],
            "package_files": package_files,
            "runtime_type": bundle.get("runtime_type"),
            "bot_name": manifest.get("bot_name"),
            "source": manifest.get("source"),
            "scope": manifest.get("scope"),
            "entrypoint_file": bundle.get("entrypoint_file"),
            "entrypoint_function": bundle.get("entrypoint_function"),
            "entrypoint_mode": bundle.get("entrypoint_mode"),
            "entrypoint_args": bundle.get("entrypoint_args") or [],
            "entrypoint_command": bundle.get("entrypoint_command"),
        }

    def register_onboarded_bot(
        self,
        *,
        job_id: str,
        request_id: str,
        request_row: Dict[str, Any],
        session: Dict[str, Any],
        uploads: List[Dict[str, Any]],
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = _now()
        raw_payload = json_loads(request_row.get("raw_payload_json"), {}) if request_row.get("raw_payload_json") else {}
        execution_metadata = json_loads(request_row.get("execution_metadata_json"), {}) if request_row.get("execution_metadata_json") else {}
        source = str(request_row.get("source") or raw_payload.get("website_url") or raw_payload.get("source") or "").strip()
        display_name = str(
            request_row.get("dataset_name")
            or raw_payload.get("source_name")
            or raw_payload.get("name")
            or source
            or f"Bot {job_id}"
        ).strip()
        category = str(
            raw_payload.get("category")
            or execution_metadata.get("category")
            or execution_metadata.get("source_kind")
            or "Custom"
        ).strip() or "Custom"
        complexity = str(
            raw_payload.get("complexity")
            or execution_metadata.get("complexity")
            or request_row.get("status_reason")
            or "Medium"
        ).strip() or "Medium"
        datapoints = _safe_int(
            request_row.get("records")
            or execution_metadata.get("records")
            or execution_metadata.get("records_count")
            or 0
        )
        primary_upload_path = ""
        for upload in uploads:
            if isinstance(upload, dict) and str(upload.get("storage_path") or "").strip():
                primary_upload_path = str(upload.get("storage_path")).strip()
                break

        bot_id = f"bot_{job_id}"
        if not primary_upload_path:
            raise ValueError("Bot package upload is required")
        package_bundle = self._extract_package(primary_upload_path, bot_id)
        manifest = package_bundle["manifest"]
        entrypoint_file = str(package_bundle.get("entrypoint_file") or manifest.get("entrypoint_file") or "").strip()
        entrypoint_mode = str(package_bundle.get("entrypoint_mode") or manifest.get("entrypoint_mode") or "").strip().lower()
        entrypoint_function = str(package_bundle.get("entrypoint_function") or manifest.get("entrypoint_function") or "").strip()
        runtime_type = str(package_bundle.get("runtime_type") or manifest.get("runtime_type") or "").strip().lower() or (
            "perl" if entrypoint_file.lower().endswith(".pl") else "python"
        )
        entrypoint_command = str(package_bundle.get("entrypoint_command") or manifest.get("entrypoint_command") or "").strip()
        entrypoint_args = package_bundle.get("entrypoint_args") if isinstance(package_bundle.get("entrypoint_args"), list) else []
        if not entrypoint_file:
            raise ValueError("Bot package must include a supported entrypoint file")
        if runtime_type not in _SUPPORTED_RUNTIME_TYPES:
            raise ValueError(f"Unsupported bot runtime: {runtime_type}")
        if runtime_type == "python":
            if entrypoint_mode not in {"", "callable", "script"}:
                raise ValueError(f"Unsupported bot entrypoint mode: {entrypoint_mode}")
            if entrypoint_mode == "callable":
                if not entrypoint_function:
                    raise ValueError("Python bot package must define a runnable entrypoint function")
                if entrypoint_function not in {"run", "execute", "main"}:
                    raise ValueError("Python bot entrypoint function must be run, execute, or main")
            else:
                entrypoint_function = ""
        if runtime_type == "perl" and not entrypoint_command:
            entrypoint_command = f"perl {entrypoint_file}"
        bot_payload: Dict[str, Any] = {
            "id": bot_id,
            "name": str(manifest.get("bot_name") or display_name).strip() or display_name,
            "project": raw_payload.get("project") or execution_metadata.get("project") or "Admin Onboarded",
            "url": source or str(manifest.get("source") or "").strip(),
            "type": raw_payload.get("type") or execution_metadata.get("source_kind") or "Onboarded Bot",
            "industry": raw_payload.get("industry") or execution_metadata.get("industry") or "Custom",
            "country": raw_payload.get("country") or execution_metadata.get("country") or "Global",
            "dataType": raw_payload.get("dataType") or raw_payload.get("data_type") or execution_metadata.get("data_type") or "Custom Data",
            "info": notes or request_row.get("status_reason") or execution_metadata.get("bot_onboarding_notes") or "Admin onboarded bot",
            "category": category,
            "complexity": complexity,
            "scope": str(manifest.get("scope") or request_row.get("scope") or "").strip(),
            "datapoints": datapoints,
            "runtime_type": runtime_type,
            "source_kind": execution_metadata.get("source_kind"),
            "request_status": request_row.get("request_status"),
            "job_status": request_row.get("job_status"),
            "request_id": request_id,
            "job_id": job_id,
            "package_path": primary_upload_path or None,
            "package_root": package_bundle["package_root"],
            "package_manifest": {
                **manifest,
                "bot_name": str(manifest.get("bot_name") or display_name).strip() or display_name,
                "source": source or str(manifest.get("source") or "").strip(),
                "scope": str(manifest.get("scope") or request_row.get("scope") or "").strip(),
                "runtime_type": runtime_type,
                "entrypoint_file": entrypoint_file,
                "entrypoint_function": entrypoint_function,
                "entrypoint_mode": entrypoint_mode or ("callable" if entrypoint_function else "script"),
                "entrypoint_args": entrypoint_args,
                "entrypoint_command": entrypoint_command,
            },
            "entrypoint_file": entrypoint_file,
            "entrypoint_function": entrypoint_function,
            "entrypoint_mode": entrypoint_mode or ("callable" if entrypoint_function else "script"),
            "entrypoint_args": entrypoint_args,
            "entrypoint_command": entrypoint_command,
            "package_files": uploads,
        }

        stored_uploads = [
            {
                "id": str(upload.get("id")) if isinstance(upload, dict) else "",
                "filename": upload.get("filename") if isinstance(upload, dict) else None,
                "storage_path": upload.get("storage_path") if isinstance(upload, dict) else None,
                "file_size": upload.get("file_size") if isinstance(upload, dict) else None,
                "format": upload.get("format") if isinstance(upload, dict) else None,
            }
            for upload in uploads
            if isinstance(upload, dict)
        ]

        with get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO bot_catalog (
                    id, catalog_kind, source_key, name, url, project, type, industry, country,
                    data_type, info, category, complexity, datapoints, bot_json,
                    package_path, package_files_json, request_id, job_id, active, created_at, updated_at
                ) VALUES (?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    bot_id,
                    _normalize_key(source or display_name or bot_id),
                    bot_payload.get("name"),
                    bot_payload.get("url"),
                    bot_payload.get("project"),
                    bot_payload.get("type"),
                    bot_payload.get("industry"),
                    bot_payload.get("country"),
                    bot_payload.get("dataType"),
                    bot_payload.get("info"),
                    bot_payload.get("category"),
                    bot_payload.get("complexity"),
                    bot_payload.get("datapoints"),
                    json_dumps(bot_payload),
                    primary_upload_path or None,
                    json_dumps(stored_uploads),
                    request_id,
                    job_id,
                    now,
                    now,
                ),
            )
            conn.commit()

        logger.info("Registered onboarded bot %s for job %s", bot_id, job_id)
        return bot_payload

    def build_response(self) -> Dict[str, Any]:
        bots = self.list_bots()
        category_counts = self.get_category_counts()
        return {
            "success": True,
            "bots": bots,
            "categoryCounts": category_counts,
            "total": len(bots),
        }


bot_catalog_service = BotCatalogService()
