from __future__ import annotations

import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _write_zip(tmp_path: Path) -> Path:
    package_path = tmp_path / "arkansas.zip"
    with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "SOS Scripts/Arkansas/SOS_Arkansas.py",
            (
                "from mod import helper\n"
                "import json\n"
                "if __name__==\"__main__\":\n"
                "    print(json.dumps({\"records\": [{\"name\": helper()}], \"execution_metadata\": {\"mode\": \"script\"}}))\n"
            ),
        )
        archive.writestr("SOS Scripts/Arkansas/mod.py", "def helper():\n    return 'ok'\n")
    return package_path


def test_bot_package_upload_accepts_common_main_guard(tmp_path):
    package_path = _write_zip(tmp_path)

    with package_path.open("rb") as handle:
        response = client.post(
            "/api/v1/bot-packages/upload",
            files={"file": ("arkansas.zip", handle, "application/zip")},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["runtime_type"] == "python"
    assert body["entrypoint_file"] == "SOS Scripts/Arkansas/SOS_Arkansas.py"
    assert body["entrypoint_mode"] == "script"
    assert body["entrypoint_function"] == ""
