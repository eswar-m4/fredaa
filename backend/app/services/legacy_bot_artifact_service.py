"""
Legacy bot artifact discovery and parsing helpers.

This module stays intentionally small so the onboarded-bot runtime can use it
as a compatibility bridge for uploaded legacy production packages.
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


SUPPORTED_ARTIFACT_EXTENSIONS = {".json", ".csv", ".tsv", ".txt"}
_IGNORED_FILE_SUFFIXES = {".log", ".tmp", ".temp", ".bak", ".pyc", ".pyo"}
_ARTIFACT_TIME_SLOP_NS = 2_000_000_000


def snapshot_artifact_state(package_root: Path) -> Dict[str, Tuple[int, int]]:
    snapshot: Dict[str, Tuple[int, int]] = {}
    if not package_root.exists():
        return snapshot

    for path in package_root.rglob("*"):
        if not path.is_file():
            continue
        if not _is_candidate_artifact(path):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        snapshot[_relative_key(package_root, path)] = (int(stat.st_mtime_ns), int(stat.st_size))
    return snapshot


def discover_new_artifact(
    package_root: Path,
    snapshot: Dict[str, Tuple[int, int]],
    *,
    started_at_ns: int | None = None,
) -> Optional[Path]:
    if not package_root.exists():
        return None

    newest: Tuple[int, int, str, Path] | None = None
    for path in package_root.rglob("*"):
        if not path.is_file():
            continue
        if not _is_candidate_artifact(path):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        rel_key = _relative_key(package_root, path)
        previous = snapshot.get(rel_key)
        current = (int(stat.st_mtime_ns), int(stat.st_size))
        if previous is not None and previous == current:
            continue
        if previous is None and started_at_ns is not None and stat.st_mtime_ns < started_at_ns - _ARTIFACT_TIME_SLOP_NS:
            continue
        candidate = (int(stat.st_mtime_ns), int(stat.st_size), rel_key, path)
        if newest is None or candidate > newest:
            newest = candidate

    return newest[3] if newest else None


def parse_output_artifact(path: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_ARTIFACT_EXTENSIONS:
        raise ValueError(f"Unsupported artifact format: {suffix}")

    if suffix == ".json":
        return _parse_json_artifact(path), {"artifact_format": "json"}
    if suffix == ".csv":
        records = _parse_delimited_artifact(path, ",")
        return records, {"artifact_format": "csv", "artifact_delimiter": ","}
    if suffix == ".tsv":
        records = _parse_delimited_artifact(path, "\t")
        return records, {"artifact_format": "tsv", "artifact_delimiter": "\\t"}
    return _parse_txt_artifact(path)


def _relative_key(package_root: Path, path: Path) -> str:
    try:
        return path.relative_to(package_root).as_posix()
    except ValueError:
        return str(path)


def _is_candidate_artifact(path: Path) -> bool:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_ARTIFACT_EXTENSIONS:
        return False
    if suffix in _IGNORED_FILE_SUFFIXES:
        return False
    if path.name.startswith("~$"):
        return False
    parts = {part.lower() for part in path.parts}
    if "__pycache__" in parts or ".git" in parts or ".svn" in parts:
        return False
    return True


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _normalize_record_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError(f"Artifact row at index {idx} must be an object")
        normalized.append({str(key): value for key, value in row.items()})
    if not normalized:
        raise ValueError("Artifact did not contain any records")
    return normalized


def _parse_json_artifact(path: Path) -> List[Dict[str, Any]]:
    payload = json.loads(_read_text(path))
    records: Any = payload
    if isinstance(payload, dict):
        for key in ("records", "normalized_records", "output"):
            candidate = payload.get(key)
            if isinstance(candidate, list):
                records = candidate
                break
        else:
            records = [payload]
    if not isinstance(records, list):
        raise ValueError("JSON artifact must contain a list of records or an object with records")
    return _normalize_record_rows(records)


def _parse_delimited_artifact(path: Path, delimiter: str) -> List[Dict[str, Any]]:
    text = _read_text(path)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames or len([field for field in reader.fieldnames if str(field or "").strip()]) < 1:
        raise ValueError("Delimited artifact is missing a header row")

    rows: List[Dict[str, Any]] = []
    for row in reader:
        normalized = {str(key): ("" if value is None else value) for key, value in row.items()}
        if any(str(value).strip() for value in normalized.values()):
            rows.append(normalized)
    return _normalize_record_rows(rows)


def _parse_txt_artifact(path: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    candidates = [
        ("\t", "tab"),
        (",", "comma"),
        ("|", "pipe"),
    ]
    last_error: Optional[Exception] = None
    for delimiter, label in candidates:
        try:
            text = _read_text(path)
            reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
            if not reader.fieldnames or len([field for field in reader.fieldnames if str(field or "").strip()]) < 2:
                raise ValueError("Delimited TXT artifact must contain at least two columns")
            rows: List[Dict[str, Any]] = []
            for row in reader:
                normalized = {str(key): ("" if value is None else value) for key, value in row.items()}
                if any(str(value).strip() for value in normalized.values()):
                    rows.append(normalized)
            rows = _normalize_record_rows(rows)
        except Exception as exc:
            last_error = exc
            continue
        return rows, {"artifact_format": "txt", "artifact_delimiter": label}
    raise ValueError(f"TXT artifact could not be parsed as tab, comma, or pipe delimited data: {last_error}")
