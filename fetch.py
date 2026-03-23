from datetime import date
from io import BytesIO
from pathlib import Path
import zipfile

import requests

DETAIL_CSV_URL = "https://mooncakes.io/api/v0/modules/statistics?raw=true"

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)


def write_index_json(data_dir: Path) -> None:
    dates = sorted(p.stem for p in data_dir.glob("*.csv") if len(p.stem) == 10)

    index_path = data_dir / "index.json"
    lines = ["{", '  "dates": [']
    for idx, day in enumerate(dates):
        suffix = "," if idx < len(dates) - 1 else ""
        lines.append(f'    "{day}"{suffix}')
    lines.append("  ]")
    lines.append("}")
    index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def fetch_detail_csv_text() -> str:
    resp = requests.get(DETAIL_CSV_URL, timeout=30)
    resp.raise_for_status()

    with zipfile.ZipFile(BytesIO(resp.content)) as zf:
        with zf.open("statistics.csv") as csv_file:
            csv_bytes = csv_file.read()

    return csv_bytes.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")


def main() -> None:
    today = date.today().isoformat()
    out = DATA_DIR / f"{today}.csv"
    latest = DATA_DIR / "latest.csv"
    csv_text = fetch_detail_csv_text()

    out.write_text(csv_text, encoding="utf-8", newline="\n")
    latest.write_text(csv_text, encoding="utf-8", newline="\n")
    write_index_json(DATA_DIR)


if __name__ == "__main__":
    main()
