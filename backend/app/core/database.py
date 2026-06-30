"""
SQLite persistence for review queue, approvals, and audit trail.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Generator, Optional

from app.config import settings
from app.core.logger import setup_logger

logger = setup_logger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS review_items (
    id TEXT PRIMARY KEY,
    record_id TEXT,
    dataset_id TEXT,
    dataset_name TEXT,
    company TEXT,
    confidence INTEGER DEFAULT 0,
    review_status TEXT DEFAULT 'pending',
    review_reason TEXT,
    uploaded_row_json TEXT,
    scraped_metadata_json TEXT,
    comparison_json TEXT,
    discovered_website TEXT,
    website_candidates_json TEXT,
    confidence_reasons_json TEXT,
    field_comparisons_json TEXT,
    suggested_changes_json TEXT,
    sources_checked_json TEXT,
    edited_values_json TEXT,
    ambiguous_candidates INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS approved_records (
    id TEXT PRIMARY KEY,
    review_id TEXT,
    dataset_id TEXT,
    company TEXT,
    approved_values_json TEXT,
    discovered_website TEXT,
    confidence INTEGER,
    approved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT,
    dataset_id TEXT,
    record_id TEXT,
    review_id TEXT,
    company TEXT,
    original_values_json TEXT,
    discovered_values_json TEXT,
    changed_fields_json TEXT,
    approval_path TEXT,
    metadata_json TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS scraper_jobs (
    id TEXT PRIMARY KEY,
    source TEXT,
    scope TEXT,
    filters TEXT,
    custom_criteria TEXT,
    frequency TEXT,
    delivery TEXT,
    output_format TEXT,
    dataset_path TEXT,
    status TEXT,
    records INTEGER DEFAULT 0,
    fresh INTEGER DEFAULT 100,
    created_at TEXT,
    last_refresh TEXT,
    next_refresh TEXT,
    refresh_count INTEGER DEFAULT 0,
    is_custom_source INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'Site-Specific',
    refresh_history_json TEXT DEFAULT '[]',
    changes_detected INTEGER DEFAULT 0,
    planner_json TEXT,
    complexity TEXT,
    estimated_onboarding_time TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_dataset ON review_items(dataset_id);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_items(review_status);
CREATE INDEX IF NOT EXISTS idx_audit_dataset ON audit_events(dataset_id);
CREATE INDEX IF NOT EXISTS idx_scraper_jobs_status ON scraper_jobs(status);
"""


def _db_path() -> Path:
    import os
    raw = getattr(settings, "FREDA_DB_PATH", "data/freda.db")
    path = Path(raw)
    if not path.is_absolute():
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        path = Path(base_dir) / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(_SCHEMA)
        conn.commit()
        
        # Schema migration: Add changes_detected column to scraper_jobs if not already present
        try:
            conn.execute("ALTER TABLE scraper_jobs ADD COLUMN changes_detected INTEGER DEFAULT 0")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists
            
        # Schema migration: Add complexity column to scraper_jobs if not already present
        try:
            conn.execute("ALTER TABLE scraper_jobs ADD COLUMN complexity TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Schema migration: Add estimated_onboarding_time column to scraper_jobs if not already present
        try:
            conn.execute("ALTER TABLE scraper_jobs ADD COLUMN estimated_onboarding_time TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Schema migration: Add planner_json column if not already present
        try:
            conn.execute("ALTER TABLE scraper_jobs ADD COLUMN planner_json TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists
        # Mark stuck 'Running' jobs from previous sessions as 'Failed' on startup
        try:
            conn.execute("UPDATE scraper_jobs SET status = 'Failed' WHERE status = 'Running'")
            conn.commit()
        except Exception:
            pass
            
    logger.info("SQLite database initialized at %s", _db_path())


@contextmanager
def get_connection() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(_db_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def json_dumps(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, default=str)


def json_loads(value: Optional[str], default: Any = None) -> Any:
    if not value:
        return default if default is not None else {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default if default is not None else {}
