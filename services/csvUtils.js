function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows = []) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.join(","),
    ...rows.map(row => columns.map(column => csvEscape(row[column])).join(",")),
  ].join("\n");
}

module.exports = {
  csvEscape,
  toCsv,
};
