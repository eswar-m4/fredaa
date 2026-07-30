"""
Session-backed admin/user authentication for the login gate and admin console.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request

from app.config import settings
from app.core.database import get_connection, init_db
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class AuthService:
    def __init__(self) -> None:
        init_db()

    @staticmethod
    def _hash_password(password: str) -> str:
        salt = str(getattr(settings, "FREDA_AUTH_SALT", "freda-auth-salt")).encode("utf-8")
        return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000).hex()

    def signup(self, *, username: str, password: str, display_name: Optional[str] = None) -> Dict[str, Any]:
        username = str(username or "").strip()
        password = str(password or "")
        display_name = str(display_name or "").strip() or username

        if not username or not password:
            raise HTTPException(status_code=400, detail="Username and password are required")

        with get_connection() as conn:
            existing = conn.execute(
                "SELECT username FROM auth_users WHERE username = ?",
                (username,),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="Username already exists")

            conn.execute(
                """
                INSERT INTO auth_users (username, password_hash, role, display_name, active, created_at)
                VALUES (?, ?, 'user', ?, 1, ?)
                """,
                (
                    username,
                    self._hash_password(password),
                    display_name,
                    datetime.utcnow().isoformat(),
                ),
            )
            conn.commit()

        return self.login(username=username, password=password, role="user")

    def login(self, *, username: str, password: str, role: str) -> Dict[str, Any]:
        role = str(role or "").strip().lower()
        username = str(username or "").strip()
        if role not in {"user", "admin"}:
            raise HTTPException(status_code=400, detail="Invalid role selection")

        with get_connection() as conn:
            row = conn.execute(
                "SELECT username, password_hash, role, display_name, active FROM auth_users WHERE username = ?",
                (username,),
            ).fetchone()
        if not row or not bool(row["active"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if row["role"] != role:
            raise HTTPException(status_code=401, detail="Role does not match the selected login")
        if self._hash_password(password) != row["password_hash"]:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        now = datetime.utcnow()
        expires_at = now + timedelta(hours=int(getattr(settings, "FREDA_SESSION_TTL_HOURS", 72)))
        token = secrets.token_urlsafe(32)
        user_id = row["username"]
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO auth_sessions (
                    session_token, username, role, user_id, display_name,
                    created_at, updated_at, expires_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    token,
                    row["username"],
                    row["role"],
                    user_id,
                    row["display_name"],
                    now.isoformat(),
                    now.isoformat(),
                    expires_at.isoformat(),
                    now.isoformat(),
                ),
            )
            conn.commit()
        session = {
            "session_token": token,
            "username": row["username"],
            "role": row["role"],
            "user_id": user_id,
            "display_name": row["display_name"],
            "created_at": now,
            "updated_at": now,
            "expires_at": expires_at,
            "last_seen_at": now,
        }
        logger.info("[Auth] %s logged in as %s", row["username"], row["role"])
        return session

    def get_session(self, request: Request) -> Optional[Dict[str, Any]]:
        token = request.cookies.get("freda_session")
        if not token:
            return None
        now = datetime.utcnow()
        with get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM auth_sessions WHERE session_token = ?",
                (token,),
            ).fetchone()
            if not row:
                return None
            expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", ""))
            if expires_at < now:
                conn.execute("DELETE FROM auth_sessions WHERE session_token = ?", (token,))
                conn.commit()
                return None
            conn.execute(
                "UPDATE auth_sessions SET updated_at = ?, last_seen_at = ? WHERE session_token = ?",
                (now.isoformat(), now.isoformat(), token),
            )
            conn.commit()
        return {
            "session_token": row["session_token"],
            "username": row["username"],
            "role": row["role"],
            "user_id": row["user_id"],
            "display_name": row["display_name"],
            "created_at": datetime.fromisoformat(row["created_at"].replace("Z", "")),
            "updated_at": now,
            "expires_at": datetime.fromisoformat(row["expires_at"].replace("Z", "")),
            "last_seen_at": now,
        }

    def require_session(self, request: Request, *, role: Optional[str] = None) -> Dict[str, Any]:
        session = self.get_session(request)
        if not session:
            raise HTTPException(status_code=401, detail="Login required")
        if role and session.get("role") != role:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return session

    def logout(self, request: Request) -> None:
        token = request.cookies.get("freda_session")
        if not token:
            return
        with get_connection() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE session_token = ?", (token,))
            conn.commit()


auth_service = AuthService()
