const statusEl = document.getElementById('status');
const dateAEl = document.getElementById('dateA');
const dateBEl = document.getElementById('dateB');
const metricEl = document.getElementById('metric');

const lineChart = echarts.init(document.getElementById('lineChart'));
const treemapChart = echarts.init(document.getElementById('treemapChart'));

const csvCache = new Map();

async function loadIndex() {
  const response = await fetch('data/index.json');
  if (!response.ok) {
    throw new Error(`加载 data/index.json 失败: ${response.status}`);
  }
  const files = await response.json();
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(file))
    .sort((a, b) => a.localeCompare(b));
}

async function loadCsvRows(fileName) {
  if (csvCache.has(fileName)) {
    return csvCache.get(fileName);
  }

  const response = await fetch(`data/${fileName}`);
  if (!response.ok) {
    throw new Error(`加载 CSV 失败: ${fileName}`);
  }

  const text = await response.text();
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parsed.errors?.length) {
    throw new Error(`解析 CSV 失败: ${fileName}, ${parsed.errors[0].message}`);
  }

  const normalizedRows = parsed.data.map((row) => ({
    package: row.package || row.pkg_name || '',
    name: row.name || '',
    line_count: Number(row.line_count) || 0,
    package_count: Number(row.package_count) || 0,
  }));

  csvCache.set(fileName, normalizedRows);
  return normalizedRows;
}

function toDateLabel(fileName) {
  return fileName.replace('.csv', '');
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function setStatus(message = '') {
  statusEl.textContent = message;
}

function fillDateOptions(files) {
  const optionsHtml = files
    .map((file) => {
      const date = toDateLabel(file);
      return `<option value="${file}">${date}</option>`;
    })
    .join('');

  dateAEl.innerHTML = optionsHtml;
  dateBEl.innerHTML = optionsHtml;

  dateAEl.value = files[0];
  dateBEl.value = files[files.length - 1];
}

async function buildTimelineData(files) {
  const labels = [];
  const totalLine = [];
  const totalPackage = [];
  const totalModule = [];

  for (const file of files) {
    const rows = await loadCsvRows(file);
    labels.push(toDateLabel(file));
    totalLine.push(sumRows(rows, 'line_count'));
    totalPackage.push(sumRows(rows, 'package_count'));
    totalModule.push(rows.length);
  }

  return { labels, totalLine, totalPackage, totalModule };
}

function renderLineChart({ labels, totalLine, totalPackage, totalModule }) {
  lineChart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        const map = Object.fromEntries(params.map((p) => [p.seriesName, p.value]));
        return [
          `<strong>${params[0].axisValue}</strong>`,
          `总 line_count: ${map['总 line_count'] ?? '-'}`,
          `总 package_count: ${map['总 package_count'] ?? '-'}`,
          `总 module_count: ${map['总 module_count'] ?? '-'}`,
        ].join('<br/>');
      },
    },
    legend: {
      data: ['总 line_count', '总 package_count', '总 module_count'],
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
    },
    series: [
      {
        name: '总 line_count',
        type: 'line',
        data: totalLine,
        smooth: true,
      },
      {
        name: '总 package_count',
        type: 'line',
        data: totalPackage,
        smooth: true,
      },
      {
        name: '总 module_count',
        type: 'line',
        data: totalModule,
        smooth: true,
      },
    ],
  });
}

function aggregateByName(rows, metric) {
  const field = metric === 'package' ? 'package_count' : 'line_count';
  const map = new Map();

  for (const row of rows) {
    const key = row.name || row.package || 'Unknown';
    const previous = map.get(key) || 0;
    map.set(key, previous + (Number(row[field]) || 0));
  }

  return map;
}

function buildTreemapNodes(rowsA, rowsB, metric) {
  const mapA = aggregateByName(rowsA, metric);
  const mapB = aggregateByName(rowsB, metric);
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const nodes = [];

  for (const key of keys) {
    const aValue = mapA.get(key) || 0;
    const bValue = mapB.get(key) || 0;
    const diff = bValue - aValue;
    nodes.push({
      name: key,
      value: Math.abs(diff),
      rawDiff: diff,
      aValue,
      bValue,
      itemStyle: {
        color: diff >= 0 ? '#16a34a' : '#dc2626',
      },
    });
  }

  nodes.sort((x, y) => y.value - x.value);
  return nodes;
}

function renderTreemap(nodes, dateA, dateB, metric) {
  treemapChart.setOption({
    tooltip: {
      formatter(info) {
        const data = info.data;
        const metricLabel = metric === 'package' ? 'package_count' : 'line_count';
        return [
          `<strong>${data.name}</strong>`,
          `${dateA} ${metricLabel}: ${data.aValue}`,
          `${dateB} ${metricLabel}: ${data.bValue}`,
          `diff (B - A): ${data.rawDiff}`,
        ].join('<br/>');
      },
    },
    series: [
      {
        type: 'treemap',
        roam: true,
        nodeClick: false,
        label: {
          show: true,
          formatter: '{b}',
        },
        data: nodes,
        upperLabel: {
          show: false,
        },
      },
    ],
  });
}

async function refreshTreemap() {
  const fileA = dateAEl.value;
  const fileB = dateBEl.value;
  const metric = metricEl.value;

  if (!fileA || !fileB) {
    return;
  }

  const [rowsA, rowsB] = await Promise.all([loadCsvRows(fileA), loadCsvRows(fileB)]);
  const nodes = buildTreemapNodes(rowsA, rowsB, metric);
  renderTreemap(nodes, toDateLabel(fileA), toDateLabel(fileB), metric);
}

async function init() {
  try {
    setStatus('加载中...');
    const files = await loadIndex();

    if (!files.length) {
      setStatus('data/index.json 中未找到可用 CSV 文件。');
      return;
    }

    fillDateOptions(files);
    const timelineData = await buildTimelineData(files);
    renderLineChart(timelineData);
    await refreshTreemap();

    dateAEl.addEventListener('change', refreshTreemap);
    dateBEl.addEventListener('change', refreshTreemap);
    metricEl.addEventListener('change', refreshTreemap);

    window.addEventListener('resize', () => {
      lineChart.resize();
      treemapChart.resize();
    });

    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus(error.message || '初始化失败');
  }
}

init();
