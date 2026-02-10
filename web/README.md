# Web Data Visualization

This `/web` page is a fully static frontend (HTML + JavaScript) designed for GitHub Pages.

## How data is loaded

- The page reads CSV files from `../data` at runtime.
- It discovers available dates at runtime by first parsing `../sitemap.xml` (GitHub Pages-friendly), then falling back to `data/` directory links when available. It supports both:
  - `data/YYYY-MM-DD/summary.csv`
  - `data/YYYY-MM-DD.csv`
- CSV parsing is done in-browser using PapaParse.

## How diff is computed

- Users select **Date A (base)** and **Date B (compare)**.
- Diff is always computed in JavaScript as:
  - `diff = value(Date B) - value(Date A)`
- No files from `diff/` are used.
- Supported metrics:
  - `line_count`: sum of `line_count`
  - `package_count`: sum of `package_count`
  - `module_count`: row count in CSV (computed as `1` per row)

## GitHub Pages

1. Push this repo to GitHub.
2. In **Settings → Pages**, set source branch (for example `main`) and folder (`/root`).
3. Open:
   - `https://<username>.github.io/<repo>/web/`

All asset paths are relative, so it works under the repository subpath.
