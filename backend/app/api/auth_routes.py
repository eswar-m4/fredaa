"""
Authentication endpoints for the user/admin login gate.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

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
