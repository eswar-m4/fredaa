"""Website scraping service for real company website verification."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import socket
from typing import Any, Dict, Optional, Tuple, List
from urllib.parse import urlparse

import aiohttp
import requests
import trafilatura
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

from app.core.logger import setup_logger

logger = setup_logger(__name__)

SAFE_SCHEMES = {'http', 'https'}
MAX_CONTENT_BYTES = 1024 * 1024
REQUEST_TIMEOUT = 20
MAX_REDIRECTS = 4
MAX_PAGE_TEXT_CHARS = 2000
USER_AGENT = 'FREDA Website Verifier/1.0 (+https://example.com)'
SOCIAL_DOMAINS = ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com']
EMAIL_REGEX = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')

# Realistic phone patterns (require grouping or country prefix for long digit runs)
PHONE_PATTERNS = [
    re.compile(
        r'\+(?:\d{1,3}[\s\-.]?)?(?:\(?\d{2,4}\)?[\s\-.]?)\d{3,4}[\s\-.]?\d{3,4}(?:[\s\-.]?\d{1,6})?',
        re.IGNORECASE,
    ),
    re.compile(
        r'(?<!\d)(?:\(\d{3}\)|\d{3})[\s\-.]?\d{3}[\s\-.]?\d{4}(?!\d)',
        re.IGNORECASE,
    ),
    re.compile(
        r'(?<!\d)\d{3}[\s\-.]\d{3}[\s\-.]\d{4}(?!\d)',
        re.IGNORECASE,
    ),
]

CTA_PHRASE_PATTERNS = [
    re.compile(r'^get started\b', re.I),
    re.compile(r'^sign up\b', re.I),
    re.compile(r'^log in\b', re.I),
    re.compile(r'^learn more\b', re.I),
    re.compile(r'^try .+\b(free|today)\b', re.I),
    re.compile(r'^contact (us|sales)\b', re.I),
    re.compile(r'^subscribe\b', re.I),
    re.compile(r'with chatgpt\b', re.I),
    re.compile(r'^welcome to\b', re.I),
]

LEGAL_SUFFIXES = re.compile(
    r'\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag)\b\.?',
    re.I,
)
ERROR_PAGE_TITLE = re.compile(
    r'\b(access denied|forbidden|attention required|request blocked|error|not found|404|503)\b',
    re.I,
)


def _extract_domain(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc or parsed.path
    domain = domain.lstrip('www.').split(':')[0].split('/')[0]
    return domain.lower()


def _is_private_host(hostname: str) -> bool:
    try:
        addresses = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False

    for family, _, _, _, sockaddr in addresses:
        ip = None
        if family == socket.AF_INET:
            ip = ipaddress.IPv4Address(sockaddr[0])
        elif family == socket.AF_INET6:
            ip = ipaddress.IPv6Address(sockaddr[0].split('%')[0])
        if ip and (ip.is_private or ip.is_loopback or ip.is_multicast or ip.is_link_local or ip.is_reserved):
            return True
    return False


def _safe_url(raw_url: str) -> Optional[str]:
    if not raw_url or not isinstance(raw_url, str):
        return None
    url = raw_url.strip()
    if not url:
        return None
    if not urlparse(url).scheme:
        url = f'https://{url}'
    parsed = urlparse(url)
    if parsed.scheme not in SAFE_SCHEMES:
        return None
    if parsed.username or parsed.password:
        return None
    host = parsed.hostname
    if not host:
        return None
    if host in {'localhost', '127.0.0.1', '::1'}:
        return None
    if _is_private_host(host):
        return None
    return url


def _digits_only(value: str) -> str:
    return re.sub(r'\D+', '', value or '')


def _is_valid_phone(candidate: str) -> bool:
    raw = (candidate or '').strip()
    if not raw:
        return False
    digits = _digits_only(raw)
    if len(digits) < 10 or len(digits) > 15:
        return False
    if len(set(digits)) <= 2:
        return False
    if digits.count('0') / len(digits) > 0.75:
        return False
    # Bare long digit strings (tracking IDs, build numbers)
    if len(digits) >= 12 and not raw.startswith('+') and not re.search(r'[\s\-\(\)\.]', raw):
        return False
    # 10–11 digit strings without formatting are usually IDs, not published phone numbers
    if len(digits) in (10, 11) and not re.search(r'[\s\-\(\)\.\+]', raw):
        return False
    # Reject obvious non-phone numeric tokens
    if re.fullmatch(r'0+', digits) or re.fullmatch(r'1+', digits):
        return False
    return True


def _normalize_phone_display(candidate: str) -> str:
    return re.sub(r'\s+', ' ', candidate.strip())


def _extract_phone_numbers(soup: BeautifulSoup, visible_text: str) -> List[str]:
    found: List[str] = []
    for anchor in soup.find_all('a', href=True):
        href = anchor.get('href', '')
        if href.lower().startswith('tel:'):
            found.append(href[4:].strip())

    for pattern in PHONE_PATTERNS:
        found.extend(pattern.findall(visible_text))

    deduped: List[str] = []
    seen_digits = set()
    for item in found:
        cleaned = _normalize_phone_display(item)
        if not _is_valid_phone(cleaned):
            continue
        key = _digits_only(cleaned)
        if key in seen_digits:
            continue
        seen_digits.add(key)
        deduped.append(cleaned)
    return deduped


def _is_cta_phrase(text: str) -> bool:
    normalized = re.sub(r'\s+', ' ', (text or '').strip())
    if not normalized or len(normalized) > 120:
        return False
    return any(pattern.search(normalized) for pattern in CTA_PHRASE_PATTERNS)


def _clean_company_candidate(text: str) -> str:
    value = re.sub(r'\s+', ' ', (text or '').strip())
    value = re.sub(r'[©®™]', '', value).strip()
    value = re.split(r'\s*[|\-–—]\s*', value)[0].strip()
    if _is_cta_phrase(value):
        return ''
    if len(value) < 2 or len(value) > 80:
        return ''
    if re.match(r'^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$', value):
        return ''
    if re.search(r'\b(scam|fraud|void|checker|validator|safeonline)\b', value, re.I):
        return ''
    return value


def _meta_content(soup: BeautifulSoup, *, name: Optional[str] = None, prop: Optional[str] = None) -> str:
    if name:
        tag = soup.find('meta', attrs={'name': name})
        if tag and tag.get('content'):
            return tag['content'].strip()
    if prop:
        tag = soup.find('meta', attrs={'property': prop})
        if tag and tag.get('content'):
            return tag['content'].strip()
    return ''


def _extract_json_ld_organization(soup: BeautifulSoup) -> str:
    for script in soup.find_all('script', attrs={'type': re.compile(r'application/ld\+json', re.I)}):
        raw = script.string or script.get_text() or ''
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        names = _collect_org_names_from_json_ld(data)
        if names:
            return names[0]
    return ''


def _collect_org_names_from_json_ld(data: Any) -> List[str]:
    names: List[str] = []
    if isinstance(data, list):
        for item in data:
            names.extend(_collect_org_names_from_json_ld(item))
        return names
    if not isinstance(data, dict):
        return names
    type_value = data.get('@type') or data.get('type') or ''
    types = type_value if isinstance(type_value, list) else [type_value]
    types_lower = [str(t).lower() for t in types]
    if any(t in ('organization', 'corporation', 'localbusiness', 'company') for t in types_lower):
        name = data.get('name') or data.get('legalName')
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    for key in ('@graph', 'publisher', 'author', 'mainEntity'):
        nested = data.get(key)
        if nested:
            names.extend(_collect_org_names_from_json_ld(nested))
    return names


def _extract_company_from_title(title: str, domain: str) -> str:
    if not title:
        return ''
    parts = [p.strip() for p in re.split(r'\s*[|\-–—]\s*', title) if p.strip()]
    domain_label = domain.split('.')[0] if domain else ''
    for part in parts:
        cleaned = _clean_company_candidate(part)
        if cleaned and not _is_cta_phrase(cleaned):
            if domain_label and domain_label.lower() in cleaned.lower():
                return cleaned
    for part in parts:
        cleaned = _clean_company_candidate(part)
        if cleaned and not _is_cta_phrase(cleaned) and len(cleaned.split()) <= 4:
            return cleaned
    return _clean_company_candidate(parts[0]) if parts else ''


def _extract_footer_company(soup: BeautifulSoup) -> str:
    footer = soup.find('footer') or soup.find(attrs={'role': 'contentinfo'})
    if not footer:
        return ''
    footer_text = footer.get_text(separator=' ', strip=True)
    match = re.search(r'©\s*\d{4}\s+([A-Za-z0-9][A-Za-z0-9\s&.\'-]{1,60})', footer_text)
    if match:
        return _clean_company_candidate(match.group(1))
    return ''


def _extract_company_name(soup: BeautifulSoup, title: str, url: str) -> str:
    domain = _extract_domain(url)
    candidates: List[Tuple[int, str]] = []

    def add(priority: int, value: str) -> None:
        cleaned = _clean_company_candidate(value)
        if cleaned:
            candidates.append((priority, cleaned))

    add(1, _meta_content(soup, prop='og:site_name'))
    add(2, _extract_json_ld_organization(soup))
    add(3, _meta_content(soup, name='application-name'))
    add(4, _extract_company_from_title(title, domain))
    add(5, _extract_footer_company(soup))

    for element in soup.find_all('h1', limit=3):
        text = element.get_text(separator=' ', strip=True)
        add(6, text)

    if not candidates:
        return ''

    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def _strip_scripts_styles(soup: BeautifulSoup) -> None:
    for tag in soup.find_all(['script', 'style', 'noscript']):
        tag.decompose()


def _meaningful_visible_text(soup: BeautifulSoup) -> str:
    clone = BeautifulSoup(str(soup), 'html.parser')
    _strip_scripts_styles(clone)
    return clone.get_text(separator=' ', strip=True)


def _extract_meaningful_page_text(soup: BeautifulSoup, html: str, description: str) -> str:
    sections: List[str] = []
    if description:
        sections.append(description.strip())

    main = (
        soup.find('main')
        or soup.find(attrs={'role': 'main'})
        or soup.find('article')
        or soup.find(class_=re.compile(r'about|hero|intro|company', re.I))
    )
    if main:
        main_text = main.get_text(separator=' ', strip=True)
        if main_text:
            sections.append(main_text[:1200])

    extracted = trafilatura.extract(html, include_comments=False, include_tables=False)
    if extracted:
        paragraphs = [p.strip() for p in extracted.split('\n') if len(p.strip()) > 40]
        sections.append(' '.join(paragraphs[:3]))

    combined = re.sub(r'\s+', ' ', ' '.join(sections)).strip()
    if len(combined) > MAX_PAGE_TEXT_CHARS:
        combined = combined[:MAX_PAGE_TEXT_CHARS].rsplit(' ', 1)[0] + '…'
    return combined


def _extract_metadata(html: str, url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, 'html.parser')
    title = ''
    description = ''
    keywords: List[str] = []
    social_links: List[str] = []

    if soup.title and soup.title.string:
        title = soup.title.string.strip()

    description = (
        _meta_content(soup, name='description')
        or _meta_content(soup, prop='og:description')
    )

    keyword_tag = soup.find('meta', attrs={'name': 'keywords'})
    if keyword_tag and keyword_tag.get('content'):
        keywords = [kw.strip().lower() for kw in keyword_tag['content'].split(',') if kw.strip()]

    visible_text = _meaningful_visible_text(soup)
    is_error_page = bool(ERROR_PAGE_TITLE.search(title))
    detected_company_name = '' if is_error_page else _extract_company_name(soup, title, url)
    page_text = '' if is_error_page else _extract_meaningful_page_text(soup, html, description)

    if not keywords and page_text:
        tokens = re.findall(r'\b[a-zA-Z]{4,}\b', page_text.lower())
        freq: Dict[str, int] = {}
        for token in tokens:
            freq[token] = freq.get(token, 0) + 1
        keywords = [k for k, _ in sorted(freq.items(), key=lambda item: item[1], reverse=True)[:10]]

    emails = [] if is_error_page else list({m.lower() for m in EMAIL_REGEX.findall(visible_text)})
    phone_numbers = [] if is_error_page else _extract_phone_numbers(soup, visible_text)

    for anchor in soup.find_all('a', href=True):
        href = anchor['href'].strip()
        if any(domain in href.lower() for domain in SOCIAL_DOMAINS):
            social_links.append(href)

    return {
        'url': url,
        'title': title,
        'meta_description': description,
        'emails': emails,
        'phone_numbers': phone_numbers,
        'social_links': social_links,
        'detected_company_name': detected_company_name,
        'detected_keywords': keywords,
        'page_text': page_text,
        'page_text_length': len(page_text),
    }


def normalize_company_name(name: str) -> str:
    value = (name or '').strip().lower()
    value = LEGAL_SUFFIXES.sub('', value)
    value = re.sub(r'[^a-z0-9\s]', ' ', value)
    return re.sub(r'\s+', ' ', value).strip()


def _score_match(record: Dict[str, Any], metadata: Dict[str, Any]) -> Tuple[int, List[str]]:
    company = (record.get('company') or record.get('company_name') or '').strip().lower()
    if not company:
        company = ''
    website = _extract_domain(record.get('website') or record.get('domain') or '')
    site_domain = _extract_domain(metadata.get('url') or '')

    # Scoring per specification:
    # +40 title match, +30 body text match, +20 domain/email match, +10 metadata/keywords
    score = 0
    matched_fields: List[str] = []

    title = (metadata.get('title') or '').lower()
    page_text = (metadata.get('page_text') or '').lower()
    detected = normalize_company_name(metadata.get('detected_company_name') or '')
    company_norm = normalize_company_name(company)

    # Title / detected company match (strong)
    if company_norm:
        if company_norm in normalize_company_name(title) or fuzz.partial_ratio(company_norm, detected) >= 85:
            score += 40
            matched_fields.append('title')
        elif company in title:
            score += 40
            matched_fields.append('title')

    # Body/text match (meaningful excerpt only)
    if company_norm and page_text:
        if company_norm in normalize_company_name(page_text) or company in page_text:
            score += 30
            matched_fields.append('body')
        elif fuzz.partial_ratio(company_norm, page_text[:500]) >= 80:
            score += 25
            matched_fields.append('body')

    # Domain / email match
    email = (record.get('email') or '').strip().lower()
    if email and '@' in email:
        email_domain = email.split('@')[-1]
        if site_domain and email_domain and (email_domain == site_domain or email_domain in site_domain):
            score += 20
            matched_fields.append('email_domain')
    if website and site_domain and (website == site_domain or website in site_domain):
        score += 20
        if 'website' not in matched_fields:
            matched_fields.append('website')

    # Keywords / metadata match
    keywords = metadata.get('detected_keywords') or []
    joined_keywords = ' '.join(keywords).lower() if keywords else ''
    if company and any(token in joined_keywords for token in company.split() if len(token) >= 4):
        score += 10
        matched_fields.append('keywords')
    if metadata.get('meta_description') and company in (metadata.get('meta_description') or '').lower():
        score += 10
        matched_fields.append('meta_description')

    # Social presence gives a small boost
    if metadata.get('social_links'):
        score += 5
        matched_fields.append('social_links')

    confidence = max(0, min(100, int(score)))
    return confidence, sorted(set(matched_fields))


def _sanitize_error(reason: str) -> str:
    if 'timed out' in reason.lower():
        return 'Request timed out'
    if '403' in reason or '404' in reason or 'domain' in reason.lower() or 'name or service' in reason.lower():
        return 'Could not verify domain'
    return 'Website unavailable'


async def _fetch_html_aio(url: str) -> str:
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT, connect=REQUEST_TIMEOUT, sock_read=REQUEST_TIMEOUT)
    async with aiohttp.ClientSession(timeout=timeout, raise_for_status=True) as session:
        async with session.get(url, headers={'User-Agent': USER_AGENT}, max_redirects=MAX_REDIRECTS) as response:
            content_type = response.headers.get('Content-Type', '')
            if 'text/html' not in content_type.lower():
                raise ValueError('Unsupported content type')
            body = []
            total_bytes = 0
            async for chunk in response.content.iter_chunked(1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_CONTENT_BYTES:
                    raise ValueError('Content too large')
                body.append(chunk.decode(errors='ignore'))
            return ''.join(body)


def _fetch_html_requests(url: str) -> str:
    headers = {'User-Agent': USER_AGENT}
    response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, allow_redirects=True)
    content_type = response.headers.get('Content-Type', '')
    if 'text/html' not in content_type.lower():
        raise ValueError('Unsupported content type')
    content = response.text
    if len(content.encode('utf-8')) > MAX_CONTENT_BYTES:
        raise ValueError('Content too large')
    return content


async def fetch_website_metadata(raw_url: str) -> Dict[str, Any]:
    url = _safe_url(raw_url)
    if not url:
        raise ValueError('Could not verify domain')

    try:
        # enforce per-scrape timeout to avoid hanging on slow sites
        logger.info('[Scraper] fetching %s', url)
        html = await asyncio.wait_for(_fetch_html_aio(url), timeout=REQUEST_TIMEOUT)
    except Exception as exc:
        # classify timeout separately for clearer logging
        if isinstance(exc, asyncio.TimeoutError):
            logger.warning('[Scraper][Timeout] fetch timed out for %s', url)
            raise ValueError('Request timed out')
        logger.warning('[Scraper] aiohttp fetch failed for %s: %s', url, exc)
        try:
            html = _fetch_html_requests(url)
        except Exception as inner:
            logger.warning('[Scraper] requests fallback failed for %s: %s', url, inner)
            raise ValueError(_sanitize_error(str(inner)))

    metadata = _extract_metadata(html, url)
    return metadata


async def verify_company_website(record: Dict[str, Any]) -> Dict[str, Any]:
    raw_url = record.get('website') or record.get('domain') or ''
    if not raw_url:
        return {
            'source': 'Company Website',
            'confidence': 0,
            'verified': False,
            'matched_fields': [],
            'extracted_values': {},
            'snippet': 'Website unavailable',
        }

    try:
        metadata = await fetch_website_metadata(raw_url)
        confidence, matched_fields = _score_match(record, metadata)
        snippet = 'Company website verified' if confidence >= 50 else 'Website verification partial'
        return {
            'source': 'Company Website',
            'confidence': confidence,
            'verified': confidence >= 75,
            'matched_fields': matched_fields,
            'extracted_values': metadata,
            'snippet': snippet,
        }
    except ValueError as exc:
        msg = str(exc)
        sanitized = _sanitize_error(msg)
        return {
            'source': 'Company Website',
            'confidence': 0,
            'verified': False,
            'matched_fields': [],
            'extracted_values': {},
            'snippet': sanitized,
        }
    except Exception as exc:
        logger.error('Unexpected website scraper error: %s', exc, exc_info=True)
        return {
            'source': 'Company Website',
            'confidence': 0,
            'verified': False,
            'matched_fields': [],
            'extracted_values': {},
            'snippet': 'Website unavailable',
        }
