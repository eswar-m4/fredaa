from __future__ import annotations

import json
import math
import os
from functools import lru_cache

from llm import _parse_json, llm_config

EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
EMBED_FLOOR = float(os.getenv("FREDA_SEMANTIC_FLOOR", "0.42"))
LLM_FLOOR = float(os.getenv("FREDA_SEMANTIC_LLM_FLOOR", "0.55"))


def semantic_enabled() -> bool:
    flag = (os.getenv("FREDA_SEMANTIC") or "1").strip().lower()
    if flag in {"0", "false", "off", "no"}:
        return False
    return llm_config() is not None


def solution_document(solution: dict) -> str:
    attrs = ", ".join((solution.get("attributes") or [])[:18])
    sources = ", ".join((solution.get("sourceNames") or [])[:8])
    return " ".join(
        part
        for part in [
            solution.get("name") or "",
            solution.get("category") or "",
            solution.get("tagline") or "",
            solution.get("description") or "",
            f"Fields: {attrs}" if attrs else "",
            f"Sources: {sources}" if sources else "",
        ]
        if part
    )


def agent_document(agent: dict) -> str:
    return " ".join(
        part
        for part in [
            agent.get("name") or "",
            agent.get("category") or "",
            agent.get("industry") or "",
            agent.get("dataType") or "",
            agent.get("description") or "",
            agent.get("country") or "",
            agent.get("hostname") or "",
        ]
        if part
    )


def cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for a, b in zip(left, right):
        dot += a * b
        na += a * a
        nb += b * b
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / math.sqrt(na * nb)


def solution_similarities(query: str, solutions: list[dict]) -> dict[str, float]:
    """id -> 0..1 similarity. Empty when semantic ranking is off or unavailable.

    Prefer a grounded LLM rank over embeddings: 19 Solutions is small enough to
    score by meaning, and short paraphrases like "airfare" embed poorly against
    long catalog blurbs.
    """
    if not semantic_enabled() or not query.strip() or not solutions:
        return {}
    try:
        scores = _llm_similarities(query, solutions)
        if scores:
            return scores
    except Exception:
        pass
    try:
        scores = _embed_similarities(query, solutions, solution_document)
        if scores:
            return scores
    except Exception:
        pass
    return {}


def agent_similarities(query: str, agents: list[dict], limit: int = 80) -> dict[str, float]:
    if not semantic_enabled() or not query.strip() or not agents:
        return {}
    try:
        return _embed_similarities(query, agents[:limit], agent_document)
    except Exception:
        return {}


def _embed_similarities(query: str, items: list[dict], document_of) -> dict[str, float]:
    cfg = llm_config()
    if cfg is None or not getattr(cfg.client, "embeddings", None):
        return {}
    docs = [document_of(item) for item in items]
    vectors = _catalog_vectors(tuple(item.get("id") or "" for item in items), tuple(docs))
    query_vec = _embed_texts([query])[0]
    out: dict[str, float] = {}
    for item, vector in zip(items, vectors):
        item_id = str(item.get("id") or "")
        if not item_id or not vector:
            continue
        out[item_id] = cosine(query_vec, vector)
    return out


@lru_cache(maxsize=8)
def _catalog_vectors(ids: tuple[str, ...], docs: tuple[str, ...]) -> tuple[list[float], ...]:
    return tuple(_embed_texts(list(docs)))


def _embed_texts(texts: list[str]) -> list[list[float]]:
    cfg = llm_config()
    if cfg is None:
        raise RuntimeError("no llm")
    response = cfg.client.embeddings.create(model=EMBED_MODEL, input=texts)
    rows = sorted(response.data, key=lambda item: item.index)
    return [list(item.embedding) for item in rows]


def _llm_similarities(query: str, solutions: list[dict]) -> dict[str, float]:
    cfg = llm_config()
    if cfg is None:
        return {}
    catalog = [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "category": item.get("category"),
            "tagline": item.get("tagline"),
            "description": (item.get("description") or "")[:280],
        }
        for item in solutions
        if item.get("id")
    ]
    messages = [
        {
            "role": "system",
            "content": (
                "Score how well each packaged Solution satisfies the user's data request. "
                "Use meaning, not keyword overlap. Return JSON only: "
                '{"scores": {"ds-travel": 0.91}}. '
                "Ids must come from the catalog. 0 = unrelated, 1 = the right product. "
                f"Omit anything below {LLM_FLOOR}."
            ),
        },
        {
            "role": "user",
            "content": json.dumps({"query": query, "solutions": catalog}, ensure_ascii=False),
        },
    ]
    try:
        response = cfg.client.chat.completions.create(
            model=cfg.model,
            response_format={"type": "json_object"},
            messages=messages,
            timeout=40,
        )
    except Exception:
        response = cfg.client.chat.completions.create(
            model=cfg.model,
            temperature=0,
            messages=messages,
            timeout=40,
        )
    parsed = _parse_json(response.choices[0].message.content or "{}")
    raw = parsed.get("scores") if isinstance(parsed, dict) else None
    if not isinstance(raw, dict):
        return {}
    allowed = {str(item.get("id")) for item in catalog}
    out: dict[str, float] = {}
    for key, value in raw.items():
        item_id = str(key)
        if item_id not in allowed:
            continue
        try:
            score = float(value)
        except (TypeError, ValueError):
            continue
        if score >= LLM_FLOOR:
            out[item_id] = max(0.0, min(1.0, score))
    return out
