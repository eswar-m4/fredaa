from __future__ import annotations

import os

import httpx

DEFAULT_PRODUCT_API = "http://127.0.0.1:8080"


def product_api_base() -> str:
    return (os.getenv("FREDA_PRODUCT_API_URL") or DEFAULT_PRODUCT_API).rstrip("/")


def submit_solution_request(payload: dict) -> dict:
    """Create an Ask Freda requirement on the live Freda (Mythili-freda) API."""
    url = f"{product_api_base()}/api/v1/demo/solution-request"
    with httpx.Client(timeout=20) as client:
        response = client.post(url, json=payload)
    if response.status_code >= 400:
        detail = (response.text or "").strip()[:400]
        raise RuntimeError(
            f"Freda platform rejected the requirement ({response.status_code}): {detail or 'no detail'}"
        )
    data = response.json()
    if not isinstance(data, dict) or not data.get("job_id"):
        raise RuntimeError("Freda platform did not return a job id.")
    return data
