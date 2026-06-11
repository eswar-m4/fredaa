"""Dump live UI runtime objects for Tesla/NVIDIA modal path and regenerate fresh workflow state."""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import urllib.request
from pathlib import Path
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
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self.sock.settimeout(300)
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
        parts = []
        pending = count
        while pending:
            chunk = self.sock.recv(pending)
            if not chunk:
                raise RuntimeError("WebSocket closed")
            parts.append(chunk)
            pending -= len(chunk)
        return b"".join(parts)

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
        if opcode == 8:
            raise RuntimeError("WebSocket closed by peer")
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
    client.command("Runtime.evaluate", {"expression": "new Promise(r => setTimeout(r, 2500))", "awaitPromise": True})

    pre_dump = evaluate(
        client,
        r"""
(() => {
  const parse = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return { parse_error: String(e) }; } };
  const datasets = Array.isArray(window.FREDA?.datasets) ? window.FREDA.datasets : [];
  const reviewData = Array.isArray(window.reviewData) ? window.reviewData : [];
  const companies = new Set(['tesla', 'nvidia']);
  const reviewMatches = reviewData.filter((r) => companies.has(String(r?.company || '').toLowerCase()));
  const datasetMatches = datasets.flatMap((d) => (Array.isArray(d?.workflowReviewRows) ? d.workflowReviewRows : []).filter((r) => companies.has(String(r?.company || '').toLowerCase())).map((r) => ({ dataset_id: d.id, dataset_name: d.name, row: r })));
  return {
    location: window.location.href,
    localStorage_keys: Object.keys(localStorage),
    localStorage_datasets: parse('freda_datasets_v1'),
    localStorage_uploaded_datasets: parse('freda_uploaded_datasets'),
    runtime_reviewData_matches: reviewMatches,
    runtime_dataset_review_matches: datasetMatches,
  };
})()
""",
    )

    # Install runtime trace wrappers.
    evaluate(
        client,
        r"""
(() => {
  window.__modalTrace = [];
  if (!window.__traceWrappedOpenDetail && typeof window.openDetail === 'function') {
    const original = window.openDetail;
    window.openDetail = function(...args) {
      window.__modalTrace.push({ type: 'openDetail_args', args: JSON.parse(JSON.stringify(args)) });
      const result = original.apply(this, args);
      window.__modalTrace.push({
        type: 'openDetail_dom',
        payload: {
          d_field: document.getElementById('d-field')?.textContent || '',
          d_old: document.getElementById('d-old')?.textContent || '',
          d_new: document.getElementById('d-new')?.textContent || '',
          d_url: document.getElementById('d-url')?.textContent || '',
          d_source_type: document.getElementById('d-source-type')?.textContent || '',
          overlay_open: document.getElementById('detail-overlay')?.classList.contains('open') || false,
        }
      });
      return result;
    };
    window.__traceWrappedOpenDetail = true;
  }
  if (!window.__traceWrappedOpenDetailFromWorkflowRow && typeof window.openDetailFromWorkflowRow === 'function') {
    const originalRow = window.openDetailFromWorkflowRow;
    window.openDetailFromWorkflowRow = function(...args) {
      window.__modalTrace.push({ type: 'openDetailFromWorkflowRow_args', args: JSON.parse(JSON.stringify(args)) });
      return originalRow.apply(this, args);
    };
    window.__traceWrappedOpenDetailFromWorkflowRow = true;
  }
  return true;
})()
""",
    )

    # Try to open currently-rendered Tesla/NVIDIA rows (if any) and dump exact objects.
    pre_modal_dump = evaluate(
        client,
        r"""
(() => {
  const companies = ['Tesla', 'NVIDIA', 'Nvidia'];
  const out = [];
  const rows = Array.isArray(window.reviewData) ? window.reviewData : [];
  const openFor = (row) => {
    if (!row) return null;
    const idx = rows.findIndex((r) => r === row);
    if (idx >= 0 && typeof window.openDetailFromWorkflowRow === 'function') {
      window.currentReviewVisibleRecords = rows;
      window.openDetailFromWorkflowRow(idx, 'all');
    }
    return {
      row_object: JSON.parse(JSON.stringify(row)),
      currentDetailContext: JSON.parse(JSON.stringify(window.currentDetailContext || {})),
      modal_dom: {
        d_field: document.getElementById('d-field')?.textContent || '',
        d_old: document.getElementById('d-old')?.textContent || '',
        d_new: document.getElementById('d-new')?.textContent || '',
        d_url: document.getElementById('d-url')?.textContent || '',
        d_source_type: document.getElementById('d-source-type')?.textContent || '',
      },
      trace: JSON.parse(JSON.stringify(window.__modalTrace || [])),
    };
  };
  for (const name of companies) {
    const row = rows.find((r) => String(r?.company || '').toLowerCase() === name.toLowerCase());
    if (row) out.push({ company: name, dump: openFor(row) });
  }
  return out;
})()
""",
    )

    # Clear stale browser state.
    clear_dump = evaluate(
        client,
        r"""
(() => {
  localStorage.removeItem('freda_datasets_v1');
  localStorage.removeItem('freda_uploaded_datasets');
  localStorage.removeItem('freda_activity_feed_v1');
  if (window.FREDA) {
    window.FREDA.datasets = [];
    window.FREDA.reviewQueue = [];
    window.FREDA.selectedDataset = null;
    window.FREDA.workflowRuns = [];
  }
  window.reviewData = [];
  return { cleared: true, remaining_keys: Object.keys(localStorage) };
})()
""",
    )

    # Seed fresh dataset and run workflow through real UI method.
    run_result = evaluate(
        client,
        r"""
(async () => {
  const dataset = {
    id: 'fresh-sec-ui-dataset',
    name: 'fresh-sec-ui.csv',
    records: [
      { company_name: 'Tesla', website: '-' },
      { company_name: 'NVIDIA', website: '-' }
    ],
    totalRecords: 2,
    columns: ['company_name', 'website'],
    confidenceSummary: '0%',
    workflowStatus: 'Ready',
    sourceType: 'csv'
  };
  if (!window.FREDA) throw new Error('FREDA runtime missing');
  window.FREDA.datasets = [dataset];
  window.FREDA.selectedDataset = dataset;
  window.workflowConfig = window.workflowConfig || {};
  window.workflowConfig.datasetId = dataset.id;
  window.workflowConfig.prioritySources = ['SEC/MCA'];
  window.workflowConfig.selectedWorkflows = ['Website Verification'];
  window.workflowConfig.requestedOutputFields = ['company_name', 'website'];
  window.workflowConfig.requestedOutputFieldsDatasetId = dataset.id;
  window.workflowConfig.autoApproveThreshold = 99;
  window.workflowConfig.reviewThreshold = 60;
  if (typeof window.setSelectedWorkflows === 'function') {
    window.setSelectedWorkflows(['Website Verification']);
  }
  if (typeof window.runWorkflow !== 'function') throw new Error('window.runWorkflow missing');
  await window.runWorkflow();
  const rows = Array.isArray(window.reviewData) ? window.reviewData : [];
  return {
    reviewData_companies: rows.map((r) => r.company),
    reviewData_rows: JSON.parse(JSON.stringify(rows)),
    localStorage_datasets: (() => { try { return JSON.parse(localStorage.getItem('freda_datasets_v1') || '[]'); } catch(e) { return { parse_error: String(e) }; } })(),
  };
})()
""",
    )

    post_modal_dump = evaluate(
        client,
        r"""
(() => {
  window.__modalTrace = [];
  const rows = Array.isArray(window.reviewData) ? window.reviewData : [];
  const targets = ['tesla', 'nvidia'];
  const dumps = [];
  for (const target of targets) {
    const idx = rows.findIndex((r) => String(r?.company || '').toLowerCase() === target);
    if (idx < 0) continue;
    if (typeof window.openDetailFromWorkflowRow === 'function') {
      window.currentReviewVisibleRecords = rows;
      window.openDetailFromWorkflowRow(idx, 'all');
    }
    dumps.push({
      company: target,
      row_object: JSON.parse(JSON.stringify(rows[idx])),
      currentDetailContext: JSON.parse(JSON.stringify(window.currentDetailContext || {})),
      modal_dom: {
        d_field: document.getElementById('d-field')?.textContent || '',
        d_old: document.getElementById('d-old')?.textContent || '',
        d_new: document.getElementById('d-new')?.textContent || '',
        d_url: document.getElementById('d-url')?.textContent || '',
        d_source_type: document.getElementById('d-source-type')?.textContent || '',
      },
      trace: JSON.parse(JSON.stringify(window.__modalTrace || [])),
    });
    window.__modalTrace = [];
  }
  return dumps;
})()
""",
    )

    # Second pass: bypass window.runWorkflow payload shaper and call API wrapper directly
    # with strict SEC/MCA-only config, then let frontend derive rows from summary.
    final_regen = evaluate(
        client,
        r"""
(async () => {
  localStorage.removeItem('freda_datasets_v1');
  localStorage.removeItem('freda_uploaded_datasets');
  localStorage.removeItem('freda_activity_feed_v1');
  const dataset = {
    id: 'fresh-sec-ui-dataset-final',
    name: 'fresh-sec-ui-final.csv',
    records: [
      { company_name: 'Tesla', website: '-' },
      { company_name: 'NVIDIA', website: '-' }
    ],
    totalRecords: 2,
    columns: ['company_name', 'website'],
    confidenceSummary: '0%',
    workflowStatus: 'Ready',
    sourceType: 'csv'
  };
  window.FREDA.datasets = [dataset];
  window.FREDA.selectedDataset = dataset;
  const payload = {
    dataset,
    workflowConfig: {
      selectedWorkflows: ['Website Verification'],
      prioritySources: ['SEC/MCA'],
      requestedOutputFields: ['company_name', 'website'],
      autoApproveThreshold: 99,
      reviewThreshold: 60,
      concurrency: 2
    }
  };
  const response = await window.FREDA.runWorkflow(payload);
  dataset.workflowSummary = response.summary || response.result || {};
  dataset.workflowReviewRows = null;
  if (typeof window.syncReviewQueueFromDataset === 'function') {
    window.syncReviewQueueFromDataset(dataset);
  }
  if (typeof window.renderReview === 'function') {
    window.renderReview('all');
  }
  const rows = Array.isArray(window.reviewData) ? window.reviewData : [];
  const dumps = [];
  for (const target of ['tesla', 'nvidia']) {
    const idx = rows.findIndex((r) => String(r?.company || '').toLowerCase() === target);
    if (idx < 0) continue;
    window.currentReviewVisibleRecords = rows;
    if (typeof window.openDetailFromWorkflowRow === 'function') {
      window.openDetailFromWorkflowRow(idx, 'all');
    }
    dumps.push({
      company: target,
      row_object: JSON.parse(JSON.stringify(rows[idx])),
      currentDetailContext: JSON.parse(JSON.stringify(window.currentDetailContext || {})),
      modal_dom: {
        d_field: document.getElementById('d-field')?.textContent || '',
        d_old: document.getElementById('d-old')?.textContent || '',
        d_new: document.getElementById('d-new')?.textContent || '',
        d_url: document.getElementById('d-url')?.textContent || '',
        d_source_type: document.getElementById('d-source-type')?.textContent || '',
      },
      trace: JSON.parse(JSON.stringify(window.__modalTrace || [])),
    });
    window.__modalTrace = [];
  }
  return {
    response_summary: dataset.workflowSummary,
    rows: JSON.parse(JSON.stringify(rows)),
    modal_dumps: dumps,
    localStorage_datasets: (() => { try { return JSON.parse(localStorage.getItem('freda_datasets_v1') || '[]'); } catch(e) { return { parse_error: String(e) }; } })(),
  };
})()
""",
    )

    out = {
        "pre_dump": pre_dump,
        "pre_modal_dump": pre_modal_dump,
        "clear_dump": clear_dump,
        "run_result": run_result,
        "post_modal_dump": post_modal_dump,
        "final_regen": final_regen,
    }
    out_path = Path("data/ui_runtime_trace_tesla_nvidia.json")
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
