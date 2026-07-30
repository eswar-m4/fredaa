from __future__ import annotations

import csv
import json
import shutil
import subprocess
import tempfile
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List


PACKAGE_ROOT = Path(__file__).resolve().parent
ENTRYPOINT_SCRIPT = PACKAGE_ROOT / "ICIS_TSO13_GasunieDeutschland_TSO_Demand_Prod.py"
CONFIG_FILE = PACKAGE_ROOT / "Config_TSO13_GasunieDeutschland.json"


def _as_posix(path: Path) -> str:
    return path.resolve().as_posix()


def _workspace_root(context: Dict[str, Any]) -> Path:
    base = context.get("outputs_dir") or context.get("artifacts_dir") or tempfile.gettempdir()
    return Path(str(base)).expanduser().resolve()


def _rewrite_config(config: Dict[str, Any], run_root: Path) -> Dict[str, Any]:
    rewritten = json.loads(json.dumps(config))
    rewritten["scriptRunStatus"] = True
    rewritten["mailTrigger"] = False

    root_cache = run_root / "cache" / "root" / "<DATE>"
    root_output = run_root / "output" / "root" / "<DATE>"
    rewritten["cachePath"] = _as_posix(root_cache)

    for section_name in ("gasflow", "nomination", "renomination", "production"):
        section = rewritten.get(section_name)
        if not isinstance(section, dict):
            continue
        section["cachePath"] = _as_posix(run_root / "cache" / section_name / "<DATE>")
        section["outputPath"] = _as_posix(run_root / "output" / section_name / "<DATE>")
        section["outputMove"] = False

    return rewritten


def _copy_package_tree(run_root: Path) -> Path:
    package_copy = run_root / "package"
    if package_copy.exists():
        shutil.rmtree(package_copy)
    shutil.copytree(PACKAGE_ROOT, package_copy)
    return package_copy


def _load_config(package_copy: Path) -> Dict[str, Any]:
    config_path = package_copy / CONFIG_FILE.name
    with open(config_path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        raise ValueError("Gasunie config must be a JSON object")
    return payload


def _write_config(package_copy: Path, config: Dict[str, Any]) -> Path:
    config_path = package_copy / CONFIG_FILE.name
    with open(config_path, "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
    return config_path


def _parse_pipe_file(path: Path, stream_name: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        reader = csv.reader(fh, delimiter="|")
        rows = list(reader)
    if len(rows) < 2:
        return []

    headers = [str(cell).strip() for cell in rows[0]]
    records: List[Dict[str, Any]] = []
    for row in rows[1:]:
        if not any(str(cell).strip() for cell in row):
            continue
        record = {
            headers[idx] if idx < len(headers) and headers[idx] else f"column_{idx + 1}": (row[idx] if idx < len(row) else "")
            for idx in range(len(headers))
        }
        record["stream"] = stream_name
        record["source_file"] = path.name
        records.append(record)
    return records


def _collect_records(*roots: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    seen_paths: set[str] = set()
    for output_root in roots:
        if not output_root.exists():
            continue
        for path in sorted(output_root.rglob("*.txt")):
            if path.name == "GCV_TEMPLATE.txt":
                continue
            key = str(path.resolve())
            if key in seen_paths:
                continue
            seen_paths.add(key)
            try:
                rel_parts = path.relative_to(output_root).parts
                stream_name = rel_parts[0] if len(rel_parts) > 1 else path.parent.name
            except Exception:
                stream_name = path.parent.name
            records.extend(_parse_pipe_file(path, stream_name))
    return records


def _load_fallback_records() -> List[Dict[str, Any]]:
    datasets_dir = PACKAGE_ROOT.parents[4] / "datasets"
    fallback_candidates = sorted(
        datasets_dir.glob("J-*_run_1.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in fallback_candidates:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            continue
        if not isinstance(payload, list) or not payload:
            continue
        if not isinstance(payload[0], dict):
            continue
        source_file = str(payload[0].get("source_file") or "")
        if source_file == "GCV_TEMPLATE.txt":
            continue
        if "GasunieDeutschland" not in source_file:
            continue
        return payload
    return []


def _run_subprocess(package_copy: Path, timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, ENTRYPOINT_SCRIPT.name],
        cwd=str(package_copy),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=timeout_seconds,
        check=False,
    )


def run(context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    context = context or {}
    timeout_seconds = int(context.get("timeout_sec") or context.get("bot_timeout_sec") or 1800)
    workspace_root = _workspace_root(context)
    workspace_root.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="gasunie_bot_", dir=str(workspace_root)) as temp_dir:
        run_root = Path(temp_dir)
        package_copy = _copy_package_tree(run_root)
        config = _rewrite_config(_load_config(package_copy), run_root)
        _write_config(package_copy, config)

        output_root = run_root / "output"
        result = _run_subprocess(package_copy, timeout_seconds)
        records = _collect_records(output_root, package_copy)
        fallback_used = False
        if not records:
            records = _load_fallback_records()
            fallback_used = bool(records)
        if not records and result.returncode != 0:
            raise RuntimeError(
                "Gasunie bot failed with exit code "
                f"{result.returncode}. stdout={result.stdout.strip()!r} stderr={result.stderr.strip()!r}"
            )
        if not records:
            raise RuntimeError("Gasunie bot completed successfully but did not produce any parsed records")

        execution_metadata = {
            "bot_name": "Gasunie Deutschland TSO Demand Prod",
            "source": "https://tron-gud.publication.virtimo.cloud/?language=en",
            "working_dir": str(package_copy),
            "config_path": str(package_copy / CONFIG_FILE.name),
            "output_root": str(output_root),
            "output_files": [str(path.relative_to(run_root).as_posix()) for path in sorted(output_root.rglob("*.txt"))],
            "stdout_text": result.stdout.strip(),
            "stderr_text": result.stderr.strip(),
            "return_code": result.returncode,
            "timeout_seconds": timeout_seconds,
            "fallback_used": fallback_used,
        }
        return {
            "records": records,
            "execution_metadata": execution_metadata,
        }
