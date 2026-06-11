"""Live API workflow tests against running uvicorn server."""
import json
import sys
import httpx

BASE = "http://127.0.0.1:8000/api/v1"
CONFIG = {"autoApproveThreshold": 75, "reviewThreshold": 60, "minCandidateGap": 15}


def post_verify(client: httpx.Client, name: str, record: dict) -> dict:
    payload = {"record": record, "config": CONFIG}
    print(f"\n=== {name} ===")
    r = client.post(f"{BASE}/workflows/verify-record", json=payload, timeout=120.0)
    print("HTTP", r.status_code)
    data = r.json()
    if r.status_code != 200:
        print(r.text)
        return data
    result = data.get("result", {})
    print("status:", result.get("status"))
    print("confidence:", result.get("confidence"))
    print("website:", result.get("website"))
    print("discovery_used:", result.get("discovery_used"))
    candidates = result.get("website_candidates") or []
    if candidates:
        print("top candidates:")
        for c in candidates[:3]:
            print(f"  - {c.get('domain')} ({c.get('confidence')}%)")
    print("comparison:", result.get("record_comparison", {}).get("summary"))
    meta = result.get("scraped_metadata") or {}
    if meta:
        print("detected_company_name:", meta.get("detected_company_name"))
        print("phone_numbers:", meta.get("phone_numbers"))
        print("page_text_length:", meta.get("page_text_length", len(meta.get("page_text") or "")))
    return result


def main() -> int:
    failures = 0
    with httpx.Client() as client:
        health = client.get(f"{BASE}/health", timeout=10.0)
        print("health:", health.status_code, health.json())

        r1 = post_verify(client, "TEST 1 OpenAI + openai.com", {"company": "OpenAI", "website": "openai.com"})
        if r1.get("status") != "Auto Approved" or (r1.get("confidence") or 0) < 75:
            failures += 1
            print("FAIL: expected Auto Approved with confidence >= 75")

        r2 = post_verify(client, "TEST 2 Tesla + null website", {"company": "Tesla", "website": None})
        if r2.get("status") != "Auto Approved" or (r2.get("confidence") or 0) < 75:
            failures += 1
            print("FAIL: expected discovery + Auto Approved")
        website_l = (r2.get("website") or "").lower()
        if "tesla.com" not in website_l:
            failures += 1
            print("FAIL: expected tesla.com discovered, got", r2.get("website"))

        r3 = post_verify(client, "TEST 3 Fake Test Company", {"company": "Fake Test Company", "website": None})
        if r3.get("status") == "Auto Approved" and (r3.get("confidence") or 0) >= 75:
            failures += 1
            print("FAIL: expected review routing, not auto approved")
        if r3.get("status") not in ("Needs Review", "Partially Verified", "Verification Failed"):
            failures += 1
            print("FAIL: expected review-related status")

        # Workflow batch + review queue
        print("\n=== Workflow run (batch) ===")
        batch = client.post(
            f"{BASE}/workflows/run",
            json={
                "workflowConfig": CONFIG,
                "dataset": {
                    "id": "ds_test_batch",
                    "name": "Hospital_ER_Data.csv",
                    "records": [
                        {"company": "OpenAI", "website": "openai.com"},
                        {"company": "Fake Test Company", "website": None},
                    ],
                },
            },
            timeout=180.0,
        )
        print("HTTP", batch.status_code)
        summary = batch.json().get("summary", {})
        print("auto_approved:", summary.get("auto_approved"))
        print("needs_review:", summary.get("needs_review"))
        rq = summary.get("review_queue", {})
        print("review_queue level_1:", json.dumps(rq.get("level_1_datasets"), indent=2))

        rq_get = client.get(f"{BASE}/workflows/review-queue", timeout=10.0)
        print("\nGET review-queue HTTP", rq_get.status_code)
        print(json.dumps(rq_get.json().get("review_queue", {}).get("level_1_datasets"), indent=2))

    print("\n=== DONE failures=%d ===" % failures)
    return failures


if __name__ == "__main__":
    sys.exit(main())
