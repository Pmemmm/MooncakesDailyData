const DATA_ROOT = "../data";

const els = {
  metric: document.getElementById("metricSelect"),
  dateA: document.getElementById("dateASelect"),
  dateB: document.getElementById("dateBSelect"),
  aggregate: document.getElementById("aggregateSelect"),
  summary: document.getElementById("summary"),
  error: document.getElementById("error"),
};

const lineChart = echarts.init(document.getElementById("lineChart"));
const treemapChart = echarts.init(document.getElementById("treemapChart"));

const state = {
  filesByDate: new Map(),
  rowsByDate: new Map(),
  totalsByDate: new Map(),
  dates: [],
};

window.addEventListener("resize", () => {
  lineChart.resize();
  treemapChart.resize();
});

function normalizeDateText(raw) {
  return String(raw).replace(/\/$/, "").trim();
}

function extractDateEntriesFromDirectoryHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");

  const entries = [];
  for (const href of links) {
    const clean = normalizeDateText(href);
    const folderMatch = clean.match(/(\d{4}-\d{2}-\d{2})$/);
    if (folderMatch) {
      entries.push({ date: folderMatch[1], url: `${DATA_ROOT}/${folderMatch[1]}/summary.csv` });
      continue;
    }

    const fileMatch = clean.match(/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (fileMatch) {
      entries.push({ date: fileMatch[1], url: `${DATA_ROOT}/${fileMatch[1]}.csv` });
    }
  }

  return entries;
}

function extractDateEntriesFromSitemap(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const locs = [...doc.querySelectorAll("url > loc")].map((n) => n.textContent || "");

  const entries = [];
  for (const loc of locs) {
    const folderMatch = loc.match(/\/data\/(\d{4}-\d{2}-\d{2})\/summary\.csv$/);
    if (folderMatch) {
      entries.push({ date: folderMatch[1], url: `${DATA_ROOT}/${folderMatch[1]}/summary.csv` });
      continue;
    }

    const fileMatch = loc.match(/\/data\/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (fileMatch) {
      entries.push({ date: fileMatch[1], url: `${DATA_ROOT}/${fileMatch[1]}.csv` });
    }
  }

  return entries;
}

async function discoverDataFiles() {
  const sitemapCandidates = ["../sitemap.xml", "./sitemap.xml"];
  for (const candidate of sitemapCandidates) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) {
        continue;
      }
      const xml = await resp.text();
      const entries = extractDateEntriesFromSitemap(xml);
      if (entries.length > 0) {
        return entries;
      }
    } catch (_err) {
      // Try next candidate.
    }
  }

  const directoryCandidates = [`${DATA_ROOT}/`, DATA_ROOT];
  for (const candidate of directoryCandidates) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) {
        continue;
      }
      const html = await resp.text();
      const entries = extractDateEntriesFromDirectoryHtml(html);
      if (entries.length > 0) {
        return entries;
      }
    } catch (_err) {
      // Try next candidate.
    }
  }

  throw new Error("Unable to discover files under ../data. Ensure sitemap.xml is generated or directory listing is available.");
}

function parseCsv(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parsed.errors.length) {
    throw new Error(parsed.errors[0].message || "CSV parse error");
  }

  return parsed.data;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return "";
}

function deriveContributor(row) {
  const direct = firstNonEmpty([row.contributor]);
  if (direct) return direct;

  const repo = firstNonEmpty([row.name]);
  if (!repo) return "";

  const parts = repo.split("/");
  return parts.length > 1 ? parts[0].trim() : "";
}

function deriveModuleId(row) {
  return firstNonEmpty([row.module, row.file, row.path, row.name, row.pkg_name, row.package]);
}

function prepareRows(rows) {
  return rows.map((row) => {
    const packageName = firstNonEmpty([row.package, row.pkg_name]);
    const contributor = deriveContributor(row);
    const moduleId = deriveModuleId(row);

    const comparableKey = packageName && moduleId ? `${packageName}::${moduleId}` : "";

    return {
      package: packageName,
      contributor,
      module_id: moduleId,
      comparable_key: comparableKey,
      line_count: toNumber(row.line_count),
      package_count: toNumber(row.package_count),
      module_count: 1,
    };
  });
}

function computeTotals(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.line_count += row.line_count;
      acc.package_count += row.package_count;
      acc.module_count += row.module_count;
      return acc;
    },
    { line_count: 0, package_count: 0, module_count: 0 }
  );
}

function metricLabel(metric) {
  if (metric === "line_count") return "Lines";
  if (metric === "package_count") return "Packages";
  return "Modules";
}

function renderLineChart(metric) {
  const x = state.dates;
  const y = state.dates.map((date) => state.totalsByDate.get(date)[metric]);

  lineChart.setOption({
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: x },
    yAxis: { type: "value", name: metricLabel(metric) },
    series: [
      {
        type: "line",
        smooth: true,
        data: y,
        areaStyle: {},
      },
    ],
  });
}

function buildKeyMetricMap(rows, metric) {
  const map = new Map();
  for (const row of rows) {
    if (!row.comparable_key) continue;
    map.set(row.comparable_key, (map.get(row.comparable_key) || 0) + row[metric]);
  }
  return map;
}

function buildDayBKeyData(rows, metric) {
  const map = new Map();
  for (const row of rows) {
    if (!row.comparable_key) continue;

    const current = map.get(row.comparable_key) || {
      value: 0,
      package: row.package,
      contributor: row.contributor,
    };

    current.value += row[metric];
    if (!current.package && row.package) current.package = row.package;
    if (!current.contributor && row.contributor) current.contributor = row.contributor;

    map.set(row.comparable_key, current);
  }
  return map;
}

function aggregatePositiveDiff(rowsA, rowsB, metric, aggregateBy) {
  const dayAMetrics = buildKeyMetricMap(rowsA, metric);
  const dayBMetrics = buildDayBKeyData(rowsB, metric);
  const aggregated = new Map();

  for (const [key, rowB] of dayBMetrics.entries()) {
    const label = aggregateBy === "contributor" ? rowB.contributor : rowB.package;
    if (!label) continue;

    const diff = rowB.value - (dayAMetrics.get(key) || 0);
    if (diff <= 0) continue;

    aggregated.set(label, (aggregated.get(label) || 0) + diff);
  }

  return aggregated;
}

function renderTreemap(metric, dateA, dateB, aggregateBy) {
  const rowsA = state.rowsByDate.get(dateA) || [];
  const rowsB = state.rowsByDate.get(dateB) || [];

  const aggregated = aggregatePositiveDiff(rowsA, rowsB, metric, aggregateBy);
  const data = [...aggregated.entries()].map(([name, diff]) => ({
    name,
    value: diff,
    rawDiff: diff,
    itemStyle: { color: "#16a34a" },
  }));

  if (aggregateBy === "contributor" && data.length === 0) {
    els.error.textContent = "No attributable contributor additions found between selected dates.";
  } else {
    els.error.textContent = "";
  }

  treemapChart.setOption({
    tooltip: {
      formatter: (params) => {
        const rawDiff = params.data?.rawDiff ?? 0;
        return `${params.name}<br/>Added: +${rawDiff}`;
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          formatter: (params) => {
            const d = params.data?.rawDiff ?? 0;
            return `${params.name}\n+${d}`;
          },
        },
        data,
      },
    ],
  });
}

function renderSummary(metric, dateA, dateB) {
  const a = state.totalsByDate.get(dateA)?.[metric] ?? 0;
  const b = state.totalsByDate.get(dateB)?.[metric] ?? 0;
  const diff = b - a;
  const sign = diff > 0 ? "+" : "";
  els.summary.textContent = `${metric} | ${dateB} - ${dateA} = ${sign}${diff} (A=${a}, B=${b})`;
}

function repopulateDateSelectors() {
  const options = state.dates
    .map((d) => `<option value="${d}">${d}</option>`)
    .join("");

  els.dateA.innerHTML = options;
  els.dateB.innerHTML = options;

  if (state.dates.length > 1) {
    els.dateA.value = state.dates[state.dates.length - 2];
    els.dateB.value = state.dates[state.dates.length - 1];
  } else if (state.dates.length === 1) {
    els.dateA.value = state.dates[0];
    els.dateB.value = state.dates[0];
  }
}

function renderAll() {
  const metric = els.metric.value;
  const dateA = els.dateA.value;
  const dateB = els.dateB.value;
  const aggregateBy = els.aggregate.value;

  renderLineChart(metric);
  renderSummary(metric, dateA, dateB);
  renderTreemap(metric, dateA, dateB, aggregateBy);
}

async function init() {
  try {
    const discovered = await discoverDataFiles();

    for (const entry of discovered) {
      state.filesByDate.set(entry.date, entry.url);
    }

    state.dates = [...state.filesByDate.keys()].sort();

    for (const date of state.dates) {
      const url = state.filesByDate.get(date);
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) {
        throw new Error(`Failed to load ${url}`);
      }
      const csvText = await resp.text();
      const parsedRows = parseCsv(csvText);
      const rows = prepareRows(parsedRows);

      state.rowsByDate.set(date, rows);
      state.totalsByDate.set(date, computeTotals(rows));
    }

    if (state.dates.length === 0) {
      throw new Error("No data CSV files found in ../data.");
    }

    repopulateDateSelectors();

    [els.metric, els.dateA, els.dateB, els.aggregate].forEach((el) => {
      el.addEventListener("change", renderAll);
    });

    renderAll();
  } catch (err) {
    els.error.textContent = err.message;
    console.error(err);
  }
}

init();
