import json
from datetime import date
from io import BytesIO
from pathlib import Path
import zipfile

import requests

URL = "https://mooncakes.io/api/v0/modules/statistics?raw=true"

REALTIME_DIR = Path("data_realtime")
REALTIME_DIR.mkdir(exist_ok=True)


def write_manifest_json(data_dir: Path, latest_file: str) -> None:
    files = sorted(
        p.name
        for p in data_dir.glob("*.csv")
        if p.name != "latest.csv" and len(p.stem) == 10
    )

    manifest = {
        "latest": latest_file,
        "files": files,
    }

    manifest_path = data_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


today = date.today().isoformat()
daily_name = f"{today}.csv"
latest_name = "latest.csv"

resp = requests.get(URL, timeout=30)
resp.raise_for_status()

with zipfile.ZipFile(BytesIO(resp.content)) as zf:
    with zf.open("statistics.csv") as csv_file:
        csv_bytes = csv_file.read()

csv_text = csv_bytes.decode("utf-8-sig")
csv_text = csv_text.replace("\r\n", "\n").replace("\r", "\n")

(REALTIME_DIR / latest_name).write_text(csv_text, encoding="utf-8", newline="\n")
(REALTIME_DIR / daily_name).write_text(csv_text, encoding="utf-8", newline="\n")

write_manifest_json(REALTIME_DIR, daily_name)
