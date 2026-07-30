from __future__ import annotations

from datetime import datetime

from app.api.demo_routes import _compute_next_refresh_at as demo_compute_next_refresh_at
from app.services.bot_runtime_service import _compute_next_refresh_at as bot_compute_next_refresh_at
from app.services.people_contacts_dataset_service import people_contacts_dataset_service


def test_one_time_frequency_has_no_next_refresh():
    now = datetime(2026, 7, 8, 12, 0, 0)

    assert demo_compute_next_refresh_at("One-time", now) is None
    assert bot_compute_next_refresh_at("one time", now) is None
    assert people_contacts_dataset_service._compute_next_refresh_at("One-time", now) is None  # noqa: SLF001


def test_weekly_frequency_schedules_one_week_ahead():
    now = datetime(2026, 7, 8, 12, 0, 0)
    expected = datetime(2026, 7, 15, 12, 0, 0)

    assert demo_compute_next_refresh_at("Weekly", now) == expected
    assert bot_compute_next_refresh_at("weekly", now) == expected
    assert people_contacts_dataset_service._compute_next_refresh_at("weekly", now) == expected  # noqa: SLF001


def test_hourly_frequency_schedules_one_hour_ahead():
    now = datetime(2026, 7, 8, 12, 0, 0)
    expected = datetime(2026, 7, 8, 13, 0, 0)

    assert demo_compute_next_refresh_at("Hourly", now) == expected
    assert bot_compute_next_refresh_at("hourly", now) == expected
    assert people_contacts_dataset_service._compute_next_refresh_at("hourly", now) == expected  # noqa: SLF001
