const { runLoggedAgent } = require("./agentLogger");

function topByScore(rows, getter, limit = 8, reverse = false) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = String(getter(row) || "").trim();
    if (!key) continue;
    const current = grouped.get(key) || { key, count: 0, total: 0 };
    current.count += 1;
    current.total += Number(row.score || row.overall_score || 0);
    grouped.set(key, current);
  }
  return Array.from(grouped.values())
    .map(item => ({ value: item.key, avg_score: item.count ? Number((item.total / item.count).toFixed(2)) : 0, sample_count: item.count }))
    .sort((a, b) => reverse ? a.avg_score - b.avg_score : b.avg_score - a.avg_score)
    .slice(0, limit);
}

async function runLearningAgent(input, deps = {}) {
  return runLoggedAgent("learning", input, async () => {
    const rows = input.rows || [];
    return {
      best_styles: topByScore(rows, row => row.meta?.mockupStyleMode || row.generation_type),
      worst_styles: topByScore(rows, row => row.meta?.mockupStyleMode || row.generation_type, 8, true),
      best_angles: topByScore(rows, row => row.meta?.cameraSetup || row.meta?.pose),
      best_colors: topByScore(rows, row => row.meta?.primaryColor || row.meta?.shirtColor),
      best_niches: topByScore(rows, row => row.category),
      recommendations: [
        "Increase use of concepts with strong score and download signals.",
        "Reduce styles that repeatedly fall below quality or usefulness thresholds.",
      ],
    };
  }, {
    persist: deps.persistLog,
    model: "statistical",
    inputSummary: {
      rowCount: Array.isArray(input.rows) ? input.rows.length : 0,
    },
    fallbackData: {
      best_styles: [],
      worst_styles: [],
      best_angles: [],
      best_colors: [],
      best_niches: [],
      recommendations: [],
    },
  });
}

module.exports = {
  runLearningAgent,
};
