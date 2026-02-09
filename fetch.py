import requests
from datetime import date
from pathlib import Path

URL = "https://mooncakes.io/api/v0/modules/statistics?raw=true"

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

today = date.today().isoformat()
out = DATA_DIR / f"{today}.csv"

resp = requests.get(URL, timeout=30)
resp.raise_for_status()

resp.encoding = resp.encoding or resp.apparent_encoding or "utf-8"
csv_text = resp.text
csv_text = csv_text.replace("\r\n", "\n").replace("\r", "\n")

with out.open("w", encoding="utf-8", newline="\n") as f:
    f.write(csv_text)
