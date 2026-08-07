"""Website scraping service for real company website verification."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import socket
from typing import Any, Dict, Optional, Tuple, List
from urllib.parse import urljoin, urlparse

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
MAX_DEEP_CRAWL_PAGES = 8
USER_AGENT = 'FREDA Website Verifier/1.0 (+https://example.com)'
SOCIAL_DOMAINS = ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com']
EMAIL_REGEX = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
ADDRESS_HINTS = re.compile(
    r'\b(?:street|st\.|road|rd\.|avenue|ave\.|blvd\.|boulevard|drive|dr\.|lane|ln\.|suite|ste\.|floor|fl\.|campus|park|center|centre|plaza|road|way|building|tower)\b',
    re.I,
)
PAGE_PATH_KEYWORDS = (
    "about",
    "about-us",
    "about/company",
    "about/team",
    "company",
    "company/about",
    "company/overview",
    "company/press",
    "company/news",
    "who-we-are",
    "our-company",
    "contact",
    "contact-us",
    "contact/company",
    "investor",
    "investors",
    "investor-relations",
    "ir",
    "careers",
    "jobs",
    "press",
    "press-room",
    "newsroom",
    "news",
    "leadership",
    "team",
    "support",
    "help",
)

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


def clean_wayback(url: str) -> str:
    if not url:
        return url
    cleaned = re.sub(r'^(?:https?://(?:www\.)?web\.archive\.org)?/web/\d+[a-z_]*/', '', url, flags=re.IGNORECASE)
    return cleaned


def _strip_wayback_noise(soup: BeautifulSoup) -> None:
    for tag in soup.find_all(id=re.compile(r'^wm-ipp', re.I)):
        tag.decompose()
    for tag in soup.find_all(class_=re.compile(r'^wm-ipp', re.I)):
        tag.decompose()
    for tag in soup.find_all(id=re.compile(r'^donato', re.I)):
        tag.decompose()


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


def _meta_content_any(soup: BeautifulSoup, keys: List[str]) -> str:
    for key in keys:
        value = _meta_content(soup, name=key) or _meta_content(soup, prop=key)
        if value:
            return value
    return ''


def _json_ld_objects(soup: BeautifulSoup) -> List[Any]:
    payloads: List[Any] = []
    for script in soup.find_all('script', attrs={'type': re.compile(r'application/ld\+json', re.I)}):
        raw = script.string or script.get_text() or ''
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        payloads.append(data)
    return payloads


def _extract_json_ld_records(soup: BeautifulSoup) -> Dict[str, Any]:
    fields: Dict[str, Any] = {}
    for data in _json_ld_objects(soup):
        for record in _flatten_json_ld_records(data):
            for key, value in record.items():
                if value in (None, '', [], {}):
                    continue
                if key == 'same_as' and isinstance(value, list):
                    fields.setdefault('social_links', [])
                    fields['social_links'].extend([str(item).strip() for item in value if str(item).strip()])
                    continue
                if key == 'address' and isinstance(value, dict):
                    formatted = _format_address(value)
                    if formatted:
                        fields.setdefault('hq_address', formatted)
                    city = value.get('addressLocality') or value.get('addressRegion')
                    if city:
                        fields.setdefault('hq_city', str(city).strip())
                    country = value.get('addressCountry')
                    if country:
                        fields.setdefault('hq_country', str(country).strip())
                    continue
                if key == 'telephone':
                    fields.setdefault('phone_numbers', [])
                    fields['phone_numbers'].append(str(value).strip())
                    continue
                if key == 'email':
                    fields.setdefault('emails', [])
                    fields['emails'].append(str(value).strip())
                    continue
                if key == 'contact_point' and isinstance(value, dict):
                    contact_tel = value.get('telephone') or value.get('contactType')
                    contact_email = value.get('email')
                    contact_address = value.get('address')
                    if contact_tel:
                        fields.setdefault('phone_numbers', [])
                        fields['phone_numbers'].append(str(contact_tel).strip())
                    if contact_email:
                        fields.setdefault('emails', [])
                        fields['emails'].append(str(contact_email).strip())
                    if isinstance(contact_address, dict):
                        formatted = _format_address(contact_address)
                        if formatted:
                            fields.setdefault('hq_address', formatted)
                    continue
                fields.setdefault(key, value)
    if 'social_links' in fields:
        seen = set()
        deduped = []
        for link in fields['social_links']:
            link = str(link).strip()
            if link and link not in seen:
                seen.add(link)
                deduped.append(link)
        fields['social_links'] = deduped
    return fields


def _flatten_json_ld_records(data: Any) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    if isinstance(data, list):
        for item in data:
            records.extend(_flatten_json_ld_records(item))
        return records
    if not isinstance(data, dict):
        return records

    type_value = data.get('@type') or data.get('type') or ''
    types = type_value if isinstance(type_value, list) else [type_value]
    types_lower = [str(t).lower() for t in types]
    if any(t in ('organization', 'corporation', 'localbusiness', 'company', 'brand', 'store', 'governmentorganization', 'educationorganization') for t in types_lower):
        record: Dict[str, Any] = {}
        for key in (
            'name', 'legalName', 'description', 'url', 'telephone', 'email',
            'industry', 'foundingDate', 'numberOfEmployees', 'logo', 'sameAs',
            'address', 'employee', 'location', 'contactPoint'
        ):
            value = data.get(key)
            if value not in (None, '', [], {}):
                normalized_key = key[0].lower() + re.sub(r'([A-Z])', lambda m: '_' + m.group(1).lower(), key[1:]) if key else key
                record[normalized_key] = value
        if data.get('name'):
            record['company_name'] = data.get('name')
        if data.get('legalName'):
            record['company_name'] = data.get('legalName')
        if data.get('url'):
            record['website'] = data.get('url')
        if data.get('foundingDate'):
            record['year_founded'] = data.get('foundingDate')
        if data.get('numberOfEmployees'):
            employee = data.get('numberOfEmployees')
            if isinstance(employee, dict):
                record['employee_count'] = employee.get('value') or employee.get('minValue') or employee.get('maxValue')
            else:
                record['employee_count'] = employee
        if data.get('logo'):
            record['logo_url'] = data.get('logo')
        records.append(record)

    for key in ('@graph', 'publisher', 'author', 'mainEntity', 'brand', 'organization', 'contactPoint', 'department', 'knowsAbout'):
        nested = data.get(key)
        if nested:
            records.extend(_flatten_json_ld_records(nested))
    return records


def _format_address(address: Dict[str, Any]) -> str:
    parts = []
    for key in (
        'streetAddress',
        'addressLocality',
        'addressRegion',
        'postalCode',
        'addressCountry',
    ):
        value = address.get(key)
        if value not in (None, '', [], {}):
            parts.append(str(value).strip())
    return ', '.join(parts)


def _extract_json_ld_organization(soup: BeautifulSoup) -> str:
    records = _extract_json_ld_records(soup)
    return str(records.get('company_name') or '').strip()


def _extract_contact_block_text(soup: BeautifulSoup) -> List[str]:
    blocks: List[str] = []
    selectors = [
        'address',
        '[class*="contact"]',
        '[id*="contact"]',
        '[class*="footer"]',
        '[id*="footer"]',
        '[class*="about"]',
        '[id*="about"]',
        '[class*="location"]',
        '[id*="location"]',
        '[class*="office"]',
        '[id*="office"]',
    ]
    for selector in selectors:
        for element in soup.select(selector):
            text = element.get_text(separator=' ', strip=True)
            if text and len(text) > 20:
                blocks.append(text)
    return blocks


def _extract_addresses_from_text(text: str) -> List[str]:
    if not text:
        return []
    candidate = re.sub(r'\s+', ' ', text).strip()
    if not candidate:
        return []
    has_hint = bool(ADDRESS_HINTS.search(candidate))
    has_number = bool(re.search(r'\b\d{1,6}\b', candidate))
    has_country = bool(re.search(r'\b(?:united states|usa|us|united kingdom|uk|india|canada|australia|germany|france|singapore|netherlands|sweden|norway|finland|denmark)\b', candidate, re.I))
    if (has_hint and has_number) or has_country:
        return [candidate[:250]]
    return []


def _extract_phones_from_text(text: str) -> List[str]:
    if not text:
        return []
    phones: List[str] = []
    for pattern in PHONE_PATTERNS:
        phones.extend(pattern.findall(text))
    for candidate in re.findall(r'\b(?:tel|phone|call|contact)\b[:\s-]*([+\d][\d\s().-]{7,})', text, re.I):
        phones.append(candidate)
    seen = set()
    deduped: List[str] = []
    for phone in phones:
        cleaned = _normalize_phone_display(phone)
        if not _is_valid_phone(cleaned):
            continue
        digits = _digits_only(cleaned)
        if digits in seen:
            continue
        seen.add(digits)
        deduped.append(cleaned)
    return deduped


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

    add(1, _meta_content_any(soup, ['og:site_name', 'application-name', 'twitter:site']))
    add(2, _extract_json_ld_organization(soup))
    add(3, _extract_company_from_title(title, domain))
    add(5, _extract_footer_company(soup))

    for element in soup.find_all('h1', limit=3):
        text = element.get_text(separator=' ', strip=True)
        add(6, text)

    if not candidates:
        return ''

    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def _extract_social_handles(soup: BeautifulSoup) -> List[str]:
    links: List[str] = []
    for anchor in soup.find_all('a', href=True):
        href = anchor['href'].strip()
        if any(domain in href.lower() for domain in SOCIAL_DOMAINS):
            links.append(href)
    return links


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
    field_provenance: Dict[str, Dict[str, str]] = {}

    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    og_description = _meta_content_any(soup, ['og:description', 'twitter:description', 'description', 'dc.description', 'parsely-description'])
    description = og_description
    og_title = _meta_content_any(soup, ['og:title', 'twitter:title', 'title'])
    og_site_name = _meta_content_any(soup, ['og:site_name', 'application-name', 'twitter:site'])
    canonical_url = _meta_content_any(soup, ['og:url', 'twitter:url', 'url', 'canonical'])
    twitter_title = _meta_content(soup, name='twitter:title')
    twitter_description = _meta_content(soup, name='twitter:description')

    keyword_tag = soup.find('meta', attrs={'name': 'keywords'})
    if keyword_tag and keyword_tag.get('content'):
        keywords = [kw.strip().lower() for kw in keyword_tag['content'].split(',') if kw.strip()]

    visible_text = _meaningful_visible_text(soup)
    is_error_page = bool(ERROR_PAGE_TITLE.search(title))
    detected_company_name = '' if is_error_page else _extract_company_name(soup, title or og_title or twitter_title, url)
    page_text = '' if is_error_page else _extract_meaningful_page_text(
        soup,
        html,
        description or og_description or twitter_description,
    )
    if not description:
        description = og_description or twitter_description or ''
    if not title and og_title:
        title = og_title

    if not keywords and page_text:
        tokens = re.findall(r'\b[a-zA-Z]{4,}\b', page_text.lower())
        freq: Dict[str, int] = {}
        for token in tokens:
            freq[token] = freq.get(token, 0) + 1
        keywords = [k for k, _ in sorted(freq.items(), key=lambda item: item[1], reverse=True)[:10]]

    emails = [] if is_error_page else list({m.lower() for m in EMAIL_REGEX.findall(visible_text)})
    phone_numbers = [] if is_error_page else _extract_phone_numbers(soup, visible_text)
    social_links = [] if is_error_page else _extract_social_handles(soup)

    json_ld = _extract_json_ld_records(soup)
    if json_ld:
        if json_ld.get('company_name') and not detected_company_name:
            detected_company_name = str(json_ld.get('company_name'))
            field_provenance.setdefault('detected_company_name', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('description') and not description:
            description = str(json_ld.get('description'))
            field_provenance.setdefault('meta_description', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('website') and not canonical_url:
            canonical_url = str(json_ld.get('website'))
        if json_ld.get('logo_url'):
            field_provenance.setdefault('logo_url', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('year_founded'):
            field_provenance.setdefault('year_founded', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('industry'):
            field_provenance.setdefault('industry', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('hq_address'):
            field_provenance.setdefault('hq_address', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('hq_country'):
            field_provenance.setdefault('hq_country', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('phone_numbers'):
            phone_numbers = list(dict.fromkeys(phone_numbers + [str(item) for item in json_ld.get('phone_numbers') or []]))
            field_provenance.setdefault('phone_numbers', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('emails'):
            emails = list(dict.fromkeys(emails + [str(item).lower() for item in json_ld.get('emails') or []]))
            field_provenance.setdefault('emails', {'source': 'json_ld', 'source_label': 'JSON-LD', 'source_url': url, 'source_type': 'website'})
        if json_ld.get('social_links'):
            social_links = list(dict.fromkeys(social_links + [str(item) for item in json_ld.get('social_links') or []]))

    address_blocks = []
    address_blocks.extend(_extract_contact_block_text(soup))
    if soup.find('address'):
        address_blocks.extend(_extract_addresses_from_text(soup.find('address').get_text(separator=' ', strip=True)))
    hq_address = ''
    for block in address_blocks:
        candidates = _extract_addresses_from_text(block)
        if candidates:
            hq_address = candidates[0]
            field_provenance.setdefault('hq_address', {'source': 'contact_block', 'source_label': 'Contact Block', 'source_url': url, 'source_type': 'website'})
            break

    if not hq_address:
        footer = soup.find('footer') or soup.find(attrs={'role': 'contentinfo'})
        if footer:
            footer_text = footer.get_text(separator=' ', strip=True)
            candidates = _extract_addresses_from_text(footer_text)
            if candidates:
                hq_address = candidates[0]
                field_provenance.setdefault('hq_address', {'source': 'footer', 'source_label': 'Footer', 'source_url': url, 'source_type': 'website'})

    if not phone_numbers:
        contact_phone_candidates = []
        for block in address_blocks:
            contact_phone_candidates.extend(_extract_phones_from_text(block))
        if not contact_phone_candidates and not is_error_page:
            footer = soup.find('footer') or soup.find(attrs={'role': 'contentinfo'})
            if footer:
                contact_phone_candidates.extend(_extract_phones_from_text(footer.get_text(separator=' ', strip=True)))
        if contact_phone_candidates:
            phone_numbers = list(dict.fromkeys(contact_phone_candidates))
            field_provenance.setdefault('phone_numbers', {'source': 'contact_block', 'source_label': 'Contact Block', 'source_url': url, 'source_type': 'website'})

    if not description and og_description:
        description = og_description
        field_provenance.setdefault('meta_description', {'source': 'og:description', 'source_label': 'OpenGraph', 'source_url': url, 'source_type': 'website'})
    elif description and og_description and description == og_description:
        field_provenance.setdefault('meta_description', {'source': 'og:description', 'source_label': 'OpenGraph', 'source_url': url, 'source_type': 'website'})

    if og_title and title == og_title:
        field_provenance.setdefault('title', {'source': 'og:title', 'source_label': 'OpenGraph', 'source_url': url, 'source_type': 'website'})
    elif title:
        field_provenance.setdefault('title', {'source': 'title', 'source_label': 'HTML Title', 'source_url': url, 'source_type': 'website'})

    if og_site_name and detected_company_name and og_site_name == detected_company_name:
        field_provenance.setdefault('detected_company_name', {'source': 'og:site_name', 'source_label': 'OpenGraph', 'source_url': url, 'source_type': 'website'})

    if canonical_url:
        field_provenance.setdefault('canonical_url', {'source': 'og:url', 'source_label': 'OpenGraph', 'source_url': url, 'source_type': 'website'})

    page_text_parts = [page_text] if page_text else []
    if hq_address and hq_address not in page_text_parts:
        page_text_parts.append(hq_address)

    return {
        'url': url,
        'title': title,
        'og_title': og_title,
        'og_site_name': og_site_name,
        'canonical_url': canonical_url,
        'meta_description': description,
        'emails': emails,
        'phone_numbers': phone_numbers,
        'social_links': social_links,
        'detected_company_name': detected_company_name,
        'detected_keywords': keywords,
        'page_text': re.sub(r'\s+', ' ', ' '.join(page_text_parts)).strip() or page_text,
        'page_text_length': len(re.sub(r'\s+', ' ', ' '.join(page_text_parts)).strip() or page_text),
        'hq_address': hq_address,
        'field_provenance': field_provenance,
        'structured_data': json_ld,
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
    response.raise_for_status()
    content_type = response.headers.get('Content-Type', '')
    if 'text/html' not in content_type.lower():
        raise ValueError('Unsupported content type')
    content = response.text
    if len(content.encode('utf-8')) > MAX_CONTENT_BYTES:
        raise ValueError('Content too large')
    return content


def _is_empty_or_blocked_metadata(metadata: Dict[str, Any]) -> bool:
    title = (metadata.get('title') or '').lower()
    if any(blocked in title for blocked in ['access denied', 'forbidden', 'attention required', 'blocked', 'security challenge', 'cloudflare']):
        return True
    has_title = bool(metadata.get('title'))
    has_desc = bool(metadata.get('meta_description'))
    has_company = bool(metadata.get('detected_company_name'))
    if not has_title and not has_desc and not has_company:
        return True
    return False


def _fetch_wayback_html_sync(url: str, headers: Dict[str, str]) -> Optional[str]:
    response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, allow_redirects=True)
    if response.status_code == 200:
        return response.text
    return None


async def fetch_wayback_html(url: str) -> Optional[str]:
    wayback_url = f"https://web.archive.org/web/20240601000000/{url}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    try:
        loop = asyncio.get_event_loop()
        html = await loop.run_in_executor(
            None,
            lambda: _fetch_wayback_html_sync(wayback_url, headers)
        )
        return html
    except Exception as e:
        logger.warning('[Scraper] failed to fetch from wayback: %s', e)
        return None


def _extract_metadata_wayback(html: str, url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, 'html.parser')
    _strip_wayback_noise(soup)
    
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
        cleaned_href = clean_wayback(href)
        if any(domain in cleaned_href.lower() for domain in SOCIAL_DOMAINS):
            social_links.append(cleaned_href)

    seen_social = set()
    dedup_social = []
    for link in social_links:
        if link not in seen_social:
            seen_social.add(link)
            dedup_social.append(link)

    return {
        'url': url,
        'title': title,
        'meta_description': description,
        'emails': emails,
        'phone_numbers': phone_numbers,
        'social_links': dedup_social,
        'detected_company_name': detected_company_name,
        'detected_keywords': keywords,
        'page_text': page_text,
        'page_text_length': len(page_text),
        'field_provenance': {'title': {'source': 'wayback', 'source_url': url}},
    }


def _candidate_deep_crawl_urls(base_url: str, html: str) -> List[str]:
    parsed = urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    soup = BeautifulSoup(html, 'html.parser')
    candidates: List[str] = []
    for path in PAGE_PATH_KEYWORDS:
        candidates.append(urljoin(origin + '/', path))
    for anchor in soup.find_all('a', href=True):
        href = anchor.get('href', '').strip()
        text = anchor.get_text(separator=' ', strip=True).lower()
        href_lower = href.lower()
        if not href or href.startswith('#'):
            continue
        if href_lower.startswith(('mailto:', 'tel:', 'javascript:')):
            continue
        if not any(keyword in href_lower or keyword in text for keyword in PAGE_PATH_KEYWORDS):
            continue
        candidate = urljoin(base_url, href)
        parsed_candidate = urlparse(candidate)
        if parsed_candidate.netloc and parsed_candidate.netloc != parsed.netloc:
            continue
        candidates.append(candidate)
    unique: List[str] = []
    seen = set()
    for url in candidates:
        if url not in seen:
            seen.add(url)
            unique.append(url)
    return unique[:MAX_DEEP_CRAWL_PAGES]


def _merge_page_metadata(base: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    provenance = dict(base.get('field_provenance') or {})
    extra_prov = dict(extra.get('field_provenance') or {})

    def set_if_empty(key: str, value: Any) -> None:
        if value in (None, '', [], {}):
            return
        if merged.get(key) in (None, '', [], {}):
            merged[key] = value

    for key in ('detected_company_name', 'title', 'og_title', 'og_site_name', 'canonical_url', 'meta_description', 'hq_address', 'page_text'):
        set_if_empty(key, extra.get(key))

    for key in ('emails', 'phone_numbers', 'social_links'):
        items = list(merged.get(key) or [])
        for value in extra.get(key) or []:
            text = str(value).strip()
            if text and text not in items:
                items.append(text)
        merged[key] = items

    for key in ('detected_keywords',):
        items = list(merged.get(key) or [])
        for value in extra.get(key) or []:
            text = str(value).strip().lower()
            if text and text not in items:
                items.append(text)
        merged[key] = items[:10]

    for key in ('year_founded', 'industry', 'hq_city', 'hq_state', 'hq_country', 'logo_url'):
        set_if_empty(key, extra.get(key))

    if len(str(extra.get('page_text') or '')) > len(str(merged.get('page_text') or '')):
        merged['page_text'] = extra.get('page_text') or merged.get('page_text')
        merged['page_text_length'] = len(str(merged.get('page_text') or ''))

    for key, value in extra_prov.items():
        provenance.setdefault(key, value)

    merged['field_provenance'] = provenance
    return merged


async def _fetch_and_extract(url: str) -> Optional[Dict[str, Any]]:
    try:
        html = await asyncio.wait_for(_fetch_html_aio(url), timeout=REQUEST_TIMEOUT)
    except Exception:
        try:
            html = _fetch_html_requests(url)
        except Exception:
            return None
    try:
        return _extract_metadata(html, url)
    except Exception as exc:
        logger.warning('[Scraper] extraction failed for %s: %s', url, exc)
        return None


async def fetch_website_metadata(raw_url: str) -> Dict[str, Any]:
    url = _safe_url(raw_url)
    if not url:
        raise ValueError('Could not verify domain')

    html = None
    fallback_to_wayback = False
    error_reason = None

    try:
        logger.info('[Scraper] fetching %s', url)
        html = await asyncio.wait_for(_fetch_html_aio(url), timeout=REQUEST_TIMEOUT)
    except Exception as exc:
        if isinstance(exc, asyncio.TimeoutError):
            logger.warning('[Scraper][Timeout] fetch timed out for %s', url)
            error_reason = 'Request timed out'
        else:
            logger.warning('[Scraper] aiohttp fetch failed for %s: %s', url, exc)
            error_reason = str(exc)
            
        try:
            html = _fetch_html_requests(url)
        except Exception as inner:
            logger.warning('[Scraper] requests fallback failed for %s: %s', url, inner)
            error_reason = str(inner)
            fallback_to_wayback = True

    if not fallback_to_wayback and html:
        try:
            metadata = _extract_metadata(html, url)
            candidate_urls = _candidate_deep_crawl_urls(url, html)
            if candidate_urls:
                crawled = await asyncio.gather(*[_fetch_and_extract(candidate) for candidate in candidate_urls])
                for extra in crawled:
                    if extra:
                        metadata = _merge_page_metadata(metadata, extra)
            if _is_empty_or_blocked_metadata(metadata):
                logger.info('[Scraper] Live metadata for %s is empty or blocked. Triggering Wayback fallback.', url)
                fallback_to_wayback = True
            else:
                return metadata
        except Exception as parse_err:
            logger.warning('[Scraper] Error parsing live HTML for %s: %s. Triggering Wayback fallback.', url, parse_err)
            fallback_to_wayback = True

    if fallback_to_wayback:
        logger.info('[Scraper] Attempting Wayback fallback for %s', url)
        try:
            wayback_html = await fetch_wayback_html(url)
            if wayback_html:
                metadata = _extract_metadata_wayback(wayback_html, url)
                if metadata and not _is_empty_or_blocked_metadata(metadata):
                    logger.info('[Scraper] Successfully retrieved archived metadata for %s', url)
                    return metadata
        except Exception as wayback_exc:
            logger.warning('[Scraper] Wayback fallback failed for %s: %s', url, wayback_exc)

    if error_reason:
        raise ValueError(_sanitize_error(error_reason))
    raise ValueError('Could not verify domain')


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
