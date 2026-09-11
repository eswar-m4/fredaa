"""
Freda catalog retrieval service — grounds Ask Freda in the REAL solutions and
agents catalog instead of letting the LLM free-associate plausible-sounding
names.

No vector DB: this catalog is small (19 solutions, ~830 agents), so a
hand-rolled TF-IDF bag-of-words scorer is the right amount of machinery —
real information retrieval (term weighting that downweights generic words
like "data"/"company" and rewards rare, discriminating words like
"firmographic"/"keysight"), without embeddings or an external index.

Data sources (static JSON snapshots, regenerate via
frontend/scripts/export-solutions-catalog.mjs when the catalog changes):
  - backend/app/data/solutions_catalog.json   (19 solutions)
  - frontend/src/data/bots.json               (830 agents)
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

_ROOT = Path(__file__).resolve().parents[3]
_SOLUTIONS_PATH = _ROOT / "backend" / "app" / "data" / "solutions_catalog.json"
_BOTS_PATH = _ROOT / "frontend" / "src" / "data" / "bots.json"

_TOKEN_RE = re.compile(r"[a-z0-9]+")

_STOPWORDS = {
    "a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "with",
    "data", "get", "list", "want", "need", "please", "can", "you", "do",
    "have", "is", "are", "what", "which", "me", "give", "find", "about",
    "all", "some", "any", "info", "information",
}

# Words that, if present in the user's message, strongly suggest a
# "browse/list the catalog" intent rather than a specific data requirement.
_BROWSE_PATTERNS = [
    r"\blist\b.*\b(catalog|catalogue|solutions?|categories|categor)",
    r"\b(full|entire|whole)\b.*\bcatalog",
    r"\bwhat\b.*\b(categories|category)\b",
    r"\bshow\s+(me\s+)?all\b",
    r"\bbrowse\b",
    r"\bwhat\s+(category\s+)?data\s+(do\s+)?you\s+(got|have)\b",
    r"\bcatalog(ue)?\b\s*$",
]
_BROWSE_RE = re.compile("|".join(_BROWSE_PATTERNS), re.IGNORECASE)


def tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]


def detect_browse_intent(message: str) -> bool:
    """True when the user is asking to browse/list the catalog rather than
    describe a specific data requirement — these two intents need very
    different handling and must never be conflated."""
    return bool(_BROWSE_RE.search(message or ""))


class _TfIdfIndex:
    """Minimal TF-IDF index over a fixed set of documents (catalog items).
    Each document is a dict of {field_name: weight} -> text, so a hit in the
    "name" field counts for more than a hit in a long description."""

    def __init__(self, items: List[Dict[str, Any]], field_weights: Dict[str, float]):
        self.items = items
        self.field_weights = field_weights
        self._doc_tokens: List[Counter] = []
        self._df: Counter = Counter()

        for item in items:
            weighted_tokens: Counter = Counter()
            for field, weight in field_weights.items():
                text = self._field_text(item, field)
                if not text:
                    continue
                for tok in tokenize(text):
                    weighted_tokens[tok] += weight
            self._doc_tokens.append(weighted_tokens)
            for tok in set(weighted_tokens):
                self._df[tok] += 1

        n_docs = max(1, len(items))
        self._idf = {
            tok: math.log((n_docs + 1) / (df + 1)) + 1.0 for tok, df in self._df.items()
        }

    @staticmethod
    def _field_text(item: Dict[str, Any], field: str) -> str:
        value = item.get(field)
        if value is None:
            return ""
        if isinstance(value, list):
            parts = []
            for v in value:
                if isinstance(v, dict):
                    parts.append(" ".join(str(x) for x in v.values() if x))
                else:
                    parts.append(str(v))
            return " ".join(parts)
        return str(value)

    def score(self, query_tokens: List[str]) -> List[float]:
        if not query_tokens:
            return [0.0] * len(self.items)
        q_counts = Counter(query_tokens)
        scores: List[float] = []
        for doc in self._doc_tokens:
            s = 0.0
            for tok, q_tf in q_counts.items():
                if tok not in doc:
                    continue
                idf = self._idf.get(tok, 0.0)
                s += q_tf * doc[tok] * idf
            scores.append(s)
        return scores

    def top_n(self, query: str, n: int, min_score: float = 0.0) -> List[Dict[str, Any]]:
        tokens = tokenize(query)
        scores = self.score(tokens)
        ranked = sorted(
            ((score, item) for score, item in zip(scores, self.items)),
            key=lambda pair: pair[0],
            reverse=True,
        )
        out = []
        for score, item in ranked[:n]:
            if score <= min_score:
                continue
            out.append({**item, "_score": round(score, 2)})
        return out


class FredaCatalogService:
    def __init__(self) -> None:
        self._solutions: List[Dict[str, Any]] = self._load_solutions()
        self._agents: List[Dict[str, Any]] = self._load_agents()

        self._solution_index = _TfIdfIndex(
            self._solutions,
            field_weights={
                "name": 5.0,
                "category": 3.0,
                "tagline": 2.0,
                "description": 1.0,
                "outputFieldLabels": 0.6,
                "sources": 0.4,
            },
        )
        self._agent_index = _TfIdfIndex(
            self._agents,
            field_weights={
                "name": 5.0,
                "category": 3.0,
                "industry": 2.5,
                "dataType": 2.0,
                "url": 1.0,
                "info": 1.0,
            },
        )

    @staticmethod
    def _load_solutions() -> List[Dict[str, Any]]:
        if not _SOLUTIONS_PATH.exists():
            return []
        payload = json.loads(_SOLUTIONS_PATH.read_text(encoding="utf-8"))
        return payload.get("solutions", [])

    @staticmethod
    def _load_agents() -> List[Dict[str, Any]]:
        if not _BOTS_PATH.exists():
            return []
        payload = json.loads(_BOTS_PATH.read_text(encoding="utf-8"))
        return payload.get("bots", [])

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    def search(
        self,
        query: str,
        top_solutions: int = 3,
        top_agents: int = 5,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Real ranked retrieval over the actual catalog. Returns only items
        that scored above a real relevance floor — an empty list is a
        legitimate, honest result (no match), not an error."""
        solutions = self._solution_index.top_n(query, top_solutions, min_score=2.0)
        agents = self._agent_index.top_n(query, top_agents, min_score=2.0)
        return {"solutions": solutions, "agents": agents}

    def browse_catalog(self) -> Dict[str, Any]:
        """Deterministic full listing for "show me everything" intents — no
        LLM guesswork needed, this is just the real data grouped by category."""
        by_category: Dict[str, List[str]] = {}
        for s in self._solutions:
            by_category.setdefault(s["category"], []).append(s["name"])

        agent_categories: Dict[str, int] = Counter(
            a.get("category") or "Other" for a in self._agents
        )

        return {
            "solutions_by_category": by_category,
            "solution_count": len(self._solutions),
            "agent_categories": dict(sorted(agent_categories.items(), key=lambda x: -x[1])),
            "agent_count": len(self._agents),
        }

    def get_solution(self, solution_id: str) -> Optional[Dict[str, Any]]:
        return next((s for s in self._solutions if s["id"] == solution_id), None)


freda_catalog_service = FredaCatalogService()
