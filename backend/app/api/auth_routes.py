"""
Authentication endpoints for the user/admin login gate.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.database import get_connection
from app.models.admin_schemas import LoginRequest, SignupRequest
from app.services.auth_service import auth_service

router = APIRouter()


def _set_session_cookie(response: JSONResponse, token: str, expires_at) -> None:
    max_age = int(max(60, (expires_at - datetime.utcnow()).total_seconds()))
    response.set_cookie(
        key="freda_session",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
        max_age=max_age,
    )


def _session_payload(session):
    return {
        "session_token": session["session_token"],
        "username": session["username"],
        "user_id": session["user_id"],
        "display_name": session["display_name"],
        "role": session["role"],
        "created_at": session["created_at"].isoformat(),
        "updated_at": session["updated_at"].isoformat(),
        "expires_at": session["expires_at"].isoformat(),
        "last_seen_at": session["last_seen_at"].isoformat(),
    }


@router.post("/login")
async def login(payload: LoginRequest) -> JSONResponse:
    session = auth_service.login(username=payload.username, password=payload.password, role=payload.role)
    body = {"success": True, "session": _session_payload(session)}
    response = JSONResponse(content=body)
    _set_session_cookie(response, session["session_token"], session["expires_at"])
    return response


@router.post("/signup")
async def signup(payload: SignupRequest) -> JSONResponse:
    session = auth_service.signup(
        username=payload.username,
        password=payload.password,
        display_name=payload.display_name,
    )
    body = {"success": True, "session": _session_payload(session)}
    response = JSONResponse(content=body)
    _set_session_cookie(response, session["session_token"], session["expires_at"])
    return response


@router.get("/me")
async def me(request: Request) -> JSONResponse:
    session = auth_service.get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return JSONResponse(content={"authenticated": True, "session": _session_payload(session)})


@router.post("/logout")
async def logout(request: Request) -> JSONResponse:
    auth_service.logout(request)
    response = JSONResponse(content={"success": True})
    response.delete_cookie(key="freda_session", path="/")
    return response


@router.post("/gateway-sync")
async def gateway_sync(request: Request) -> JSONResponse:
    """Auto-authenticate a user that has already been verified by the freda-auth gateway.

    The gateway sets X-Freda-User and X-Freda-Type on every proxied request after
    verifying its own HMAC-signed session cookie, so these headers are trusted.
    Direct access to this port from outside is blocked by IIS — only the gateway
    can reach port 8131.
    """
    username = request.headers.get("x-freda-user", "").strip()
    user_type = request.headers.get("x-freda-type", "").strip()
    if not username or user_type != "market":
        raise HTTPException(status_code=401, detail="Not authenticated via gateway")

    now = datetime.utcnow()
    expires_at = now + timedelta(hours=int(getattr(settings, "FREDA_SESSION_TTL_HOURS", 72)))
    token = secrets.token_urlsafe(32)

    with get_connection() as conn:
        row = conn.execute(
            "SELECT username, role, display_name FROM auth_users WHERE username = ?",
            (username,),
        ).fetchone()

        if not row:
            conn.execute(
                """INSERT INTO auth_users (username, password_hash, role, display_name, active, created_at)
                   VALUES (?, ?, 'user', ?, 1, ?)""",
                (username, "gateway-managed", username, now.isoformat()),
            )
            conn.commit()
            role = "user"
            display_name = username
        else:
            role = row["role"]
            display_name = row["display_name"]

        conn.execute(
            """INSERT INTO auth_sessions
               (session_token, username, role, user_id, display_name,
                created_at, updated_at, expires_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                token, username, role, username, display_name,
                now.isoformat(), now.isoformat(), expires_at.isoformat(), now.isoformat(),
            ),
        )
        conn.commit()

    session = {
        "session_token": token, "username": username, "user_id": username,
        "display_name": display_name, "role": role,
        "created_at": now, "updated_at": now, "expires_at": expires_at, "last_seen_at": now,
    }
    body = {"success": True, "session": _session_payload(session)}
    response = JSONResponse(content=body)
    _set_session_cookie(response, token, expires_at)
    return response
