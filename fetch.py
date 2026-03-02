import requests
from datetime import date
from pathlib import Path
from io import BytesIO
import zipfile

URL = "https://mooncakes.io/api/v0/modules/statistics?raw=true"

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)


def write_index_json(data_dir: Path) -> None:
    dates = sorted(
        p.stem
        for p in data_dir.glob("*.csv")
        if len(p.stem) == 10
    )

    index_path = data_dir / "index.json"
    lines = ["{", '  "dates": [']
    for idx, day in enumerate(dates):
        suffix = "," if idx < len(dates) - 1 else ""
        lines.append(f'    "{day}"{suffix}')
    lines.append("  ]")
    lines.append("}")
    index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


today = date.today().isoformat()
out = DATA_DIR / f"{today}.csv"

resp = requests.get(URL, timeout=30)
resp.raise_for_status()

with zipfile.ZipFile(BytesIO(resp.content)) as zf:
    with zf.open("statistics.csv") as csv_file:
        csv_bytes = csv_file.read()

csv_text = csv_bytes.decode("utf-8-sig")
csv_text = csv_text.replace("\r\n", "\n").replace("\r", "\n")

with out.open("w", encoding="utf-8", newline="\n") as f:
    f.write(csv_text)

write_index_json(DATA_DIR)
