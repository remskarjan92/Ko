const { runLoggedAgent } = require("./agentLogger");

function collectTopValues(rows, getter, limit = 8) {
  const counts = new Map();
  for (const row of rows || []) {
    const values = getter(row);
    for (const raw of Array.isArray(values) ? values : [values]) {
      const value = String(raw || "").trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

async function runEtsyResearchAgent(input, deps = {}) {
  return runLoggedAgent("etsy_research", input, async () => {
    const rows = input.rows || [];
    return {
      niche: input.niche || "",
      top_keywords: collectTopValues(rows, row => String(row.category_keywords || row.prompt || "").split(/[,\n]/), 12),
      top_mockup_styles: collectTopValues(rows, row => row.meta?.mockupStyleMode || row.generation_type),
      top_colors: collectTopValues(rows, row => row.meta?.shirtColor || row.meta?.primaryColor),
      top_angles: collectTopValues(rows, row => row.meta?.cameraSetup || row.meta?.pose),
      recommendations: [
        "Prioritize concepts with high review/download signals.",
        "Prefer repeated high-score styles over one-off visual ideas.",
      ],
      avoid: collectTopValues(rows.filter(row => Number(row.score || 0) < 60), row => row.category || row.review_status, 6),
    };
  }, {
    persist: deps.persistLog,
    model: "statistical",
    inputSummary: {
      niche: input.niche || "",
      rowCount: Array.isArray(input.rows) ? input.rows.length : 0,
    },
    fallbackData: {
      niche: input.niche || "",
      top_keywords: [],
      top_mockup_styles: [],
      top_colors: [],
      top_angles: [],
      recommendations: [],
      avoid: [],
    },
  });
}

module.exports = {
  runEtsyResearchAgent,
};
