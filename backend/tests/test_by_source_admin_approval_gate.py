from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
import os
import time

from fastapi.testclient import TestClient

from app.core.database import get_connection
from app.main import app


client = TestClient(app)


def _login_as(role: str) -> TestClient:
    session_client = TestClient(app)
    creds = {
        "user": {"username": "user", "password": "REDACTED_USER_PASS", "role": "user"},
        "admin": {"username": "admin", "password": "REDACTED_ADMIN_PASS", "role": "admin"},
    }[role]
    response = session_client.post("/api/v1/auth/login", json=creds)
    assert response.status_code == 200
    return session_client


def _cleanup(job_id: str) -> None:
    input_path = Path(__file__).resolve().parents[1] / "datasets" / f"{job_id}_input.json"
    with get_connection() as conn:
        conn.execute("DELETE FROM admin_request_audit WHERE job_id = ?", (job_id,))
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()
    try:
        if input_path.exists():
            input_path.unlink()
    except Exception:
        pass


def _write_job_input(job_id: str, payload: list[dict[str, str]]) -> Path:
    input_path = Path(__file__).resolve().parents[1] / "datasets" / f"{job_id}_input.json"
    input_path.parent.mkdir(parents=True, exist_ok=True)
    input_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return input_path


def _write_bot_package(tmp_path: Path, *, manifest: dict, files: dict[str, str]) -> Path:
    package_path = tmp_path / "bot.zip"
    with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, contents in files.items():
            archive.writestr(name, contents)
    return package_path


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def test_new_source_request_becomes_pending_onboarding_and_supports_bot_upload(tmp_path):
    user_client = _login_as("user")
    admin_client = _login_as("admin")

    payload = {
        "source_name": "approval-gated-example",
        "website_url": "https://approval-gated-example.com",
        "category": "Registry & SEC",
        "complexity": "Easy",
        "recommended_scraper_type": "HTML Parser",
        "estimated_development_effort": "1-2 days",
        "status": "Analysis Complete",
    }

    try:
        response = user_client.post("/api/v1/demo/jobs/create_pending", json=payload)
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        with get_connection() as conn:
            row = conn.execute(
                "SELECT status, is_custom_source, source FROM scraper_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        assert row is not None
        assert row["status"] == "Pending Onboarding"
        assert row["is_custom_source"] == 1
        assert row["source"] == payload["website_url"]

        admin_rows = admin_client.get("/api/v1/admin/requests?request_type=By Source&status=Pending Onboarding&limit=50")
        assert admin_rows.status_code == 200
        rows = admin_rows.json()["requests"]
        request_row = next((r for r in rows if r["job_id"] == job_id), None)
        assert request_row is not None
        request_id = request_row["id"]

        bot_package = _write_bot_package(
            tmp_path,
            manifest={
                "bot_name": "Approval Gate Bot",
                "source": payload["website_url"],
                "scope": "Full Dump",
                "runtime_type": "python",
                "entrypoint_file": "bot.py",
                "entrypoint_function": "run",
            },
            files={
                "bot.py": (
                    "def run(context):\n"
                    "    return {\n"
                    "        'records': [{'company': 'Example Corp', 'source': context['source']}],\n"
                    "        'execution_metadata': {'rows': 1},\n"
                    "    }\n"
                ),
                "helper.py": "VALUE = 1\n",
            },
        )

        onboard_response = admin_client.post(
            f"/api/v1/admin/requests/{request_id}/onboard",
            json={
                "notes": "Uploaded bot package",
                "uploads": [
                    {
                        "id": "upload-1",
                        "filename": "bot.zip",
                        "storage_path": str(bot_package),
                        "file_size": os.path.getsize(bot_package),
                        "format": "zip",
                    }
                ],
            },
        )
        assert onboard_response.status_code == 200

        with get_connection() as conn:
            running = conn.execute(
                "SELECT status FROM scraper_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        assert running is not None
        assert running["status"] == "Running"

        deadline = time.time() + 6
        review_pending = None
        while time.time() < deadline:
            with get_connection() as conn:
                review_pending = conn.execute(
                    "SELECT status FROM scraper_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
            if review_pending and review_pending["status"] == "Review Pending":
                break
            time.sleep(0.25)

        assert review_pending is not None
        assert review_pending["status"] == "Review Pending"

        onboarded_row = admin_client.get(f"/api/v1/admin/requests/{request_id}").json()["request"]
        assert onboarded_row["request_status"] == "Review Pending"
        assert onboarded_row["execution_metadata"]["bot_onboarding_notes"] == "Uploaded bot package"
        assert onboarded_row["execution_metadata"]["bot_uploads"][0]["filename"] == "bot.zip"
        assert onboarded_row["execution_metadata"]["bot_catalog_entry"]["entrypoint_function"] == "run"
    finally:
        _cleanup(payload["website_url"])


def test_arkansas_style_script_package_runs_to_review_pending_without_mutating_zip(tmp_path):
    user_client = _login_as("user")
    admin_client = _login_as("admin")

    payload = {
        "source_name": "arkansas-style-package",
        "website_url": "https://arkansas-style-package.example",
        "category": "Registry & SEC",
        "complexity": "Medium",
        "recommended_scraper_type": "HTML Parser",
        "estimated_development_effort": "1-2 days",
        "status": "Analysis Complete",
    }

    try:
        response = user_client.post("/api/v1/demo/jobs/create_pending", json=payload)
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        admin_rows = admin_client.get("/api/v1/admin/requests?request_type=By Source&status=Pending Onboarding&limit=50")
        assert admin_rows.status_code == 200
        request_row = next((r for r in admin_rows.json()["requests"] if r["job_id"] == job_id), None)
        assert request_row is not None

        bot_package = _write_bot_package(
            tmp_path,
            manifest={
                "bot_name": "Arkansas Bot",
                "source": payload["website_url"],
                "scope": "Full Dump",
                "runtime_type": "python",
                "entrypoint_file": "SOS Scripts/Arkansas/main.py",
                "entrypoint_mode": "script",
            },
            files={
                "SOS Scripts/Arkansas/main.py": (
                    "import csv\n"
                    "from pathlib import Path\n"
                    "\n"
                    "if __name__ == '__main__':\n"
                    "    input_lines = [line.strip() for line in Path('Input.txt').read_text(encoding='utf-8').splitlines() if line.strip()]\n"
                    "    with Path('Output.csv').open('w', encoding='utf-8', newline='') as handle:\n"
                    "        writer = csv.DictWriter(handle, fieldnames=['keyword'])\n"
                    "        writer.writeheader()\n"
                    "        for value in input_lines:\n"
                    "            writer.writerow({'keyword': value})\n"
                ),
                "SOS Scripts/Arkansas/Input.txt": "Walmart\nTyson\n",
                "SOS Scripts/Arkansas/mod.py": "VALUE = 1\n",
            },
        )
        zip_hash_before = _sha256_file(bot_package)

        onboard_response = admin_client.post(
            f"/api/v1/admin/requests/{request_row['id']}/onboard",
            json={
                "notes": "Arkansas-style package",
                "uploads": [
                    {
                        "id": "upload-arkansas",
                        "filename": "arkansas.zip",
                        "storage_path": str(bot_package),
                        "file_size": os.path.getsize(bot_package),
                        "format": "zip",
                    }
                ],
            },
        )
        assert onboard_response.status_code == 200
        assert _sha256_file(bot_package) == zip_hash_before

        deadline = time.time() + 10
        review_pending = None
        while time.time() < deadline:
            with get_connection() as conn:
                review_pending = conn.execute(
                    "SELECT status, records FROM scraper_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
            if review_pending and review_pending["status"] == "Review Pending":
                break
            time.sleep(0.25)

        assert review_pending is not None
        assert review_pending["status"] == "Review Pending"
        assert review_pending["records"] == 2

        onboarded_row = admin_client.get(f"/api/v1/admin/requests/{request_row['id']}").json()["request"]
        assert onboarded_row["request_status"] == "Review Pending"
        assert onboarded_row["job_status"] == "Review Pending"
        assert onboarded_row["execution_metadata"]["records_count"] == 2
        assert onboarded_row["execution_metadata"]["bot_entrypoint_file"] == "SOS Scripts/Arkansas/main.py"
        assert onboarded_row["execution_metadata"]["bot_catalog_entry"]["entrypoint_file"] == "SOS Scripts/Arkansas/main.py"
        assert onboarded_row["execution_metadata"]["bot_catalog_entry"]["entrypoint_mode"] == "script"
        assert onboarded_row["execution_metadata"]["bot_uploads"][0]["filename"] == "arkansas.zip"
        assert onboarded_row["execution_metadata"]["artifact_format"] == "csv"
        assert onboarded_row["execution_metadata"]["bot_output_artifact_path"].endswith("Output.csv")
    finally:
        _cleanup(payload["website_url"])


def test_legacy_python_bot_without_entrypoint_is_rejected(tmp_path):
    user_client = _login_as("user")
    admin_client = _login_as("admin")

    payload = {
        "source_name": "legacy-package-example",
        "website_url": "https://legacy-package-example.com",
        "category": "Registry & SEC",
        "complexity": "Easy",
        "recommended_scraper_type": "HTML Parser",
        "estimated_development_effort": "1-2 days",
        "status": "Analysis Complete",
    }

    try:
        response = user_client.post("/api/v1/demo/jobs/create_pending", json=payload)
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        admin_rows = admin_client.get("/api/v1/admin/requests?request_type=By Source&status=Pending Onboarding&limit=50")
        request_row = next((r for r in admin_rows.json()["requests"] if r["job_id"] == job_id), None)
        assert request_row is not None

        bad_package = _write_bot_package(
            tmp_path,
            manifest={
                "bot_name": "Legacy Bot",
                "source": payload["website_url"],
                "scope": "Full Dump",
                "runtime_type": "python",
                "entrypoint_file": "mod.py",
            },
            files={
                "mod.py": "print('hello from import time')\n",
            },
        )

        onboard_response = admin_client.post(
            f"/api/v1/admin/requests/{request_row['id']}/onboard",
            json={
                "notes": "Attempting legacy bot",
                "uploads": [
                    {
                        "id": "upload-legacy",
                        "filename": "legacy.zip",
                        "storage_path": str(bad_package),
                        "file_size": os.path.getsize(bad_package),
                        "format": "zip",
                    }
                ],
            },
        )
        assert onboard_response.status_code == 200

        deadline = time.time() + 6
        failed = None
        while time.time() < deadline:
            with get_connection() as conn:
                failed = conn.execute(
                    "SELECT status FROM scraper_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
            if failed and failed["status"] == "Failed":
                break
            time.sleep(0.25)

        assert failed is not None
        assert failed["status"] == "Failed"
    finally:
        _cleanup(payload["website_url"])


def test_admin_live_by_source_request_shows_datapoints_and_owner_name():
    admin_client = _login_as("admin")
    job_id = "J-ADMIN-BY-SOURCE-DATAPOINTS"
    input_rows = [
        {
            "company_name": "OpenCorporates Ltd",
            "country": "United Kingdom",
            "website": "https://opencorporates.com",
            "datapoint_1": "directors",
        },
        {
            "company_name": "OpenCorporates Holdings",
            "country": "United Kingdom",
            "website": "https://opencorporates.com",
            "datapoint_1": "incorporation_date",
        },
    ]

    _write_job_input(job_id, input_rows)
    created_at = "2026-07-29T09:30:00Z"

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO scraper_jobs (
                    id, owner_username, source, scope, filters, custom_criteria, frequency, delivery,
                    output_format, dataset_path, status, records, fresh, created_at, is_custom_source, mode,
                    refresh_count, planner_json, complexity, estimated_onboarding_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    "tanisha",
                    "https://opencorporates.com",
                    "Full Dump",
                    '{"country":"United Kingdom"}',
                    'country=United Kingdom',
                    "Weekly",
                    "S3 bucket",
                    "JSON",
                    "datasets/opencorporates_sample.csv",
                    "Pending Onboarding",
                    len(input_rows),
                    100,
                    created_at,
                    1,
                    "Site-Specific",
                    0,
                    json.dumps({"source": "https://opencorporates.com"}),
                    "Easy",
                    "1-2 days",
                ),
            )
            conn.commit()

        response = admin_client.get("/api/v1/admin/requests?limit=50")
        assert response.status_code == 200
        rows = response.json()["requests"]
        row = next((item for item in rows if item["job_id"] == job_id), None)
        assert row is not None
        assert row["username"] == "tanisha"
        assert str(row["display_name"]).lower().startswith("tanisha") or row["display_name"] == row["username"]

        raw_payload = row["raw_payload"]
        assert raw_payload["website_url"] == "https://opencorporates.com"
        assert raw_payload["source_name"] == "https://opencorporates.com"
        assert raw_payload["input_data"] == input_rows
    finally:
        _cleanup(job_id)
