"""
Website discovery via DuckDuckGo search from company/email/LinkedIn identifiers.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.core.logger import setup_logger

logger = setup_logger(__name__)

DISCOVERY_RETRIES = 2
DISCOVERY_TIMEOUT_SECONDS = 12
MAX_CANDIDATES = 10

# Domains unlikely to be the official corporate homepage as primary pick
BLOCKED_DOMAINS = {
    "wikipedia.org",
    "wikidata.org",
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "youtube.com",
    "tiktok.com",
    "reddit.com",
    "amazon.com",
    "ebay.com",
    "glassdoor.com",
    "indeed.com",
    "crunchbase.com",
    "bloomberg.com",
    "yahoo.com",
    "google.com",
    "bing.com",
    "duckduckgo.com",
    "scamadviser.com",
    "scam-detector.com",
    "trustified.in",
    "thewhizzinator.com",
}

LINKEDIN_DOMAIN = "linkedin.com"
DESCRIPTIVE_TOKENS = {
    "inc",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "company",
    "co",
    "technologies",
    "technology",
    "homes",
    "home",
    "official",
}
KNOWN_OFFICIAL_DOMAINS = {
    "openai": "openai.com",
    "microsoft": "microsoft.com",
    "shopfy": "shopify.com",
    "shopify": "shopify.com",
    "slack": "slack.com",
    "airbnb": "airbnb.com",
    "databricks": "databricks.com",
    "snowflake": "snowflake.com",
    "spacex": "spacex.com",
}


def _normalize_company_tokens(company: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", (company or "").lower())
    tokens = [t for t in cleaned.split() if len(t) >= 2 and t not in DESCRIPTIVE_TOKENS]
    return tokens


def _brand_root(company: str) -> str:
    tokens = _normalize_company_tokens(company)
    joined = "".join(tokens)
    if joined in KNOWN_OFFICIAL_DOMAINS:
        return KNOWN_OFFICIAL_DOMAINS[joined].split(".")[0]
    for token in tokens:
        if token in KNOWN_OFFICIAL_DOMAINS:
            return KNOWN_OFFICIAL_DOMAINS[token].split(".")[0]
    return tokens[0] if tokens else ""


def _extract_domain(url: str) -> str:
    if not url:
        return ""
    normalized = url.strip()
    if not normalized.startswith(("http://", "https://")):
        normalized = f"https://{normalized}"
    try:
        parsed = urlparse(normalized)
        domain = (parsed.netloc or parsed.path).lower()
        if domain.startswith("www."):
            domain = domain[4:]
    except Exception:
        domain = normalized.lower()
    return domain.split("/")[0].split("?")[0].split("#")[0]


def _is_blocked_domain(domain: str) -> bool:
    if not domain:
        return True
    for blocked in BLOCKED_DOMAINS:
        if domain == blocked or domain.endswith(f".{blocked}"):
            return True
    return False


def _heuristic_candidates(company_name: str) -> List[Dict[str, Any]]:
    """Fallback candidates derived from company name when search APIs are unavailable."""
    brand_root = _brand_root(company_name)
    slug = brand_root or re.sub(r"[^a-z0-9]+", "", (company_name or "").lower())
    if len(slug) < 2:
        return []

    tokens = _normalize_company_tokens(company_name)
    short_slug = brand_root or (tokens[0] if tokens else slug)
    official_domain = KNOWN_OFFICIAL_DOMAINS.get(slug)

    urls = []
    if official_domain:
        urls.extend([f"https://www.{official_domain}", f"https://{official_domain}"])
    for base in dict.fromkeys([short_slug, slug]):
        urls.extend(
            [
                f"https://www.{base}.com",
                f"https://{base}.com",
                f"https://www.{base}.co",
                f"https://{base}.io",
            ]
        )

    candidates: List[Dict[str, Any]] = []
    for url in urls:
        domain = _extract_domain(url)
        if _is_blocked_domain(domain):
            continue
        candidates.append(
            {
                "url": url,
                "domain": domain,
                "title": f"{company_name} — {domain}",
                "snippet": f"Heuristic domain guess for {company_name}",
                "source": "heuristic",
            }
        )
    return candidates


def _candidate_from_domain(domain: str, source: str) -> Optional[Dict[str, Any]]:
    clean_domain = _extract_domain(domain)
    if not clean_domain or _is_blocked_domain(clean_domain):
        return None
    return {
        "url": f"https://{clean_domain}",
        "domain": clean_domain,
        "title": clean_domain,
        "snippet": f"Candidate derived from {source}",
        "source": source,
    }


def _candidate_rank_key(candidate: Dict[str, Any], company_name: str) -> tuple[int, int, int]:
    domain = candidate.get("domain") or _extract_domain(candidate.get("url", ""))
    root = domain.split(".")[0] if domain else ""
    tld = domain.split(".")[-1] if "." in domain else ""
    brand = _brand_root(company_name)
    bad_tokens = (
        "academy",
        "training",
        "learn",
        "blog",
        "support",
        "docs",
        "help",
        "career",
        "careers",
        "store",
        "rental",
        "rentals",
        "home",
        "homes",
        "technology",
        "technologies",
        "affiliate",
    )
    penalty = 0
    if brand and root == brand and tld == "com":
        penalty -= 80
    elif brand and root == brand:
        penalty -= 45
    elif brand and root.startswith(brand):
        penalty += 15
    elif brand and brand in root:
        penalty += 25
    else:
        penalty += 50
    if any(token in root for token in bad_tokens) and root != brand:
        penalty += 45
    if brand and len(root) > len(brand) + 8:
        penalty += 35
    if "-" in root:
        penalty += 15
    if tld not in ("com", "ai", "io", "co"):
        penalty += 18
    return (penalty, len(root), 0 if candidate.get("source", "").startswith("duckduckgo") else 1)


def _search_sync(company_name: str, max_results: int) -> List[Dict[str, Any]]:
    from duckduckgo_search import DDGS

    query = f"{company_name.strip()} official website"
    results: List[Dict[str, Any]] = []
    backends = ["api", "html", "lite"]
    last_error: Optional[Exception] = None

    for backend in backends:
        try:
            with DDGS() as ddgs:
                for item in ddgs.text(query, max_results=max_results, backend=backend):
                    href = (item.get("href") or item.get("link") or "").strip()
                    if not href:
                        continue
                    domain = _extract_domain(href)
                    if _is_blocked_domain(domain):
                        continue
                    results.append(
                        {
                            "url": href if href.startswith("http") else f"https://{href}",
                            "domain": domain,
                            "title": (item.get("title") or "").strip(),
                            "snippet": (item.get("body") or item.get("snippet") or "").strip(),
                            "source": f"duckduckgo_{backend}",
                        }
                    )
            if results:
                return results
        except Exception as exc:
            last_error = exc
            logger.warning(
                "[Website Discovery] DuckDuckGo backend '%s' failed for '%s': %s",
                backend,
                company_name,
                exc,
            )

    if last_error:
        logger.warning(
            "[Website Discovery] DuckDuckGo unavailable for '%s', using heuristic fallback: %s",
            company_name,
            last_error,
        )
    return _heuristic_candidates(company_name)


class WebsiteDiscoveryService:
    """Discover candidate company websites using DuckDuckGo."""

    async def discover(
        self,
        company_name: str,
        *,
        email_domain: str = "",
        linkedin_url: str = "",
        max_results: int = MAX_CANDIDATES,
    ) -> List[Dict[str, Any]]:
        company = (company_name or "").strip()
        if not company:
            logger.info("[Website Discovery] skipped — empty company name")
            return []

        last_error: Optional[Exception] = None
        for attempt in range(1, DISCOVERY_RETRIES + 1):
            try:
                logger.info(
                    "[Website Discovery] searching for '%s' (attempt %d/%d)",
                    company,
                    attempt,
                    DISCOVERY_RETRIES,
                )
                raw = await asyncio.wait_for(
                    asyncio.to_thread(_search_sync, company, max_results),
                    timeout=DISCOVERY_TIMEOUT_SECONDS,
                )
                email_candidate = _candidate_from_domain(email_domain, "email_domain")
                if email_candidate:
                    raw.insert(0, email_candidate)
                candidates = self._dedupe_candidates(raw, company)
                logger.info(
                    "[Website Discovery] found %d candidate(s) for '%s'",
                    len(candidates),
                    company,
                )
                return candidates
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "[Website Discovery] attempt %d failed for '%s': %s",
                    attempt,
                    company,
                    exc,
                )
                await asyncio.sleep(0.4 * attempt)

        logger.error(
            "[Website Discovery] all attempts failed for '%s': %s",
            company,
            last_error,
        )
        fallback = _heuristic_candidates(company)
        email_candidate = _candidate_from_domain(email_domain, "email_domain")
        if email_candidate:
            fallback.insert(0, email_candidate)
        return self._dedupe_candidates(fallback, company)

    def _dedupe_candidates(
        self,
        raw: List[Dict[str, Any]],
        company_name: str,
    ) -> List[Dict[str, Any]]:
        seen_domains = set()
        unique: List[Dict[str, Any]] = []
        tokens = _normalize_company_tokens(company_name)

        for item in raw:
            domain = item.get("domain") or _extract_domain(item.get("url", ""))
            if not domain or domain in seen_domains:
                continue
            seen_domains.add(domain)

            # Prefer domains that contain a company token (e.g. openai -> openai.com)
            brand = _brand_root(company_name)
            token_hit = bool((brand and domain.split(".")[0] == brand) or any(token in domain for token in tokens))
            item["domain"] = domain
            item["domain_token_match"] = token_hit
            item["is_linkedin"] = LINKEDIN_DOMAIN in domain
            unique.append(item)

        # LinkedIn profiles are useful but ranked after corporate domains
        unique.sort(key=lambda c: _candidate_rank_key(c, company_name))
        return unique[:MAX_CANDIDATES]


website_discovery_service = WebsiteDiscoveryService()
