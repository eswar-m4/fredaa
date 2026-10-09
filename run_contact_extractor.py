#!/usr/bin/env python3
"""
Thin CLI wrapper around contact_extractor.run_async() for Node.js to spawn.

Reads a JSON config from stdin:
  { "pairs": [["https://acme.com", "Acme Corp"], ...] }

Writes JSON to stdout:
  { "contacts": [...] }

Errors are written to stderr; exit code is non-zero on failure.
"""
from __future__ import annotations
import asyncio, importlib.util, json, os, sys, tempfile

def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"bad input JSON: {exc}"}), file=sys.stdout)
        sys.exit(1)

    pairs: list[list[str]] = payload.get("pairs", [])
    if not pairs:
        print(json.dumps({"contacts": []}), file=sys.stdout)
        return

    here = os.path.dirname(os.path.abspath(__file__))
    ce_path = os.path.join(here, "contact_extractor.py")
    if not os.path.exists(ce_path):
        print(json.dumps({"error": f"contact_extractor.py not found at {ce_path}"}), file=sys.stdout)
        sys.exit(1)

    spec = importlib.util.spec_from_file_location("contact_extractor", ce_path)
    ce = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(ce)  # type: ignore[union-attr]

    from openpyxl import Workbook
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        tmp_in = f.name
    try:
        wb = Workbook()
        ws = wb.active
        ws.append(["url", "company"])
        for url, company in pairs:
            ws.append([url, company])
        wb.save(tmp_in)

        cfg = ce.ExtractionConfig(input_path=tmp_in, browser_provider="http")
        report = asyncio.run(ce.run_async(cfg))
        print(json.dumps({"contacts": report.contacts}), file=sys.stdout)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stdout)
        sys.exit(1)
    finally:
        try:
            os.unlink(tmp_in)
        except OSError:
            pass

if __name__ == "__main__":
    main()
