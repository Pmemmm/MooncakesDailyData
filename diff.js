const fs = require("fs");

function parseCSV(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === ',' || char === '\n' || char === '\r')) {
      row.push(current);
      current = "";

      if (char === ',') {
        continue;
      }

      if (char === '\r' && next === '\n') {
        i += 1;
      }

      rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function arrayToCSV(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const stringValue = String(value ?? "");
          if (/[",\n\r]/.test(stringValue)) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(",")
    )
    .join("\n");
}

function compareCSV(csv1Rows, csv2Rows) {
  const header1 = csv1Rows[0] || [];
  const header2 = csv2Rows[0] || [];

  const nameIndex1 = header1.indexOf("name");
  const lineIndex1 = header1.indexOf("line_count");
  const packageIndex1 = header1.indexOf("package_count");

  const nameIndex2 = header2.indexOf("name");
  const lineIndex2 = header2.indexOf("line_count");
  const packageIndex2 = header2.indexOf("package_count");

  const csv1Map = new Map();
  const csv2Map = new Map();

  for (let i = 1; i < csv1Rows.length; i += 1) {
    const row = csv1Rows[i];
    const name = row[nameIndex1];
    if (!name) continue;

    csv1Map.set(name, {
      lineCount: Number(row[lineIndex1] || 0),
      packageCount: Number(row[packageIndex1] || 0),
    });
  }

  for (let i = 1; i < csv2Rows.length; i += 1) {
    const row = csv2Rows[i];
    const name = row[nameIndex2];
    if (!name) continue;

    csv2Map.set(name, {
      lineCount: Number(row[lineIndex2] || 0),
      packageCount: Number(row[packageIndex2] || 0),
    });
  }

  const allNames = new Set([...csv1Map.keys(), ...csv2Map.keys()]);
  const outputRows = [
    [
      "name",
      "status",
      "line_count_diff",
      "package_count_diff",
      "csv1_line_count",
      "csv1_package_count",
      "csv2_line_count",
      "csv2_package_count",
    ],
  ];

  const dataRows = Array.from(allNames).map((name) => {
    const csv1 = csv1Map.get(name);
    const csv2 = csv2Map.get(name);

    let status = "无变化";
    let lineDiff = 0;
    let packageDiff = 0;
    const csv1Line = csv1 ? csv1.lineCount : 0;
    const csv1Package = csv1 ? csv1.packageCount : 0;
    const csv2Line = csv2 ? csv2.lineCount : 0;
    const csv2Package = csv2 ? csv2.packageCount : 0;

    if (!csv1 && csv2) {
      status = "新增";
      lineDiff = csv2Line;
      packageDiff = csv2Package;
    } else if (csv1 && !csv2) {
      status = "删除";
      lineDiff = -csv1Line;
      packageDiff = -csv1Package;
    } else if (csv1 && csv2) {
      lineDiff = csv2Line - csv1Line;
      packageDiff = csv2Package - csv1Package;
      if (lineDiff !== 0 || packageDiff !== 0) {
        status = "有变化";
      }
    }

    return [
      name,
      status,
      lineDiff,
      packageDiff,
      csv1Line,
      csv1Package,
      csv2Line,
      csv2Package,
    ];
  });

  const statusOrder = {
    新增: 0,
    有变化: 1,
    删除: 2,
    无变化: 3,
  };

  dataRows.sort((a, b) => {
    const statusDiff = statusOrder[a[1]] - statusOrder[b[1]];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    return a[0].localeCompare(b[0]);
  });

  outputRows.push(...dataRows);

  return outputRows;
}

function main() {
  const [oldPath, newPath, outPath] = process.argv.slice(2);
  if (!oldPath || !newPath || !outPath) {
    console.error("Usage: node diff.js old.csv new.csv out.csv");
    process.exit(1);
  }

  const csv1Text = fs.readFileSync(oldPath, "utf8");
  const csv2Text = fs.readFileSync(newPath, "utf8");

  const csv1Rows = parseCSV(csv1Text.trim());
  const csv2Rows = parseCSV(csv2Text.trim());

  const outputRows = compareCSV(csv1Rows, csv2Rows);
  const csvOutput = arrayToCSV(outputRows);

  fs.writeFileSync(outPath, csvOutput, "utf8");

}

main();
