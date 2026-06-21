const { runLoggedAgent } = require("./agentLogger");

const DEFAULT_REPORT = {
  score: 0,
  status: "NEEDS_FIX",
  issues: ["Quality inspection unavailable"],
  design_visibility: 0,
  realism: 0,
  defect_risk: 100,
  etsy_usefulness: 0,
  recommended_action: "fix",
  fix_prompt: "Review the generated mockup and repair only the visible quality issue while preserving the design, garment, model, background, lighting, and composition.",
};

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeStatus(score, status) {
  const upper = String(status || "").toUpperCase();
  if (["PASS", "NEEDS_FIX", "REJECT"].includes(upper)) return upper;
  if (score >= 75) return "PASS";
  if (score >= 60) return "NEEDS_FIX";
  return "REJECT";
}

function normalizeAction(action, status) {
  const clean = String(action || "").toLowerCase();
  if (["keep", "fix", "regenerate"].includes(clean)) return clean;
  return status === "PASS" ? "keep" : status === "REJECT" ? "regenerate" : "fix";
}

function parseJsonObject(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    console.error("[qualityInspectorAgent] JSON.parse failed:", error.message);
    return null;
  }
}

function normalizeQualityReport(report) {
  const source = report && typeof report === "object" ? report : DEFAULT_REPORT;
  const score = clampScore(source.score);
  const status = normalizeStatus(score, source.status);
  return {
    score,
    status,
    issues: Array.isArray(source.issues) ? source.issues.map(String).filter(Boolean).slice(0, 12) : [],
    design_visibility: clampScore(source.design_visibility),
    realism: clampScore(source.realism),
    defect_risk: clampScore(source.defect_risk),
    etsy_usefulness: clampScore(source.etsy_usefulness),
    recommended_action: normalizeAction(source.recommended_action, status),
    fix_prompt: String(source.fix_prompt || "").slice(0, 1200),
  };
}

async function runQualityInspectorAgent(input, deps = {}) {
  return runLoggedAgent("quality_inspector", input, async () => {
    const { gemini, fetchJsonWithRetry, getGeminiText } = deps;
    if (!gemini) {
      const err = new Error("Quality inspector service is not configured");
      err.code = "service_missing";
      throw err;
    }
    if (!input?.imageUrl) {
      const err = new Error("Generated image is required");
      err.code = "bad_request";
      throw err;
    }

    const parts = [
      {
        text: `You are a strict Etsy mockup quality inspector.

Inspect:
- design visibility
- design readability
- print placement
- shirt realism
- lighting consistency
- face quality
- hand quality
- body anatomy defects
- AI artifacts
- Etsy usefulness

Return ONLY strict JSON:
{
  "score": 0,
  "status": "PASS",
  "issues": [],
  "design_visibility": 0,
  "realism": 0,
  "defect_risk": 0,
  "etsy_usefulness": 0,
  "recommended_action": "keep",
  "fix_prompt": ""
}

Status rules:
90-100 Excellent, 75-89 Good, 60-74 NEEDS_FIX, 0-59 REJECT.

Be strict. If there are repairable defects, write a surgical fix_prompt. If the image is not useful for Etsy, recommend regenerate.

Mockup prompt:
${input.mockupPrompt || "Not provided"}`,
      },
    ];

    const mockupDataUrl = String(input.imageUrl || "");
    if (mockupDataUrl.startsWith("data:") && mockupDataUrl.includes(";base64,")) {
      const [meta, base64] = mockupDataUrl.split(",");
      parts.unshift({
        inline_data: {
          mime_type: meta.match(/data:(.*?);base64/)?.[1] || "image/png",
          data: base64,
        },
      });
    }

    const originalDataUrl = String(input.originalDesignUrl || "");
    if (originalDataUrl.startsWith("data:") && originalDataUrl.includes(";base64,")) {
      const [meta, base64] = originalDataUrl.split(",");
      parts.unshift({
        inline_data: {
          mime_type: meta.match(/data:(.*?);base64/)?.[1] || "image/png",
          data: base64,
        },
      });
    }

    const response = await fetchJsonWithRetry("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        generationConfig: { maxOutputTokens: 1800, responseMimeType: "application/json" },
        contents: [{ role: "user", parts }],
      }),
    }, { retries: 2, delayMs: 900, label: "gemini quality-inspector" });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return normalizeQualityReport(parseJsonObject(getGeminiText(data)));
  }, {
    persist: deps.persistLog,
    model: "gemini-2.5-flash",
    inputSummary: {
      hasImage: !!input?.imageUrl,
      hasOriginalDesign: !!input?.originalDesignUrl,
      promptLength: String(input?.mockupPrompt || "").length,
    },
    fallbackData: DEFAULT_REPORT,
  });
}

module.exports = {
  normalizeQualityReport,
  runQualityInspectorAgent,
};
