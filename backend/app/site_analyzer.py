"""
site_analyzer.py
────────────────
Crawls a target website up to a configurable page limit and produces a
structured report covering:

  • HTTP-level blocking signals (status codes, rate-limit headers)
  • JavaScript / browser-challenge gates (Cloudflare, Akamai, PerimeterX, …)
  • CAPTCHA type detection (reCAPTCHA v2/v3, hCaptcha, FunCaptcha / Arkose,
    Geetest, text/image CAPTCHA, puzzle CAPTCHA)
  • robots.txt scraping restrictions
  • Recommended bypass strategy with ranked options

Usage
─────
    python site_analyzer.py --url https://example.com --pages 10

Dependencies (install once):
    pip install requests beautifulsoup4 selenium playwright
    playwright install chromium
"""

import argparse
import json
import random
import re
import time
import urllib.robotparser
from dataclasses import dataclass, field, asdict
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ── Optional imports (graceful degradation) ──────────────────────────────────
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.common.exceptions import WebDriverException
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class PageResult:
    url: str
    http_status: Optional[int] = None
    blocked: bool = False
    block_reason: str = ""
    captcha_detected: bool = False
    captcha_type: str = ""
    js_challenge: bool = False
    js_challenge_vendor: str = ""
    redirect_chain: list = field(default_factory=list)
    response_time_ms: float = 0.0
    raw_signals: dict = field(default_factory=dict)


@dataclass
class SiteReport:
    target_url: str
    pages_requested: int
    pages_visited: int = 0
    robots_txt_blocks_scraper: bool = False
    robots_txt_notes: str = ""
    overall_blocking: str = "none"          # none / soft / hard
    blocking_behavior: str = ""
    captcha_present: bool = False
    captcha_types: list = field(default_factory=list)
    js_challenges: list = field(default_factory=list)
    rate_limiting_detected: bool = False
    fingerprinting_signals: list = field(default_factory=list)
    recommendations: list = field(default_factory=list)
    page_results: list = field(default_factory=list)


# ── Constants / heuristics ────────────────────────────────────────────────────

CAPTCHA_PATTERNS = {
    "reCAPTCHA v2": [
        r"google\.com/recaptcha",
        r"g-recaptcha",
        r"grecaptcha\.render",
        r"recaptcha/api\.js",
    ],
    "reCAPTCHA v3": [
        r"grecaptcha\.execute",
        r"recaptcha/api\.js\?render=",
    ],
    "hCaptcha": [
        r"hcaptcha\.com",
        r"h-captcha",
        r"hcaptcha\.render",
    ],
    "FunCaptcha / Arkose": [
        r"arkoselabs\.com",
        r"funcaptcha",
        r"enforcement\.arkoselabs",
    ],
    "Geetest": [
        r"geetest\.com",
        r"initGeetest",
        r"gt\.js",
    ],
    "Puzzle / Slider CAPTCHA": [
        r"slider.{0,20}captcha",
        r"drag.{0,20}puzzle",
        r"jigsaw.{0,20}captcha",
    ],
    "Text / Image CAPTCHA": [
        r'<input[^>]+name=["\']captcha["\']',
        r'img[^>]+alt=["\']captcha',
        r'captcha_image',
        r'captchaimage',
        r'type=["\']text["\'][^>]+captcha',
    ],
    "Cloudflare Turnstile": [
        r"challenges\.cloudflare\.com/turnstile",
        r"cf-turnstile",
    ],
}

JS_CHALLENGE_PATTERNS = {
    "Cloudflare": [
        r"cloudflare\.com/cdn-cgi/challenge",
        r"cf_chl_prog",
        r"__cf_chl_jschl_tk__",
        r"Attention Required! \| Cloudflare",
        r"cf-browser-verification",
        r"_cf_chl_opt",
    ],
    "Akamai Bot Manager": [
        r"akamai.*bot",
        r"_abck",
        r"ak_bmsc",
        r"bm_sz",
    ],
    "PerimeterX / HUMAN": [
        r"perimeterx\.com",
        r"px-captcha",
        r"_pxvid",
        r"pxscript",
        r"PerimeterX",
    ],
    "DataDome": [
        r"datadome\.co",
        r"dd_cookie_test",
        r"datadome.*interstitial",
    ],
    "Imperva / Incapsula": [
        r"incapsula\.com",
        r"visid_incap",
        r"incap_ses",
        r"___utmvc",
    ],
    "Shape Security / F5": [
        r"shape\.io",
        r"f5\.com.*bot",
        r"shapeshift",
    ],
    "Kasada": [
        r"kasada\.io",
        r"kpsdk",
        r"x-kpsdk",
    ],
}

BLOCK_STATUS_CODES = {
    403: "403 Forbidden – access explicitly denied",
    429: "429 Too Many Requests – rate limited",
    503: "503 Service Unavailable – possible bot gate",
    407: "407 Proxy Auth Required",
    451: "451 Unavailable For Legal Reasons",
}

FINGERPRINT_SIGNALS = [
    ("TLS fingerprinting hint", re.compile(r"ja3", re.I)),
    ("Canvas/WebGL fingerprint", re.compile(r"canvas.*finger|webgl.*finger", re.I)),
    ("Browser fingerprint library", re.compile(r"fingerprintjs|fp2|fpjs", re.I)),
    ("Mouse/behaviour tracking", re.compile(r"mousetrap|behavioral.*analytics|botd", re.I)),
    ("Headless browser detection", re.compile(r"webdriver|HeadlessChrome|phantom", re.I)),
]

COMMON_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
]


# ── Helper utilities ──────────────────────────────────────────────────────────

def random_delay(min_s: float = 1.0, max_s: float = 3.5) -> None:
    time.sleep(random.uniform(min_s, max_s))


def same_domain(base: str, link: str) -> bool:
    return urlparse(base).netloc == urlparse(link).netloc


def normalise_url(base: str, href: str) -> Optional[str]:
    if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None
    full = urljoin(base, href)
    parsed = urlparse(full)
    if parsed.scheme not in ("http", "https"):
        return None
    # Strip fragment
    return parsed._replace(fragment="").geturl()


def check_robots_txt(base_url: str) -> tuple[bool, str]:
    """Return (blocks_scraper, notes_string)."""
    robots_url = urljoin(base_url, "/robots.txt")
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(robots_url)
    try:
        rp.read()
    except Exception as exc:
        return False, f"Could not fetch robots.txt: {exc}"

    test_agents = ["*", "Googlebot", "python-requests", "scrapy"]
    blocked_agents = []
    notes = []
    for agent in test_agents:
        if not rp.can_fetch(agent, base_url):
            blocked_agents.append(agent)

    crawl_delay = rp.crawl_delay("*")
    if crawl_delay:
        notes.append(f"Crawl-delay: {crawl_delay}s")

    disallowed_paths = []
    try:
        for entry in rp.entries:            # type: ignore[attr-defined]
            for rule in entry.rulelines:    # type: ignore[attr-defined]
                if not rule.allowance:
                    disallowed_paths.append(rule.path)
    except Exception:
        pass

    if disallowed_paths:
        sample = disallowed_paths[:5]
        notes.append(f"Disallowed paths (sample): {sample}")

    is_blocked = bool(blocked_agents or disallowed_paths)
    summary = "; ".join(notes) if notes else "No crawl restrictions found"
    if blocked_agents:
        summary = f"Blocked agents: {blocked_agents}. " + summary
    return is_blocked, summary


# ── Detection logic ───────────────────────────────────────────────────────────

def detect_captcha(html: str, headers: dict) -> tuple[bool, list[str]]:
    detected = []
    html_lower = html.lower()
    for captcha_type, patterns in CAPTCHA_PATTERNS.items():
        for pat in patterns:
            if re.search(pat, html, re.I):
                if captcha_type not in detected:
                    detected.append(captcha_type)
                break
    # Some WAFs embed CAPTCHA in HTTP headers
    for h_val in headers.values():
        if re.search(r"captcha", str(h_val), re.I):
            if "Unknown CAPTCHA (header)" not in detected:
                detected.append("Unknown CAPTCHA (header)")
    return bool(detected), detected


def detect_js_challenge(html: str, headers: dict, status: int) -> tuple[bool, list[str]]:
    vendors = []
    for vendor, patterns in JS_CHALLENGE_PATTERNS.items():
        for pat in patterns:
            if re.search(pat, html, re.I):
                if vendor not in vendors:
                    vendors.append(vendor)
                break
    # Check response headers for known WAF cookies / server tags
    server_header = headers.get("server", "").lower()
    if "cloudflare" in server_header and "Cloudflare" not in vendors:
        vendors.append("Cloudflare")
    cf_ray = headers.get("cf-ray", "")
    if cf_ray and "Cloudflare" not in vendors:
        vendors.append("Cloudflare")

    # 503 with JS challenge body is very common for Cloudflare
    if status == 503 and re.search(r"cf_chl|cloudflare", html, re.I):
        if "Cloudflare" not in vendors:
            vendors.append("Cloudflare")

    return bool(vendors), vendors


def detect_fingerprinting(html: str) -> list[str]:
    found = []
    for label, pattern in FINGERPRINT_SIGNALS:
        if pattern.search(html):
            found.append(label)
    return found


def is_blocked_response(status: int, html: str, headers: dict) -> tuple[bool, str]:
    if status in BLOCK_STATUS_CODES:
        return True, BLOCK_STATUS_CODES[status]
    # Soft blocks (200 with a challenge/block page)
    block_phrases = [
        r"access denied",
        r"you have been blocked",
        r"unusual traffic",
        r"bot.*detected",
        r"automated.*request",
        r"enable javascript.*continue",
        r"checking your browser",
        r"ddos protection",
        r"verify you are human",
        r"please wait.*moment",
    ]
    for phrase in block_phrases:
        if re.search(phrase, html, re.I):
            return True, f"Soft-block page detected: '{phrase}'"
    return False, ""


# ── Request strategies ────────────────────────────────────────────────────────

class RequestStrategy:
    """Plain requests strategy."""

    name = "requests"

    def __init__(self, session: requests.Session):
        self.session = session

    def get(self, url: str) -> tuple[Optional[int], str, dict, list[str], float]:
        """Returns (status, html, headers, redirect_chain, response_time_ms)."""
        start = time.monotonic()
        try:
            resp = self.session.get(url, timeout=15, allow_redirects=True)
            elapsed = (time.monotonic() - start) * 1000
            chain = [r.url for r in resp.history] + [resp.url]
            return resp.status_code, resp.text, dict(resp.headers), chain, elapsed
        except requests.RequestException as exc:
            elapsed = (time.monotonic() - start) * 1000
            return None, f"Request error: {exc}", {}, [url], elapsed


class SeleniumStrategy:
    """Headless Chrome via Selenium."""

    name = "selenium"

    def __init__(self):
        opts = ChromeOptions()
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        opts.add_argument(f"user-agent={random.choice(COMMON_USER_AGENTS)}")
        self.driver = webdriver.Chrome(options=opts)
        self.driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"},
        )

    def get(self, url: str) -> tuple[Optional[int], str, dict, list[str], float]:
        start = time.monotonic()
        try:
            self.driver.get(url)
            time.sleep(3)  # allow JS to execute
            html = self.driver.page_source
            elapsed = (time.monotonic() - start) * 1000
            return 200, html, {}, [url], elapsed
        except WebDriverException as exc:
            elapsed = (time.monotonic() - start) * 1000
            return None, f"Selenium error: {exc}", {}, [url], elapsed

    def close(self):
        try:
            self.driver.quit()
        except Exception:
            pass


class PlaywrightStrategy:
    """Stealth-mode Chromium via Playwright."""

    name = "playwright"

    def __init__(self):
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self._context = self._browser.new_context(
            user_agent=random.choice(COMMON_USER_AGENTS),
            viewport={"width": 1280, "height": 800},
            extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
        )
        self._page = self._context.new_page()
        # Basic anti-detection
        self._page.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )

    def get(self, url: str) -> tuple[Optional[int], str, dict, list[str], float]:
        start = time.monotonic()
        try:
            resp = self._page.goto(url, wait_until="networkidle", timeout=20_000)
            html = self._page.content()
            elapsed = (time.monotonic() - start) * 1000
            status = resp.status if resp else 200
            headers = dict(resp.headers) if resp else {}
            return status, html, headers, [url], elapsed
        except PlaywrightTimeout as exc:
            elapsed = (time.monotonic() - start) * 1000
            return None, f"Playwright timeout: {exc}", {}, [url], elapsed
        except Exception as exc:
            elapsed = (time.monotonic() - start) * 1000
            return None, f"Playwright error: {exc}", {}, [url], elapsed

    def close(self):
        try:
            self._browser.close()
            self._pw.stop()
        except Exception:
            pass


# ── Link extractor ────────────────────────────────────────────────────────────

def extract_links(html: str, base_url: str) -> list[str]:
    links = set()
    try:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup.find_all("a", href=True):
            url = normalise_url(base_url, tag["href"])
            if url and same_domain(base_url, url):
                links.add(url)
    except Exception as err:
        print(err)
    return list(links)


# ── Recommendation engine ─────────────────────────────────────────────────────

def build_recommendations(report: SiteReport) -> list[str]:
    recs = []

    if not report.overall_blocking and not report.captcha_present:
        recs.append(
            "✅ No significant blocking detected. Plain requests + random delays + "
            "rotating User-Agent headers should be sufficient."
        )
        return recs

    # --- Rate limiting
    if report.rate_limiting_detected:
        recs.append(
            "⏱ Rate limiting detected → implement exponential back-off with jitter "
            "(e.g. time.sleep(2**attempt + random.random())) and keep concurrency low."
        )

    # --- JS challenges
    if report.js_challenges:
        vendors = ", ".join(report.js_challenges)
        if "Cloudflare" in report.js_challenges:
            recs.append(
                "🛡 Cloudflare challenge detected → use Playwright/Selenium with "
                "stealth patches (playwright-stealth or undetected-chromedriver). "
                "For heavy usage consider a Cloudflare-bypass API (e.g. FlareSolverr)."
            )
        if any(v in report.js_challenges for v in ("Akamai Bot Manager", "PerimeterX / HUMAN")):
            recs.append(
                f"🤖 Advanced bot manager ({vendors}) detected → browser automation alone "
                "is often insufficient. Consider: (1) residential proxy + browser automation, "
                "(2) sensor-data replay services, or (3) a managed scraping API "
                "(ScrapingBee, Zyte, Apify)."
            )
        if "DataDome" in report.js_challenges:
            recs.append(
                "🔒 DataDome detected → requires real browser + residential IPs. "
                "DataDome's ML checks browser fingerprints; use undetected-chromedriver "
                "with rotating residential proxies."
            )
        if "Kasada" in report.js_challenges:
            recs.append(
                "🔒 Kasada detected → one of the hardest WAFs to bypass. "
                "Recommend a specialist scraping service or reverse-engineering the "
                "Kasada sensor payload (advanced)."
            )

    # --- CAPTCHA
    if report.captcha_present:
        for ct in report.captcha_types:
            if "reCAPTCHA v2" in ct:
                recs.append(
                    "🧩 reCAPTCHA v2 detected → integrate a CAPTCHA-solving service: "
                    "2captcha, Anti-Captcha, or CapSolver. Use their async API to submit "
                    "the site-key and receive a g-recaptcha-response token."
                )
            elif "reCAPTCHA v3" in ct:
                recs.append(
                    "🧩 reCAPTCHA v3 detected → score-based; harder to bypass. Options: "
                    "(1) 2captcha/CapSolver reCAPTCHA v3 endpoint, "
                    "(2) browser automation with real interactions to score highly."
                )
            elif "hCaptcha" in ct:
                recs.append(
                    "🧩 hCaptcha detected → 2captcha and Anti-Captcha support hCaptcha. "
                    "Pass the site-key; receive an h-captcha-response token."
                )
            elif "FunCaptcha" in ct or "Arkose" in ct:
                recs.append(
                    "🧩 FunCaptcha / Arkose Labs detected → use CapSolver or 2captcha's "
                    "FunCaptcha endpoint. These are image-rotation/interaction CAPTCHAs."
                )
            elif "Geetest" in ct:
                recs.append(
                    "🧩 Geetest detected → 2captcha and CapSolver both support Geetest v3/v4. "
                    "Requires passing challenge, gt, and api_server parameters."
                )
            elif "Puzzle" in ct or "Slider" in ct:
                recs.append(
                    "🧩 Puzzle/Slider CAPTCHA detected → usually custom-built. Options: "
                    "(1) image recognition + Selenium to drag the slider, "
                    "(2) CapSolver custom CAPTCHA endpoint."
                )
            elif "Text" in ct or "Image" in ct:
                recs.append(
                    "🧩 Text/Image CAPTCHA detected → OCR-based solving via pytesseract "
                    "for simple text CAPTCHAs, or 2captcha image CAPTCHA endpoint for "
                    "harder ones."
                )
            elif "Turnstile" in ct:
                recs.append(
                    "🧩 Cloudflare Turnstile detected → CapSolver and 2captcha support "
                    "Turnstile. Pass the site-key to receive a cf-turnstile-response token."
                )

    # --- Fingerprinting
    if report.fingerprinting_signals:
        sigs = ", ".join(report.fingerprinting_signals)
        recs.append(
            f"👁 Fingerprinting signals found ({sigs}) → use browser automation with "
            "randomised fingerprints: rotate Canvas noise, WebGL renderer strings, "
            "screen resolution, timezone, and language headers."
        )

    # --- General proxy advice
    if report.overall_blocking in ("soft", "hard") or report.captcha_present:
        recs.append(
            "🌐 IP rotation recommended → use residential or mobile proxies "
            "(Bright Data, Oxylabs, Smartproxy). Datacenter proxies are often "
            "pre-blocked. Rotate per request or per session depending on cookie requirements."
        )

    # --- robots.txt
    if report.robots_txt_blocks_scraper:
        recs.append(
            "⚠️  robots.txt restricts automated access. Review legal and ToS implications "
            "before proceeding. Consider reaching out to the site owner for an official API."
        )

    if not recs:
        recs.append("No specific recommendations generated – review raw page results.")
    return recs


# ── Core analyser ─────────────────────────────────────────────────────────────

def analyse_site(
    target_url: str,
    max_pages: int = 10,
    strategy: str = "auto",
    min_delay: float = 1.0,
    max_delay: float = 3.5,
) -> SiteReport:
    """
    Crawl *target_url* visiting up to *max_pages* internal pages and return a
    SiteReport describing blocking behaviour and recommendations.

    strategy: "requests" | "selenium" | "playwright" | "auto"
              auto = try requests first; upgrade to Playwright on JS-challenge.
    """
    report = SiteReport(target_url=target_url, pages_requested=max_pages)

    # ── robots.txt ────────────────────────────────────────────────────────────
    print(f"[•] Checking robots.txt …")
    report.robots_txt_blocks_scraper, report.robots_txt_notes = check_robots_txt(target_url)

    # ── Build primary HTTP session ────────────────────────────────────────────
    session = requests.Session()
    session.headers.update({
        "User-Agent": random.choice(COMMON_USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    })

    # ── Choose strategy ───────────────────────────────────────────────────────
    primary: RequestStrategy | SeleniumStrategy | PlaywrightStrategy

    if strategy == "selenium":
        if not SELENIUM_AVAILABLE:
            raise RuntimeError("Selenium not installed – pip install selenium")
        primary = SeleniumStrategy()
    elif strategy == "playwright":
        if not PLAYWRIGHT_AVAILABLE:
            raise RuntimeError("Playwright not installed – pip install playwright && playwright install chromium")
        primary = PlaywrightStrategy()
    else:
        primary = RequestStrategy(session)  # default / auto starts here

    upgraded = False  # tracks whether we auto-upgraded to Playwright

    to_visit = [target_url]
    visited: set[str] = set()
    all_fingerprint_signals: set[str] = set()
    all_captcha_types: set[str] = set()
    all_js_challenges: set[str] = set()
    block_count = 0
    rate_limit_count = 0

    try:
        while to_visit and len(visited) < max_pages:
            url = to_visit.pop(0)
            if url in visited:
                continue
            visited.add(url)

            print(f"[{len(visited):>2}/{max_pages}] Fetching {url} …")

            status, html, headers, chain, elapsed = primary.get(url)

            pr = PageResult(
                url=url,
                http_status=status,
                redirect_chain=chain,
                response_time_ms=round(elapsed, 1),
            )

            if status is None:
                pr.blocked = True
                pr.block_reason = html  # error message stored in html field
                report.page_results.append(asdict(pr))
                block_count += 1
                random_delay(min_delay, max_delay)
                continue

            # ── Blocking detection ────────────────────────────────────────
            blocked, block_reason = is_blocked_response(status, html, headers)
            pr.blocked = blocked
            pr.block_reason = block_reason
            if blocked:
                block_count += 1
            if status == 429:
                rate_limit_count += 1

            # ── JS challenge detection ────────────────────────────────────
            js_challenge, js_vendors = detect_js_challenge(html, headers, status or 0)
            pr.js_challenge = js_challenge
            pr.js_challenge_vendor = ", ".join(js_vendors)
            all_js_challenges.update(js_vendors)

            # ── Auto-upgrade to Playwright on first JS challenge ──────────
            if (
                strategy == "auto"
                and js_challenge
                and not upgraded
                and PLAYWRIGHT_AVAILABLE
            ):
                print(f"  [↑] JS challenge detected ({pr.js_challenge_vendor}) – upgrading to Playwright …")
                if hasattr(primary, "close"):
                    primary.close()
                primary = PlaywrightStrategy()
                upgraded = True
                # Re-fetch the same URL with Playwright
                status, html, headers, chain, elapsed = primary.get(url)
                pr.http_status = status
                pr.response_time_ms = round(elapsed, 1)
                blocked, block_reason = is_blocked_response(status or 0, html, headers)
                pr.blocked = blocked
                pr.block_reason = block_reason
                js_challenge, js_vendors = detect_js_challenge(html, headers, status or 0)
                pr.js_challenge = js_challenge
                pr.js_challenge_vendor = ", ".join(js_vendors)
                all_js_challenges.update(js_vendors)

            # ── CAPTCHA detection ─────────────────────────────────────────
            captcha_found, captcha_types = detect_captcha(html, headers)
            pr.captcha_detected = captcha_found
            pr.captcha_type = ", ".join(captcha_types)
            all_captcha_types.update(captcha_types)

            # ── Fingerprinting signals ────────────────────────────────────
            fp_signals = detect_fingerprinting(html)
            all_fingerprint_signals.update(fp_signals)
            pr.raw_signals = {
                "fingerprinting": fp_signals,
                "rate_limit_header": headers.get("retry-after", ""),
                "server": headers.get("server", ""),
                "x-powered-by": headers.get("x-powered-by", ""),
            }

            report.page_results.append(asdict(pr))

            # ── Harvest new links (always – even from blocked pages) ──────
            if html:
                new_links = extract_links(html, url)
                random.shuffle(new_links)
                for link in new_links:
                    if link not in visited and link not in to_visit:
                        to_visit.append(link)

            # ── Fallback: seed common paths when queue runs dry ───────────
            # Keeps analysis going even when a blocked/challenge page yields
            # no crawlable links (robots.txt gate, JS challenge on home page, etc.)
            if not to_visit and len(visited) < max_pages:
                parsed_base = urlparse(target_url)
                base = f"{parsed_base.scheme}://{parsed_base.netloc}"
                fallback_paths = [
                    "/about", "/about-us", "/contact", "/contact-us",
                    "/products", "/services", "/blog", "/news",
                    "/faq", "/help", "/support", "/privacy",
                    "/terms", "/careers", "/team", "/pricing",
                    "/login", "/signup", "/search", "/sitemap.xml",
                ]
                added = 0
                for path in fallback_paths:
                    candidate = base + path
                    if candidate not in visited and candidate not in to_visit:
                        to_visit.append(candidate)
                        added += 1
                if added:
                    print(f"  [~] Queue empty – seeding {added} common paths to continue analysis …")

            random_delay(min_delay, max_delay)

    finally:
        if hasattr(primary, "close"):
            primary.close()

    # ── Aggregate findings ────────────────────────────────────────────────────
    report.pages_visited = len(visited)
    report.captcha_present = bool(all_captcha_types)
    report.captcha_types = sorted(all_captcha_types)
    report.js_challenges = sorted(all_js_challenges)
    report.rate_limiting_detected = rate_limit_count > 0
    report.fingerprinting_signals = sorted(all_fingerprint_signals)

    # Overall blocking severity
    if block_count == 0:
        report.overall_blocking = "none"
    elif block_count / max(len(visited), 1) < 0.4:
        report.overall_blocking = "soft"
    else:
        report.overall_blocking = "hard"

    # Human-readable blocking behaviour summary
    behaviours = []
    if report.rate_limiting_detected:
        behaviours.append("rate-limiting (429)")
    if report.js_challenges:
        behaviours.append(f"JS challenge ({', '.join(report.js_challenges)})")
    if report.captcha_present:
        behaviours.append(f"CAPTCHA ({', '.join(report.captcha_types)})")
    if block_count and not behaviours:
        behaviours.append(f"HTTP block ({block_count} pages)")
    report.blocking_behavior = "; ".join(behaviours) if behaviours else "No blocking behaviour observed"

    # ── Recommendations ───────────────────────────────────────────────────────
    report.recommendations = build_recommendations(report)

    return report


# ── Pretty-print report ───────────────────────────────────────────────────────

def print_report(report: SiteReport) -> None:
    SEP = "─" * 70
    print(f"\n{'═'*70}")
    print(f"  SITE ANALYSIS REPORT")
    print(f"  Target : {report.target_url}")
    print(f"  Visited: {report.pages_visited} / {report.pages_requested} pages")
    print(f"{'═'*70}")

    print(f"\n{SEP}")
    print("  ROBOTS.TXT")
    print(SEP)
    print(f"  Blocks scraper : {'YES ⚠' if report.robots_txt_blocks_scraper else 'No'}")
    print(f"  Notes          : {report.robots_txt_notes}")

    print(f"\n{SEP}")
    print("  BLOCKING OVERVIEW")
    print(SEP)
    print(f"  Severity  : {report.overall_blocking.upper()}")
    print(f"  Behaviour : {report.blocking_behavior}")
    print(f"  Rate-limit: {'Yes' if report.rate_limiting_detected else 'No'}")

    print(f"\n{SEP}")
    print("  JS / WAF CHALLENGES")
    print(SEP)
    if report.js_challenges:
        for v in report.js_challenges:
            print(f"  • {v}")
    else:
        print("  None detected")

    print(f"\n{SEP}")
    print("  CAPTCHA")
    print(SEP)
    if report.captcha_present:
        for ct in report.captcha_types:
            print(f"  • {ct}")
    else:
        print("  None detected")

    print(f"\n{SEP}")
    print("  FINGERPRINTING SIGNALS")
    print(SEP)
    if report.fingerprinting_signals:
        for s in report.fingerprinting_signals:
            print(f"  • {s}")
    else:
        print("  None detected")

    print(f"\n{SEP}")
    print("  RECOMMENDATIONS")
    print(SEP)
    for rec in report.recommendations:
        print(f"\n  {rec}")

    print(f"\n{SEP}")
    print("  PER-PAGE SUMMARY")
    print(SEP)
    print(f"  {'URL':<55} {'Status':>6}  {'Blocked':>7}  {'CAPTCHA':>7}  {'JSChallenge':>11}")
    print(f"  {'─'*55} {'─'*6}  {'─'*7}  {'─'*7}  {'─'*11}")
    for pr in report.page_results:
        url_short = pr["url"][:53] + ".." if len(pr["url"]) > 55 else pr["url"]
        print(
            f"  {url_short:<55} "
            f"{str(pr['http_status'] or 'ERR'):>6}  "
            f"{'Yes' if pr['blocked'] else 'No':>7}  "
            f"{'Yes' if pr['captcha_detected'] else 'No':>7}  "
            f"{'Yes' if pr['js_challenge'] else 'No':>11}"
        )
    print(f"\n{'═'*70}\n")


# ── CLI entry point ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Analyse anti-bot / CAPTCHA blocking on a website."
    )
    parser.add_argument("--url", required=True, help="Starting URL to analyse")
    parser.add_argument(
        "--pages", type=int, default=10,
        help="Maximum number of pages to visit (default: 10)"
    )
    parser.add_argument(
        "--strategy",
        choices=["auto", "requests", "selenium", "playwright"],
        default="auto",
        help=(
            "Request strategy: auto (requests → Playwright on JS-challenge), "
            "requests, selenium, playwright (default: auto)"
        ),
    )
    parser.add_argument(
        "--min-delay", type=float, default=1.0,
        help="Minimum delay between requests in seconds (default: 1.0)"
    )
    parser.add_argument(
        "--max-delay", type=float, default=3.5,
        help="Maximum delay between requests in seconds (default: 3.5)"
    )
    parser.add_argument(
        "--json", dest="json_out", metavar="FILE",
        help="Write full report as JSON to FILE"
    )
    args = parser.parse_args()

    print(f"\n[•] Starting analysis of {args.url}")
    print(f"[•] Strategy: {args.strategy} | Pages: {args.pages} | "
          f"Delay: {args.min_delay}–{args.max_delay}s\n")

    report = analyse_site(
        target_url=args.url,
        max_pages=args.pages,
        strategy=args.strategy,
        min_delay=args.min_delay,
        max_delay=args.max_delay,
    )

    print_report(report)

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(asdict(report), fh, indent=2)
        print(f"[✓] JSON report saved to {args.json_out}\n")


if __name__ == "__main__":
    main()
