"""
Simple mock connectors for external source verification.

These connectors simulate checks for Company Website, LinkedIn, SEC/MCA, News, and Custom URLs.
They use basic heuristics (domain matching, name similarity, keyword presence) and return
a lightweight match object consumed by the workflow engine.
"""
from typing import Dict, Any
import re
from difflib import SequenceMatcher
from urllib.parse import urlparse


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _extract_domain(value: str) -> str:
    if not value:
        return ''
    normalized = value.strip().lower()
    if not normalized.startswith(('http://', 'https://')):
        normalized = f'https://{normalized}'
    try:
        parsed = urlparse(normalized)
        domain = parsed.netloc or parsed.path
    except Exception:
        domain = normalized
    domain = domain.lstrip('www.')
    return domain.split('/')[0].split('?')[0].split('#')[0]


def check_company_website(record: Dict[str, Any]) -> Dict[str, Any]:
    raw_domain = record.get('domain') or record.get('website') or ''
    domain = _extract_domain(raw_domain)
    name = (record.get('company') or record.get('company_name') or '')
    verified = False
    score = 0.0
    reasons = []
    if domain:
        # simple domain pattern check
        if re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", domain):
            verified = True
            score += 25
            reasons.append('domain_valid')
    if name and domain:
        similarity_score = _similarity(name.split()[0], domain)
        if similarity_score >= 0.75:
            score += 35
            reasons.append('name_domain_match')
        elif similarity_score >= 0.4:
            score += 15
            reasons.append('name_domain_partial')
    return {
        'source': 'company_website',
        'verified': verified,
        'score': score,
        'snippet': f"Website check: domain={domain}",
    }


def check_linkedin(record: Dict[str, Any]) -> Dict[str, Any]:
    name = (record.get('company') or record.get('company_name') or '')
    linked = bool(record.get('linkedin'))
    score = 20 if linked else 0
    reasons = ['linkedin_profile'] if linked else []
    # small boost for name similarity heuristic
    if name and linked:
        score += 10
    return {
        'source': 'linkedin',
        'verified': linked,
        'score': score,
        'snippet': 'LinkedIn presence' if linked else 'No LinkedIn found',
    }


def check_sec_mca(record: Dict[str, Any]) -> Dict[str, Any]:
    # Mock: public registry match if company name has multiple words or uppercase letters
    name = record.get('company') or record.get('company_name') or ''
    match = len(name.split()) > 1 or any(c.isupper() for c in name)
    return {
        'source': 'sec_mca',
        'verified': bool(match),
        'score': 15 if match else 0,
        'snippet': 'Registry match' if match else 'No registry match',
    }


def check_news(record: Dict[str, Any]) -> Dict[str, Any]:
    # Mock: keyword overlap between name and custom fields
    name = (record.get('company') or '')
    keywords = record.get('keywords') or ''
    score = 10 if name and keywords and name.split()[0].lower() in keywords.lower() else 0
    return {
        'source': 'news',
        'verified': score > 0,
        'score': score,
        'snippet': 'News keyword match' if score > 0 else 'No news match',
    }


def check_custom_urls(record: Dict[str, Any], urls) -> Dict[str, Any]:
    # Check presence of domain or company in any provided custom URL string
    name = record.get('company') or ''
    domain = record.get('domain') or ''
    positive = 0
    for u in (urls or []):
        lu = u.lower()
        if domain and domain.lower() in lu:
            positive += 1
        elif name and name.split()[0].lower() in lu:
            positive += 1
    return {
        'source': 'custom_urls',
        'verified': positive > 0,
        'score': min(25, positive * 10),
        'snippet': f'Checked {len(urls or [])} custom URLs',
    }
