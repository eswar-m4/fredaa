from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.services import bot_runtime_worker
from app.services.bot_runtime_service import BotRuntimeExecutionError, bot_runtime_service
from app.services.legacy_bot_artifact_service import parse_output_artifact


def _make_package(tmp_path: Path, source: str, filename: str = "bot.py") -> Path:
    package_root = tmp_path / "package"
    package_root.mkdir(parents=True, exist_ok=True)
    (package_root / filename).write_text(source, encoding="utf-8")
    return package_root


def test_python_bot_runs_in_isolated_worker(tmp_path):
    package_root = _make_package(
        tmp_path,
        """
def run(context):
    return {
        "records": [{"name": "Example", "source": context["source"]}],
        "execution_metadata": {"rows": 1},
    }
""".strip(),
    )

    payload = bot_runtime_service._run_worker(  # noqa: SLF001
        {
            "package_root": str(package_root),
            "entrypoint_file": "bot.py",
            "entrypoint_function": "run",
            "runtime_type": "python",
        },
        {"source": "https://example.com"},
    )

    assert payload["runtime_type"] == "python"
    assert payload["records"] == [{"name": "Example", "source": "https://example.com"}]
    assert payload["execution_metadata"]["rows"] == 1


def test_python_bot_import_failure_is_reported_cleanly(tmp_path):
    package_root = _make_package(
        tmp_path,
        """
raise RuntimeError("boom")

def run(context):
    return {"records": []}
""".strip(),
    )

    with pytest.raises(BotRuntimeExecutionError, match="boom"):
        bot_runtime_service._run_worker(  # noqa: SLF001
            {
                "package_root": str(package_root),
                "entrypoint_file": "bot.py",
                "entrypoint_function": "run",
                "entrypoint_mode": "callable",
                "entrypoint_args": [],
                "runtime_type": "python",
            },
            {"source": "https://example.com"},
        )


def test_python_bot_main_entrypoint_is_adapted(tmp_path):
    package_root = _make_package(
        tmp_path,
        """
from helper import prefix

def main():
    return {
        "records": [{"name": prefix("Legacy Main")}],
        "execution_metadata": {"mode": "main"},
    }
""".strip(),
    )
    (package_root / "helper.py").write_text(
        """
def prefix(value):
    return f"wrapped:{value}"
""".strip(),
        encoding="utf-8",
    )

    payload = bot_runtime_service._run_worker(  # noqa: SLF001
        {
            "package_root": str(package_root),
            "entrypoint_file": "bot.py",
            "entrypoint_function": "main",
            "entrypoint_mode": "callable",
            "entrypoint_args": [],
            "runtime_type": "python",
        },
        {"source": "https://example.com"},
    )

    assert payload["records"] == [{"name": "wrapped:Legacy Main"}]
    assert payload["execution_metadata"]["mode"] == "main"


def test_python_script_entrypoint_uses_sys_argv_and_helper_imports(tmp_path):
    package_root = _make_package(
        tmp_path,
        """
import json
from helper import prefix

if __name__ == "__main__":
    print(json.dumps({
        "records": [{"name": prefix("Script Bot")}],
        "execution_metadata": {"mode": "script"},
    }))
""".strip(),
        filename="script.py",
    )
    (package_root / "helper.py").write_text(
        """
def prefix(value):
    return f"wrapped:{value}"
""".strip(),
        encoding="utf-8",
    )

    payload = bot_runtime_service._run_worker(  # noqa: SLF001
        {
            "package_root": str(package_root),
            "entrypoint_file": "script.py",
            "entrypoint_function": "",
            "entrypoint_mode": "script",
            "entrypoint_args": ["--sample", "123"],
            "runtime_type": "python",
        },
        {"source": "https://example.com"},
    )

    assert payload["records"] == [{"name": "wrapped:Script Bot"}]
    assert payload["execution_metadata"]["mode"] == "script"


def test_python_script_entrypoint_uses_output_artifact_fallback(tmp_path):
    package_root = _make_package(
        tmp_path,
        """
import csv
from pathlib import Path

if __name__ == "__main__":
    values = [line.strip() for line in Path("Input.txt").read_text(encoding="utf-8").splitlines() if line.strip()]
    with Path("Output.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["keyword"])
        writer.writeheader()
        for value in values:
            writer.writerow({"keyword": value})
""".strip(),
        filename="script.py",
    )
    (package_root / "Input.txt").write_text("Walmart\nTyson\n", encoding="utf-8")

    payload = bot_runtime_service._run_worker(  # noqa: SLF001
        {
            "package_root": str(package_root),
            "entrypoint_file": "script.py",
            "entrypoint_function": "",
            "entrypoint_mode": "script",
            "entrypoint_args": [],
            "runtime_type": "python",
        },
        {"source": "https://example.com"},
    )

    assert payload["records"] == [{"keyword": "Walmart"}, {"keyword": "Tyson"}]
    assert payload["execution_metadata"]["artifact_format"] == "csv"
    assert payload["execution_metadata"]["bot_output_artifact_path"].endswith("Output.csv")


@pytest.mark.parametrize(
    ("filename", "content", "expected"),
    [
        ("records.json", '[{"name": "A"}, {"name": "B"}]', [{"name": "A"}, {"name": "B"}]),
        ("records.csv", "name,source\nA,x\nB,y\n", [{"name": "A", "source": "x"}, {"name": "B", "source": "y"}]),
        ("records.tsv", "name\tsource\nA\tx\nB\ty\n", [{"name": "A", "source": "x"}, {"name": "B", "source": "y"}]),
        ("records.txt", "name|source\nA|x\nB|y\n", [{"name": "A", "source": "x"}, {"name": "B", "source": "y"}]),
    ],
)
def test_legacy_artifact_parser_supports_common_formats(tmp_path, filename, content, expected):
    path = tmp_path / filename
    path.write_text(content, encoding="utf-8")

    records, metadata = parse_output_artifact(path)

    assert records == expected
    assert metadata["artifact_format"] in {"json", "csv", "tsv", "txt"}


def test_perl_bot_uses_output_artifact_fallback(tmp_path, monkeypatch):
    package_root = _make_package(
        tmp_path,
        "print 'legacy perl';\n",
        filename="bot.pl",
    )

    def fake_run_streaming_subprocess(cmd, *, input_text, cwd, env=None, timeout=1800):
        (Path(cwd) / "Output.tsv").write_text("name\tsource\nExample\thttps://example.com\n", encoding="utf-8")
        return "", "", 0

    monkeypatch.setattr(bot_runtime_worker.shutil, "which", lambda _name: "perl")
    monkeypatch.setattr(bot_runtime_worker, "_run_streaming_subprocess", fake_run_streaming_subprocess)

    payload = bot_runtime_worker._execute_perl(  # noqa: SLF001
        package_root,
        "bot.pl",
        {"source": "https://example.com"},
    )

    assert payload["records"] == [{"name": "Example", "source": "https://example.com"}]
    assert payload["execution_metadata"]["artifact_format"] == "tsv"


def test_perl_runtime_missing_is_reported_cleanly(tmp_path, monkeypatch):
    package_root = _make_package(
        tmp_path,
        "print 'legacy perl';\n",
        filename="bot.pl",
    )
    monkeypatch.setattr(bot_runtime_worker.shutil, "which", lambda _name: None)

    with pytest.raises(ValueError, match="Perl runtime is not available on this server"):
        bot_runtime_worker._execute_perl(  # noqa: SLF001
            package_root,
            "bot.pl",
            {"source": "https://example.com"},
        )


def test_python_adapter_source_is_left_aligned_and_parseable():
    source = bot_runtime_worker._python_adapter_source()  # noqa: SLF001
    assert source.startswith("import asyncio")
    ast.parse(source)
    top_level_lines = [line for line in source.splitlines() if line.strip()][:10]
    assert all(not line.startswith((" ", "\t")) for line in top_level_lines)


def test_streaming_subprocess_handles_broken_pipe(tmp_path):
    stdout_text, stderr_text, returncode = bot_runtime_worker._run_streaming_subprocess(  # noqa: SLF001
        [
            bot_runtime_worker.sys.executable,
            "-c",
            "import os, sys; sys.stderr.write('boom\\n'); sys.stderr.flush(); os._exit(1)",
        ],
        input_text="{\"source\": \"https://example.com\"}",
        cwd=str(tmp_path),
        timeout=10,
    )

    assert returncode == 1
    assert stdout_text == ""
    assert "boom" in stderr_text
