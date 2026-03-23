function getBasePath() {
  const host = window.location.hostname || "";
  if (!host.endsWith("github.io")) return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts.length > 0 ? `/${parts[0]}` : "";
}

function asText(value) {
  return value == null ? "" : String(value).trim();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

const BASE_PATH = getBasePath();
const VIEW_MODE = asText(window.VIEW_MODE) || "realtime";
const DETAIL_DATA_DIR = asText(window.DETAIL_DATA_DIR || window.DATA_DIR);
const DETAIL_DATA_MANIFEST_PATH = asText(window.DETAIL_DATA_MANIFEST_PATH || window.DATA_MANIFEST_PATH);
const TOTALS_HISTORY_PATH = asText(window.TOTALS_HISTORY_PATH);
const REALTIME_STATS_API = asText(window.REALTIME_STATS_API);

const DEFAULT_DETAIL_DATA_ROOTS = [...new Set([`${BASE_PATH}/data`, "../data", "./../data", "./data", "data"])];
const DETAIL_DATA_ROOTS = DETAIL_DATA_DIR ? [DETAIL_DATA_DIR] : DEFAULT_DETAIL_DATA_ROOTS;
const TOTAL_METRIC_KEYS = ["line_count", "package_count", "module_count", "total_download"];
const API_TOTAL_FIELD_MAP = {
  total_lines: "line_count",
  total_packages: "package_count",
  total_modules: "module_count",
  total_downloads: "total_download",
};

const els = {
  metric: document.getElementById("metricSelect"),
  dateA: document.getElementById("dateASelect"),
  dateB: document.getElementById("dateBSelect"),
  aggregate: document.getElementById("aggregateSelect"),
  emphasizeTrend: document.getElementById("emphasizeTrend"),
  deltaHint: document.getElementById("deltaHint"),
  summary: document.getElementById("summary"),
  status: document.getElementById("status"),
  availableDates: document.getElementById("availableDates"),
};

const lineChart = echarts.init(document.getElementById("lineChart"));
const treemapChart = echarts.init(document.getElementById("treemapChart"));

const state = {
  detailFileByDate: new Map(),
  detailRowsByDate: new Map(),
  detailLoadPromisesByDate: new Map(),
  totalsByDate: new Map(),
  detailDates: [],
  totalDates: [],
  dates: [],
  selectedRange: "30",
};

const numberFmt = new Intl.NumberFormat("en-US");
const TREEMAP_COLOR_SCALE = { start: "#d8f3dc", mid: "#52b788", end: "#0f4e6b" };
const TREEMAP_NEGATIVE_COLOR_SCALE = { start: "#fde2e4", mid: "#f08080", end: "#9d0208" };
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
  if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return formatNumber(num);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function sortDateStrings(dates) {
  return [...new Set(dates.filter(Boolean))].sort((a, b) => {
    const aTime = new Date(a).getTime();
    const bTime = new Date(b).getTime();
    return Number.isFinite(aTime) && Number.isFinite(bTime) ? aTime - bTime : a.localeCompare(b);
  });
}

function toDateUtc(dateText) {
  const text = asText(dateText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toDateText(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function shiftDays(dateText, offset) {
  const date = toDateUtc(dateText);
  if (!date) return "";
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return toDateText(shifted);
}

function getLatestDateOnOrBefore(targetDate, dates = state.dates) {
  for (let idx = dates.length - 1; idx >= 0; idx -= 1) {
    if (dates[idx] <= targetDate) return dates[idx];
  }
  return "";
}

function getLatestDateBefore(targetDate, dates = state.dates) {
  for (let idx = dates.length - 1; idx >= 0; idx -= 1) {
    if (dates[idx] < targetDate) return dates[idx];
  }
  return "";
}

function resolveClosestAvailableDate(rawDate, dates = state.dates) {
  const text = asText(rawDate);
  if (!text || dates.length === 0) return "";
  if (dates.includes(text)) return text;
  const target = toDateUtc(text);
  if (!target) return "";

  let bestDate = dates[0];
  let bestDistance = Math.abs(toDateUtc(bestDate).getTime() - target.getTime());
  for (let idx = 1; idx < dates.length; idx += 1) {
    const candidate = dates[idx];
    const distance = Math.abs(toDateUtc(candidate).getTime() - target.getTime());
    if (distance < bestDistance || (distance === bestDistance && candidate < bestDate)) {
      bestDate = candidate;
      bestDistance = distance;
    }
  }
  return bestDate;
}

function resolveDefaultDateA(dateB, daysBack = 7) {
  if (!dateB) return "";
  const target = shiftDays(dateB, -Math.abs(daysBack));
  const onOrBeforeTarget = getLatestDateOnOrBefore(target);
  if (onOrBeforeTarget && onOrBeforeTarget < dateB) return onOrBeforeTarget;
  return getLatestDateBefore(dateB) || dateB;
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

function emptyTotals() {
  return { line_count: 0, package_count: 0, module_count: 0, total_download: 0 };
}

function mergeTotalsForDate(date, totals) {
  const current = state.totalsByDate.get(date) || {};
  const next = { ...current };
  for (const metric of TOTAL_METRIC_KEYS) {
    if (Number.isFinite(totals?.[metric])) next[metric] = totals[metric];
  }
  state.totalsByDate.set(date, next);
}

function computeDetailTotals(rows) {
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

function parseTotalsHistoryRows(rawRows) {
  return rawRows
    .map((row) => {
      const date = asText(row.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return {
        date,
        totals: {
          line_count: toNumber(row.total_lines),
          package_count: toNumber(row.total_packages),
          module_count: toNumber(row.total_modules),
          total_download: toNumber(row.total_downloads),
        },
      };
    })
    .filter(Boolean);
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
    return {
      package: packageName,
      contributor: deriveContributor(row),
      key: packageName ? `${packageName}::${deriveIdentifier(row, index)}` : "",
      line_count: toNumber(row.line_count),
      package_count: toNumber(row.package_count),
      module_count: 1,
      total_download: toNumber(row.total_download),
    };
  });
}

function extractDateEntriesFromDirectoryHtml(html, dataRoot) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
  const entries = [];

  for (const href of links) {
    const clean = String(href).replace(/\/$/, "").trim();
    const folder = clean.match(/(\d{4}-\d{2}-\d{2})$/);
    const file = clean.match(/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (folder) entries.push({ date: folder[1], url: `${dataRoot}/${folder[1]}/summary.csv` });
    if (file) entries.push({ date: file[1], url: `${dataRoot}/${file[1]}.csv` });
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
    const file = loc.match(/\/data\/(\d{4}-\d{2}-\d{2})\.csv$/);
    if (folder) entries.push({ date: folder[1], url: `${dataRoot}/${folder[1]}/summary.csv` });
    if (file) entries.push({ date: file[1], url: `${dataRoot}/${file[1]}.csv` });
  }

  return entries;
}

function extractDateEntriesFromGithubContents(items, dataRoot) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const match = asText(item?.name).match(/^(\d{4}-\d{2}-\d{2})\.csv$/);
      return match ? { date: match[1], url: `${dataRoot}/${match[1]}.csv` } : null;
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

async function discoverDataFilesFromManifest(manifestPath, dataRoot) {
  try {
    const resp = await fetch(manifestPath, { cache: "no-store" });
    if (!resp.ok) return [];
    const payload = await resp.json();
    if (!Array.isArray(payload?.files)) return [];
    return payload.files
      .map((name) => asText(name))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(name))
      .map((name) => ({ date: name.slice(0, 10), url: `${dataRoot}/${name}` }));
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
  return owner && repo ? { owner, repo } : null;
}

async function discoverDataFilesFromGithubApi(dataRoot) {
  const repoInfo = detectGithubRepoFromLocation();
  if (!repoInfo) return [];

  const repoDataPath = dataRoot
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  if (!repoDataPath) return [];

  for (const ref of ["HEAD", "main", "master"]) {
    const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodeURIComponent(repoDataPath)}?ref=${encodeURIComponent(ref)}`;
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

async function discoverDetailDataFiles() {
  const allEntries = new Map();
  const appendEntries = (entries) => {
    for (const entry of entries) {
      if (entry?.date && entry?.url) allEntries.set(entry.date, entry.url);
    }
  };

  for (const candidate of [`${BASE_PATH}/sitemap.xml`, "../sitemap.xml", "./sitemap.xml"]) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) continue;
      const xmlText = await resp.text();
      for (const dataRoot of DETAIL_DATA_ROOTS) appendEntries(extractDateEntriesFromSitemap(xmlText, dataRoot));
    } catch (_err) {
      // try next
    }
  }

  const manifestCandidates = DETAIL_DATA_MANIFEST_PATH
    ? [DETAIL_DATA_MANIFEST_PATH]
    : DETAIL_DATA_ROOTS.map((dataRoot) => `${dataRoot}/manifest.json`);

  for (const manifestPath of manifestCandidates) {
    for (const dataRoot of DETAIL_DATA_ROOTS) {
      appendEntries(await discoverDataFilesFromManifest(manifestPath, dataRoot));
    }
  }

  for (const dataRoot of DETAIL_DATA_ROOTS) appendEntries(await discoverDataFilesFromIndex(dataRoot));

  for (const dataRoot of DETAIL_DATA_ROOTS) {
    for (const candidate of [`${dataRoot}/`, dataRoot]) {
      try {
        const resp = await fetch(candidate, { cache: "no-store" });
        if (!resp.ok) continue;
        appendEntries(extractDateEntriesFromDirectoryHtml(await resp.text(), dataRoot));
      } catch (_err) {
        // try next
      }
    }
  }

  for (const dataRoot of DETAIL_DATA_ROOTS) appendEntries(await discoverDataFilesFromGithubApi(dataRoot));

  if (allEntries.size === 0) {
    throw new Error(`Unable to discover CSV files in ${DETAIL_DATA_ROOTS.join(", ")}.`);
  }

  return [...allEntries.entries()].map(([date, url]) => ({ date, url }));
}

async function loadDetailRowsAndTotals() {
  const discovered = await discoverDetailDataFiles();
  for (const entry of discovered) state.detailFileByDate.set(entry.date, entry.url);
  state.detailDates = sortDateStrings([...state.detailFileByDate.keys()]);
}

async function ensureDetailRowsLoaded(date) {
  if (!date) return [];
  if (state.detailRowsByDate.has(date)) return state.detailRowsByDate.get(date);
  if (state.detailLoadPromisesByDate.has(date)) return state.detailLoadPromisesByDate.get(date);

  const url = state.detailFileByDate.get(date);
  if (!url) return [];

  const promise = (async () => {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${url}`);
    const rows = prepareRows(parseCsv(await resp.text()));
    state.detailRowsByDate.set(date, rows);
    mergeTotalsForDate(date, computeDetailTotals(rows));
    state.detailLoadPromisesByDate.delete(date);
    return rows;
  })().catch((err) => {
    state.detailLoadPromisesByDate.delete(date);
    throw err;
  });

  state.detailLoadPromisesByDate.set(date, promise);
  return promise;
}

async function warmInitialDetailTotals() {
  if (state.detailDates.length === 0) return;
  const newest = state.detailDates[state.detailDates.length - 1];
  const target = shiftDays(newest, -7);
  let baseline = getLatestDateOnOrBefore(target, state.detailDates);
  if (!baseline || baseline >= newest) {
    baseline = getLatestDateBefore(newest, state.detailDates) || newest;
  }
  const datesToWarm = sortDateStrings([newest, baseline].filter(Boolean));
  await Promise.all(datesToWarm.map((date) => ensureDetailRowsLoaded(date)));
}

async function loadRemainingDetailTotalsInBackground() {
  const pendingDates = state.detailDates.filter((date) => !state.detailRowsByDate.has(date));
  if (pendingDates.length === 0) return;

  const batchSize = 4;
  for (let idx = 0; idx < pendingDates.length; idx += batchSize) {
    const batch = pendingDates.slice(idx, idx + batchSize);
    await Promise.all(batch.map((date) => ensureDetailRowsLoaded(date)));
    rebuildAvailableDates();
    renderLineChart(els.metric.value, els.emphasizeTrend.checked);
    renderSummary(els.metric.value, els.dateA.value, els.dateB.value);
  }
}

async function loadTotalsHistory() {
  if (!TOTALS_HISTORY_PATH) return;
  try {
    const resp = await fetch(TOTALS_HISTORY_PATH, { cache: "no-store" });
    if (!resp.ok) return;
    const entries = parseTotalsHistoryRows(parseCsv(await resp.text()));
    for (const entry of entries) mergeTotalsForDate(entry.date, entry.totals);
  } catch (_err) {
    // optional until first snapshot exists
  }
}

function mapRealtimeApiTotals(payload) {
  const totals = emptyTotals();
  for (const [apiField, metric] of Object.entries(API_TOTAL_FIELD_MAP)) {
    totals[metric] = toNumber(payload?.[apiField]);
  }
  return totals;
}

async function loadRealtimeTotalsOverride() {
  if (VIEW_MODE !== "realtime" || !REALTIME_STATS_API) return;
  try {
    const resp = await fetch(REALTIME_STATS_API, { cache: "no-store" });
    if (!resp.ok) return;
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    mergeTotalsForDate(today, mapRealtimeApiTotals(await resp.json()));
  } catch (_err) {
    // keep historical fallback
  }
}

function rebuildAvailableDates() {
  state.totalDates = sortDateStrings([...state.totalsByDate.keys()]);
  state.dates = sortDateStrings([...state.detailDates, ...state.totalDates]);
}

function getAvailableDatesForMetric(metric) {
  return state.totalDates.filter((date) => Object.prototype.hasOwnProperty.call(state.totalsByDate.get(date) || {}, metric));
}

function getTotalsForDate(date, metric = "") {
  if (!date || state.totalDates.length === 0) return emptyTotals();
  if (!metric && state.totalsByDate.has(date)) return state.totalsByDate.get(date);

  const metricDates = metric ? getAvailableDatesForMetric(metric) : state.totalDates;
  if (metric && Object.prototype.hasOwnProperty.call(state.totalsByDate.get(date) || {}, metric)) {
    return state.totalsByDate.get(date);
  }

  const fallbackDate = getLatestDateOnOrBefore(date, metricDates) || resolveClosestAvailableDate(date, metricDates);
  return state.totalsByDate.get(fallbackDate) || emptyTotals();
}

function resolveDetailDateForSelection(date) {
  if (state.detailDates.length === 0) return "";
  if (state.detailFileByDate.has(date)) return date;
  return getLatestDateOnOrBefore(date, state.detailDates) || resolveClosestAvailableDate(date, state.detailDates);
}

function populateDateSelectors() {
  const prevA = resolveClosestAvailableDate(els.dateA.value);
  const prevB = resolveClosestAvailableDate(els.dateB.value);
  if (els.availableDates) {
    els.availableDates.innerHTML = state.dates.map((d) => `<option value="${d}"></option>`).join("");
  }

  const minDate = state.dates[0] || "";
  const maxDate = state.dates[state.dates.length - 1] || "";
  els.dateA.min = minDate;
  els.dateA.max = maxDate;
  els.dateB.min = minDate;
  els.dateB.max = maxDate;
  els.dateB.value = prevB || maxDate;
  els.dateA.value = prevA || resolveDefaultDateA(els.dateB.value, 7);
  if (els.dateA.value >= els.dateB.value) {
    els.dateA.value = resolveDefaultDateA(els.dateB.value, 7);
  }
}

function enforceDateOrder(changedField) {
  const normalizedA = resolveClosestAvailableDate(els.dateA.value);
  const normalizedB = resolveClosestAvailableDate(els.dateB.value);
  if (normalizedB) els.dateB.value = normalizedB;
  if (normalizedA) els.dateA.value = normalizedA;
  if (els.dateA.value < els.dateB.value) return;

  if (changedField === "dateB") {
    els.dateA.value = resolveDefaultDateA(els.dateB.value, 7);
  } else {
    els.dateA.value = getLatestDateBefore(els.dateB.value) || resolveDefaultDateA(els.dateB.value, 7);
  }
}

function bindQuickRangeButtons() {
  const buttons = [...document.querySelectorAll("[data-quick-range]")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.dataset.quickRange);
      const dateB = state.dates[state.dates.length - 1] || "";
      if (!dateB || !Number.isFinite(days)) return;
      els.dateB.value = dateB;
      els.dateA.value = resolveDefaultDateA(dateB, days);
      enforceDateOrder("dateB");
      renderAll();
    });
  });
}

function getPaddedYAxisRange(rawMin, rawMax) {
  const min = Number(rawMin);
  const max = Number(rawMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.1, 1);
    return { min: Math.floor(min - padding), max: Math.ceil(max + padding) };
  }
  const padding = (max - min) * 0.1;
  return { min: Math.floor(min - padding), max: Math.ceil(max + padding) };
}

function getYAxisRange(values, emphasizeTrend) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!emphasizeTrend) return getPaddedYAxisRange(min, max);
  const range = max - min || Math.max(Math.abs(max) * 0.05, 1);
  const padding = range * 0.2;
  return { min: Math.floor(min - padding), max: Math.ceil(max + padding) };
}

function getRangeStartPercent(range, dates = state.dates) {
  if (range === "all" || dates.length === 0) return 0;
  const showCount = Number(range);
  if (!Number.isFinite(showCount) || showCount <= 0) return 0;
  return dates.length > showCount ? ((dates.length - showCount) / dates.length) * 100 : 0;
}

function setRange(days) {
  state.selectedRange = String(days);
  const dates = state.totalDates.length > 0 ? state.totalDates : state.dates;
  lineChart.dispatchAction({ type: "dataZoom", start: getRangeStartPercent(state.selectedRange, dates), end: 100 });
}

function bindRangeButtons() {
  const buttons = [...document.querySelectorAll(".chart-toolbar button")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setRange(btn.dataset.range || "all");
    });
  });
}

function renderLineChart(metric, emphasizeTrend) {
  const metricDates = getAvailableDatesForMetric(metric);
  const chartDates = metricDates.length > 0 ? metricDates : (metric === "total_download" ? [] : (state.totalDates.length > 0 ? state.totalDates : state.dates));
  const trendColor = getCssVar("--trend-color", "#2f80ed");
  const trendFill = getCssVar("--trend-fill", "rgba(47,128,237,0.12)");
  const isDark = document.documentElement.dataset.theme === "dark";

  if (chartDates.length === 0) {
    lineChart.setOption(
      {
        title: {
          text: "No historical data yet for this metric.",
          left: "center",
          top: "middle",
          textStyle: { fontSize: 14, fontWeight: "normal", color: "#6b7280" },
        },
        xAxis: { type: "category", data: [] },
        yAxis: { type: "value" },
        series: [{ type: "line", data: [] }],
      },
      { notMerge: true }
    );
    return;
  }

  const values = chartDates.map((date) => getTotalsForDate(date, metric)?.[metric] ?? 0);
  const yAxisRange = getYAxisRange(values, emphasizeTrend);
  lineChart.setOption(
    {
      title: { text: "" },
      grid: { left: 80, right: 40, top: 40, bottom: 90, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v) => formatNumber(v) },
      xAxis: {
        type: "category",
        data: chartDates,
        axisTick: { show: false },
        axisLabel: { color: "#6b7280", fontSize: 12 },
        axisLine: { lineStyle: { color: isDark ? "#2d3748" : "#d9e1e6" } },
      },
      yAxis: {
        type: "value",
        min: emphasizeTrend ? yAxisRange.min : (extent) => getPaddedYAxisRange(extent?.min, extent?.max).min,
        max: emphasizeTrend ? yAxisRange.max : (extent) => getPaddedYAxisRange(extent?.min, extent?.max).max,
        axisTick: { show: false },
        axisLabel: { color: "#6b7280", fontSize: 12, formatter: (value) => formatAxisNumber(value) },
        splitLine: { lineStyle: { color: isDark ? "#1f2937" : "#eef2f6" } },
      },
      dataZoom: [
        { type: "slider", show: true, realtime: true, xAxisIndex: 0, start: getRangeStartPercent(state.selectedRange, chartDates), end: 100 },
        { type: "inside", xAxisIndex: 0 },
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
        },
      ],
    },
    { notMerge: true }
  );
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const normalized = clean.length === 3 ? clean.split("").map((c) => `${c}${c}`).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 0, g: 0, b: 0 };
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function interpolateColor(startColor, endColor, factor) {
  const clamped = Math.max(0, Math.min(1, factor));
  const from = hexToRgb(startColor);
  const to = hexToRgb(endColor);
  const r = Math.round(from.r + clamped * (to.r - from.r));
  const g = Math.round(from.g + clamped * (to.g - from.g));
  const b = Math.round(from.b + clamped * (to.b - from.b));
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

function getTreemapLabelColor(normalized) {
  return normalized < 0.35 ? "#111827" : "#ffffff";
}

function getCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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
    const current = map.get(row.key) || { package: row.package, contributor: row.contributor, metricValue: 0 };
    current.metricValue += row[metric];
    if (!current.package && row.package) current.package = row.package;
    if (!current.contributor && row.contributor) current.contributor = row.contributor;
    map.set(row.key, current);
  }
  return map;
}

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

    if (aggregateBy === "package" && rowB.contributor && rowB.package) {
      const totals = contributorByPackage.get(rowB.package) || new Map();
      totals.set(rowB.contributor, (totals.get(rowB.contributor) || 0) + diff);
      contributorByPackage.set(rowB.package, totals);
    }
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
    if (topName) topContributorByPackage.set(packageName, { name: topName, value: topValue });
  }

  return { grouped, topContributorByPackage };
}

async function renderTreemap(metric, dateA, dateB, aggregateBy) {
  if (metric === "total_download") {
    treemapChart.setOption(
      {
        title: {
          text: "total_download has no detailed CSV breakdown.",
          left: "center",
          top: "middle",
          textStyle: { fontSize: 14, fontWeight: "normal", color: "#6b7280" },
        },
        series: [{ type: "treemap", data: [] }],
      },
      { notMerge: true }
    );
    setStatus("Treemap and diff analysis still use detailed CSV, so total_download is only available in totals panels.");
    return;
  }

  const detailDateA = resolveDetailDateForSelection(dateA);
  const detailDateB = resolveDetailDateForSelection(dateB);
  if (!detailDateA || !detailDateB) {
    treemapChart.setOption(
      {
        title: {
          text: "Detailed CSV snapshots are not available yet.",
          left: "center",
          top: "middle",
          textStyle: { fontSize: 14, fontWeight: "normal", color: "#6b7280" },
        },
        series: [{ type: "treemap", data: [] }],
      },
      { notMerge: true }
    );
    setStatus("Treemap diff requires detailed CSV snapshots.");
    return;
  }

  if (detailDateA >= detailDateB) {
    treemapChart.setOption({ series: [{ type: "treemap", data: [] }] }, { notMerge: true });
    setStatus("No diff data between dates (Date A must be earlier than Date B).");
    return;
  }

  try {
    setStatus("Loading detailed CSV snapshots for treemap...");
    const [rowsA, rowsB] = await Promise.all([ensureDetailRowsLoaded(detailDateA), ensureDetailRowsLoaded(detailDateB)]);
    const { grouped, topContributorByPackage } = computeDiffAggregation(rowsA, rowsB, metric, aggregateBy);
    const data = [...grouped.entries()].map(([name, delta]) => ({ name, delta, value: Math.abs(delta) }));
    const values = data.map((item) => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);

    const styledData = data.map((item) => {
      const normalized = (item.value - min) / ((max - min) || 1);
      const color = item.delta > 0
        ? buildTreemapColor(item.value, min, max)
        : item.delta < 0
          ? (normalized < 0.5
            ? interpolateColor(TREEMAP_NEGATIVE_COLOR_SCALE.start, TREEMAP_NEGATIVE_COLOR_SCALE.mid, normalized * 2)
            : interpolateColor(TREEMAP_NEGATIVE_COLOR_SCALE.mid, TREEMAP_NEGATIVE_COLOR_SCALE.end, (normalized - 0.5) * 2))
          : TREEMAP_ZERO_COLOR;
      return { ...item, itemStyle: { color }, label: { color: getTreemapLabelColor(normalized) } };
    });

    treemapChart.setOption(
      {
        title: { text: "" },
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
            itemStyle: { borderColor: "#ffffff", borderWidth: 2, gapWidth: 2 },
            label: {
              formatter: ({ data: item }) => {
                const delta = item?.delta || 0;
                const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
                return `${item?.name || ""}\n${sign}${formatNumber(Math.abs(delta))}`;
              },
              fontSize: 12,
              color: ({ data: item }) => item?.label?.color || "#111827",
            },
            visibleMin: 300,
          },
        ],
      },
      { notMerge: true }
    );

    if (data.length === 0) {
      setStatus("No non-zero diff items between dates.");
    } else if (detailDateA !== dateA || detailDateB !== dateB) {
      setStatus(`Treemap uses detailed snapshots ${detailDateA} -> ${detailDateB}.`);
    } else {
      setStatus("");
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Failed to load treemap data", true);
  }
}

function renderSummary(metric, dateA, dateB) {
  const valueA = getTotalsForDate(dateA, metric)?.[metric] ?? 0;
  const valueB = getTotalsForDate(dateB, metric)?.[metric] ?? 0;
  const diff = dateA >= dateB ? 0 : valueB - valueA;
  const sign = diff > 0 ? "+" : "";
  els.deltaHint.textContent = `Δ ${metric} (${dateB} - ${dateA}) = ${sign}${formatNumber(diff)}`;
  els.summary.textContent = `${metric} | ${dateB} - ${dateA} = ${sign}${formatNumber(diff)}`;
}

function renderAll() {
  const metric = els.metric.value;
  const dateA = els.dateA.value;
  const dateB = els.dateB.value;
  const aggregateBy = els.aggregate.value;
  const emphasizeTrend = els.emphasizeTrend.checked;
  renderLineChart(metric, emphasizeTrend);
  renderSummary(metric, dateA, dateB);
  void renderTreemap(metric, dateA, dateB, aggregateBy);
}

async function init() {
  try {
    setStatus("Loading totals history...");
    await loadDetailRowsAndTotals();
    await Promise.all([loadTotalsHistory(), loadRealtimeTotalsOverride(), warmInitialDetailTotals()]);
    rebuildAvailableDates();
    if (state.dates.length === 0) throw new Error("No date data files found.");

    populateDateSelectors();
    [els.metric, els.aggregate, els.emphasizeTrend].forEach((control) => control.addEventListener("change", renderAll));
    els.dateB.addEventListener("change", () => {
      enforceDateOrder("dateB");
      renderAll();
    });
    els.dateA.addEventListener("change", () => {
      enforceDateOrder("dateA");
      renderAll();
    });
    bindRangeButtons();
    bindQuickRangeButtons();
    setStatus("");
    renderAll();
    void loadRemainingDetailTotalsInBackground();
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Failed to load data", true);
  }
}

init();
