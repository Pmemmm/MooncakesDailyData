const DATA_ROOT = "../data";

const els = {
  metric: document.getElementById("metricSelect"),
  dateA: document.getElementById("dateASelect"),
  dateB: document.getElementById("dateBSelect"),
  aggregate: document.getElementById("aggregateSelect"),
  deltaHint: document.getElementById("deltaHint"),
  summary: document.getElementById("summary"),
  status: document.getElementById("status"),
};

const lineChart = echarts.init(document.getElementById("lineChart"));
const treemapChart = echarts.init(document.getElementById("treemapChart"));

const state = {
  fileByDate: new Map(),
  rowsByDate: new Map(),
  totalsByDate: new Map(),
  dates: [],
};

const numberFmt = new Intl.NumberFormat("en-US");

window.addEventListener("resize", () => {
  lineChart.resize();
  treemapChart.resize();
});

function formatNumber(value) {
  return numberFmt.format(value);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function asText(value) {
  return value == null ? "" : String(value).trim();
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function metricLabel(metric) {
  if (metric === "line_count") return "line_count";
  if (metric === "package_count") return "package_count";
  return "module_count";
}

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

    const folder = clean.match(/(\d{4}-\d{2}-\d{2})$/);
    if (folder) {
      entries.push({ date: folder[1], url: `${DATA_ROOT}/${folder[1]}/summary.csv` });
      continue;
    }

    const file = clean.match(/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (file) {
      entries.push({ date: file[1], url: `${DATA_ROOT}/${file[1]}.csv` });
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
    const folder = loc.match(/\/data\/(\d{4}-\d{2}-\d{2})\/summary\.csv$/);
    if (folder) {
      entries.push({ date: folder[1], url: `${DATA_ROOT}/${folder[1]}/summary.csv` });
      continue;
    }

    const file = loc.match(/\/data\/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (file) {
      entries.push({ date: file[1], url: `${DATA_ROOT}/${file[1]}.csv` });
    }
  }

  return entries;
}

function extractDateEntriesFromGithubContents(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const name = asText(item?.name);
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.csv$/);
      if (!match) return null;
      return { date: match[1], url: `${DATA_ROOT}/${match[1]}.csv` };
    })
    .filter(Boolean);
}

function detectGithubRepoFromLocation() {
  const host = window.location.hostname || "";
  if (!host.endsWith("github.io")) return null;

  const owner = host.split(".")[0];
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const repo = pathParts[0] || `${owner}.github.io`;

  if (!owner || !repo) return null;
  return { owner, repo };
}

async function discoverDataFilesFromGithubApi() {
  const repoInfo = detectGithubRepoFromLocation();
  if (!repoInfo) return [];

  const { owner, repo } = repoInfo;
  const candidateRefs = ["HEAD", "main", "master"];

  for (const ref of candidateRefs) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/data?ref=${encodeURIComponent(ref)}`;

    try {
      const resp = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!resp.ok) continue;

      const entries = extractDateEntriesFromGithubContents(await resp.json());
      if (entries.length > 0) return entries;
    } catch (_err) {
      // try next
    }
  }

  return [];
}

async function discoverDataFiles() {
  const sitemapCandidates = ["../sitemap.xml", "./sitemap.xml"];
  for (const candidate of sitemapCandidates) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) continue;

      const entries = extractDateEntriesFromSitemap(await resp.text());
      if (entries.length > 0) return entries;
    } catch (_err) {
      // try next
    }
  }

  for (const candidate of [`${DATA_ROOT}/`, DATA_ROOT]) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) continue;

      const entries = extractDateEntriesFromDirectoryHtml(await resp.text());
      if (entries.length > 0) return entries;
    } catch (_err) {
      // try next
    }
  }

  const githubEntries = await discoverDataFilesFromGithubApi();
  if (githubEntries.length > 0) return githubEntries;

  throw new Error("Unable to discover CSV files in ../data.");
}

function parseCsv(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message || "CSV parse error");
  }

  return parsed.data;
}

function deriveContributor(row) {
  const direct = firstNonEmpty([row.contributor]);
  if (direct) return direct;

  const repo = firstNonEmpty([row.name]);
  if (!repo) return "";

  const parts = repo.split("/");
  return parts.length > 1 ? parts[0].trim() : "";
}

function derivePackage(row) {
  return firstNonEmpty([row.package, row.pkg_name]);
}

function deriveIdentifier(row, index) {
  return firstNonEmpty([row.module, row.file, row.path, row.name, row.module_id]) || `row-${index}`;
}

function prepareRows(rawRows) {
  return rawRows.map((row, index) => {
    const packageName = derivePackage(row);
    const contributor = deriveContributor(row);
    const identifier = deriveIdentifier(row, index);

    return {
      package: packageName,
      contributor,
      key: packageName ? `${packageName}::${identifier}` : "",
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

function populateDateSelectors() {
  const prevA = els.dateA.value;
  const prevB = els.dateB.value;

  const options = state.dates.map((d) => `<option value="${d}">${d}</option>`).join("");
  els.dateA.innerHTML = options;
  els.dateB.innerHTML = options;

  if (state.dates.includes(prevA)) {
    els.dateA.value = prevA;
  }
  if (state.dates.includes(prevB)) {
    els.dateB.value = prevB;
  }

  if (!els.dateA.value && state.dates.length > 0) {
    els.dateA.value = state.dates[Math.max(0, state.dates.length - 2)] || state.dates[0];
  }
  if (!els.dateB.value && state.dates.length > 0) {
    els.dateB.value = state.dates[state.dates.length - 1];
  }
}

function renderLineChart(metric) {
  lineChart.setOption({
    grid: { left: 56, right: 20, top: 24, bottom: 44 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => formatNumber(v),
    },
    xAxis: {
      type: "category",
      data: state.dates,
      axisTick: { show: false },
      axisLabel: { color: "#6b7280", fontSize: 12 },
      axisLine: { lineStyle: { color: "#d1d5db" } },
    },
    yAxis: {
      type: "value",
      axisTick: { show: false },
      axisLabel: { color: "#6b7280", fontSize: 12 },
      splitLine: { lineStyle: { color: "#eef2f7" } },
    },
    series: [
      {
        type: "line",
        smooth: true,
        data: state.dates.map((date) => state.totalsByDate.get(date)?.[metric] || 0),
        lineStyle: { width: 3, color: "#2563eb" },
        itemStyle: { color: "#2563eb" },
        areaStyle: { color: "rgba(37, 99, 235, 0.12)" },
      },
    ],
  });
}

function buildMetricMapByKey(rows, metric) {
  const map = new Map();
  for (const row of rows) {
    if (!row.key) continue;
    map.set(row.key, (map.get(row.key) || 0) + row[metric]);
  }
  return map;
}

function buildRowsBByKey(rows, metric) {
  const map = new Map();
  for (const row of rows) {
    if (!row.key) continue;

    const current = map.get(row.key) || {
      package: row.package,
      contributor: row.contributor,
      metricValue: 0,
    };

    current.metricValue += row[metric];
    if (!current.package && row.package) current.package = row.package;
    if (!current.contributor && row.contributor) current.contributor = row.contributor;

    map.set(row.key, current);
  }
  return map;
}

function computePositiveDiffAggregation(rowsA, rowsB, metric, aggregateBy) {
  const valueAByKey = buildMetricMapByKey(rowsA, metric);
  const rowsBByKey = buildRowsBByKey(rowsB, metric);
  const grouped = new Map();

  for (const [key, rowB] of rowsBByKey.entries()) {
    const label = aggregateBy === "contributor" ? rowB.contributor : rowB.package;
    if (!label) continue;

    const diff = rowB.metricValue - (valueAByKey.get(key) || 0);
    if (diff <= 0) continue;

    grouped.set(label, (grouped.get(label) || 0) + diff);
  }

  return grouped;
}

function renderTreemap(metric, dateA, dateB, aggregateBy) {
  if (dateA >= dateB) {
    treemapChart.setOption({
      series: [{ type: "treemap", data: [] }],
    });
    setStatus("No positive additions between dates (Date A must be earlier than Date B).");
    return;
  }

  const rowsA = state.rowsByDate.get(dateA) || [];
  const rowsB = state.rowsByDate.get(dateB) || [];

  const grouped = computePositiveDiffAggregation(rowsA, rowsB, metric, aggregateBy);
  const data = [...grouped.entries()].map(([name, value]) => ({ name, value }));

  if (data.length === 0) {
    setStatus("No positive additions between dates.");
  } else {
    setStatus("");
  }

  treemapChart.setOption({
    tooltip: {
      formatter: (params) => `${params.name}<br/>+${formatNumber(params.value || 0)}`,
    },
    visualMap: {
      min: data.length ? Math.min(...data.map((d) => d.value)) : 0,
      max: data.length ? Math.max(...data.map((d) => d.value)) : 1,
      show: false,
      inRange: {
        color: ["#d1fae5", "#86efac", "#22c55e", "#15803d"],
      },
    },
    series: [
      {
        type: "treemap",
        data,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          formatter: ({ data: item }) => `${item?.name || ""}\n+${formatNumber(item?.value || 0)}`,
          fontSize: 12,
        },
      },
    ],
  });
}

function renderSummary(metric, dateA, dateB) {
  const valueA = state.totalsByDate.get(dateA)?.[metric] || 0;
  const valueB = state.totalsByDate.get(dateB)?.[metric] || 0;

  const diff = dateA >= dateB ? 0 : valueB - valueA;
  const sign = diff > 0 ? "+" : "";

  els.deltaHint.textContent = `Δ ${metricLabel(metric)} (${dateB} − ${dateA}) = ${sign}${formatNumber(diff)}`;
  els.summary.textContent = `${metricLabel(metric)} | ${dateB} − ${dateA} = ${sign}${formatNumber(diff)}`;
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
    setStatus("Loading CSV data...");
    const discovered = await discoverDataFiles();

    for (const entry of discovered) {
      state.fileByDate.set(entry.date, entry.url);
    }

    state.dates = [...state.fileByDate.keys()].sort();

    if (state.dates.length === 0) {
      throw new Error("No date CSV files found under ./data.");
    }

    for (const date of state.dates) {
      const url = state.fileByDate.get(date);
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) {
        throw new Error(`Failed to load ${url}`);
      }

      const rows = prepareRows(parseCsv(await resp.text()));
      state.rowsByDate.set(date, rows);
      state.totalsByDate.set(date, computeTotals(rows));
    }

    populateDateSelectors();

    [els.metric, els.dateA, els.dateB, els.aggregate].forEach((control) => {
      control.addEventListener("change", renderAll);
    });

    setStatus("");
    renderAll();
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Failed to load data", true);
  }
}

init();
