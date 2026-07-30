import os
import json
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import get_connection
from app.services.wcm_comparison_service import compare_records

client = TestClient(app)
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def clean_files(job_id):
    datasets_dir = os.path.join(BASE_DIR, "datasets")
    for filename in os.listdir(datasets_dir):
        if filename.startswith(job_id):
            try:
                os.remove(os.path.join(datasets_dir, filename))
            except Exception:
                pass

def test_wcm_monitoring_lifecycle():
    job_id = "test_wcm_job_12345"
    source = "Keysight"
    
    # Ensure clean state
    clean_files(job_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()

    # 1. Insert mock job in SQLite database
    # First execution setup (refresh_count = 0)
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO scraper_jobs (
                id, source, scope, filters, custom_criteria, frequency, delivery,
                output_format, dataset_path, status, records, fresh, created_at,
                last_refresh, next_refresh, refresh_count, is_custom_source, mode,
                refresh_history_json, changes_detected
            ) VALUES (
                ?, ?, 'Full Dump', '—', '', 'Weekly', 'Email',
                'json', '', 'Review Pending', 2, 100, '2026-06-23T17:00:00Z',
                '2026-06-23T17:00:00Z', '2026-06-30T17:00:00Z', 0, 0, 'Site-Specific',
                '[]', 0
            )
        """, (job_id, source))
        conn.commit()

    # 2. Write datasets/{job_id}_run_1.json
    run_1_records = [
        {
            "name": "Keysight DSOX1204A Oscilloscope",
            "sku": "DSOX1204A",
            "price": "$1,200.00",
            "category": "Oscilloscopes",
            "pdf": "https://keysight.com/dsox1204a.pdf"
        },
        {
            "name": "Keysight DSOX1204G Oscilloscope",
            "sku": "DSOX1204G",
            "price": "$1,500.00",
            "category": "Oscilloscopes",
            "pdf": "https://keysight.com/dsox1204g.pdf"
        }
    ]
    
    datasets_dir = os.path.join(BASE_DIR, "datasets")
    os.makedirs(datasets_dir, exist_ok=True)
    run_1_path = os.path.join(datasets_dir, f"{job_id}_run_1.json")
    with open(run_1_path, "w", encoding="utf-8") as f:
        json.dump(run_1_records, f, ensure_ascii=False, indent=2)

    # 3. Request GET review_data
    response = client.get(f"/api/v1/demo/jobs/review_data?job_id={job_id}&sample_rate=100.0")
    assert response.status_code == 200
    res_data = response.json()
    assert "rows" in res_data
    assert res_data["totalSampled"] == 2
    
    rows = res_data["rows"]
    # Check that all changeTypes are 'A' because baseline does not exist (first run)
    for r in rows:
        assert r["changeType"] == "A"
        assert r["previous"] == "—"
        assert r["value"] != "—"

    # 4. Submit first review
    decisions = []
    for r in rows:
        decisions.append({
            "record_index": r["recordIndex"],
            "attribute": r["attributeKey"],
            "previous_value": r["previous"],
            "enriched_value": r["value"],
            "admv_status": r["changeType"],
            "reviewer_action": "accepted"
        })
        
    submit_req = {
        "job_id": job_id,
        "decisions": decisions
    }
    
    response = client.post("/api/v1/demo/jobs/submit_review", json=submit_req)
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify baseline is created and DB refreshed
    final_path = os.path.join(datasets_dir, f"{job_id}_final.json")
    assert os.path.exists(final_path)
    with open(final_path, "r", encoding="utf-8") as f:
        final_records = json.load(f)
    assert len(final_records) == 2
    
    # Check sku alignment keys
    skus = [fr["sku"] for fr in final_records]
    assert "DSOX1204A" in skus
    assert "DSOX1204G" in skus

    # Verify db status
    with get_connection() as conn:
        row = conn.execute("SELECT status, refresh_count FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    assert row[0] == "Completed"
    assert row[1] == 1

    # 5. Simulate Run 2 (Mutated Scrape)
    # We write run_2.json with:
    # - DSOX1204A: Price modified to $1,300.00 (M)
    # - DSOX1204G: Same (V)
    # - DSOX3000A: New product added (A)
    run_2_records = [
        {
            "name": "Keysight DSOX1204A Oscilloscope",
            "sku": "DSOX1204A",
            "price": "$1,300.00", # Modified
            "category": "Oscilloscopes",
            "pdf": "https://keysight.com/dsox1204a.pdf"
        },
        {
            "name": "Keysight DSOX1204G Oscilloscope",
            "sku": "DSOX1204G",
            "price": "$1,500.00", # Same
            "category": "Oscilloscopes",
            "pdf": "https://keysight.com/dsox1204g.pdf"
        },
        {
            "name": "Keysight DSOX3000A Oscilloscope",
            "sku": "DSOX3000A", # Added
            "price": "$3,000.00",
            "category": "Oscilloscopes",
            "pdf": "https://keysight.com/dsox3000a.pdf"
        }
    ]
    run_2_path = os.path.join(datasets_dir, f"{job_id}_run_2.json")
    with open(run_2_path, "w", encoding="utf-8") as f:
        json.dump(run_2_records, f, ensure_ascii=False, indent=2)

    # Note: simulate subsequent run updates database to 'Review Pending' with refresh_count = 1
    with get_connection() as conn:
        conn.execute("UPDATE scraper_jobs SET status = 'Review Pending' WHERE id = ?", (job_id,))
        conn.commit()

    # 6. Fetch review_data for Run 2
    response = client.get(f"/api/v1/demo/jobs/review_data?job_id={job_id}&sample_rate=100.0")
    assert response.status_code == 200
    res_data_2 = response.json()
    assert res_data_2["totalSampled"] == 3
    
    rows_2 = res_data_2["rows"]
    
    # Group rows by sku and attribute to inspect ADMV
    # DSOX1204A - price should be 'M', previous '$1,200.00', new '$1,300.00'
    # DSOX1204G - price should be 'V', previous '$1,500.00', new '$1,500.00'
    # DSOX3000A - price should be 'A', previous '—', new '$3,000.00'
    price_1204a = next(r for r in rows_2 if r["recordKey"] == "DSOX1204A" and r["attributeKey"] == "price")
    price_1204g = next(r for r in rows_2 if r["recordKey"] == "DSOX1204G" and r["attributeKey"] == "price")
    sku_3000a = next(r for r in rows_2 if r["recordKey"] == "DSOX3000A" and r["attributeKey"] == "sku")
    
    assert price_1204a["changeType"] == "M"
    assert price_1204a["previous"] == "$1,200.00"
    assert price_1204a["value"] == "$1,300.00"
    
    assert price_1204g["changeType"] == "V"
    assert price_1204g["previous"] == "$1,500.00"
    assert price_1204g["value"] == "$1,500.00"
    
    assert sku_3000a["changeType"] == "A"
    assert sku_3000a["previous"] == "—"
    assert sku_3000a["value"] == "DSOX3000A"

    # 7. Submit second review, accept DSOX1204A modifications, reject DSOX3000A addition
    decisions_2 = []
    for r in rows_2:
        action = "accepted"
        if r["recordKey"] == "DSOX3000A":
            action = "rejected" # Reject adding the new oscilloscope
        decisions_2.append({
            "record_index": r["recordIndex"],
            "attribute": r["attributeKey"],
            "previous_value": r["previous"],
            "enriched_value": r["value"],
            "admv_status": r["changeType"],
            "reviewer_action": action
        })
        
    submit_req_2 = {
        "job_id": job_id,
        "decisions": decisions_2
    }
    response = client.post("/api/v1/demo/jobs/submit_review", json=submit_req_2)
    assert response.status_code == 200
    
    # Read updated baseline
    with open(final_path, "r", encoding="utf-8") as f:
        final_records_2 = json.load(f)
        
    # Should only have DSOX1204A and DSOX1204G (since DSOX3000A addition was rejected)
    assert len(final_records_2) == 2
    skus_2 = [fr["sku"] for fr in final_records_2]
    assert "DSOX1204A" in skus_2
    assert "DSOX1204G" in skus_2
    # DSOX1204A price should be updated to '$1,300.00' (accepted modification)
    dsox1204a_rec = next(r for r in final_records_2 if r["sku"] == "DSOX1204A")
    assert dsox1204a_rec["price"] == "$1,300.00"

    # Verify db status and refresh_count
    with get_connection() as conn:
        row = conn.execute("SELECT status, refresh_count FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    assert row[0] == "Completed"
    assert row[1] == 2

    # Clean up
    clean_files(job_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()


def test_keysight_review_source_link_is_normalized():
    rows, changed = compare_records(
        "Keysight",
        [],
        [{"sku": "10020A", "name": "Resistive Divider Probe Kit"}],
        False,
    )

    assert changed == 1
    assert rows[0]["sourceUrl"] == "https://www.keysight.com"
    assert rows[0]["source"] == "keysight.com"


def test_compare_records_treats_null_like_previous_values_as_added():
    rows, changed = compare_records(
        "Keysight",
        [{"sku": "10020A", "name": "null"}],
        [{"sku": "10020A", "name": "Resistive Divider Probe Kit"}],
        False,
    )

    assert changed == 1
    assert rows[0]["changeType"] == "A"


def test_wcm_monitoring_uses_previous_run_when_final_baseline_is_missing():
    job_id = "test_wcm_pending_12345"
    source = "Keysight"

    clean_files(job_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO scraper_jobs (
                id, source, scope, filters, custom_criteria, frequency, delivery,
                output_format, dataset_path, status, records, fresh, created_at,
                last_refresh, next_refresh, refresh_count, is_custom_source, mode,
                refresh_history_json, changes_detected
            ) VALUES (
                ?, ?, 'Full Scrape', 'Ã¢â‚¬â€', '', 'Weekly', 'Email',
                'json', '', 'Review Pending', 2, 100, '2026-06-23T17:00:00Z',
                '2026-06-23T17:00:00Z', '2026-06-30T17:00:00Z', 0, 0, 'Site-Specific',
                '[]', 0
            )
            """,
            (job_id, source),
        )
        conn.commit()

    datasets_dir = os.path.join(BASE_DIR, "datasets")
    os.makedirs(datasets_dir, exist_ok=True)
    run_1_records = [
        {"sku": "DSOX1204A", "name": "Keysight DSOX1204A Oscilloscope", "price": "$1,200.00"},
        {"sku": "DSOX1204G", "name": "Keysight DSOX1204G Oscilloscope", "price": "$1,500.00"},
    ]
    run_2_records = [
        {"sku": "DSOX1204A", "name": "Keysight DSOX1204A Oscilloscope", "price": "$1,300.00"},
        {"sku": "DSOX1204G", "name": "Keysight DSOX1204G Oscilloscope", "price": "$1,500.00"},
        {"sku": "DSOX3000A", "name": "Keysight DSOX3000A Oscilloscope", "price": "$3,000.00"},
    ]

    with open(os.path.join(datasets_dir, f"{job_id}_run_1.json"), "w", encoding="utf-8") as f1:
        json.dump(run_1_records, f1, ensure_ascii=False, indent=2)
    with open(os.path.join(datasets_dir, f"{job_id}_run_2.json"), "w", encoding="utf-8") as f2:
        json.dump(run_2_records, f2, ensure_ascii=False, indent=2)

    res = client.get(f"/api/v1/demo/jobs/review_data?job_id={job_id}&sample_rate=100.0")
    assert res.status_code == 200
    payload = res.json()
    assert payload["totalSampled"] == 3

    price_row = next(r for r in payload["rows"] if r["recordKey"] == "DSOX1204A" and r["attributeKey"] == "price")
    added_row = next(r for r in payload["rows"] if r["recordKey"] == "DSOX3000A" and r["attributeKey"] == "sku")

    assert price_row["previous"] == "$1,200.00"
    assert price_row["value"] == "$1,300.00"
    assert added_row["previous"] not in (None, "", "DSOX3000A")
    assert added_row["value"] == "DSOX3000A"

    clean_files(job_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()


def test_site_specific_refresh_does_not_fail_when_review_pending(monkeypatch):
    import asyncio

    from app.api.demo_routes import run_scraper_background

    job_id = "test_wcm_refresh_pending_12345"
    source = "TurkeyBrokers"

    clean_files(job_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO scraper_jobs (
                id, source, scope, filters, custom_criteria, frequency, delivery,
                output_format, dataset_path, status, records, fresh, created_at,
                last_refresh, next_refresh, refresh_count, is_custom_source, mode,
                refresh_history_json, changes_detected
            ) VALUES (
                ?, ?, 'Full Scrape', 'Ã¢â‚¬â€', '', 'Hourly', 'S3 bucket',
                'JSON', 'datasets/turkeybrokers_sample.csv', 'Review Pending', 15, 100,
                '2026-07-05T14:10:05.009291Z', '2026-07-05T14:10:05.009291Z',
                '2026-07-05T15:10:05.010556Z', 0, 0, 'Site-Specific', '[]', 15
            )
            """,
            (job_id, source),
        )
        conn.commit()

    datasets_dir = os.path.join(BASE_DIR, "datasets")
    os.makedirs(datasets_dir, exist_ok=True)
    run_1_records = [
        {"PrimaryKey": "TB-001", "Address": "Ataturk Bulvari No: 12, Ankara", "City": "Ankara"},
        {"PrimaryKey": "TB-002", "Address": "Istiklal Caddesi No: 45, Istanbul", "City": "Istanbul"},
    ]
    run_2_records = [
        {"PrimaryKey": "TB-001", "Address": "Ataturk Bulvari No: 12, Ankara", "City": "Ankara"},
        {"PrimaryKey": "TB-002", "Address": "Istiklal Caddesi No: 45, Istanbul", "City": "Istanbul"},
    ]
    with open(os.path.join(datasets_dir, f"{job_id}_run_1.json"), "w", encoding="utf-8") as f1:
        json.dump(run_1_records, f1, ensure_ascii=False, indent=2)
    with open(os.path.join(datasets_dir, f"{job_id}_run_2.json"), "w", encoding="utf-8") as f2:
        json.dump(run_2_records, f2, ensure_ascii=False, indent=2)

    async def _no_sleep(*_args, **_kwargs):
        return None

    monkeypatch.setattr("app.api.demo_routes.asyncio.sleep", _no_sleep)

    asyncio.run(run_scraper_background(job_id))

    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, refresh_count, next_refresh FROM scraper_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    assert row is not None
    assert row["status"] == "Review Pending"
    assert row["refresh_count"] == 0
    assert row["next_refresh"] is not None

    clean_files(job_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()
