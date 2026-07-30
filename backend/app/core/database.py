"""
SQLite persistence for review queue, approvals, and audit trail.
"""

from __future__ import annotations

import json
import sqlite3
import shutil
from contextlib import contextmanager
from datetime import datetime
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
    owner_username TEXT,
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
    is_urgent INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'Site-Specific',
    refresh_history_json TEXT DEFAULT '[]',
    changes_detected INTEGER DEFAULT 0,
    planner_json TEXT,
    complexity TEXT,
    estimated_onboarding_time TEXT
);

CREATE TABLE IF NOT EXISTS auth_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    display_name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    session_token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_request_audit (
    id TEXT PRIMARY KEY,
    job_id TEXT UNIQUE,
    request_type TEXT,
    source TEXT,
    dataset_name TEXT,
    mode TEXT,
    scope TEXT,
    user_id TEXT,
    username TEXT,
    role TEXT,
    display_name TEXT,
    raw_payload_json TEXT,
    planner_json TEXT,
    planner_status TEXT,
    request_status TEXT,
    job_status TEXT,
    status_reason TEXT,
    execution_metadata_json TEXT,
    timeline_json TEXT,
    decision_state TEXT,
    decision_by TEXT,
    decision_at TEXT,
    decision_reason TEXT,
    created_at TEXT,
    updated_at TEXT,
    investigated INTEGER DEFAULT 0,
    investigated_at TEXT,
    investigated_by TEXT,
    investigated_notes TEXT
);

CREATE TABLE IF NOT EXISTS bot_catalog (
    id TEXT PRIMARY KEY,
    catalog_kind TEXT,
    source_key TEXT,
    name TEXT,
    url TEXT,
    project TEXT,
    type TEXT,
    industry TEXT,
    country TEXT,
    data_type TEXT,
    info TEXT,
    category TEXT,
    complexity TEXT,
    datapoints INTEGER DEFAULT 0,
    bot_json TEXT NOT NULL,
    package_path TEXT,
    package_files_json TEXT,
    request_id TEXT,
    job_id TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_dataset ON review_items(dataset_id);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_items(review_status);
CREATE INDEX IF NOT EXISTS idx_audit_dataset ON audit_events(dataset_id);
CREATE INDEX IF NOT EXISTS idx_scraper_jobs_status ON scraper_jobs(status);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_role ON auth_sessions(role);
CREATE INDEX IF NOT EXISTS idx_admin_request_status ON admin_request_audit(request_status);
CREATE INDEX IF NOT EXISTS idx_admin_request_type ON admin_request_audit(request_type);
CREATE INDEX IF NOT EXISTS idx_admin_request_user ON admin_request_audit(username);
CREATE INDEX IF NOT EXISTS idx_admin_request_created_at ON admin_request_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_bot_catalog_category ON bot_catalog(category);
CREATE INDEX IF NOT EXISTS idx_bot_catalog_kind ON bot_catalog(catalog_kind);
CREATE INDEX IF NOT EXISTS idx_bot_catalog_active ON bot_catalog(active);
"""


def _db_path() -> Path:
    import os
    raw = getattr(settings, "FREDA_DB_PATH", "data/freda.db")
    path = Path(raw)
    if not path.is_absolute():
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        path = Path(base_dir) / path
    path.parent.mkdir(parents=True, exist_ok=True)
    legacy_path = Path(__file__).resolve().parents[2] / "data" / "freda.db"
    if legacy_path.exists() and legacy_path.resolve() != path.resolve() and not path.exists():
        shutil.copy2(legacy_path, path)
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

        # Schema migration: Add urgent flag for monitoring/review highlighting
        try:
            conn.execute("ALTER TABLE scraper_jobs ADD COLUMN is_urgent INTEGER DEFAULT 0")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Schema migration: Add owner_username column so jobs can be scoped per signed-in user.
        try:
            conn.execute("ALTER TABLE scraper_jobs ADD COLUMN owner_username TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Auth + admin console tables
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_users (
                    username TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    active INTEGER DEFAULT 1,
                    created_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    session_token TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    role TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_request_audit (
                    id TEXT PRIMARY KEY,
                    job_id TEXT UNIQUE,
                    request_type TEXT,
                    source TEXT,
                    dataset_name TEXT,
                    mode TEXT,
                    scope TEXT,
                    user_id TEXT,
                    username TEXT,
                    role TEXT,
                    display_name TEXT,
                    raw_payload_json TEXT,
                    planner_json TEXT,
                    planner_status TEXT,
                    request_status TEXT,
                    job_status TEXT,
                    status_reason TEXT,
                    execution_metadata_json TEXT,
                    timeline_json TEXT,
                    decision_state TEXT,
                    decision_by TEXT,
                    decision_at TEXT,
                    decision_reason TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    investigated INTEGER DEFAULT 0,
                    investigated_at TEXT,
                    investigated_by TEXT,
                    investigated_notes TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS bot_catalog (
                    id TEXT PRIMARY KEY,
                    catalog_kind TEXT,
                    source_key TEXT,
                    name TEXT,
                    url TEXT,
                    project TEXT,
                    type TEXT,
                    industry TEXT,
                    country TEXT,
                    data_type TEXT,
                    info TEXT,
                    category TEXT,
                    complexity TEXT,
                    datapoints INTEGER DEFAULT 0,
                    bot_json TEXT NOT NULL,
                    package_path TEXT,
                    package_files_json TEXT,
                    request_id TEXT,
                    job_id TEXT,
                    active INTEGER DEFAULT 1,
                    created_at TEXT,
                    updated_at TEXT
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(session_token)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_role ON auth_sessions(role)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_admin_request_status ON admin_request_audit(request_status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_admin_request_type ON admin_request_audit(request_type)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_admin_request_user ON admin_request_audit(username)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_admin_request_created_at ON admin_request_audit(created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_bot_catalog_category ON bot_catalog(category)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_bot_catalog_kind ON bot_catalog(catalog_kind)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_bot_catalog_active ON bot_catalog(active)")
            conn.commit()
        except Exception:
            pass

        for column_def, pragma_column in [
            ("decision_state TEXT", "decision_state"),
            ("decision_by TEXT", "decision_by"),
            ("decision_at TEXT", "decision_at"),
            ("decision_reason TEXT", "decision_reason"),
        ]:
            try:
                existing = conn.execute("PRAGMA table_info(admin_request_audit)").fetchall()
                if not any(str(row[1]) == pragma_column for row in existing):
                    conn.execute(f"ALTER TABLE admin_request_audit ADD COLUMN {column_def}")
                    conn.commit()
            except sqlite3.OperationalError:
                pass

        try:
            existing = conn.execute("PRAGMA table_info(bot_catalog)").fetchall()
            bot_columns = {
                "catalog_kind": "catalog_kind TEXT",
                "source_key": "source_key TEXT",
                "name": "name TEXT",
                "url": "url TEXT",
                "project": "project TEXT",
                "type": "type TEXT",
                "industry": "industry TEXT",
                "country": "country TEXT",
                "data_type": "data_type TEXT",
                "info": "info TEXT",
                "category": "category TEXT",
                "complexity": "complexity TEXT",
                "datapoints": "datapoints INTEGER DEFAULT 0",
                "bot_json": "bot_json TEXT",
                "package_path": "package_path TEXT",
                "package_files_json": "package_files_json TEXT",
                "request_id": "request_id TEXT",
                "job_id": "job_id TEXT",
                "active": "active INTEGER DEFAULT 1",
                "created_at": "created_at TEXT",
                "updated_at": "updated_at TEXT",
            }
            existing_names = {str(row[1]) for row in existing}
            for column_name, column_def in bot_columns.items():
                if column_name not in existing_names:
                    conn.execute(f"ALTER TABLE bot_catalog ADD COLUMN {column_def}")
                    conn.commit()
        except sqlite3.OperationalError:
            pass

        # Seed default login accounts if they don't exist yet.
        try:
            from hashlib import pbkdf2_hmac
            from app.config import settings as _settings
            import os

            def _hash(password: str) -> str:
                salt = str(getattr(_settings, "FREDA_AUTH_SALT", "freda-auth-salt")).encode("utf-8")
                return pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000).hex()

            default_users = [
                ("user", _hash("REDACTED_USER_PASS"), "user", "FreshData User"),
                ("admin", _hash("REDACTED_ADMIN_PASS"), "admin", "FreshData Admin"),
            ]
            now = datetime.utcnow().isoformat()
            for username, password_hash, role, display_name in default_users:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO auth_users (
                        username, password_hash, role, display_name, active, created_at
                    ) VALUES (?, ?, ?, ?, 1, ?)
                    """,
                    (username, password_hash, role, display_name, now),
                )
            conn.commit()
        except Exception:
            pass

        try:
            conn.execute(
                "UPDATE scraper_jobs SET owner_username = 'user' WHERE owner_username IS NULL"
            )
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
