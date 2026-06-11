"""Verify the frontend Eye Modal renders SEC/MCA source values."""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse


CDP = "http://127.0.0.1:9222"


class CDPClient:
    def __init__(self, ws_url: str) -> None:
        parsed = urlparse(ws_url)
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or 9222
        self.path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self.next_id = 1
        self._handshake()

    def _handshake(self) -> None:
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        response = self.sock.recv(4096)
        if b"101" not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"WebSocket handshake failed: {response[:200]!r}")

    def _send_text(self, payload: str) -> None:
        data = payload.encode("utf-8")
        header = bytearray([0x81])
        length = len(data)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self.sock.sendall(bytes(header) + masked)

    def _recv_exact(self, count: int) -> bytes:
        chunks = []
        remaining = count
        while remaining:
            chunk = self.sock.recv(remaining)
            if not chunk:
                raise RuntimeError("WebSocket closed")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _recv_text(self) -> Dict[str, Any]:
        first = self._recv_exact(2)
        opcode = first[0] & 0x0F
        length = first[1] & 0x7F
        masked = bool(first[1] & 0x80)
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length)
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        if opcode == 8:
            raise RuntimeError("WebSocket close frame received")
        if opcode not in (1, 2):
            return self._recv_text()
        return json.loads(payload.decode("utf-8"))

    def command(self, method: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
        command_id = self.next_id
        self.next_id += 1
        self._send_text(json.dumps({"id": command_id, "method": method, "params": params or {}}))
        while True:
            message = self._recv_text()
            if message.get("id") == command_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result") or {}


def _json_get(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _target() -> Dict[str, Any]:
    targets = _json_get(f"{CDP}/json")
    for target in targets:
        if target.get("type") == "page":
            return target
    raise RuntimeError("No Chrome page target found")


def main() -> None:
    validation = json.loads(Path("data/sec_mca_live_validation.json").read_text(encoding="utf-8"))
    client = CDPClient(_target()["webSocketDebuggerUrl"])
    client.command("Page.enable")
    client.command("Runtime.enable")
    client.command("Page.navigate", {"url": "http://127.0.0.1:8000/"})
    time.sleep(3)

    rendered_results = []
    for item in validation:
        queue_records = next(iter(item["review_queue_object"]["level_2_records"].values()))
        website_cmp = next(
            entry for entry in queue_records[0]["field_comparisons"]
            if entry["field"] == "website"
        )
        row = {
            "id": f"frontend-sec-{item['company'].lower()}",
            "init": item["company"][:2].upper(),
            "company": item["company"],
            "field": "website",
            "chg": "medium",
            "conf": 85,
            "url": website_cmp["source_url"],
            "old": "-",
            "nw": website_cmp["suggested_value"],
            "reasoning": "SEC/MCA priority source used for mapped fields.",
            "agents": ["SEC EDGAR"],
            "source": {
                "selected_priority_sources": ["SEC", "MCA"],
                "registry_metadata": {
                    "registry_source": "sec_edgar",
                    "raw_metadata": {"company_browse_url": website_cmp["source_url"]},
                },
                "field_comparisons": [website_cmp],
            },
        }
        expression = f"""
(() => {{
  const row = {json.dumps(row)};
  window.reviewData = [row];
  window.currentReviewVisibleRecords = [row];
  if (typeof window.openDetailFromWorkflowRow !== 'function') {{
    throw new Error('openDetailFromWorkflowRow not available');
  }}
  window.openDetailFromWorkflowRow(0, 'all');
  return {{
    field: document.getElementById('d-field')?.textContent,
    oldValue: document.getElementById('d-old')?.textContent,
    aiRecommendation: document.getElementById('d-new')?.textContent,
    sourceUrl: document.getElementById('d-url')?.textContent,
    sourceType: document.getElementById('d-source-type')?.textContent,
    overlayOpen: document.getElementById('detail-overlay')?.classList.contains('open')
  }};
}})()
"""
        result = client.command("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        rendered = result["result"]["value"]
        rendered["company"] = item["company"]
        rendered_results.append(rendered)

    screenshot = client.command("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})

    out_json = Path("data/frontend_eye_modal_verification.json")
    out_png = Path("data/frontend_eye_modal_verification.png")
    out_json.write_text(json.dumps(rendered_results, indent=2, sort_keys=True), encoding="utf-8")
    out_png.write_bytes(base64.b64decode(screenshot["data"]))
    print(json.dumps(rendered_results, indent=2, sort_keys=True))
    print(f"Wrote {out_json}")
    print(f"Wrote {out_png}")

    expected_urls = {item["company"]: item["sec_url_discovered"] for item in validation}
    for rendered in rendered_results:
        expected = {
            "field": "website",
            "oldValue": "-",
            "aiRecommendation": "Nil Value",
            "sourceUrl": expected_urls[rendered["company"]],
            "sourceType": "SEC EDGAR",
            "overlayOpen": True,
        }
        for key, value in expected.items():
            if rendered.get(key) != value:
                raise SystemExit(
                    f"{rendered['company']} mismatch for {key}: expected {value!r}, got {rendered.get(key)!r}"
                )


if __name__ == "__main__":
    main()
