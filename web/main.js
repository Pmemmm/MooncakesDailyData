const DEFAULT_CONFIG = {
  owner: '',
  repo: '',
  branch: 'main',
};

const STATUS = {
  line: document.getElementById('lineStatus'),
  treemap: document.getElementById('treemapStatus'),
};

const lineChart = echarts.init(document.getElementById('lineChart'));
const treemapChart = echarts.init(document.getElementById('treemapChart'));
const diffDateSelect = document.getElementById('diffDate');
const groupBySelect = document.getElementById('groupBy');

const repoConfig = resolveRepoConfig();

init().catch((error) => {
  console.error(error);
  setStatus(STATUS.line, `初始化失败：${error.message}`);
  setStatus(STATUS.treemap, `初始化失败：${error.message}`);
});

async function init() {
  const [dataFiles, diffFiles] = await Promise.all([
    listCsvFiles('data'),
    listCsvFiles('diff'),
  ]);

  if (!dataFiles.length) {
    setStatus(STATUS.line, '未获取到 data/ CSV 文件，请检查仓库配置或网络连接。');
  } else {
    await renderLineChart(dataFiles);
  }

  if (!diffFiles.length) {
    setStatus(STATUS.treemap, '未获取到 diff/ CSV 文件，请检查仓库配置或网络连接。');
    return;
  }

  const sortedDiffFiles = diffFiles.sort();
  populateDiffSelect(sortedDiffFiles);
  await renderTreemap(sortedDiffFiles[sortedDiffFiles.length - 1]);

  diffDateSelect.addEventListener('change', async (event) => {
    await renderTreemap(event.target.value);
  });

  groupBySelect.addEventListener('change', async () => {
    await renderTreemap(diffDateSelect.value);
  });
}

function resolveRepoConfig() {
  if (window.REPO_CONFIG) {
    return { ...DEFAULT_CONFIG, ...window.REPO_CONFIG };
  }

  const hostname = window.location.hostname;
  const pathParts = window.location.pathname.split('/').filter(Boolean);

  if (hostname.endsWith('github.io') && pathParts.length > 0) {
    return {
      ...DEFAULT_CONFIG,
      owner: hostname.replace('.github.io', ''),
      repo: pathParts[0],
    };
  }

  return { ...DEFAULT_CONFIG };
}

async function listCsvFiles(dir) {
  const apiFiles = await listCsvFilesFromGitHub(dir);
  if (apiFiles.length) {
    return apiFiles;
  }

  const fallbackList = await listCsvFilesFromManifest(dir);
  return fallbackList;
}

async function listCsvFilesFromGitHub(dir) {
  if (!repoConfig.owner || !repoConfig.repo) {
    return [];
  }

  const apiUrl = `https://api.github.com/repos/${repoConfig.owner}/${repoConfig.repo}/contents/${dir}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return data
      .filter((item) => item.type === 'file' && item.name.endsWith('.csv'))
      .map((item) => item.name)
      .sort();
  } catch (error) {
    console.warn('GitHub API 获取失败', error);
    return [];
  }
}

async function listCsvFilesFromManifest(dir) {
  try {
    const response = await fetch(`../${dir}/index.json`);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      return data.filter((name) => name.endsWith('.csv')).sort();
    }
    return [];
  } catch (error) {
    return [];
  }
}

async function renderLineChart(files) {
  setStatus(STATUS.line, '加载数据中...');
  const rows = [];

  for (const filename of files) {
    const date = filename.replace('.csv', '');
    const csvText = await fetchCsvText(`../data/${filename}`);
    if (!csvText) {
      continue;
    }
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const total = parsed.data.reduce((sum, row) => sum + Number(row.line_count || 0), 0);
    rows.push({ date, total });
  }

  const sorted = rows.sort((a, b) => a.date.localeCompare(b.date));
  const option = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: sorted.map((item) => item.date),
    },
    yAxis: { type: 'value', name: '总代码行数' },
    series: [
      {
        type: 'line',
        data: sorted.map((item) => item.total),
        smooth: true,
        symbolSize: 6,
        lineStyle: { width: 3 },
      },
    ],
  };

  lineChart.setOption(option);
  setStatus(STATUS.line, `已加载 ${sorted.length} 天数据。`);
}

function populateDiffSelect(files) {
  diffDateSelect.innerHTML = '';
  files.forEach((filename) => {
    const option = document.createElement('option');
    option.value = filename;
    option.textContent = filename.replace('.diff.csv', '');
    diffDateSelect.appendChild(option);
  });

  diffDateSelect.value = files[files.length - 1];
}

async function renderTreemap(filename) {
  setStatus(STATUS.treemap, '加载 diff 数据中...');
  const csvText = await fetchCsvText(`../diff/${filename}`);
  if (!csvText) {
    setStatus(STATUS.treemap, '无法读取 diff 文件。');
    return;
  }

  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const groupKey = groupBySelect.value;
  const aggregated = aggregateDiff(parsed.data, groupKey);

  const option = {
    tooltip: {
      formatter: (info) => {
        const value = info.value || 0;
        return `${info.name}<br/>行数变更: ${value}`;
      },
    },
    series: [
      {
        type: 'treemap',
        data: aggregated,
        roam: false,
        label: {
          show: true,
          formatter: '{b}',
        },
        upperLabel: { show: false },
        itemStyle: {
          borderColor: '#fff',
        },
      },
    ],
  };

  treemapChart.setOption(option);
  setStatus(STATUS.treemap, `已加载 ${filename.replace('.diff.csv', '')} 的 diff 数据。`);
}

function aggregateDiff(rows, groupBy) {
  const map = new Map();

  rows.forEach((row) => {
    const name = row.name || '';
    const [owner, repo] = name.split('/');
    const key = groupBy === 'contributor' ? owner || name : repo || name;
    const diffValue = Number(row.line_count_diff || 0);
    if (!map.has(key)) {
      map.set(key, 0);
    }
    map.set(key, map.get(key) + diffValue);
  });

  return Array.from(map.entries())
    .filter(([, value]) => value !== 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

async function fetchCsvText(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn('读取 CSV 失败', error);
    return null;
  }
}

function setStatus(target, message) {
  target.textContent = message;
}

window.addEventListener('resize', () => {
  lineChart.resize();
  treemapChart.resize();
});
