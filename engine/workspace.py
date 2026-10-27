"""Customer workspace context for Ask Freda.

The customer portal sends its workspace (projects, their datapoints, sources
and quality figures) with each chat turn. For that turn the catalog Freda
searches is the market catalog plus:

  * each existing project as a Solution  (id ``proj-...``), and
  * each project source as an Agent       (id ``pagent-...``),

so the normal flow — match, use existing, expand, add a new scope — works on
the customer's own projects exactly as it does on the 21 packaged solutions.
Without a workspace the catalog is returned unchanged (market portal).
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

PROJECT_PREFIX = "proj-"
PROJECT_AGENT_PREFIX = "pagent-"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:60] or "item"


def _hostname(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
        return (parsed.hostname or "").replace("www.", "").lower()
    except Exception:
        return ""


def _num(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value)


def with_workspace(catalog: dict, context: dict | None) -> dict:
    projects = [p for p in ((context or {}).get("projects") or []) if isinstance(p, dict) and p.get("name")]
    if not projects:
        return catalog

    workspace = str((context or {}).get("workspace") or "Your workspace")
    industry = str((context or {}).get("industry") or "")
    category = f"{workspace} projects"

    solutions, sources, agents = [], [], []
    for p in projects:
        sid = f"{PROJECT_PREFIX}{_slug(p['name'])}"
        datapoints = [str(d) for d in (p.get("datapoints") or []) if d]
        src_items = [s for s in (p.get("sources") or []) if s]
        src_names = [str(s.get("label") or s.get("name") or s) if isinstance(s, dict) else str(s) for s in src_items]
        records = _num(p.get("records"))
        bits = [f"Existing {workspace} project"]
        if records:
            bits.append(f"{records} records under management")
        if p.get("frequency"):
            bits.append(f"refreshed {str(p['frequency']).lower()}")
        if p.get("reviewStatus"):
            bits.append(f"review: {p['reviewStatus']}")
        solutions.append({
            "id": sid,
            "name": str(p["name"]),
            "category": category,
            "tagline": f"Your existing project · {len(datapoints)} datapoints · {len(src_names)} sources",
            "description": "; ".join(bits) + (f". Datapoints: {', '.join(datapoints[:25])}" if datapoints else ""),
            "records": records,
            "coverage": _num(p.get("coverage")),
            "accuracy": _num(p.get("accuracy")),
            "countriesCovered": "",
            "refreshCadence": str(p.get("frequency") or ""),
            "refreshOptions": [],
            "sourceCount": str(len(src_names)),
            "sourceNames": src_names,
            "attributeCount": str(len(datapoints)),
            "attributes": datapoints,
            "inputAttributeCount": "",
            "workspaceProject": True,
        })
        for i, s in enumerate(src_items):
            name = src_names[i]
            url = str(s.get("url") or "") if isinstance(s, dict) else ""
            sources.append({
                "solutionId": sid,
                "solutionName": str(p["name"]),
                "solutionCategory": category,
                "name": name,
                "url": url,
                "kind": "Customer source",
                "attributesContributed": str(len(datapoints)),
                "region": "",
            })
            agents.append({
                "id": f"{PROJECT_AGENT_PREFIX}{_slug(p['name'])}-{i}",
                "name": name,
                "sourceUrl": url,
                "project": str(p["name"]),
                "type": "Customer agent",
                "category": category,
                "industry": str(p.get("industry") or industry),
                "country": "",
                "dataType": ", ".join(datapoints[:6]),
                "description": f"Source agent for the {workspace} project {p['name']}"
                + (f" ({_num(s.get('records'))} records)" if isinstance(s, dict) and s.get("records") is not None else ""),
                "complexity": "",
                "datapoints": str(len(datapoints)),
                "estimatedRecords": _num(s.get("records")) if isinstance(s, dict) else "",
                "runtimeType": "",
                "hostname": _hostname(url),
                "workspaceProject": True,
            })

    merged = dict(catalog)
    merged["solutions"] = [*catalog["solutions"], *solutions]
    merged["sources"] = [*catalog["sources"], *sources]
    merged["agents"] = [*catalog["agents"], *agents]
    merged["solutionsByCategory"] = [*catalog.get("solutionsByCategory", []), {"name": category, "count": len(solutions)}]
    merged["overview"] = [
        *catalog.get("overview", []),
        {"label": f"{workspace} existing projects", "value": str(len(solutions))},
        {"label": f"{workspace} project source agents", "value": str(len(agents))},
    ]
    return merged
