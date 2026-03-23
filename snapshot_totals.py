from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

TOTALS_API_URL = "https://mooncakes.io/api/v0/modules/statistics"
OUTPUT_DIR = Path("data_daily")
OUTPUT_DIR.mkdir(exist_ok=True)
STATS_HISTORY_PATH = OUTPUT_DIR / "stats_history.csv"
TIMEZONE = ZoneInfo("Asia/Shanghai")

FIELDNAMES = [
    "date",
    "timestamp",
    "total_modules",
    "total_packages",
    "total_lines",
    "total_downloads",
]


def fetch_totals() -> dict[str, int]:
    resp = requests.get(TOTALS_API_URL, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    return {
        "total_modules": int(payload.get("total_modules", 0) or 0),
        "total_packages": int(payload.get("total_packages", 0) or 0),
        "total_lines": int(payload.get("total_lines", 0) or 0),
        "total_downloads": int(payload.get("total_downloads", 0) or 0),
    }


def load_existing_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return [dict(row) for row in reader]


def write_history(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def upsert_today_snapshot(path: Path) -> dict[str, str]:
    now = datetime.now(TIMEZONE)
    today = now.date().isoformat()
    totals = fetch_totals()
    snapshot = {
        "date": today,
        "timestamp": now.isoformat(timespec="seconds"),
        "total_modules": str(totals["total_modules"]),
        "total_packages": str(totals["total_packages"]),
        "total_lines": str(totals["total_lines"]),
        "total_downloads": str(totals["total_downloads"]),
    }

    rows = [row for row in load_existing_rows(path) if row.get("date") != today]
    rows.append(snapshot)
    rows.sort(key=lambda row: row.get("date", ""))
    write_history(path, rows)
    return snapshot


def main() -> None:
    snapshot = upsert_today_snapshot(STATS_HISTORY_PATH)
    print(json.dumps(snapshot, ensure_ascii=False))


if __name__ == "__main__":
    main()
