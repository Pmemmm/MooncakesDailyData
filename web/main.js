function getBasePath() {
  const host = window.location.hostname || "";
  if (!host.endsWith("github.io")) {
    return "";
  }

  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length > 0) {
    return `/${parts[0]}`;
  }

  return "";
}

const BASE_PATH = getBasePath();
const DATA_ROOTS = [...new Set([`${BASE_PATH}/data`, "../data", "./../data", "./data", "data"])];

const els = {
  metric: document.getElementById("metricSelect"),
  dateA: document.getElementById("dateASelect"),
  dateB: document.getElementById("dateBSelect"),
  aggregate: document.getElementById("aggregateSelect"),
  emphasizeTrend: document.getElementById("emphasizeTrend"),
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
  selectedRange: "30",
};

const numberFmt = new Intl.NumberFormat("en-US");
const TREEMAP_COLOR_SCALE = {
  start: "#d8f3dc",
  mid: "#52b788",
  end: "#0f4e6b",
};
const TREEMAP_NEGATIVE_COLOR_SCALE = {
  start: "#fde2e4",
  mid: "#f08080",
  end: "#9d0208",
};
const TREEMAP_ZERO_COLOR = "#9ca3af";

window.addEventListener("resize", () => {
  lineChart.resize();
  treemapChart.resize();
});

function formatNumber(value) {
  return numberFmt.format(value);
}

function formatAxisNumber(value) {
  const num = toNumber(value);
  const abs = Math.abs(num);

  if (abs >= 1_000_000) {
    const scaled = (num / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `${scaled}M`;
  }

  if (abs >= 1_000) {
    const scaled = (num / 1_000).toFixed(1).replace(/\.0$/, "");
    return `${scaled}K`;
  }

  return formatNumber(num);
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const normalized = clean.length === 3 ? clean.split("").map((c) => `${c}${c}`).join("") : clean;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function getCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getTreemapLabelColor(normalized) {
  return normalized < 0.35 ? "#111827" : "#ffffff";
}

function interpolateColor(startColor, endColor, factor) {
  const clampedFactor = Math.max(0, Math.min(1, factor));
  const from = hexToRgb(startColor);
  const to = hexToRgb(endColor);

  const r = Math.round(from.r + clampedFactor * (to.r - from.r));
  const g = Math.round(from.g + clampedFactor * (to.g - from.g));
  const b = Math.round(from.b + clampedFactor * (to.b - from.b));

  return `rgb(${r},${g},${b})`;
}

function buildTreemapColor(value, min, max) {
  const denominator = max - min;
  const normalized = denominator === 0 ? 0 : (value - min) / denominator;

  if (normalized < 0.5) {
    return interpolateColor(TREEMAP_COLOR_SCALE.start, TREEMAP_COLOR_SCALE.mid, normalized * 2);
  }

  return interpolateColor(TREEMAP_COLOR_SCALE.mid, TREEMAP_COLOR_SCALE.end, (normalized - 0.5) * 2);
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

function extractDateEntriesFromDirectoryHtml(html, dataRoot) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");

  const entries = [];
  for (const href of links) {
    const clean = normalizeDateText(href);

    const folder = clean.match(/(\d{4}-\d{2}-\d{2})$/);
    if (folder) {
      entries.push({ date: folder[1], url: `${dataRoot}/${folder[1]}/summary.csv` });
      continue;
    }

    const file = clean.match(/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (file) {
      entries.push({ date: file[1], url: `${dataRoot}/${file[1]}.csv` });
    }
  }

  return entries;
}

function extractDateEntriesFromSitemap(xmlText, dataRoot) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const locs = [...doc.querySelectorAll("url > loc")].map((n) => n.textContent || "");

  const entries = [];
  for (const loc of locs) {
    const folder = loc.match(/\/data\/(\d{4}-\d{2}-\d{2})\/summary\.csv$/);
    if (folder) {
      entries.push({ date: folder[1], url: `${dataRoot}/${folder[1]}/summary.csv` });
      continue;
    }

    const file = loc.match(/\/data\/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (file) {
      entries.push({ date: file[1], url: `${dataRoot}/${file[1]}.csv` });
    }
  }

  return entries;
}

function extractDateEntriesFromGithubContents(items, dataRoot) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const name = asText(item?.name);
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.csv$/);
      if (!match) return null;
      return { date: match[1], url: `${dataRoot}/${match[1]}.csv` };
    })
    .filter(Boolean);
}

async function discoverDataFilesFromIndex(dataRoot) {
  try {
    const resp = await fetch(`${dataRoot}/index.json`, { cache: "no-store" });
    if (!resp.ok) return [];

    const payload = await resp.json();
    if (!Array.isArray(payload?.dates)) return [];

    return payload.dates
      .map((date) => asText(date))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map((date) => ({ date, url: `${dataRoot}/${date}.csv` }));
  } catch (_err) {
    return [];
  }
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

async function discoverDataFilesFromGithubApi(dataRoot) {
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

      const entries = extractDateEntriesFromGithubContents(await resp.json(), dataRoot);
      if (entries.length > 0) return entries;
    } catch (_err) {
      // try next
    }
  }

  return [];
}

async function discoverDataFiles() {
  const sitemapCandidates = [`${BASE_PATH}/sitemap.xml`, "../sitemap.xml", "./sitemap.xml"];
  for (const candidate of sitemapCandidates) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) continue;

      const xmlText = await resp.text();
      for (const dataRoot of DATA_ROOTS) {
        const entries = extractDateEntriesFromSitemap(xmlText, dataRoot);
        if (entries.length > 0) return entries;
      }
    } catch (_err) {
      // try next
    }
  }

  for (const dataRoot of DATA_ROOTS) {
    const indexEntries = await discoverDataFilesFromIndex(dataRoot);
    if (indexEntries.length > 0) return indexEntries;
  }

  for (const dataRoot of DATA_ROOTS) {
    for (const candidate of [`${dataRoot}/`, dataRoot]) {
      try {
        const resp = await fetch(candidate, { cache: "no-store" });
        if (!resp.ok) continue;

        const entries = extractDateEntriesFromDirectoryHtml(await resp.text(), dataRoot);
        if (entries.length > 0) return entries;
      } catch (_err) {
        // try next
      }
    }
  }

  for (const dataRoot of DATA_ROOTS) {
    const githubEntries = await discoverDataFilesFromGithubApi(dataRoot);
    if (githubEntries.length > 0) return githubEntries;
  }

  throw new Error(`Unable to discover CSV files in ${DATA_ROOTS.join(", ")}.`);
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
    if (state.dates.length >= 2) {
      els.dateA.value = state.dates[state.dates.length - 2];
    } else {
      els.dateA.value = state.dates[0];
    }
  }
  if (!els.dateB.value && state.dates.length > 0) {
    els.dateB.value = state.dates[state.dates.length - 1];
  }
}

function getYAxisRange(values, emphasizeTrend) {
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (!emphasizeTrend) {
    const top = Math.max(max, 0);
    const baseRange = top || 1;
    return {
      min: 0,
      max: Math.ceil(top + baseRange * 0.1),
    };
  }

  const range = max - min || Math.max(Math.abs(max) * 0.05, 1);
  const padding = range * 0.2;

  return {
    min: Math.floor(min - padding),
    max: Math.ceil(max + padding),
  };
}

function getRangeStartPercent(range) {
  const total = state.dates.length;

  if (range === "all" || total === 0) {
    return 0;
  }

  const showCount = Number(range);
  if (!Number.isFinite(showCount) || showCount <= 0) {
    return 0;
  }

  return total > showCount ? ((total - showCount) / total) * 100 : 0;
}

function setRange(days) {
  state.selectedRange = String(days);
  const startPercent = getRangeStartPercent(state.selectedRange);

  lineChart.dispatchAction({
    type: "dataZoom",
    start: startPercent,
    end: 100,
  });
}

function bindRangeButtons() {
  const buttons = [...document.querySelectorAll(".chart-toolbar button")];
  if (buttons.length === 0) return;

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const range = btn.dataset.range || "all";
      setRange(range);
    });
  });
}

function renderLineChart(metric, emphasizeTrend) {
  const trendColor = getCssVar("--trend-color", "#2f80ed");
  const trendFill = getCssVar("--trend-fill", "rgba(47,128,237,0.12)");
  const isDark = document.documentElement.dataset.theme === "dark";
  const startPercent = getRangeStartPercent(state.selectedRange);

  const values = state.dates.map((date) => state.totalsByDate.get(date)?.[metric] || 0);
  const yAxisRange = getYAxisRange(values, emphasizeTrend);

  lineChart.setOption(
    {
    grid: { left: 80, right: 40, top: 40, bottom: 90, containLabel: true },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => formatNumber(v),
    },
    xAxis: {
      type: "category",
      data: state.dates,
      axisTick: { show: false },
      axisLabel: { color: "#6b7280", fontSize: 12 },
      axisLine: { lineStyle: { color: isDark ? "#2d3748" : "#d9e1e6" } },
    },
    yAxis: {
      type: "value",
      min: yAxisRange.min,
      max: yAxisRange.max,
      axisTick: { show: false },
      axisLabel: {
        color: "#6b7280",
        fontSize: 12,
        formatter: (value) => formatAxisNumber(value),
      },
      splitLine: { lineStyle: { color: isDark ? "#1f2937" : "#eef2f6" } },
    },
    dataZoom: [
      {
        type: "slider",
        show: true,
        realtime: true,
        xAxisIndex: 0,
        start: startPercent,
        end: 100,
      },
      {
        type: "inside",
        xAxisIndex: 0,
      },
    ],
    series: [
      {
        type: "line",
        smooth: true,
        symbolSize: 6,
        data: values,
        lineStyle: { width: 3, color: isDark ? "#5ea0ff" : trendColor },
        itemStyle: { color: isDark ? "#5ea0ff" : trendColor },
        areaStyle: { color: isDark ? "rgba(94,160,255,0.2)" : trendFill },
        emphasis: {
          focus: "series",
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0,0,0,0.12)",
          },
        },
      },
    ],
    },
    { notMerge: true }
  );
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

// CHANGED: include both positive and negative deltas for treemap aggregation.
function computeDiffAggregation(rowsA, rowsB, metric, aggregateBy) {
  const valueAByKey = buildMetricMapByKey(rowsA, metric);
  const rowsBByKey = buildRowsBByKey(rowsB, metric);
  const grouped = new Map();
  const contributorByPackage = new Map();

  for (const [key, rowB] of rowsBByKey.entries()) {
    const label = aggregateBy === "contributor" ? rowB.contributor : rowB.package;
    if (!label) continue;

    const diff = rowB.metricValue - (valueAByKey.get(key) || 0);
    if (diff === 0) continue;

    grouped.set(label, (grouped.get(label) || 0) + diff);

    if (aggregateBy !== "package" || !rowB.contributor || !rowB.package) continue;

    const contributorTotals = contributorByPackage.get(rowB.package) || new Map();
    contributorTotals.set(rowB.contributor, (contributorTotals.get(rowB.contributor) || 0) + diff);
    contributorByPackage.set(rowB.package, contributorTotals);
  }

  const topContributorByPackage = new Map();
  for (const [packageName, contributorTotals] of contributorByPackage.entries()) {
    let topName = "";
    let topValue = 0;

    for (const [name, value] of contributorTotals.entries()) {
      if (Math.abs(value) > Math.abs(topValue)) {
        topName = name;
        topValue = value;
      }
    }

    if (topName) {
      topContributorByPackage.set(packageName, { name: topName, value: topValue });
    }
  }

  return { grouped, topContributorByPackage };
}

function renderTreemap(metric, dateA, dateB, aggregateBy) {
  if (dateA === dateB && state.dates.length === 1) {
    treemapChart.setOption({
      series: [{ type: "treemap", data: [] }],
    });
    setStatus("Only one date is available, so Date A and Date B are set to the same day.");
    return;
  }

  if (dateA >= dateB) {
    treemapChart.setOption({
      series: [{ type: "treemap", data: [] }],
    });
    setStatus("No diff data between dates (Date A must be earlier than Date B).");
    return;
  }

  const rowsA = state.rowsByDate.get(dateA) || [];
  const rowsB = state.rowsByDate.get(dateB) || [];

  const { grouped, topContributorByPackage } = computeDiffAggregation(rowsA, rowsB, metric, aggregateBy);
  // CHANGED: ECharts treemap value must be non-negative; keep signed delta in a dedicated field.
  const data = [...grouped.entries()].map(([name, delta]) => ({
    name,
    delta,
    value: Math.abs(delta),
  }));
  const values = data.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const styledData = data.map((item) => {
    const normalized = (item.value - min) / ((max - min) || 1);
    // CHANGED: color by delta sign (positive vs negative) with separate palettes.
    const color = item.delta > 0
      ? buildTreemapColor(item.value, min, max)
      : item.delta < 0
        ? (normalized < 0.5
          ? interpolateColor(TREEMAP_NEGATIVE_COLOR_SCALE.start, TREEMAP_NEGATIVE_COLOR_SCALE.mid, normalized * 2)
          : interpolateColor(TREEMAP_NEGATIVE_COLOR_SCALE.mid, TREEMAP_NEGATIVE_COLOR_SCALE.end, (normalized - 0.5) * 2))
        : TREEMAP_ZERO_COLOR;
    const textColor = getTreemapLabelColor(normalized);

    return {
      ...item,
      itemStyle: { color },
      label: { color: textColor },
    };
  });

  if (data.length === 0) {
    setStatus("No non-zero diff items between dates.");
  } else {
    setStatus("");
  }

  treemapChart.setOption(
    {
    tooltip: {
      formatter: (params) => {
        const delta = params.data?.delta || 0;
        const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
        const base = `${params.name}<br/>Δ ${sign}${formatNumber(Math.abs(delta))}`;
        if (aggregateBy !== "package") return base;

        const topContributor = topContributorByPackage.get(params.name);
        if (!topContributor) return `${base}<br/>Contributor: N/A`;

        const contributorSign = topContributor.value > 0 ? "+" : topContributor.value < 0 ? "-" : "";
        return `${base}<br/>Contributor: ${topContributor.name} (${contributorSign}${formatNumber(Math.abs(topContributor.value))} lines)`;
      },
    },
    series: [
      {
        type: "treemap",
        data: styledData,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        itemStyle: {
          borderColor: "#ffffff",
          borderWidth: 2,
          gapWidth: 2,
        },
        label: {
          // CHANGED: show signed delta in label while using absolute value for layout.
          formatter: ({ data: item }) => {
            const delta = item?.delta || 0;
            const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
            return `${item?.name || ""}\n${sign}${formatNumber(Math.abs(delta))}`;
          },
          fontSize: 12,
          color: ({ data: item }) => item?.label?.color || "#111827",
        },
        visibleMin: 300,
        emphasis: {
          itemStyle: {
            shadowBlur: 20,
            shadowColor: "rgba(0,0,0,0.15)",
          },
        },
      },
    ],
    },
    { notMerge: true }
  );
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
  const emphasizeTrend = els.emphasizeTrend.checked;

  renderLineChart(metric, emphasizeTrend);
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

    state.dates = [...state.fileByDate.keys()].sort((a, b) => {
      const aTime = new Date(a).getTime();
      const bTime = new Date(b).getTime();

      if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
        return aTime - bTime;
      }

      return a.localeCompare(b);
    });

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

    [els.metric, els.dateA, els.dateB, els.aggregate, els.emphasizeTrend].forEach((control) => {
      control.addEventListener("change", renderAll);
    });

    bindRangeButtons();

    setStatus("");
    renderAll();
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Failed to load data", true);
  }
}

init();
