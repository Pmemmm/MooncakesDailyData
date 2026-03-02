# Web Data Visualization

This site provides two static views on GitHub Pages:

- `/realtime/` reads `../data_realtime/manifest.json`
- `/daily/` reads `../data_daily/manifest.json`

## Files

- `../realtime/index.html`: realtime entry page
- `../daily/index.html`: daily snapshot entry page
- `style.css`: shared styles
- `main.js`: CSV loading/parsing + chart rendering

## How data is loaded

- Pages only read `manifest.json`.
- No directory listing / sitemap / GitHub Contents API fallback is used.
- Manifest format:

```json
{
  "latest": "YYYY-MM-DD.csv",
  "files": ["YYYY-MM-DD.csv", "..."]
}
```

## Local testing

```bash
python3 -m http.server 8000
```

- `http://127.0.0.1:8000/realtime/`
- `http://127.0.0.1:8000/daily/`
