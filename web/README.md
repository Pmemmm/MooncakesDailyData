# Web Data Visualization

This `/web` page is fully static (HTML + CSS + JavaScript) and designed for GitHub Pages deployment.

## Files

- `index.html`: page layout and control panel
- `style.css`: page/card/form styles
- `main.js`: CSV discovery, parsing, diff computation, ECharts rendering

## How data is loaded

- The app reads data at runtime from `../data`.
- It discovers available dates dynamically (no hardcoded list), supporting both:
  - `data/YYYY-MM-DD/summary.csv`
  - `data/YYYY-MM-DD.csv`
- Date discovery tries:
  1. `../sitemap.xml` / `./sitemap.xml`
  2. `../data/` directory listing fallback
- CSV parsing is done in-browser using PapaParse.

## How diff is computed

- Users select **Date A (base)** and **Date B (compare)**.
- Trend totals per date:
  - `line_count`: sum of `line_count`
  - `package_count`: sum of `package_count`
  - `module_count`: row count (`1` per row)
- Treemap diff is computed on the fly in browser:
  - key = `package + "::" + module/file identifier`
  - for each key in Date B: `diff = valueB - valueA`
  - keep only `diff > 0` (positive additions)
  - attribution always uses Date B fields only (package/contributor)
  - unattributable rows are skipped (never labeled `unknown`)
- The `diff/` folder is not used.

## GitHub Pages

1. Push repository to GitHub.
2. In **Settings → Pages**, pick the branch (for example `main`) and root folder.
3. Open:
   - `https://<username>.github.io/<repo>/web/`

## Local testing

From repo root:

```bash
python3 -m http.server 8000
```

Then open:

- `http://127.0.0.1:8000/web/`
