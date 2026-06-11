from __future__ import annotations

import base64
import json
import os
import socket
import struct
import urllib.request
from typing import Any, Dict

CDP_HTTP = "http://127.0.0.1:9222/json"
APP_URL = "http://127.0.0.1:8000/"


class CDPClient:
    def __init__(self, ws_url: str) -> None:
        host_port, path = ws_url.replace("ws://", "", 1).split("/", 1)
        host, port = host_port.split(":")
        self.host = host
        self.port = int(port)
        self.path = "/" + path
        self.next_id = 1
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self.sock.settimeout(180)
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

    def _send(self, payload: str) -> None:
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
        masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(data))
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

    def _recv_message(self) -> Dict[str, Any]:
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
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        if opcode != 1:
            return self._recv_message()
        return json.loads(payload.decode("utf-8"))

    def command(self, method: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
        cid = self.next_id
        self.next_id += 1
        self._send(json.dumps({"id": cid, "method": method, "params": params or {}}))
        while True:
            msg = self._recv_message()
            if msg.get("id") == cid:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result") or {}


def get_page_ws_url() -> str:
    with urllib.request.urlopen(CDP_HTTP, timeout=10) as resp:
        targets = json.loads(resp.read().decode("utf-8"))
    for target in targets:
        if target.get("type") == "page" and target.get("url", "").startswith(APP_URL):
            return target["webSocketDebuggerUrl"]
    for target in targets:
        if target.get("type") == "page":
            return target["webSocketDebuggerUrl"]
    raise RuntimeError("No page target found")


def evaluate(client: CDPClient, expression: str) -> Any:
    result = client.command(
        "Runtime.evaluate",
        {"expression": expression, "returnByValue": True, "awaitPromise": True},
    )
    return (result.get("result") or {}).get("value")


def main() -> None:
    client = CDPClient(get_page_ws_url())
    client.command("Page.enable")
    client.command("Runtime.enable")
    client.command("Page.navigate", {"url": APP_URL})
    client.command(
        "Runtime.evaluate",
        {"expression": "new Promise(r => setTimeout(r, 2500))", "awaitPromise": True},
    )

    output = evaluate(
        client,
        r"""
(async () => {
  localStorage.removeItem('freda_datasets_v1');
  localStorage.removeItem('freda_uploaded_datasets');
  localStorage.removeItem('freda_activity_feed_v1');

  window.__trace = { fetchCalls: [], modalTrace: [] };
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0] || '');
    const init = args[1] || {};
    const body = init?.body || null;
    const res = await origFetch(...args);
    let jsonBody = null;
    try { jsonBody = await res.clone().json(); } catch (e) {}
    if (url.includes('/workflows/run')) {
      window.__trace.fetchCalls.push({
        url,
        method: init?.method || 'GET',
        requestBody: body ? JSON.parse(body) : null,
        status: res.status,
        responseJson: jsonBody,
      });
    }
    return res;
  };

  if (!window.__wrappedODContactSec && typeof window.openDetail === 'function') {
    const orig = window.openDetail;
    window.openDetail = function(...args) {
      window.__trace.modalTrace.push({ type: 'openDetail_args', args: JSON.parse(JSON.stringify(args)) });
      const rv = orig.apply(this, args);
      window.__trace.modalTrace.push({
        type: 'openDetail_dom',
        payload: {
          d_field: document.getElementById('d-field')?.textContent || '',
          d_old: document.getElementById('d-old')?.textContent || '',
          d_new: document.getElementById('d-new')?.textContent || '',
          d_url: document.getElementById('d-url')?.textContent || '',
          d_source_type: document.getElementById('d-source-type')?.textContent || '',
        }
      });
      return rv;
    };
    window.__wrappedODContactSec = true;
  }

  const dataset = {
    id: 'contact-sec-browser-proof',
    name: 'contact-sec-browser-proof.csv',
    records: [
      { company_name: 'Apple', hq_address: '-' },
      { company_name: 'Tesla', hq_address: '-' },
      { company_name: 'NVIDIA', hq_address: '-' }
    ],
    columns: ['company_name', 'hq_address'],
  };

  window.FREDA.datasets = [dataset];
  window.FREDA.selectedDataset = dataset;

  window.workflowConfig = window.workflowConfig || {};
  window.workflowConfig.workflowType = 'Contact Enrichment';
  window.workflowConfig.selectedWorkflows = ['Contact Enrichment'];
  window.workflowConfig.prioritySources = ['SEC/MCA'];
  window.workflowConfig.enrichmentSources = ['SEC/MCA'];
  window.workflowConfig.selectedEnrichmentSources = ['SEC/MCA'];
  window.workflowConfig.sourceConfiguration = { companyWebsite: false, linkedin: false, customSources: [] };
  window.workflowConfig.requestedOutputFields = ['company_name', 'hq_address'];
  window.workflowConfig.workflowOutputPlan = {
    requestedFields: ['company_name', 'hq_address'],
    selectedWorkflows: ['Contact Enrichment'],
    enrichedFields: ['company_name', 'hq_address'],
    emptyFields: [],
  };

  let runError = null;
  try {
    await window.runWorkflow();
  } catch (err) {
    runError = String(err && err.message ? err.message : err);
  }

  const rows = JSON.parse(JSON.stringify(window.FREDA.selectedDataset?.workflowReviewRows || []));
  const reviewDataRows = JSON.parse(JSON.stringify(window.reviewData || []));
  const modalDumps = [];
  const targets = ['apple', 'tesla', 'nvidia'];
  for (const name of targets) {
    const idx = rows.findIndex((r) => String(r?.company || '').toLowerCase() === name);
    if (idx >= 0 && typeof window.openDetailFromWorkflowRow === 'function') {
      window.__trace.modalTrace = [];
      window.openDetailFromWorkflowRow(idx, 'all');
      modalDumps.push({
        company: name,
        row: rows[idx],
        trace: JSON.parse(JSON.stringify(window.__trace.modalTrace || [])),
      });
    }
  }

  return {
    runError,
    fetchCalls: JSON.parse(JSON.stringify(window.__trace.fetchCalls || [])),
    workflowSummary: JSON.parse(JSON.stringify(window.lastWorkflowRun || null)),
    workflowReviewRows: rows,
    reviewDataRows,
    modalDumps,
  };
})()
""",
    )

    path = "data/contact_enrichment_sec_browser_post_fix.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(json.dumps({"written": path, "rows": len(output.get("workflowReviewRows") or [])}, indent=2))


if __name__ == "__main__":
    main()
