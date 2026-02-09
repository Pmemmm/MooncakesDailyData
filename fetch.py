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

out.write_bytes(resp.content)
