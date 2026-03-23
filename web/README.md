# Web Data Visualization

This `/web` page is fully static (HTML + CSS + JavaScript) and designed for GitHub Pages deployment.

## Files

- `index.html`: realtime view
- `daily/index.html`: daily snapshot view
- `style.css`: page/card/form styles
- `main.js`: mixed totals + detailed CSV loading, diff computation, ECharts rendering

## How data is loaded

- Realtime view (`/web/index.html`)
  - detailed CSV snapshots: `../data`
  - totals history: `../data_daily/stats_history.csv`
  - latest totals: `https://mooncakes.io/api/v0/modules/statistics`
- Daily Snapshot (`/web/daily/index.html`)
  - detailed CSV snapshots: `../../data_daily`
  - totals history: `../../data_daily/stats_history.csv`

Detailed CSV discovery remains dynamic and supports both:

- `data/YYYY-MM-DD/summary.csv`
- `data/YYYY-MM-DD.csv`

Date discovery tries:

1. `../sitemap.xml` / `./sitemap.xml`
2. manifest/index files
3. directory listing fallback
4. GitHub Contents API fallback

CSV parsing is done in-browser using PapaParse.

## How totals and diff work

- Users select **Date A (base)** and **Date B (compare)**.
- Totals panels and trend use a mixed source:
  - historical `line_count` / `package_count` / `module_count` can fall back to totals derived from detailed CSV snapshots
  - `data_daily/stats_history.csv` overrides those totals and adds `total_download`
  - realtime view also overrides the latest day with the live statistics API response
- Treemap diff is computed on the fly in browser from detailed CSV snapshots only:
  - key = `package + "::" + module/file identifier`
  - for each key in Date B: `diff = valueB - valueA`
  - both positive and negative deltas are shown
  - attribution always uses Date B fields only (package/contributor)
  - unattributable rows are skipped (never labeled `unknown`)
- `total_download` is intentionally excluded from treemap because the API exposes it only as a total metric.

## GitHub Pages

1. Push repository to GitHub.
2. In **Settings -> Pages**, pick the branch (for example `main`) and root folder.
3. Open:
   - `https://<username>.github.io/<repo>/web/`

## Local testing

From repo root:

```bash
python3 -m http.server 8000
```

Then open:

- `http://127.0.0.1:8000/web/`
