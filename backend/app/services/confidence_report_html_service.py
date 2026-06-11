"""
Confidence report HTML generation service.

Generates:
1) Raw source HTML snapshot
2) Enriched HTML (suggested values applied in-place when old values are present)
3) Confidence report HTML (old value in red + new value in green inline)
"""

from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup, NavigableString


class ConfidenceReportHtmlService:
    def __init__(self) -> None:
        self._session = requests.Session()
        self._freda_headers = {
            "User-Agent": "FredaAI/1.0 (support@freda.ai)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Connection": "keep-alive",
        }
        self._browser_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Connection": "keep-alive",
        }

    def _safe_text(self, value: Any) -> str:
        return str(value or "").strip()

    def _safe_filename(self, value: str) -> str:
        cleaned = re.sub(r"[^\w.\- ]+", "_", value or "").strip(" ._")
        return cleaned or "confidence_report"

    def _resolve_source_url(self, payload: Dict[str, Any]) -> str:
        source_url = self._safe_text(payload.get("source_url"))
        if source_url:
            return source_url
        comparisons = payload.get("comparisons") or []
        if isinstance(comparisons, list):
            for entry in comparisons:
                if not isinstance(entry, dict):
                    continue
                candidate = self._safe_text(entry.get("source_url"))
                if candidate:
                    return candidate
        return ""

    def _validate_source_url(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Only http/https source URLs are supported")
        if not parsed.netloc:
            raise ValueError("Invalid source URL")

    def _get_cache_path(self, url: str) -> str:
        import hashlib
        import os
        url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        cache_dir = os.path.join(base_dir, "datasets", "cache")
        os.makedirs(cache_dir, exist_ok=True)
        return os.path.join(cache_dir, f"{url_hash}.html")

    def _save_to_cache(self, url: str, html: str) -> None:
        try:
            path = self._get_cache_path(url)
            with open(path, "w", encoding="utf-8") as f:
                f.write(html)
        except Exception:
            pass

    def _read_from_cache(self, url: str) -> str | None:
        try:
            path = self._get_cache_path(url)
            import os
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read()
        except Exception:
            pass
        return None

    def fetch_wayback_snapshot(self, url: str) -> str | None:
        """Queries archive.org/wayback/available to fetch the closest raw snapshot."""
        try:
            api_url = f"https://archive.org/wayback/available?url={url}"
            resp = self._session.get(api_url, timeout=5, headers=self._browser_headers)
            if resp.ok:
                data = resp.json()
                closest = data.get("archived_snapshots", {}).get("closest", {})
                if closest.get("available") and closest.get("url"):
                    snapshot_url = closest["url"]
                    # Fetch snapshot raw text
                    snap_resp = self._session.get(snapshot_url, timeout=15, headers=self._browser_headers)
                    if snap_resp.ok:
                        return snap_resp.text
        except Exception:
            pass
        return None

    def fetch_source_html(self, url: str, timeout_seconds: int = 25) -> str:
        self._validate_source_url(url)
        candidates = [url] + self._fallback_urls_for_forbidden(url)
        last_response = None
        for candidate in candidates:
            for headers in self._header_profiles_for_url(candidate):
                try:
                    response = self._session.get(
                        candidate,
                        timeout=timeout_seconds,
                        allow_redirects=True,
                        headers=headers,
                    )
                    last_response = response
                    if response.ok:
                        response.encoding = response.encoding or response.apparent_encoding or "utf-8"
                        html_text = response.text or ""
                        self._save_to_cache(url, html_text)
                        return html_text
                except Exception:
                    pass
        # 2. If blocked, check if any available cached source snapshot exists
        cached_html = self._read_from_cache(url)
        if cached_html:
            return cached_html

        # 3. Try Wayback Machine fallback if direct fetches fail
        wayback_html = self.fetch_wayback_snapshot(url)
        if wayback_html:
            self._save_to_cache(url, wayback_html)
            return wayback_html
            
        if last_response is not None:
            last_response.raise_for_status()
        raise requests.RequestException("Failed to fetch source HTML")

    def _header_profiles_for_url(self, url: str) -> List[Dict[str, str]]:
        host = (urlparse(url).netloc or "").lower()
        if "sec.gov" in host:
            return [self._freda_headers, self._browser_headers]
        return [self._browser_headers, self._freda_headers]

    def _fallback_urls_for_forbidden(self, url: str) -> List[str]:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
        path = parsed.path or "/"
        # Minimal targeted fallback for Oracle homepage, which returns 403
        # while corporate/regional pages return 200.
        if "oracle.com" in host and path in {"", "/"}:
            return [
                f"{parsed.scheme}://{parsed.netloc}/corporate/",
                f"{parsed.scheme}://{parsed.netloc}/in/",
                f"{parsed.scheme}://{parsed.netloc}/us/corporate/",
            ]
        return []

    def _normalized_change_pairs(self, payload: Dict[str, Any]) -> List[Tuple[str, str, str]]:
        comparisons = payload.get("comparisons") or []
        pairs: List[Tuple[str, str, str]] = []
        if not isinstance(comparisons, list):
            return pairs
        for entry in comparisons:
            if not isinstance(entry, dict):
                continue
            field = self._safe_text(entry.get("field"))
            old_value = self._safe_text(entry.get("existing_value"))
            new_value = self._safe_text(entry.get("suggested_value"))
            if not new_value or new_value.lower() == "nil value":
                continue
            if not old_value:
                continue
            if old_value.strip().lower() == new_value.strip().lower():
                continue
            pairs.append((field, old_value, new_value))
        pairs.sort(key=lambda item: len(item[1]), reverse=True)
        return pairs

    def _iter_text_nodes(self, soup: BeautifulSoup):
        for node in soup.find_all(string=True):
            if not isinstance(node, NavigableString):
                continue
            parent_name = (node.parent.name or "").lower() if node.parent else ""
            if parent_name in {"script", "style", "noscript"}:
                continue
            yield node

    def _strip_nonessential_source_content(self, html: str) -> str:
        """Remove heavy/non-essential UI/media elements for low-level evidence HTML."""
        if not html:
            return html
        soup = BeautifulSoup(html, "html.parser")
        removable_tags = {
            "script",
            "style",
            "noscript",
            "iframe",
            "img",
            "picture",
            "source",
            "video",
            "audio",
            "canvas",
            "svg",
            "object",
            "embed",
            "form",
            "button",
            "link",
        }
        for tag in soup.find_all(removable_tags):
            tag.decompose()
        # Remove inline event handlers and style-heavy attributes.
        for tag in soup.find_all(True):
            if not tag.attrs:
                continue
            for attr in list(tag.attrs.keys()):
                key = str(attr or "").lower()
                if key.startswith("on") or key in {"style", "srcset", "poster"}:
                    tag.attrs.pop(attr, None)
                    
        # Remove Wayback Machine injected elements
        for tag in soup.find_all(id=re.compile(r"^wm-")):
            tag.decompose()
        for tag in soup.find_all(class_=re.compile(r"^wm-")):
            tag.decompose()
            
        # Remove links to PDFs
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"].lower()
            if href.endswith(".pdf") or ".pdf?" in href:
                a_tag.decompose()

        # Remove elements with class or id related to ads/tracking
        tracking_pattern = re.compile(r"analytics|tracking|ad-container|advertisement|google-analytics|gtm", re.I)
        for tag in soup.find_all(True):
            if not tag.attrs:
                continue
            id_val = str(tag.get("id") or "")
            classes = " ".join(tag.get("class") or [])
            if tracking_pattern.search(id_val) or tracking_pattern.search(classes):
                tag.decompose()

        return str(soup)

    def _ensure_confidence_styles_in_source_html(self, html: str) -> str:
        if not html:
            return html
        soup = BeautifulSoup(html, "html.parser")
        style = soup.new_tag("style")
        style.string = (
            ".confidence-old{color:#b91c1c!important;font-weight:700!important;}"
            ".confidence-new{color:#047857!important;font-weight:700!important;}"
            ".confidence-arrow{color:#6b7280!important;font-weight:600!important;}"
        )
        if soup.head:
            soup.head.append(style)
        else:
            head = soup.new_tag("head")
            head.append(style)
            if soup.html:
                soup.html.insert(0, head)
            else:
                wrapped = BeautifulSoup("<html><head></head><body></body></html>", "html.parser")
                wrapped.head.append(style)
                if soup.body:
                    wrapped.body.append(soup.body)
                else:
                    wrapped.body.append(BeautifulSoup(str(soup), "html.parser"))
                soup = wrapped
        return str(soup)

    def _apply_replacements(self, html: str, pairs: List[Tuple[str, str, str]]) -> str:
        if not html or not pairs:
            return html
        soup = BeautifulSoup(html, "html.parser")
        for text_node in list(self._iter_text_nodes(soup)):
            original_text = str(text_node)
            updated_text = original_text
            for _, old_value, new_value in pairs:
                if old_value in updated_text:
                    updated_text = updated_text.replace(old_value, new_value)
            if updated_text != original_text:
                text_node.replace_with(updated_text)
        return str(soup)

    def _apply_confidence_markup(self, html: str, pairs: List[Tuple[str, str, str]]) -> str:
        if not html or not pairs:
            return html
        soup = BeautifulSoup(html, "html.parser")
        for text_node in list(self._iter_text_nodes(soup)):
            original_text = str(text_node)
            marked_text = original_text
            for _, old_value, new_value in pairs:
                if old_value in marked_text:
                    replacement = (
                        f'<span class="confidence-old">{old_value}</span>'
                        f'<span class="confidence-arrow"> → </span>'
                        f'<span class="confidence-new">{new_value}</span>'
                    )
                    marked_text = marked_text.replace(old_value, replacement)
            if marked_text != original_text:
                fragment = BeautifulSoup(marked_text, "html.parser")
                text_node.replace_with(fragment)
        return str(soup)

    def _wrap_confidence_html(
        self,
        marked_source_html: str,
        payload: Dict[str, Any],
        source_url: str,
        pairs: List[Tuple[str, str, str]],
    ) -> str:
        company = self._safe_text(payload.get("company")) or "Unknown"
        workflow_name = self._safe_text(payload.get("workflow_name")) or "Workflow"
        source_type = self._safe_text(payload.get("source_type")) or "Unknown"
        timestamp = self._safe_text(payload.get("timestamp")) or datetime.utcnow().isoformat()
        confidence = self._safe_text(payload.get("confidence"))
        
        changes_count = payload.get("changes_count", len(pairs))
        added_count = payload.get("added_count", 0)
        removed_count = payload.get("removed_count", 0)
        modified_count = payload.get("modified_count", len(pairs))

        change_rows = "".join(
            f"<tr><td>{field}</td><td><span class='confidence-old'>{old}</span></td><td><span class='confidence-new'>{new}</span></td></tr>"
            for field, old, new in pairs
        ) or "<tr><td colspan='3'>No changed values detected in source text.</td></tr>"

        return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Confidence Report - {company}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 20px; color: #111827; }}
    .meta {{ border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; margin-bottom: 14px; background-color: #f9fafb; }}
    .meta div {{ margin: 3px 0; }}
    .confidence-old {{ color: #b91c1c; font-weight: 700; text-decoration: line-through; }}
    .confidence-new {{ color: #047857; font-weight: 700; }}
    .confidence-arrow {{ color: #6b7280; }}
    .source-wrap {{ border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }}
    table {{ border-collapse: collapse; width: 100%; margin-bottom: 14px; }}
    th, td {{ border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #f8fafc; }}
  </style>
</head>
<body>
  <h1>Confidence Report</h1>
  <div class="meta">
    <div><strong>Company/Source Name:</strong> {company}</div>
    <div><strong>Workflow Name:</strong> {workflow_name}</div>
    <div><strong>Timestamp:</strong> {timestamp}</div>
    <div><strong>Confidence Score:</strong> {confidence}</div>
    <div><strong>Source URL:</strong> <a href="{source_url}" target="_blank">{source_url}</a></div>
    <div><strong>Source Type:</strong> {source_type}</div>
    <div style="margin-top: 8px; padding-top: 8px; border-t: 1px solid #e5e7eb;">
      <strong>Refresh Statistics:</strong>
      <span style="margin-left: 10px;">Total Changes: <strong>{changes_count}</strong></span>
      <span style="margin-left: 10px;">Added: <strong>{added_count}</strong></span>
      <span style="margin-left: 10px;">Removed: <strong>{removed_count}</strong></span>
      <span style="margin-left: 10px;">Modified: <strong>{modified_count}</strong></span>
    </div>
  </div>
  <h2>Changed Values</h2>
  <table>
    <thead><tr><th>Field / Record ID</th><th>Original (Red / Strikethrough)</th><th>Updated (Green / Bold)</th></tr></thead>
    <tbody>{change_rows}</tbody>
  </table>
  <h2>Source Content With Highlights</h2>
  <div class="source-wrap">{marked_source_html}</div>
</body>
</html>"""

    def build_html_bundle(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        source_url = self._resolve_source_url(payload)
        
        raw_html = ""
        fetch_success = False
        if source_url and (source_url.startswith("http://") or source_url.startswith("https://")):
            try:
                raw_html = self.fetch_source_html(source_url)
                fetch_success = True
            except Exception:
                pass
                
        if not fetch_success:
            raw_html = "<div>Source web page preview is not applicable or could not be loaded. Detailed records diff can be viewed in the table above.</div>"

        cleaned_html = self._strip_nonessential_source_content(raw_html) if fetch_success else raw_html
        pairs = self._normalized_change_pairs(payload)
        enriched_html = self._apply_replacements(cleaned_html, pairs) if fetch_success else cleaned_html
        marked_html = self._apply_confidence_markup(cleaned_html, pairs) if fetch_success else cleaned_html
        highlighted_source_html = self._ensure_confidence_styles_in_source_html(marked_html)
        confidence_html = self._wrap_confidence_html(marked_html, payload, source_url or "Demo Source", pairs)

        company = self._safe_filename(self._safe_text(payload.get("company")) or "company")
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        base = f"{company}_confidence_{ts}"

        return {
            "base_filename": base,
            "source_url": source_url or "",
            "raw_html_filename": f"{base}_source_raw.html",
            "enriched_html_filename": f"{base}_source_enriched.html",
            "highlighted_source_html_filename": f"{base}_source_highlighted.html",
            "confidence_html_filename": f"{base}_confidence_report.html",
            "raw_html": cleaned_html,
            "enriched_html": enriched_html,
            "highlighted_source_html": highlighted_source_html,
            "confidence_html": confidence_html,
        }

    def build_zip_bytes(self, payload: Dict[str, Any]) -> Tuple[str, bytes]:
        bundle = self.build_html_bundle(payload)
        output = io.BytesIO()
        with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(bundle["raw_html_filename"], bundle["raw_html"])
            archive.writestr(bundle["enriched_html_filename"], bundle["enriched_html"])
            archive.writestr(bundle["highlighted_source_html_filename"], bundle["highlighted_source_html"])
            archive.writestr(bundle["confidence_html_filename"], bundle["confidence_html"])
        output.seek(0)
        return f"{bundle['base_filename']}.zip", output.getvalue()

    def build_highlighted_source_html_bytes(self, payload: Dict[str, Any]) -> Tuple[str, bytes]:
        bundle = self.build_html_bundle(payload)
        filename = bundle["highlighted_source_html_filename"]
        return filename, bundle["highlighted_source_html"].encode("utf-8")

    def generate_local_fallback_mock_html(self, source: str) -> str:
        """Generates a high-fidelity mock HTML page when live fetch fails or is offline."""
        source_lower = source.lower()
        if "keysight" in source_lower:
            return """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Keysight Product Detail Page</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 30px; color: #1f2937; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; background-color: #ffffff; }
    h1 { color: #111827; margin-top: 0; font-size: 24px; border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; }
    .meta-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 16px; margin-top: 20px; }
    .meta-item { background: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; }
    .label { font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: bold; }
    .value { font-size: 15px; font-weight: 600; color: #111827; margin-top: 4px; }
    .description { margin-top: 24px; padding-top: 16px; border-top: 1px solid #f3f4f6; }
    .description h2 { font-size: 16px; margin-top: 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Keysight Product Detail: <span class="attr-name">Resistive Divider Probe Kit</span></h1>
    <div class="meta-grid">
      <div class="meta-item">
        <div class="label">Product SKU</div>
        <div class="value attr-sku">10020A</div>
      </div>
      <div class="meta-item">
        <div class="label">Category</div>
        <div class="value attr-category">Probes</div>
      </div>
      <div class="meta-item">
        <div class="label">Product Family</div>
        <div class="value">InfiniiVision Oscilloscopes</div>
      </div>
      <div class="meta-item">
        <div class="label">Price (USD)</div>
        <div class="value attr-price">$2,450.00</div>
      </div>
      <div class="meta-item">
        <div class="label">Availability</div>
        <div class="value attr-is-in-stock">In Stock</div>
      </div>
      <div class="meta-item">
        <div class="label">Discontinued</div>
        <div class="value attr-discontinued">False</div>
      </div>
    </div>
    <div class="description">
      <h2>Description</h2>
      <p>The Keysight 10020A resistive divider probe kit is designed for high frequency measurements and high-impedance probing.</p>
    </div>
  </div>
</body>
</html>"""

        elif "webmd" in source_lower:
            return """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WebMD Physician Profile Page</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 30px; color: #1f2937; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; background-color: #ffffff; }
    h1 { color: #111827; margin-top: 0; font-size: 24px; border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; }
    .meta-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 16px; margin-top: 20px; }
    .meta-item { background: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; }
    .label { font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: bold; }
    .value { font-size: 15px; font-weight: 600; color: #111827; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Physician Profile: <span class="attr-name">Dr. John Doe</span></h1>
    <div class="meta-grid">
      <div class="meta-item">
        <div class="label">Medical Specialty</div>
        <div class="value attr-specialty">Cardiology</div>
      </div>
      <div class="meta-item">
        <div class="label">Accepting New Patients</div>
        <div class="value attr-accepting-patients">Yes</div>
      </div>
      <div class="meta-item">
        <div class="label">Hospital Affiliation</div>
        <div class="value attr-hospital">Saint Francis Memorial Hospital</div>
      </div>
      <div class="meta-item">
        <div class="label">Location</div>
        <div class="value"><span class="attr-city">San Francisco</span>, <span class="attr-state">CA</span></div>
      </div>
    </div>
  </div>
</body>
</html>"""

        elif "turkeybrokers" in source_lower:
            return """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>TurkeyBrokers Profile Page</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 30px; color: #1f2937; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; background-color: #ffffff; }
    h1 { color: #111827; margin-top: 0; font-size: 24px; border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; }
    .meta-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 16px; margin-top: 20px; }
    .meta-item { background: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; }
    .label { font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: bold; }
    .value { font-size: 15px; font-weight: 600; color: #111827; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Broker Profile: <span class="attr-pk">TB-001</span></h1>
    <div class="meta-grid">
      <div class="meta-item">
        <div class="label">Broker Address</div>
        <div class="value attr-address">Ataturk Bulvari No: 12, Ankara</div>
      </div>
      <div class="meta-item">
        <div class="label">City</div>
        <div class="value attr-city">Ankara</div>
      </div>
    </div>
  </div>
</body>
</html>"""

        elif "investegate" in source_lower:
            return """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Investegate Announcement Page</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 30px; color: #1f2937; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; background-color: #ffffff; }
    h1 { color: #111827; margin-top: 0; font-size: 24px; border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; }
    .meta-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 16px; margin-top: 20px; }
    .meta-item { background: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; }
    .label { font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: bold; }
    .value { font-size: 15px; font-weight: 600; color: #111827; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SEC Filing Announcement: <span class="attr-name">Apple Inc.</span></h1>
    <div class="meta-grid">
      <div class="meta-item">
        <div class="label">Stock Ticker</div>
        <div class="value attr-ticker">AAPL</div>
      </div>
      <div class="meta-item">
        <div class="label">Filing Form Type</div>
        <div class="value attr-filing-type">10-K</div>
      </div>
    </div>
  </div>
</body>
</html>"""

        else:
            return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Web Page Preview - {source}</title>
  <style>
    body {{ font-family: Arial, sans-serif; padding: 20px; color: #111827; }}
    .url {{ color: #2563eb; font-weight: bold; }}
  </style>
</head>
<body>
  <h3>Web Page Preview</h3>
  <p>Cleaned baseline source snapshot for: <span class="url">{source}</span></p>
  <div>Mocked target crawl content representing the primary dashboard record schema.</div>
</body>
</html>"""

    def apply_record_mutations_to_html(self, html: str, source: str, records: list) -> str:
        """Updates placeholder attribute spans in fallback HTML layouts using mutated records."""
        if not html or not records:
            return html
        soup = BeautifulSoup(html, "html.parser")
        rec = records[0]
        source_lower = source.lower()

        if "keysight" in source_lower:
            price = rec.get("price")
            discontinued = rec.get("Discontinued")
            is_in_stock = rec.get("is_in_stock")
            sku = rec.get("sku")
            name = rec.get("name")
            category = rec.get("category") or rec.get("_category")
            
            if sku is not None:
                el = soup.select_one(".attr-sku")
                if el: el.string = str(sku)
            if name is not None:
                el = soup.select_one(".attr-name")
                if el: el.string = str(name)
            if category is not None:
                el = soup.select_one(".attr-category")
                if el: el.string = str(category)
            if price is not None:
                el = soup.select_one(".attr-price")
                if el: el.string = str(price)
            if discontinued is not None:
                el = soup.select_one(".attr-discontinued")
                if el: el.string = "True" if discontinued else "False"
            if is_in_stock is not None:
                el = soup.select_one(".attr-is-in-stock")
                if el: el.string = "In Stock" if is_in_stock == 1 else "Out of Stock"

        elif "webmd" in source_lower:
            accepting = rec.get("Accepting_New_Patients")
            hospital = rec.get("Hospital_Affiliations")
            name = rec.get("Business_Name") or rec.get("Physician_Name")
            specialty = rec.get("Specialty")
            city = rec.get("City")
            state = rec.get("State")

            if name is not None:
                el = soup.select_one(".attr-name")
                if el: el.string = str(name)
            if specialty is not None:
                el = soup.select_one(".attr-specialty")
                if el: el.string = str(specialty)
            if city is not None:
                el = soup.select_one(".attr-city")
                if el: el.string = str(city)
            if state is not None:
                el = soup.select_one(".attr-state")
                if el: el.string = str(state)
            if accepting is not None:
                el = soup.select_one(".attr-accepting-patients")
                if el: el.string = str(accepting)
            if hospital is not None:
                el = soup.select_one(".attr-hospital")
                if el: el.string = str(hospital)

        elif "turkeybrokers" in source_lower:
            address = rec.get("Address")
            pk = rec.get("PrimaryKey")
            city = rec.get("City")

            if pk is not None:
                el = soup.select_one(".attr-pk")
                if el: el.string = str(pk)
            if city is not None:
                el = soup.select_one(".attr-city")
                if el: el.string = str(city)
            if address is not None:
                el = soup.select_one(".attr-address")
                if el: el.string = str(address)

        elif "investegate" in source_lower:
            ftype = rec.get("filing_type")
            ticker = rec.get("ticker")
            name = rec.get("entity_name")

            if name is not None:
                el = soup.select_one(".attr-name")
                if el: el.string = str(name)
            if ticker is not None:
                el = soup.select_one(".attr-ticker")
                if el: el.string = str(ticker)
            if ftype is not None:
                el = soup.select_one(".attr-filing-type")
                if el: el.string = str(ftype)

        return str(soup)

    def build_inline_html_diff(self, baseline_html: str, current_html: str) -> str:
        """Performs parallel text-node comparison walk, annotating inline red/green diffs."""
        soup_base = BeautifulSoup(baseline_html, "html.parser")
        soup_curr = BeautifulSoup(current_html, "html.parser")

        def iter_text_nodes(soup):
            for node in soup.find_all(string=True):
                if not isinstance(node, NavigableString):
                    continue
                parent_name = (node.parent.name or "").lower() if node.parent else ""
                if parent_name in {"script", "style", "noscript"}:
                    continue
                yield node

        nodes_base = list(iter_text_nodes(soup_base))
        nodes_curr = list(iter_text_nodes(soup_curr))

        for n_base, n_curr in zip(nodes_base, nodes_curr):
            t_base = str(n_base).strip()
            t_curr = str(n_curr).strip()
            if t_base != t_curr and t_base and t_curr:
                # Wrap changes using classes old-value and new-value
                diff_html = (
                    f'<span class="old-value">{t_base}</span> '
                    f'<span class="new-value">{t_curr}</span>'
                )
                fragment = BeautifulSoup(diff_html, "html.parser")
                n_curr.replace_with(fragment)

        style_tag = soup_curr.new_tag("style")
        style_tag.string = """
            .old-value { color: red !important; }
            .new-value { color: green !important; font-weight: 600 !important; }
        """
        if soup_curr.head:
            soup_curr.head.append(style_tag)
        elif soup_curr.html:
            head = soup_curr.new_tag("head")
            head.append(style_tag)
            soup_curr.html.insert(0, head)

        return str(soup_curr)


confidence_report_html_service = ConfidenceReportHtmlService()
