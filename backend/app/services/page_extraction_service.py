"""Page-grounded extraction for URL-driven solutions.

Used by the ESG Compliance Monitoring and Regulatory Incident & Spill Tracking
solutions: each input row names a page (a company's sustainability page, or a
regulator's incident registry). The page — plus a few relevant subpages — is
rendered in Playwright Chromium and the requested fields are read from that
text by the model. Values are only ever taken from the fetched pages; anything
the pages don't state stays empty. Same approach as the customer portal's
live-refresh extraction (monitoring-refresh.core.ts).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlsplit

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
PAGE_TEXT_LIMIT = 14000          # characters per page sent to the model
MAX_SUBPAGES = 3                 # relevant subpages fetched besides the seed page
MAX_INCIDENTS = 300              # cap on rows read from one registry page

# Fields the pipeline fills itself rather than asking the model for.
PROVENANCE_FIELDS = {"source_url", "last_verified", "case_url"}

PAGE_DATASETS: Dict[str, Dict[str, Any]] = {
    "ds-esg-compliance": {
        "kind": "per_row",
        "entity": "company",
        "url_columns": ("sustainability_url", "esg_url", "esg_page_url", "url", "website", "source_url"),
        "name_columns": ("company_name", "company", "name"),
        "link_keywords": ("sustainab", "esg", "climate", "environment", "net-zero", "netzero", "carbon",
                          "emission", "diversity", "inclusion", "impact", "report", "responsib"),
    },
    "ds-regulatory-incident-tracking": {
        "kind": "list",
        "entity": "incident",
        "url_columns": ("registry_portal_url", "registry_url", "portal_url", "url", "source_url"),
        "name_columns": ("jurisdiction", "state", "province"),
        "link_keywords": ("incident", "spill", "release", "case", "report", "search", "hazmat", "complaint"),
    },
}

_BOT_BLOCK_MARKERS = ("verify you are human", "captcha", "access denied", "attention required", "just a moment")


def _norm_key(key: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(key or "").strip().lower()).strip("_")


def _field(row: Dict[str, Any], names: Tuple[str, ...]) -> str:
    normalized = {_norm_key(k): v for k, v in row.items()}
    for name in names:
        value = normalized.get(name)
        if value is not None and str(value).strip() and str(value).strip().lower() not in ("nan", "none", "-", "—"):
            return str(value).strip()
    return ""


def _ensure_url(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    return value if re.match(r"^https?://", value, re.I) else f"https://{value}"


# ---------------------------------------------------------------------------
# Rendering (Playwright Chromium in its own event loop / worker thread)
# ---------------------------------------------------------------------------

_LINKS_JS = """() => Array.from(document.querySelectorAll('a[href]')).map(a => [a.href, (a.innerText || '').trim().slice(0, 120)])"""


async def _render_all(targets: List[str], keywords: Tuple[str, ...]) -> Dict[str, Dict[str, Any]]:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright is not installed in the backend venv. Run: "
            "pip install -r requirements.txt && python -m playwright install chromium"
        ) from exc

    results: Dict[str, Dict[str, Any]] = {}
    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.launch(headless=True)
        except Exception as exc:
            raise RuntimeError(
                f"Playwright Chromium could not start ({exc}). Run: python -m playwright install chromium"
            ) from exc
        context = await browser.new_context(locale="en-US", viewport={"width": 1366, "height": 900})
        page = await context.new_page()

        async def open_text(url: str) -> Tuple[str, str, List[List[str]]]:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            try:
                await page.wait_for_load_state("load", timeout=8000)
            except Exception:
                pass
            await page.wait_for_timeout(1500)
            text = await page.inner_text("body")
            links = await page.evaluate(_LINKS_JS)
            return page.url, text or "", links or []

        for url in targets:
            try:
                final_url, text, links = await open_text(url)
                lowered = text[:3000].lower()
                if len(text.strip()) < 200 and any(m in lowered for m in _BOT_BLOCK_MARKERS):
                    results[url] = {"error": "Blocked by bot/security protection (challenge page, not real content)"}
                    continue
                sections = [f"### Page: {final_url}\n{text[:PAGE_TEXT_LIMIT]}"]
                seed_host = urlsplit(final_url).hostname or ""
                picked: List[str] = []
                for href, label in links:
                    host = urlsplit(href).hostname or ""
                    if not href.startswith("http") or host != seed_host or href.split("#")[0] == final_url.split("#")[0]:
                        continue
                    haystack = f"{href} {label}".lower()
                    if any(k in haystack for k in keywords) and href not in picked:
                        picked.append(href.split("#")[0])
                    if len(picked) >= MAX_SUBPAGES:
                        break
                for sub in picked:
                    try:
                        sub_url, sub_text, _ = await open_text(sub)
                        if sub_text.strip():
                            sections.append(f"### Page: {sub_url}\n{sub_text[:PAGE_TEXT_LIMIT]}")
                    except Exception as exc:
                        logger.info("Subpage %s skipped: %s", sub, exc)
                results[url] = {"final_url": final_url, "text": "\n\n".join(sections)}
            except Exception as exc:
                results[url] = {"error": f"{type(exc).__name__}: {exc}"}
        await browser.close()
    return results


def _render_in_thread(targets: List[str], keywords: Tuple[str, ...]) -> Dict[str, Dict[str, Any]]:
    loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(_render_all(targets, keywords))
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Model calls
# ---------------------------------------------------------------------------

async def _chat_json(prompt: str, api_key: str) -> Any:
    body = {
        "model": str(getattr(settings, "OPENAI_MODEL", "") or "gpt-4o-mini"),
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "You extract structured data from website text and respond with strict JSON only."},
            {"role": "user", "content": prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            OPENAI_CHAT_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
        )
    if not response.is_success:
        raise RuntimeError(f"OpenAI returned {response.status_code}: {response.text[:300]}")
    text = response.json()["choices"][0]["message"]["content"] or "{}"
    return json.loads(text)


def _clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        value = "; ".join(str(v) for v in value if v not in (None, ""))
    text = str(value).strip()
    if not text or text.lower() in ("unknown", "n/a", "na", "none", "null", "not found", "not stated", "-", "—"):
        return None
    return value if not isinstance(value, str) else text


def _field_lines(fields: List[Dict[str, str]]) -> str:
    return "\n".join(f"  - {f['key']} = {f['label']}" for f in fields)


_RULES = """Rules:
- Use ONLY the website text above. Never use outside or general knowledge.
- If the text clearly states a value for a field, return it (plain string or number).
- If the text does not state it, return JSON null. Never guess or invent a value —
  accuracy matters more than completeness."""


async def _extract_record(entity: str, url: str, page_text: str, fields: List[Dict[str, str]], api_key: str) -> Dict[str, Any]:
    # Smaller prompts per field group read the page more carefully than one big one.
    groups: Dict[str, List[Dict[str, str]]] = {}
    for f in fields:
        groups.setdefault(f.get("group") or "Fields", []).append(f)

    async def one(group_fields: List[Dict[str, str]]) -> Dict[str, Any]:
        prompt = (
            f"Entity: {entity}\nSource URL: {url}\n\n"
            "Website text below is split into \"### Page: <url>\" sections (the page plus a few relevant subpages).\n"
            f"---\n{page_text}\n---\n\n{_RULES}\n\nFields (code = meaning):\n{_field_lines(group_fields)}\n\n"
            "Respond with ONLY a JSON object mapping each field CODE to its value."
        )
        parsed = await _chat_json(prompt, api_key)
        return {f["key"]: _clean(parsed.get(f["key"])) for f in group_fields} if isinstance(parsed, dict) else {}

    out: Dict[str, Any] = {}
    errors: List[str] = []
    for result in await asyncio.gather(*(one(g) for g in groups.values()), return_exceptions=True):
        if isinstance(result, Exception):
            errors.append(str(result))
        else:
            out.update(result)
    if errors and len(errors) == len(groups):
        raise RuntimeError("; ".join(errors))
    return out


async def _extract_list(entity_label: str, context: str, url: str, page_text: str, fields: List[Dict[str, str]], api_key: str) -> List[Dict[str, Any]]:
    prompt = (
        f"{context}\nRegistry URL: {url}\n\n"
        "Website text below is split into \"### Page: <url>\" sections.\n"
        f"---\n{page_text}\n---\n\n{_RULES}\n- Return one entry per distinct {entity_label} actually listed in the text; "
        f"return an empty list if none are listed.\n\nFields for each {entity_label} (code = meaning):\n{_field_lines(fields)}\n\n"
        f'Respond with ONLY a JSON object: {{"items": [{{<field code>: <value>, ...}}, ...]}}'
    )
    parsed = await _chat_json(prompt, api_key)
    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        return []
    rows = []
    for item in items[:MAX_INCIDENTS]:
        if isinstance(item, dict):
            row = {f["key"]: _clean(item.get(f["key"])) for f in fields}
            if any(v is not None for v in row.values()):
                rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def run_page_dataset(
    dataset_id: str,
    input_rows: List[Dict[str, Any]],
    output_fields: List[Dict[str, str]],
) -> Tuple[List[Dict[str, Any]], int]:
    """Returns (records, rows_with_data). Raises on missing input/config or when every page fails."""
    spec = PAGE_DATASETS[dataset_id]
    api_key = str(settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured; page extraction cannot run.")
    rows = [r for r in (input_rows or []) if isinstance(r, dict)]
    if not rows:
        raise RuntimeError("This solution needs an uploaded input file listing the pages to read.")

    targets = [(_ensure_url(_field(r, spec["url_columns"])), _field(r, spec["name_columns"]), r) for r in rows]
    urls = sorted({u for u, _, _ in targets if u})
    if not urls:
        cols = ", ".join(spec["url_columns"][:2])
        raise RuntimeError(f"No page URL column found in the uploaded file (expected e.g. {cols}).")

    rendered = await asyncio.to_thread(_render_in_thread, urls, spec["link_keywords"])
    failures = {u: r["error"] for u, r in rendered.items() if r.get("error")}
    if len(failures) == len(urls):
        sample = "; ".join(f"{u}: {e}" for u, e in list(failures.items())[:3])
        raise RuntimeError(f"Every page failed to load — {sample}")
    for u, e in failures.items():
        logger.warning("Page extraction: %s failed: %s", u, e)

    ask_fields = [f for f in output_fields if f["key"] not in PROVENANCE_FIELDS]
    wanted = {f["key"] for f in output_fields}
    today = datetime.utcnow().date().isoformat()
    records: List[Dict[str, Any]] = []
    with_data = 0

    if spec["kind"] == "per_row":
        for url, name, row in targets:
            page = rendered.get(url) or {}
            record: Dict[str, Any] = {f["key"]: None for f in output_fields}
            if not url or page.get("error"):
                record["_error"] = page.get("error") or "No page URL in this row"
                records.append(record)
                continue
            extracted = await _extract_record(name or url, page["final_url"], page["text"], ask_fields, api_key)
            record.update(extracted)
            if "company_name" in wanted and not record.get("company_name") and name:
                record["company_name"] = name  # the row's own identifier, not an extracted claim
            if "source_url" in wanted:
                record["source_url"] = page["final_url"]
            if "last_verified" in wanted:
                record["last_verified"] = today
            if any(record.get(f["key"]) is not None for f in ask_fields):
                with_data += 1
            records.append(record)
        return records, with_data

    # kind == "list": one registry page yields many incident rows.
    for url, jurisdiction, row in targets:
        page = rendered.get(url) or {}
        if not url or page.get("error"):
            continue
        context = f"Jurisdiction: {jurisdiction}" if jurisdiction else "Jurisdiction: (not given)"
        items = await _extract_list(spec["entity"], context, page["final_url"], page["text"], ask_fields, api_key)
        for item in items:
            record = {f["key"]: None for f in output_fields}
            record.update(item)
            if "jurisdiction" in wanted and not record.get("jurisdiction") and jurisdiction:
                record["jurisdiction"] = jurisdiction
            if "case_url" in wanted:
                record["case_url"] = page["final_url"]
            if "last_verified" in wanted:
                record["last_verified"] = today
            records.append(record)
    if not records:
        raise RuntimeError("The registry pages loaded but listed no incidents that could be read.")
    return records, len(records)
