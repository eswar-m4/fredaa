"""
Lightweight enrichment service for F.R.E.D.A.

Extracts structured metadata from public page content returned by source retrieval.
"""

import html
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

import httpx

from app.core.logger import setup_logger

logger = setup_logger(__name__)
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"


class EnrichmentService:
    """Service that extracts enrichment attributes from live source pages."""

    def enrich(
        self,
        live_source_results: List[Dict[str, Any]],
        processed_results: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        start = time.time()
        if not live_source_results:
            return {}

        top_source = live_source_results[0]
        source_url = top_source.get("url") or ""
        enriched = {"source_url": source_url}

        try:
            page_html = self._fetch_page_html(source_url)
            metadata = self._extract_metadata(page_html, source_url)
            enriched.update(metadata)
        except Exception as exc:
            logger.warning(f"Enrichment failed for {source_url}: {exc}")

        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"Enriched data from {source_url} in {duration_ms}ms")
        return enriched

    def _fetch_page_html(self, url: str) -> str:
        response = httpx.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=10.0,
            follow_redirects=True,
        )
        if response.status_code != 200:
            raise ValueError(f"Unable to retrieve page: {response.status_code}")
        return response.text

    def _extract_metadata(self, html_text: str, url: str) -> Dict[str, Any]:
        company_name = self._extract_meta(html_text, ["og:site_name", "twitter:site", "application-name"]) or self._extract_title(html_text)
        description = self._extract_meta(html_text, ["og:description", "twitter:description", "description"])
        possible_email = self._extract_email(html_text)
        possible_phone = self._extract_phone(html_text)
        role_title = self._find_first(
            r"(?:Chief|Head|Director|Manager|VP|Vice President|Founder|CEO|CTO|CFO)[^<\n]{0,80}",
            html_text,
        )
        address = self._find_first(
            r"\d{1,5}\s+[A-Za-z0-9\.\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct)\b",
            html_text,
        )
        social_profiles = self._extract_social_links(html_text, url)
        social_by_platform = self._social_links_by_platform(social_profiles)
        contact_page_url = self._extract_internal_page_url(html_text, url, ["contact", "support"])
        careers_page_url = self._extract_internal_page_url(html_text, url, ["careers", "jobs"])
        website = self._extract_website(html_text, url)
        tech_signals = self._extract_tech_signals(html_text, url)

        return {
            "company_name": company_name,
            "website": website,
            "possible_email": possible_email,
            "possible_phone": possible_phone,
            "role_title": role_title,
            "address": address,
            "social_profiles": social_profiles,
            **social_by_platform,
            "contact_page_url": contact_page_url,
            "careers_page_url": careers_page_url,
            "description": description,
            **tech_signals,
        }

    def _extract_tech_signals(self, html_text: str, url: str) -> Dict[str, Optional[str]]:
        html_lower = (html_text or "").lower()
        url_lower = (url or "").lower()

        def _match(patterns: Dict[str, tuple[str, ...]]) -> Optional[str]:
            for label, needles in patterns.items():
                if any(needle in html_lower or needle in url_lower for needle in needles):
                    return label
            return None

        cms = _match({
            "WordPress": ("wp-content", "wp-includes", "wordpress"),
            "Shopify": ("cdn.shopify.com", "shopify", "myshopify.com"),
            "Webflow": ("webflow", "webflow.io", "webflow.com"),
            "Squarespace": ("squarespace", "static1.squarespace.com"),
            "Wix": ("wix.com", "wixstatic.com"),
            "Drupal": ("drupal", "drupal-settings-json"),
            "Joomla": ("joomla", "/media/system/js/"),
            "Magento": ("magento", "mage/", "static/version"),
            "HubSpot": ("hubspot", "hs-scripts.com", "hsforms.net"),
            "Ghost": ("ghost", "ghost.org"),
        })

        frameworks = _match({
            "Next.js": ("_next/", "nextjs", "next.js"),
            "React": ("react", "react-dom", "data-reactroot"),
            "Vue.js": ("vue", "nuxt"),
            "Angular": ("angular", "ng-version"),
            "Svelte": ("svelte", "sveltekit"),
            "Gatsby": ("gatsby", "__gatsby"),
            "Remix": ("remix", "remix-run"),
        })

        analytics = _match({
            "Google Tag Manager": ("googletagmanager", "gtm.js", "gtm-"),
            "Google Analytics": ("google-analytics", "gtag(", "ga4", "analytics.js"),
            "Segment": ("segment.com", "analytics.js", "segment"),
            "Mixpanel": ("mixpanel", "mp.min.js"),
            "Hotjar": ("hotjar", "hjSettings"),
            "Matomo": ("matomo", "piwik"),
            "Plausible": ("plausible.io", "plausible.js"),
        })

        hosting = _match({
            "Vercel": ("vercel", "vercel.app"),
            "Netlify": ("netlify", "netlify.app"),
            "Cloudflare": ("cloudflare", "cf-ray", "cdn-cgi"),
            "AWS": ("amazonaws.com", "aws", "cloudfront"),
            "Azure": ("azurewebsites.net", "azure", "microsoft.com"),
            "Google Cloud": ("googleusercontent.com", "cloud.google.com", "gstatic.com"),
        })

        tech_stack_parts = [part for part in (cms, frameworks, analytics, hosting) if part]
        tech_stack = ", ".join(dict.fromkeys(tech_stack_parts)) if tech_stack_parts else None

        return {
            "cms": cms,
            "analytics": analytics,
            "frameworks": frameworks,
            "hosting": hosting,
            "tech_stack": tech_stack,
        }

    def _extract_title(self, html_text: str) -> Optional[str]:
        title_match = re.search(r"<title>(.*?)</title>", html_text, re.I | re.S)
        if title_match:
            return self._clean_text(title_match.group(1))
        return None

    def _extract_meta(self, html_text: str, keys: List[str]) -> Optional[str]:
        for key in keys:
            pattern = re.compile(
                rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)["\']',
                re.I,
            )
            match = pattern.search(html_text)
            if match:
                return self._clean_text(match.group(1))
        return None

    def _find_first(self, regex: str, html_text: str) -> Optional[str]:
        match = re.search(regex, html_text, re.I)
        if match:
            return self._clean_text(match.group(0))
        return None

    def _extract_email(self, html_text: str) -> Optional[str]:
        mailto_matches = re.findall(r'href=["\']mailto:([^"\'?]+)', html_text, re.I)
        body_matches = re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", html_text, re.I)
        for email in mailto_matches + body_matches:
            cleaned = self._clean_text(email).strip().lower()
            if self._is_valid_contact_email(cleaned):
                return cleaned
        return None

    def _is_valid_contact_email(self, email: str) -> bool:
        if not email or "@" not in email:
            return False
        local, _, domain = email.partition("@")
        if not local or not domain or "." not in domain:
            return False
        asset_suffixes = (
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
            ".svg",
            ".css",
            ".js",
            ".json",
            ".map",
            ".woff",
            ".woff2",
            ".ttf",
        )
        if email.endswith(asset_suffixes) or domain.endswith(asset_suffixes):
            return False
        if re.search(r"(@2x|@3x|sprite|asset|image|icon|logo|cdn)", email, re.I):
            return False
        return True

    def _extract_phone(self, html_text: str) -> Optional[str]:
        tel_matches = re.findall(r'href=["\']tel:([^"\']+)', html_text, re.I)
        text_matches = re.findall(r"\+?[0-9][0-9\-\s().]{7,}[0-9]", html_text, re.I)
        for phone in tel_matches + text_matches:
            cleaned = self._clean_text(phone)
            if self._is_valid_contact_phone(cleaned):
                return cleaned
        return None

    def _is_valid_contact_phone(self, phone: str) -> bool:
        digits = re.sub(r"\D+", "", phone or "")
        if len(digits) < 10 or len(digits) > 15:
            return False
        if re.search(r"\d+\.\d+", phone or ""):
            return False
        # Reject random digit strings unless they are explicitly formatted or tel: derived.
        if phone.strip().isdigit():
            return False
        if re.search(r"(width|height|padding|margin|rgba|data-|utm|asset|image)", phone, re.I):
            return False
        return True

    def _extract_social_links(self, html_text: str, base_url: str) -> List[str]:
        links = []
        for href in re.findall(r'href=["\']([^"\']+)["\']', html_text, re.I):
            absolute = urljoin(base_url, href)
            if any(domain in absolute.lower() for domain in ["linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "youtube.com", "github.com"]):
                if not self._is_valid_social_profile(absolute):
                    continue
                links.append(absolute)
        return list(dict.fromkeys(links))

    def _is_valid_social_profile(self, url: str) -> bool:
        lower = url.lower()
        if "youtube.com" in lower or "youtu.be" in lower:
            return bool(re.search(r"youtube\.com/(user/|channel/|c/|@)", lower))
        return True

    def _social_links_by_platform(self, links: List[str]) -> Dict[str, Optional[str]]:
        fields: Dict[str, Optional[str]] = {
            "linkedin_url": None,
            "twitter_url": None,
            "instagram_url": None,
            "facebook_url": None,
            "youtube_url": None,
        }
        for link in links:
            lower = link.lower()
            if "linkedin.com" in lower and not fields["linkedin_url"]:
                fields["linkedin_url"] = link
            elif ("twitter.com" in lower or "x.com" in lower) and not fields["twitter_url"]:
                fields["twitter_url"] = link
            elif "instagram.com" in lower and not fields["instagram_url"]:
                fields["instagram_url"] = link
            elif "facebook.com" in lower and not fields["facebook_url"]:
                fields["facebook_url"] = link
            elif "youtube.com" in lower and not fields["youtube_url"]:
                fields["youtube_url"] = link
        return fields

    def _extract_internal_page_url(self, html_text: str, base_url: str, tokens: List[str]) -> Optional[str]:
        for href in re.findall(r'href=["\']([^"\']+)["\']', html_text, re.I):
            lower = href.lower()
            if any(token in lower for token in tokens):
                return urljoin(base_url, href)
        return None

    def _extract_website(self, html_text: str, base_url: str) -> str:
        website = self._extract_meta(html_text, ["og:url", "twitter:url", "url"])
        if website and self._is_valid_website_candidate(website, base_url):
            return website

        if self._is_valid_website_candidate(base_url, base_url):
            return base_url

        external_website = self._extract_external_website_link(html_text, base_url)
        if external_website:
            return external_website

        return ""

    def _extract_external_website_link(self, html_text: str, base_url: str) -> str:
        for href, link_text in re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html_text, re.I | re.S):
            href = href.strip()
            if not href or href.startswith("#") or href.lower().startswith(("mailto:", "tel:", "javascript:")):
                continue
            absolute = urljoin(base_url, href)
            if not self._is_valid_website_candidate(absolute, base_url):
                continue
            text = self._clean_text(link_text or "")
            if re.search(r"\b(official|website|site|homepage|visit|home page)\b", text, re.I):
                return absolute

        for href in re.findall(r'href=["\']([^"\']+)["\']', html_text, re.I):
            href = href.strip()
            if not href or href.startswith("#") or href.lower().startswith(("mailto:", "tel:", "javascript:")):
                continue
            absolute = urljoin(base_url, href)
            if self._is_valid_website_candidate(absolute, base_url):
                return absolute

        return ""

    def _is_valid_website_candidate(self, url: str, base_url: str) -> bool:
        if not url:
            return False
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().lstrip("www.")
        if not host:
            return False
        if any(host.endswith(domain) for domain in (
            "linkedin.com",
            "sec.gov",
            "mca.gov.in",
            "companieshouse.gov.uk",
            "opencorporates.com",
            "glassdoor.com",
            "crunchbase.com",
            "en.wikipedia.org",
            "yelp.com",
            "yellowpages.com",
        )):
            return False
        if any(host.endswith(domain) for domain in (
            "twitter.com",
            "x.com",
            "facebook.com",
            "instagram.com",
            "youtube.com",
            "github.com",
        )):
            return False
        lower = url.lower()
        if lower.startswith(("mailto:", "tel:", "javascript:")):
            return False
        if re.search(r"\.(jpg|jpeg|png|gif|svg|pdf|docx?|xlsx?|pptx?)(?:$|[?#])", lower):
            return False
        return True

    def _clean_text(self, value: str) -> str:
        text = re.sub(r"<[^>]+>", "", value)
        return html.unescape(text).strip()


enrichment_service = EnrichmentService()
