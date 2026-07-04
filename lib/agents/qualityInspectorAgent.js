const { runLoggedAgent } = require("./agentLogger");

const ISSUE_CATALOG = {
  distorted_hands: "Distorted hands",
  extra_fingers: "Extra fingers",
  distorted_face: "Distorted face",
  warped_design: "Warped design",
  blurry_print: "Blurry print",
  unreadable_design: "Unreadable design",
  stretched_shirt: "Stretched shirt",
  unrealistic_pose: "Unrealistic pose",
  low_realism: "Low realism",
  poor_composition: "Poor composition",
};

const DEFAULT_REPORT = {
  score: 62,
  status: "NEEDS_FIX",
  reasoning: "Quality inspection unavailable. A conservative fallback score was used.",
  issues: ["Quality inspection unavailable"],
  detected_issues: [],
  improvement_suggestions: ["Review the mockup manually before using it in a listing."],
  confidence_level: 35,
  suggested_fix_prompt: "Review the generated mockup and repair only the visible quality issue while preserving the design, garment, model, background, lighting, and composition.",
  design_visibility: 60,
  design_placement: 60,
  realism: 60,
  human_anatomy: 60,
  hands: 60,
  face_quality: 60,
  clothing_realism: 60,
  lighting: 60,
  composition: 60,
  etsy_listing_attractiveness: 60,
  defect_risk: 40,
  etsy_usefulness: 60,
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

function clampPercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeSeverity(value) {
  const clean = String(value || "").toLowerCase();
  if (["low", "medium", "high", "critical"].includes(clean)) return clean;
  return "medium";
}

function normalizeIssueCode(value, reason = "") {
  const clean = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (ISSUE_CATALOG[clean]) return clean;
  const haystack = `${clean} ${String(reason || "").toLowerCase()}`;
  if (haystack.includes("extra finger")) return "extra_fingers";
  if (haystack.includes("hand")) return "distorted_hands";
  if (haystack.includes("face")) return "distorted_face";
  if (haystack.includes("warp") || haystack.includes("distort") && haystack.includes("design")) return "warped_design";
  if (haystack.includes("blurry") || haystack.includes("blur")) return "blurry_print";
  if (haystack.includes("unreadable") || haystack.includes("illegible")) return "unreadable_design";
  if (haystack.includes("stretch")) return "stretched_shirt";
  if (haystack.includes("pose")) return "unrealistic_pose";
  if (haystack.includes("realism") || haystack.includes("synthetic")) return "low_realism";
  if (haystack.includes("composition") || haystack.includes("crop")) return "poor_composition";
  return "";
}

function normalizeDetectedIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === "string") {
      const code = normalizeIssueCode(item, item);
      return code ? {
        code,
        label: ISSUE_CATALOG[code],
        severity: "medium",
        reason: item,
      } : null;
    }
    if (!item || typeof item !== "object") return null;
    const reason = String(item.reason || item.detail || item.description || "").trim();
    const code = normalizeIssueCode(item.code || item.issue || item.label, reason);
    if (!code) return null;
    return {
      code,
      label: ISSUE_CATALOG[code],
      severity: normalizeSeverity(item.severity),
      reason: reason.slice(0, 280),
    };
  }).filter(Boolean).slice(0, 12);
}

function normalizeSuggestionList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback.slice(0, 8);
  return value.map(item => String(item || "").trim()).filter(Boolean).slice(0, 8);
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
  const detectedIssues = normalizeDetectedIssues(source.detected_issues || source.issues);
  const improvementSuggestions = normalizeSuggestionList(source.improvement_suggestions, DEFAULT_REPORT.improvement_suggestions);
  const reasoning = String(source.reasoning || source.summary || DEFAULT_REPORT.reasoning).trim().slice(0, 2000);
  const suggestedFixPrompt = String(source.suggested_fix_prompt || source.fix_prompt || DEFAULT_REPORT.fix_prompt).trim().slice(0, 1400);
  return {
    score,
    status,
    reasoning,
    issues: detectedIssues.length ? detectedIssues.map(issue => issue.label) : (Array.isArray(source.issues) ? source.issues.map(String).filter(Boolean).slice(0, 12) : []),
    detected_issues: detectedIssues,
    improvement_suggestions: improvementSuggestions,
    confidence_level: clampPercent(source.confidence_level, 40),
    design_visibility: clampScore(source.design_visibility),
    design_placement: clampScore(source.design_placement),
    realism: clampScore(source.realism),
    human_anatomy: clampScore(source.human_anatomy),
    hands: clampScore(source.hands),
    face_quality: clampScore(source.face_quality),
    clothing_realism: clampScore(source.clothing_realism),
    lighting: clampScore(source.lighting),
    composition: clampScore(source.composition),
    etsy_listing_attractiveness: clampScore(source.etsy_listing_attractiveness),
    defect_risk: clampScore(source.defect_risk),
    etsy_usefulness: clampScore(source.etsy_usefulness),
    recommended_action: normalizeAction(source.recommended_action, status),
    suggested_fix_prompt: suggestedFixPrompt,
    fix_prompt: suggestedFixPrompt,
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
  "reasoning": "",
  "detected_issues": [
    { "code": "distorted_hands", "severity": "medium", "reason": "" }
  ],
  "improvement_suggestions": [],
  "confidence_level": 0,
  "design_visibility": 0,
  "design_placement": 0,
  "realism": 0,
  "human_anatomy": 0,
  "hands": 0,
  "face_quality": 0,
  "clothing_realism": 0,
  "lighting": 0,
  "composition": 0,
  "etsy_listing_attractiveness": 0,
  "defect_risk": 0,
  "etsy_usefulness": 0,
  "recommended_action": "keep",
  "suggested_fix_prompt": ""
}

Status rules:
90-100 Excellent, 75-89 Good, 60-74 NEEDS_FIX, 0-59 REJECT.

Allowed issue codes:
- distorted_hands
- extra_fingers
- distorted_face
- warped_design
- blurry_print
- unreadable_design
- stretched_shirt
- unrealistic_pose
- low_realism
- poor_composition

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
