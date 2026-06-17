// Requires Node.js >= 18 (native fetch — no node-fetch needed)
const express = require("express");
const path    = require("path");
const fs      = require("fs");

const app      = express();
const PORT     = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, "..", ".etsy-mockup-keys.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const FLORENCE_VERSION = "da53547e17d45b9cfb48174b2f18af8b83ca020fa76db62136bf9c6616762595";

app.use(express.json({ limit: "25mb" }));
app.use(express.static(__dirname));

// ─── Key storage ──────────────────────────────────────────────────────────────
// Priority: environment variables > keys.json (fallback for local dev)
function loadKeys() {
  const envKeys = {
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    replicate: process.env.REPLICATE_API_KEY || "",
  };
  // If both env vars are set, use them directly
  if (envKeys.gemini && envKeys.replicate) return envKeys;
  // Otherwise merge with any saved keys (local dev fallback)
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      return {
        gemini: envKeys.gemini || saved.gemini || "",
        replicate: envKeys.replicate || saved.replicate || "",
      };
    }
  } catch {}
  return envKeys;
}

function saveKeys(keys) {
  // On Railway, env vars take priority — saving to file is a no-op for those
  const toSave = {
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "" : keys.gemini,
    replicate: process.env.REPLICATE_API_KEY ? "" : keys.replicate,
  };
  try { fs.writeFileSync(KEYS_FILE, JSON.stringify(toSave, null, 2)); } catch {}
}

// ─── Prompt generation debug log (in-memory, resets on redeploy/restart) ──────
const PROMPT_LOG_MAX = 30;
const promptLog = [];
function logPromptGeneration(entry) {
  promptLog.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (promptLog.length > PROMPT_LOG_MAX) promptLog.length = PROMPT_LOG_MAX;
}
function maskKey(k) {
  if (!k || k.length < 12) return k ? "••••••••" : "";
  return k.slice(0, 8) + "•".repeat(k.length - 12) + k.slice(-4);
}

function getAuthToken(req) {
  const header = req.get("x-admin-token") || "";
  if (header) return header;

  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  return "";
}

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) return true;
  if (getAuthToken(req) === ADMIN_TOKEN) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function keySource(type) {
  if (type === "gemini") return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "env" : "file";
  return process.env.REPLICATE_API_KEY ? "env" : "file";
}

function getGeminiText(data) {
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n").trim() || "";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractRateLimitWaitMs(res, bodyText = "") {
  const header = res.headers?.get?.("retry-after") || "";
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  }

  const source = `${bodyText} ${res.statusText || ""}`;
  const patterns = [
    /reset(?:s)? in ~?(\d+(?:\.\d+)?)s/i,
    /retry after ~?(\d+(?:\.\d+)?)s/i,
    /(\d+(?:\.\d+)?)\s*seconds/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Math.max(0, Math.ceil(Number(match[1]) * 1000));
  }
  return 0;
}

async function fetchJsonWithRetry(url, options, { retries = 2, delayMs = 900, label = "request" } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok && (res.status === 429 || res.status >= 500)) {
        const body = await res.text().catch(() => "");
        const retryWait = res.status === 429 ? extractRateLimitWaitMs(res, body) : 0;
        const wait = retryWait || (delayMs * (attempt + 1));
        console.warn(`[${label}] retry ${attempt + 1}/${retries + 1} -> HTTP ${res.status} wait=${Math.ceil(wait / 1000)}s`, body.slice(0, 160));
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        throw new Error(body.slice(0, 240) || `HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        console.warn(`[${label}] retry ${attempt + 1}/${retries + 1} -> ${err.message}`);
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error(`${label} failed`);
}

// ─── Key management ───────────────────────────────────────────────────────────
app.get("/api/keys", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const keys = loadKeys();
  res.json({
    gemini: {
      set: !!keys.gemini,
      masked: maskKey(keys.gemini),
      fromEnv: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    },
    replicate: {
      set: !!keys.replicate,
      masked: maskKey(keys.replicate),
      fromEnv: !!process.env.REPLICATE_API_KEY,
    },
  });
});

app.post("/api/keys", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { gemini, replicate } = req.body;
  const current = loadKeys();
  saveKeys({
    gemini: gemini !== undefined ? gemini : current.gemini,
    replicate: replicate !== undefined ? replicate : current.replicate,
  });
  res.json({ ok: true, message: "Keys saved." });
});

app.delete("/api/keys/:type", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { type } = req.params;
  if (!["gemini", "replicate"].includes(type))
    return res.status(400).json({ error: "Invalid key type" });
  if (keySource(type) === "env") {
    return res.status(409).json({
      error: `${type} key comes from an environment variable and cannot be deleted from the UI.`,
    });
  }
  const keys = loadKeys();
  keys[type] = "";
  saveKeys(keys);
  res.json({ ok: true, message: `${type} key deleted.` });
});

// ─── Connection tests ─────────────────────────────────────────────────────────
app.post("/api/test/gemini", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { gemini } = loadKeys();
  if (!gemini) return res.json({ ok: false, message: "Ključ ni nastavljen." });
  try {
    const r = await fetchJsonWithRetry("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "hi" }] }],
      }),
    }, { retries: 3, delayMs: 1500, label: "gemini generate-prompts" });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const text = d.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    res.json({ ok: true, message: text ? "Povezava uspešna ✓" : "Povezava uspešna ✓" });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

app.post("/api/test/replicate", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { replicate } = loadKeys();
  if (!replicate) return res.json({ ok: false, message: "Ključ ni nastavljen." });
  try {
    const r = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Bearer ${replicate}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    res.json({ ok: true, message: `Povezan kot ${d.username} ✓` });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

const LISTING_ROLE_SEQUENCE = [
  { value: "thumbnail", label: "Thumbnail", purpose: "Search-grid scroll stopper" },
  { value: "proof", label: "Proof", purpose: "Credibility and design clarity" },
  { value: "ugc_review", label: "UGC Review", purpose: "Customer trust and social proof" },
  { value: "fit", label: "Fit", purpose: "Body and garment fit confidence" },
  { value: "lifestyle", label: "Lifestyle", purpose: "Believable everyday ownership" },
  { value: "gift", label: "Gift", purpose: "Occasion-ready buyer intent" },
  { value: "color_variant", label: "Color Variant", purpose: "Alternative color conversion" },
  { value: "detail_closeup", label: "Detail Closeup", purpose: "Print texture and typography proof" },
  { value: "back_view", label: "Back View", purpose: "Back-print or blank-back validation" },
];

const DESIGN_LOCK = `DESIGN LOCK:
Use the uploaded artwork as a protected object.
Preserve exactly:
- wording
- typography
- colors
- spacing
- proportions
- linework
- placement
- scale
Do not:
- redraw
- reinterpret
- restyle
- simplify
- translate
- replace
- modify
Printed text must remain perfectly readable.
Every letter must remain unchanged.
No warped typography.
No melted text.
No missing characters.
No altered wording.`;

const SHIRT_LOCK = `SHIRT LOCK:
Preserve:
- garment identity
- neckline
- sleeve length
- fit
- fabric weight appearance
- garment proportions
- natural fabric texture
Only allow color changes when explicitly requested by the concept.`;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countWords(text) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

function normalizeRiskLevel(score) {
  if (score >= 0.67) return "high";
  if (score >= 0.34) return "medium";
  return "low";
}

function getRoleMeta(role) {
  return LISTING_ROLE_SEQUENCE.find(item => item.value === role) || LISTING_ROLE_SEQUENCE[0];
}

function getRoleAssignment(index) {
  const role = LISTING_ROLE_SEQUENCE[index % LISTING_ROLE_SEQUENCE.length];
  const phase = index < LISTING_ROLE_SEQUENCE.length ? "primary" : "supporting";
  const slot = index + 1;
  const supportVariant = phase === "primary"
    ? `${role.purpose}.`
    : {
        thumbnail: "Alternate crop or mobile-first preview that still reads instantly in a search grid.",
        proof: "Alternate proof angle that emphasizes material clarity, print fidelity, or product confidence.",
        ugc_review: "Different everyday-customer angle that feels like a separate real review photo.",
        fit: "Different body type, posture, or framing that stresses garment drape and fit confidence.",
        lifestyle: "Different scene or routine moment that sells a distinct ownership story.",
        gift: "Different gift occasion, recipient, or gifting context without repeating the earlier angle.",
        color_variant: "Different shirt color or palette alternative that supports conversion variety.",
        detail_closeup: "Different crop or macro emphasis that highlights print texture or typography.",
        back_view: "Different rear-view or blank-back validation angle with clean separation from the first pass.",
      }[role.value] || "Distinct second-pass variant that should not repeat the earlier concept's framing.";
  return { role, phase, slot, supportVariant };
}

function buildRolePlan(batchLength) {
  return Array.from({ length: batchLength }, (_, i) => {
    const { role, phase, slot, supportVariant } = getRoleAssignment(i);
    const phaseLabel = phase === "primary" ? "primary pass" : "supporting pass";
    return `${slot}. ${role.label} (${role.value}) — ${phaseLabel}: ${supportVariant}`;
  }).join("\n");
}

function inferListingRole(category = "", index = 0) {
  const text = String(category).toLowerCase();
  if (/back/i.test(text)) return "back_view";
  if (/close\s*up|close-up|detail|macro|texture/i.test(text)) return "detail_closeup";
  if (/selfie|ugc|phone/i.test(text)) return "ugc_review";
  if (/mirror/i.test(text)) return "fit";
  if (/gift|holiday|occasion/i.test(text)) return "gift";
  if (/color|variant|palette/i.test(text)) return "color_variant";
  if (/proof|product|hanger|folded|stack|mannequin/i.test(text)) return "proof";
  if (/hero|thumbnail|flat lay|flatlay|clean white/i.test(text)) return "thumbnail";
  if (/lifestyle|coffee|walk|street|home|outdoor|vacation|family/i.test(text)) return "lifestyle";
  return LISTING_ROLE_SEQUENCE[index % LISTING_ROLE_SEQUENCE.length].value;
}

function visiblePrintForRole(printVisibility, listingRole) {
  if (printVisibility === "both_sides") return true;
  const backFacing = listingRole === "back_view";
  if (printVisibility === "back_only") return backFacing;
  if (printVisibility === "front_only") return !backFacing;
  return !backFacing;
}

function buildVisibilityLogic(printVisibility, listingRole, visiblePrint) {
  if (visiblePrint) {
    return printVisibility === "back_only"
      ? "VISIBILITY LOGIC: the print must be fully visible, centered, unobstructed, and readable on the back-facing side."
      : printVisibility === "both_sides"
        ? "VISIBILITY LOGIC: the print may appear on both sides when the concept calls for it, but the visible artwork must remain fully readable."
        : "VISIBILITY LOGIC: the print must be fully visible, centered, unobstructed, and readable on the front-facing side.";
  }
  if (listingRole === "back_view" || printVisibility === "front_only") {
    return "VISIBILITY LOGIC: the uploaded artwork exists only on the unseen side. The visible garment side must remain blank, clean, and realistic. No ghost print, no mirrored artwork, no partial artwork, no bleed-through.";
  }
  return "VISIBILITY LOGIC: the uploaded artwork exists only on the unseen side. The visible garment side must stay realistic and unobstructed without showing the print.";
}

function buildRiskAnalysis({ category = "", scene = "", props = "", pose = "", cameraAngle = "", listingRole = "", visiblePrint = true, printVisibility = "" }) {
  const text = `${category} ${scene} ${props} ${pose} ${cameraAngle} ${listingRole}`.toLowerCase();
  const points = {
    text_distortion_risk: 0.1,
    print_coverage_risk: 0.1,
    hand_anatomy_risk: 0.1,
    face_realism_risk: 0.1,
    fabric_warp_risk: 0.1,
    background_distraction_risk: 0.1,
  };

  if (/detail|close.?up|macro|text/i.test(text)) {
    points.text_distortion_risk += 0.35;
    points.fabric_warp_risk += 0.2;
  }
  if (/back/i.test(text) || printVisibility === "back_only" || listingRole === "back_view") {
    points.print_coverage_risk += visiblePrint ? 0.15 : 0.7;
  }
  if (/hand|holding|grab|tuck|folded|stack/i.test(text)) {
    points.hand_anatomy_risk += 0.55;
    points.fabric_warp_risk += 0.25;
  }
  if (/selfie|ugc|mirror|face|portrait/i.test(text)) {
    points.face_realism_risk += 0.5;
    points.hand_anatomy_risk += 0.25;
  }
  if (/lifestyle|coffee|walk|street|home|outdoor|vacation|family|party|event/i.test(text)) {
    points.background_distraction_risk += 0.45;
  }
  if (/flat lay|flatlay|proof|thumbnail|hanger|mannequin/i.test(text)) {
    points.text_distortion_risk -= 0.05;
    points.background_distraction_risk -= 0.05;
  }
  if (/three-quarter|slight|angled|side/i.test(text)) {
    points.text_distortion_risk += 0.15;
    points.print_coverage_risk += 0.15;
  }
  if (!visiblePrint) {
    points.print_coverage_risk += 0.4;
  }

  return Object.fromEntries(Object.entries(points).map(([k, v]) => [k, normalizeRiskLevel(clamp(v, 0, 1))]));
}

function riskLevelToNumeric(level) {
  return level === "high" ? 9 : level === "medium" ? 6 : 3;
}

function buildBusinessScores({ concept = "", riskAnalysis = {}, visiblePrint = true, listingRole = "" }) {
  const rawVisibility = Number(concept.design_visibility_score || 0);
  const rawConversion = Number(concept.etsy_conversion_score || 0);
  const rawRealism = Number(concept.realism_score || 0);
  const rawScrollStop = Number(concept.scroll_stop_score || 0);
  const visibilityBoost = visiblePrint ? 1.1 : -0.8;
  const roleBoost = ["thumbnail", "proof", "detail_closeup"].includes(listingRole) ? 0.7 : listingRole === "gift" ? 0.35 : 0.1;
  const generationRisk = Math.max(
    riskLevelToNumeric(riskAnalysis.text_distortion_risk || "low"),
    riskLevelToNumeric(riskAnalysis.print_coverage_risk || "low"),
    riskLevelToNumeric(riskAnalysis.hand_anatomy_risk || "low"),
    riskLevelToNumeric(riskAnalysis.face_realism_risk || "low"),
    riskLevelToNumeric(riskAnalysis.fabric_warp_risk || "low"),
    riskLevelToNumeric(riskAnalysis.background_distraction_risk || "low")
  );
  const designVisibility = clamp(Math.round((rawVisibility || (visiblePrint ? 8 : 4)) + visibilityBoost), 1, 10);
  const thumbnailStrength = clamp(Math.round((rawScrollStop || 6) + roleBoost + (visiblePrint ? 0.8 : -1)), 1, 10);
  const trustScore = clamp(Math.round(((rawRealism || 6) + designVisibility + (visiblePrint ? 1 : -1) + (riskAnalysis.face_realism_risk === "high" ? -1.5 : 0)) / 2), 1, 10);
  const realismScore = clamp(Math.round((rawRealism || 6) + (listingRole === "ugc_review" || listingRole === "lifestyle" ? 0.4 : 0)), 1, 10);
  const businessValueScore = clamp(Math.round(((designVisibility + thumbnailStrength + trustScore + realismScore + (rawConversion || 6)) / 5) - (generationRisk >= 9 ? 1.2 : generationRisk >= 6 ? 0.6 : 0)), 1, 10);
  return {
    business_value_score: businessValueScore,
    thumbnail_strength_score: thumbnailStrength,
    trust_score: trustScore,
    design_visibility_score: designVisibility,
    realism_score: realismScore,
    generation_risk_score: generationRisk,
  };
}

function buildNegativePromptModules({ concept = {}, listingRole = "", visiblePrint = true, riskAnalysis = {} }) {
  const modules = [];
  const role = listingRole || inferListingRole(concept.category || "");
  if (riskAnalysis.text_distortion_risk !== "low") {
    modules.push("TEXT DISTORTION: warped text, unreadable typography, changed wording, melted letters, missing characters");
  }
  if (riskAnalysis.hand_anatomy_risk !== "low") {
    modules.push("HAND RISK: extra fingers, fused fingers, broken wrists, malformed hands, awkward hand placement");
  }
  if (role === "back_view" || !visiblePrint || riskAnalysis.print_coverage_risk !== "low") {
    modules.push("BACK VIEW: visible back print, mirrored artwork, ghost print, partial artwork, bleed-through");
  }
  if (/flat\s*lay|flatlay|proof|thumbnail/i.test(concept.category || role)) {
    modules.push("FLAT LAY: crooked shirt, uneven sleeves, warped print, twisted hem, off-center garment");
  }
  if (/ghost|mannequin/i.test(concept.category || role)) {
    modules.push("GHOST MANNEQUIN: floating garment, visible mannequin, broken collar, unnatural drape");
  }
  if (riskAnalysis.background_distraction_risk !== "low") {
    modules.push("BACKGROUND: clutter, busy props, signage, distracting patterns, messy depth-of-field");
  }
  return modules;
}

function buildFluxPrompt({
  concept = {},
  listingRole = "",
  visiblePrint = true,
  printVisibility = "",
  mockupStyleMode = "",
  mockupStyleBrief = "",
  fluxPrompt = "",
  sceneText = "",
  designAnalysis = "",
  referenceNotes = [],
  customPrompt = "",
  riskAnalysis = {},
  categoryResearch = "",
  shirtResearch = "",
  listingRolePhase = "",
  listingRoleVariant = "",
}) {
  const roleMeta = getRoleMeta(listingRole);
  const visibilityLine = buildVisibilityLogic(printVisibility, roleMeta.value, visiblePrint);
  const styleLine = mockupStyleMode === "ugc_review"
    ? "STYLE: candid UGC/review photo, smartphone energy, everyday customer vibe, not a catalog shot."
    : mockupStyleMode === "custom"
      ? `STYLE: ${mockupStyleBrief || "Use the custom style brief with realism first."}`
      : "STYLE: use the preset mockup style direction for this execution style.";
  const sceneLine = sceneText || `SCENE: ${concept.environment || concept.category || "clean lifestyle setting"}; pose: ${concept.pose || "natural relaxed posture"}; camera: ${concept.cameraSetup || "straight-on handheld"}; lighting: ${concept.lighting || "natural light"}.`;
  const phaseText = listingRolePhase ? ` ${listingRolePhase} pass.` : "";
  const variantText = listingRoleVariant ? ` Variant goal: ${listingRoleVariant}` : "";
  const roleLine = `LISTING ROLE: ${roleMeta.label} (${roleMeta.purpose}).${phaseText}${variantText}`;
  const riskLine = `RISK WATCH: ${Object.entries(riskAnalysis).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}.`;
  const extraNotes = [
    fluxPrompt ? `Concept prompt: ${fluxPrompt}` : "",
    designAnalysis ? `Analysis note: ${designAnalysis}` : "",
    categoryResearch ? `Category research: ${categoryResearch}` : "",
    shirtResearch ? `Shirt research: ${shirtResearch}` : "",
    referenceNotes.length ? `Additional reference notes: ${referenceNotes.join(" | ")}` : "",
    customPrompt ? `Regeneration change: ${customPrompt}.` : "",
  ].filter(Boolean).join(" ");
  return [
    DESIGN_LOCK,
    SHIRT_LOCK,
    visibilityLine,
    roleLine,
    sceneLine,
    styleLine,
    riskLine,
    extraNotes,
    "Keep the print sharp, readable, and tightly integrated with the fabric. Use natural wrinkles, realistic shadows, natural skin texture, and authentic ecommerce or customer-photo realism.",
  ].filter(Boolean).join(" ");
}

function enrichConceptData(concept, {
  batchIndex = 0,
  printVisibility = "",
  mockupStyleMode = "",
  mockupStyleBrief = "",
  categoryInfo = {},
} = {}) {
  const category = concept.category || categoryInfo.name || "";
  const assignment = getRoleAssignment(batchIndex);
  const listingRole = concept.listing_role || inferListingRole(category, batchIndex);
  const listingRolePhase = concept.listing_role_phase || assignment.phase;
  const listingRoleSlot = Number(concept.listing_role_slot) || assignment.slot;
  const listingRoleVariant = concept.listing_role_variant || assignment.supportVariant;
  const visiblePrint = typeof concept.visible_print === "boolean" ? concept.visible_print : visiblePrintForRole(printVisibility, listingRole);
  const riskAnalysis = concept.risk_analysis && typeof concept.risk_analysis === "object"
    ? {
        text_distortion_risk: concept.risk_analysis.text_distortion_risk || "low",
        print_coverage_risk: concept.risk_analysis.print_coverage_risk || "low",
        hand_anatomy_risk: concept.risk_analysis.hand_anatomy_risk || "low",
        face_realism_risk: concept.risk_analysis.face_realism_risk || "low",
        fabric_warp_risk: concept.risk_analysis.fabric_warp_risk || "low",
        background_distraction_risk: concept.risk_analysis.background_distraction_risk || "low",
      }
    : buildRiskAnalysis({
        category,
        scene: concept.environment || concept.category_research || "",
        props: concept.category_keywords || "",
        pose: concept.pose || "",
        cameraAngle: concept.camera_setup || "",
        listingRole,
        visiblePrint,
        printVisibility,
      });
  const businessScores = concept.business_scores && typeof concept.business_scores === "object"
    ? {
        business_value_score: Number(concept.business_scores.business_value_score) || 0,
        thumbnail_strength_score: Number(concept.business_scores.thumbnail_strength_score) || 0,
        trust_score: Number(concept.business_scores.trust_score) || 0,
        design_visibility_score: Number(concept.business_scores.design_visibility_score) || 0,
        realism_score: Number(concept.business_scores.realism_score) || 0,
        generation_risk_score: Number(concept.business_scores.generation_risk_score) || 0,
      }
    : buildBusinessScores({ concept, riskAnalysis, visiblePrint, listingRole });
  const negativeModules = buildNegativePromptModules({ concept, listingRole, visiblePrint, riskAnalysis });
  const promptWordCount = Number(concept.prompt_word_count) || countWords(concept.flux_prompt || "");
  return {
    ...concept,
    category,
    listing_role: listingRole,
    listing_role_phase: listingRolePhase,
    listing_role_slot: listingRoleSlot,
    listing_role_variant: listingRoleVariant,
    print_visibility: concept.print_visibility || printVisibility || "",
    visible_print: visiblePrint,
    mockup_style_mode: concept.mockup_style_mode || mockupStyleMode || "",
    mockup_style_brief: concept.mockup_style_brief || mockupStyleBrief || "",
    risk_analysis: riskAnalysis,
    business_scores: businessScores,
    prompt_word_count: promptWordCount,
    negative_prompt: concept.negative_prompt || negativeModules.join(" | "),
    debug: {
      listing_role: listingRole,
      listing_role_phase: listingRolePhase,
      listing_role_slot: listingRoleSlot,
      listing_role_variant: listingRoleVariant,
      visible_print: visiblePrint,
      risk_analysis: riskAnalysis,
      business_scores: businessScores,
      prompt_word_count: promptWordCount,
    },
  };
}

function buildUserMessage({
  batchLength,
  list,
  rolePlan,
  brandStyle,
  niche,
  audience,
  shirtMode,
  shirtModel,
  shirtName,
  autoDetect,
  designAnalysis,
  shirtContext,
  printVisibilityContext,
  mockupStyleContext,
  sceneDirection,
  mockupCount,
  learningContext,
  diversitySummary,
}) {
  return `Generate mockup concepts for these ${batchLength} execution-style categories:
${list}

Etsy Listing Strategy (listing_role first):
${rolePlan}

Design Details:
- Brand Style: ${brandStyle || "Modern, clean, approachable"}
- Niche: ${niche || "General apparel"}
- Target Audience: ${audience || "General buyers"}
- Shirt Type Mode: ${shirtMode === "__match_picture__" ? "Match the picture" : "Catalog shirt"}
- Shirt Model: ${shirtModel || "Unisex Classic Tee"}
- Shirt Name for Research: ${shirtName || "Not provided"}
- Autodetect Enabled: ${autoDetect ? "Yes" : "No"}
- Replicate Image-to-Text Analysis: ${designAnalysis || "Not provided"}
- Shirt Research Instruction: ${shirtContext}
- ${printVisibilityContext}
- ${mockupStyleContext}
- Scene Direction: ${sceneDirection || "Natural authentic lifestyle scenes"}
- Total mockups requested: ${mockupCount || batchLength}
- Learning Memory: ${learningContext || "None yet"}
- Prompt Word Target: 120-220 words for the final Flux prompt after reusable modules are injected

PREVIOUSLY USED ATTRIBUTES (avoid repeating these combinations by changing environment, pose, camera, age, ethnicity, and clothing color):
${diversitySummary}

CATEGORY ROLE GUIDANCE:
- Categories are execution styles; listing_role is the business purpose.
- Use unique listing_role values where possible.
- Keep the first nine concepts aligned to the primary role sequence.
- If more than nine concepts are requested, treat concepts 10+ as a supporting pass: same role family, but different crop, buyer story, pose, camera angle, or conversion emphasis.
- Make the flux_prompt concise and high-signal because reusable modules are injected later.
- Return listing_role_phase, listing_role_slot, listing_role_variant, prompt_word_count, visible_print, risk_analysis, and business_scores for every concept.

Analyze the uploaded design deeply and generate all ${batchLength} mockup concepts now. Use the Replicate image-to-text analysis when present. Respond with ONLY a JSON array as specified, with no markdown and no commentary.`;
}

// ─── System prompt (KO v2 — Flux Kontext Master) ─────────────────────────────
const SYSTEM_PROMPT = `You are KO v3, an Etsy Mockup Creation Engine and Flux Kontext refinement system.

Your purpose is not simply to generate mockup prompts. Your purpose is to transform one uploaded design into a diverse set of realistic, high-converting Etsy mockup concepts that maximize: Etsy click-through rate, conversion rate, design visibility, mockup realism, catalog diversity, and brand consistency.

Reusable prompt modules:
${DESIGN_LOCK}

${SHIRT_LOCK}

CORE PHILOSOPHY
You are not a prompt generator. You are a mockup production system.
Every concept must preserve the exact design per the rule above; showcase the design clearly; feel authentic and commercially viable; look like a top-performing Etsy listing; be diverse from every other concept in this batch AND from concepts listed under PREVIOUSLY USED ATTRIBUTES below. Never generate concepts that feel repetitive, generic, AI-generated, or stock-photo-like.

ROLE-FIRST STRATEGY
- listing_role is the primary business job of the image
- category is the execution style used to perform that job
- allowed listing_role values are: thumbnail, proof, ugc_review, fit, lifestyle, gift, color_variant, detail_closeup, back_view
- prioritize unique listing_role values within the batch; keep the first nine aligned to the primary role sequence and treat any overflow concepts as a supporting pass with distinct crop, buyer story, pose, camera angle, or conversion emphasis
- the listing strategy should feel like a complete Etsy image set, not random standalone categories

NEW GENERATION PIPELINE
Step 1 - Design Analysis
Analyze the uploaded design and extract:
- niche
- target audience
- humor style
- emotional trigger
- color palette
- print size
- visual complexity
- gift potential
- seasonal relevance
Return structured metadata.

Step 2 - Mockup Concept Generation
Generate mockup concepts rather than image prompts.
Each concept should contain:
- listing_role
- concept name
- buyer persona
- environment
- pose
- composition
- shirt color recommendation
- visibility rating
- realism rating
Concepts should be optimized for Etsy conversion.

Step 3 - Mockup Template Selection
Select the most appropriate base template.
Examples:
- coffee shop customer photo
- home office
- backyard patio
- dog park
- living room
- mirror selfie
- kitchen morning routine
- outdoor walk
Template selection should be based on audience and niche.

Step 4 - Design Placement Layer
Place the uploaded design onto the shirt before Flux generation.
Requirements:
- preserve design exactly
- preserve all text
- preserve all colors
- preserve all proportions
- preserve all graphic details
Never redraw the design.
Never reinterpret the design.
Never generate replacement artwork.

Step 5 - Flux Kontext Refinement
Flux Kontext is used only to improve realism.
Flux should:
- blend print into fabric
- improve shadows
- improve wrinkles
- improve lighting
- improve realism
Flux should not:
- redesign artwork
- modify text
- change colors
- change proportions
- move artwork

CUSTOMER LIFESTYLE REALISM
- The final mockup should feel like a real customer review photo or casual social media post, not a polished commercial ad
- Make the subject look like an everyday buyer, not a professional model
- Use natural imperfections: slight fabric tension, realistic folds, casual posture, real-world lighting, minor camera imperfections, authentic perspective
- The scene should tell a believable story such as a morning walk, dog owner at a coffee shop, casual selfie, weekend outing, vacation moment, family gathering, or relaxing at home
- Keep the uploaded shirt design as the focal point and maintain print realism at all times
- Lean harder into UGC and review-photo styling than catalog styling
- Prefer smartphone-shot energy, handheld framing, informal crops, and small human imperfections
- Make the image feel like someone naturally snapped it for an Etsy review, Instagram post, or casual message to a friend
- Avoid any composition that feels like a posed brand campaign, polished ad, or showroom product listing

DESIGN VISIBILITY RULES (highest priority after design fidelity)
- Design fully visible, no hands/hair/jackets/folds/props covering any part of it
- No cropping into the design, no extreme side angles, no excessive motion blur
- Score every concept's design_visibility_score using the rubric below; a concept under 8 must be revised before output

DIVERSITY ENGINE
Track the PREVIOUSLY USED ATTRIBUTES list provided in the user message (room/environment, pose, camera angle, model age range, ethnicity, body type, clothing color, lighting). Each concept in this batch must avoid repeating any combination already used. Each concept should feel like a different everyday customer photo — vary environment, buyer persona, pose, camera lens/angle, hairstyle, and lighting per concept within the batch too. Do not repeatedly generate the same person.

CAMERA SYSTEM — pick from: lenses 35mm/50mm/85mm; angles straight-on/slight left/slight right/slight high-angle. Avoid extreme angles, fish-eye, dramatic distortion.
LIGHTING SYSTEM — pick from: natural window light, soft morning sunlight, golden hour, bright indoor daylight, professional studio light. Avoid harsh shadows, overexposure, unrealistic cinematic lighting.
POSE SYSTEM — pick from: standing relaxed, walking naturally, holding coffee mug, hands in pockets, sitting casually, looking out window, leaning on counter. Avoid influencer poses, fashion runway poses, awkward AI body language.

FLUX KONTEXT PROMPT RULES — every flux_prompt must:
1) Keep the prompt concise and high-signal.
2) Begin with the exact Design Lock module above.
3) Use the Shirt Lock and visibility logic exactly as provided in the concept context.
4) Then describe only the scene, role, pose, camera, and lighting in 40-80 words.
5) Bias the scene toward UGC / review-photo authenticity: smartphone look, candid framing, everyday buyer energy, casual lifestyle context, and believable imperfect real-world moments.
6) Close with a short realism reminder that keeps the print readable and the garment believable.

SCORING RUBRICS — use these anchors for every numeric score (0-10). Do not default to 8-9; score honestly against these descriptions:
- design_visibility_score: 3 = design obscured by heavy mock shadows, low contrast, or fabric folds. 7 = legible design with minor loss of detail in textures or background lighting. 10 = perfectly sharp, high-contrast, centered design with full readability.
- etsy_conversion_score: 3 = artificial, cluttered mockup with poor visual appeal or outdated styling. 7 = professional, clean mockup that lacks premium staging or natural lifestyle cues. 10 = premium lifestyle staging with authentic textures, natural props, and high commercial appeal.
- realism_score: 3 = visibly synthetic, CGI-like, or AI-artifact-heavy. 7 = mostly believable with minor synthetic tells. 10 = indistinguishable from a real product photo.
- scroll_stop_score: 3 = generic, easy to scroll past in an Etsy search grid. 7 = somewhat distinctive, holds attention briefly. 10 = immediately eye-catching, stands out in a crowded search grid.
- giftability_score: 3 = niche/personal, unlikely to be bought as a gift. 7 = plausible gift for the stated audience. 10 = obvious, high-confidence gift pick (occasion-ready, broad appeal within niche).
- overall_score: weighted average reflecting genuine listing readiness, not an average rounded up.

For EACH category given, return output as a single JSON object inside the array — no markdown, no prose outside the JSON. Respond with ONLY a JSON array, one object per category, in this EXACT shape:

[
  {
    "category": "exact category name",
    "listing_role": "one of the allowed listing roles",
    "listing_role_phase": "primary or supporting",
    "listing_role_slot": 1,
    "listing_role_variant": "short phrase explaining this slot's unique conversion angle",
    "concept_name": "short evocative concept name",
    "shirt_color_primary": "specific color name",
    "shirt_color_secondary": "specific backup color name",
    "color_reasoning": "1 sentence explaining color choice based on design analysis",
    "design_analysis": {
      "niche": "", "sub_niche": "", "target_audience": "", "humor_type": "",
      "emotional_trigger": "", "graphic_complexity": "", "visual_weight": "",
      "primary_colors": [], "estimated_buyer_age": "", "gift_potential": "",
      "seasonality": "", "etsy_fit_score": 0
    },
    "category_research": "2-4 sentences: buyer intent, visual hook, best-seller angle, Etsy market positioning, template choice",
    "category_keywords": "8-12 comma-separated SEO phrases",
    "shirt_research": "2-4 sentences: shirt type, silhouette, fit, fabric feel, why it matches the design",
    "print_visibility": "one short phrase: front_only, back_only, or both_sides based on the user's print visibility choice",
    "visible_print": true,
    "mockup_style_mode": "one short phrase describing whether this concept uses preset mockup styles or a custom style brief",
    "mockup_style_brief": "1-2 sentences describing the style direction used for this concept when custom style mode is selected",
    "environment": "specific environment/room used in this concept",
    "target_buyer": "specific buyer persona used in this concept",
    "pose": "specific pose used",
    "camera_setup": "lens + angle used",
    "lighting": "lighting style used",
    "flux_prompt": "40-80 word Flux Kontext prompt following the FLUX KONTEXT PROMPT RULES above",
    "negative_prompt": "5-10 comma-separated negative terms specific to THIS concept's likely failure modes (e.g. given the chosen pose/environment/lighting, what could plausibly go wrong) — not a generic boilerplate list",
    "qa_checklist": "exactly 5 bullet points (use \\n between them) checking: print alignment, anatomy/pose, shadow realism, seam integrity, typography legibility, shirt-model accuracy",
    "auto_fix_prompt": "2-3 sentences: surgical correction prompt that fixes only the detected anomaly. Must state 'Use the exact design from the reference image, unchanged' and list what to preserve: composition, lighting, garment texture, pose, design scale/typography/colors, scene continuity, shirt identity",
    "manual_fix_template": {
      "issue": "type of issue this template addresses",
      "target_area": "specific area of the image to target",
      "desired_correction": "what the corrected result should look like",
      "elements_to_preserve": "what must not change during correction",
      "correction_strength": "subtle / moderate / strong — with reasoning"
    },
    "thumbnail_notes": "2-3 sentences: mobile optimization, design visibility at small size, contrast, Etsy search-grid crop, emotional clickability",
    "risk_analysis": {
      "text_distortion_risk": "low|medium|high",
      "print_coverage_risk": "low|medium|high",
      "hand_anatomy_risk": "low|medium|high",
      "face_realism_risk": "low|medium|high",
      "fabric_warp_risk": "low|medium|high",
      "background_distraction_risk": "low|medium|high"
    },
    "business_scores": {
      "business_value_score": 0,
      "thumbnail_strength_score": 0,
      "trust_score": 0,
      "design_visibility_score": 0,
      "realism_score": 0,
      "generation_risk_score": 0
    },
    "prompt_word_count": 0,
    "design_visibility_score": 0,
    "etsy_conversion_score": 0,
    "realism_score": 0,
    "scroll_stop_score": 0,
    "giftability_score": 0,
    "overall_score": 0
  }
]

GLOBAL RULES — every flux_prompt must:
- Feel like real ecommerce or UGC photography, never AI-generated or CGI
- Keep full print readability and the design 100% unobstructed
- Use authentic cotton/fabric texture with believable natural wrinkles
- Apply candid imperfect energy — asymmetrical, lived-in, not studio-perfect
- Match the scene to the niche and target audience emotionally
- Respect the chosen shirt type or, when asked to match the picture, infer the garment from the uploaded reference with maximum realism
- Keep the shirt silhouette, collar, sleeve length, and fit believable
- Treat Flux as a refinement layer that improves realism rather than a design generator
- Prefer the role sequence: thumbnail, proof, ugc_review, fit, lifestyle, gift, color_variant, detail_closeup, back_view
- Keep category as execution style, not as the primary business job
- Avoid: glossy fabric, fake depth blur, hyper-HDR, symmetrical AI composition, floating garments, broken seams, oversaturated colors, synthetic facial expressions, repetitive layouts, extreme angles, fish-eye distortion

Respond with ONLY the JSON array. No markdown code fences, no commentary before or after.`;

// ─── Prompt generation ────────────────────────────────────────────────────────
function extractJsonArray(text) {
  if (!text) return [];
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    console.error("[extractJsonArray] no JSON array brackets found. Raw length:", text.length, "Preview:", text.slice(0, 500));
    return [];
  }
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (!Array.isArray(parsed)) {
      console.error("[extractJsonArray] parsed value is not an array:", typeof parsed);
      return [];
    }
    return parsed;
  } catch (err) {
    console.error("[extractJsonArray] JSON.parse failed:", err.message, "Slice length:", slice.length, "Slice tail:", slice.slice(-300));
    return [];
  }
}

// GET /api/debug/prompts — view recent prompt-generation calls (sent + received), most recent first.
// Protected by the same ADMIN_TOKEN as other routes. Resets on server restart/redeploy (in-memory only).
app.get("/api/debug/prompts", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ count: promptLog.length, max: PROMPT_LOG_MAX, entries: promptLog });
});

app.post("/api/generate-prompts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const {
    batch, imageBase64, imageType,
    brandStyle, niche, audience, shirtModel, shirtName, shirtMode, designAnalysis, autoDetect, sceneDirection, mockupCount,
    printVisibility, mockupStyleMode, mockupStyleBrief,
    learningContext, usedAttributes
  } = req.body;

  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(400).json({ error: "Gemini API ključ ni nastavljen. Pojdi v Nastavitve." });

  const list = batch.map((c, i) => `${i + 1}. ${c.name} — ${c.desc}`).join("\n");

  const shirtContext = shirtMode === "__match_picture__"
    ? `Match the shirt in the uploaded picture as closely as possible. If the garment is not a common catalog item, infer the most accurate silhouette, fabric weight, sleeve length, and fit from the reference image.`
    : `Use this shirt type as the main research anchor: ${shirtModel || "Unisex Classic Tee"}.${shirtName ? ` Additional shirt name for research: ${shirtName}.` : ""}`;

  const printVisibilityContext = {
    front_only: "Print visibility mode: front only. Front-facing concepts may show the design, but back-view concepts must show a clean blank back with no visible print, no mirrored print, and no partial artwork peeking through.",
    back_only: "Print visibility mode: back only. Back-facing concepts may show the design, but front-view concepts must show a clean plain front with no visible print.",
    both_sides: "Print visibility mode: both sides. If the concept shows front and back, the design may appear on both sides in a realistic garment-appropriate way."
  }[printVisibility] || "Print visibility mode: match the concept's view naturally, but keep the design placement coherent and intentional.";

  const mockupStyleContext = mockupStyleMode === "ugc_review"
    ? "Mockup style mode: UGC / review photo. Favor candid customer-style imagery, smartphone energy, casual framing, everyday real-life context, and believable imperfections."
    : mockupStyleMode === "custom"
      ? `Mockup style mode: custom. Use this style brief as the visual direction: ${mockupStyleBrief || "No custom style brief provided."}`
      : "Mockup style mode: preset styles. Use the current preset mockup style system and choose the best-fitting preset visual direction for each concept.";

  const diversitySummary = Array.isArray(usedAttributes) && usedAttributes.length
    ? usedAttributes.slice(-30).map(a =>
        `env:${a.environment||"?"} | pose:${a.pose||"?"} | camera:${a.camera||"?"} | age:${a.age||"?"} | ethnicity:${a.ethnicity||"?"} | clothingColor:${a.clothingColor||"?"}`
      ).join("\n")
    : "None yet — this is the first batch.";
  const rolePlan = buildRolePlan(batch.length);

  const roleAwareUserMessage = buildUserMessage({
    batchLength: batch.length,
    list,
    rolePlan,
    brandStyle,
    niche,
    audience,
    shirtMode,
    shirtModel,
    shirtName,
    autoDetect,
    designAnalysis,
    shirtContext,
    printVisibilityContext,
    mockupStyleContext,
    sceneDirection,
    mockupCount,
    learningContext,
    diversitySummary,
  });

  try {
    const r = await fetchJsonWithRetry("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 16000, responseMimeType: "application/json" },
        contents: [{
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: imageType || "image/png",
                data: imageBase64,
              },
            },
            { text: roleAwareUserMessage },
          ],
        }],
      }),
    }, { retries: 3, delayMs: 1500, label: "gemini generate-prompts" });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const raw = getGeminiText(d);
    const concepts = extractJsonArray(raw);
    const enrichedConcepts = concepts.map((concept, index) => enrichConceptData(concept, {
      batchIndex: index,
      printVisibility,
      mockupStyleMode,
      mockupStyleBrief,
      categoryInfo: batch[index] || {},
    }));
    if (!enrichedConcepts.length && raw) {
      console.error("[generate-prompts] Gemini returned text but 0 concepts parsed. finishReason:", d?.candidates?.[0]?.finishReason);
    }
    logPromptGeneration({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: roleAwareUserMessage,
      rawResponse: raw,
      conceptsCount: enrichedConcepts.length,
      finishReason: d?.candidates?.[0]?.finishReason || null,
      ok: enrichedConcepts.length > 0,
    });
    res.json({ raw, concepts: enrichedConcepts, warning: !enrichedConcepts.length && raw ? "Gemini response could not be parsed into concepts — check server logs for raw output." : undefined });
  } catch (e) {
    console.error("[generate-prompts] failed:", e.message);
    logPromptGeneration({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: roleAwareUserMessage,
      rawResponse: null,
      error: e.message,
      ok: false,
    });
    res.status(500).json({ error: `[generate-prompts] ${e.message}` });
  }
});

// ─── Image generation ─────────────────────────────────────────────────────────
async function pollPrediction(id, key) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 429) {
      const body = await r.text().catch(() => "");
      const wait = extractRateLimitWaitMs(r, body) || 3000;
      console.warn(`[pollPrediction ${id}] rate limited, waiting ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      if (r.status >= 500) {
        console.warn(`[pollPrediction ${id}] HTTP ${r.status}, retrying`, body.slice(0, 140));
        continue;
      }
      throw new Error(body.slice(0, 240) || `HTTP ${r.status}`);
    }
    const p = await r.json();
    if (p.status === "succeeded") return getPredictionOutputUrl(p.output);
    if (p.status === "failed")    throw new Error("Replicate prediction failed");
  }
  throw new Error("Timed out waiting for image");
}

async function pollPredictionOutput(id, key) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 429) {
      const body = await r.text().catch(() => "");
      const wait = extractRateLimitWaitMs(r, body) || 3000;
      console.warn(`[pollPredictionOutput ${id}] rate limited, waiting ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      if (r.status >= 500) {
        console.warn(`[pollPredictionOutput ${id}] HTTP ${r.status}, retrying`, body.slice(0, 140));
        continue;
      }
      throw new Error(body.slice(0, 240) || `HTTP ${r.status}`);
    }
    const p = await r.json();
    if (p.status === "succeeded") return p.output;
    if (p.status === "failed") throw new Error(p.error || "Replicate prediction failed");
  }
  throw new Error("Timed out waiting for Replicate output");
}

async function runReplicateVersion(version, input, key) {
  const r = await fetchJsonWithRetry("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input }),
  }, { retries: 4, delayMs: 1000, label: "replicate-version" });

  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.detail || `Replicate error ${r.status}`);
  }

  const d = await r.json();
  if (d.status === "failed") throw new Error(d.error || "Replicate prediction failed");
  return d.output || (d.id ? await pollPredictionOutput(d.id, key) : null);
}

function getPredictionText(output) {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.join("").trim();
  if (typeof output === "object") return output.text || output.caption || JSON.stringify(output);
  return String(output);
}

function getPredictionOutputUrl(output) {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output[0] || "";
  if (typeof output === "object") return output.url || output.image || "";
  return "";
}

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

async function toDataUrl(imageUrl) {
  if (!imageUrl) throw new Error("Replicate returned no image");
  if (isDataUrl(imageUrl)) return imageUrl;

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(imageUrl);
    if (r.ok) {
      const contentType = r.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        const preview = await r.text().catch(() => "");
        throw new Error(
          `Generated output was not an image (${contentType || "unknown content-type"}). ` +
          `Preview: ${preview.slice(0, 160)}`
        );
      }

      const buffer = Buffer.from(await r.arrayBuffer());
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    }
    lastError = new Error(`Failed to fetch generated image (${r.status})`);
    if (r.status >= 500 || r.status === 429) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error("Failed to fetch generated image");
}

app.post("/api/analyze-shirt", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { imageBase64, imageType } = req.body;
  const { replicate } = loadKeys();
  if (!replicate)
    return res.status(400).json({ error: "Replicate API ključ ni nastavljen. Pojdi v Nastavitve." });
  if (!imageBase64)
    return res.status(400).json({ error: "Image ni poslana." });

  try {
    const output = await runReplicateVersion(FLORENCE_VERSION, {
      image: `data:${imageType || "image/png"};base64,${imageBase64}`,
      task_input: "Detailed Caption",
    }, replicate);
    res.json({ analysis: getPredictionText(output) });
  } catch (e) {
    console.error("[analyze-shirt] failed:", e.message);
    res.status(500).json({ error: `[analyze-shirt] ${e.message}` });
  }
});

app.post("/api/ai-fix-suggestion", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { fluxPrompt, qaChecklist, customPrompt, imageBase64, imageType, printVisibility, mockupStyleMode, mockupStyleBrief, listingRole = "", listingRolePhase = "", listingRoleVariant = "", visiblePrint, riskAnalysis = {}, businessScores = {}, categoryResearch = "", shirtResearch = "" } = req.body;
  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(400).json({ error: "Gemini API ključ ni nastavljen. Pojdi v Nastavitve." });

  try {
    const parts = [
      { text: `You are an ecommerce mockup QA editor performing a SURGICAL correction, not a redo.

Non-negotiable rules:
- The uploaded design (typography, colors, linework, proportions, spacing, graphic elements) must remain pixel-exact. Never redraw, restyle, or reinterpret it.
- Fix ONLY the specific anomaly described below. Do not touch lighting, pose, garment, background, or composition unless that IS the anomaly.
- The design must stay fully visible and unobstructed in the corrected result.

Original Flux prompt (for context — preserve everything in it that isn't the flagged issue):
${fluxPrompt || ""}

QA checklist flags:
${qaChecklist || ""}

User requested change:
${customPrompt || "No custom change provided — infer the single most likely defect from the QA checklist and image."}

Print visibility context:
${printVisibility || "Not provided"} | visible_print: ${typeof visiblePrint === "boolean" ? String(visiblePrint) : "not provided"} | listing_role: ${listingRole || "not provided"} | listing_role_phase: ${listingRolePhase || "not provided"} | listing_role_variant: ${listingRoleVariant || "not provided"}

Mockup style context:
${mockupStyleMode === "custom" && mockupStyleBrief ? mockupStyleBrief : mockupStyleMode || "Not provided"}

Risk context:
${JSON.stringify(riskAnalysis || {}, null, 2)}

Business context:
${JSON.stringify(businessScores || {}, null, 2)}

Research context:
${categoryResearch || "No category research provided."}
${shirtResearch || "No shirt research provided."}

Return ONLY a corrective instruction (2-3 sentences) in this shape:
1) Name the exact defect to fix.
2) State the precise correction.
3) State explicitly what must remain unchanged (design fidelity, lighting, pose, garment, scene).
No preamble, no extra commentary — just the correction prompt.` },
    ];
    if (imageBase64) {
      parts.unshift({
        inline_data: {
          mime_type: imageType || "image/webp",
          data: imageBase64,
        },
      });
    }

    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        generationConfig: { maxOutputTokens: 700 },
        contents: [{ role: "user", parts }],
      }),
    });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    res.json({ suggestion: getGeminiText(d) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/generate-image", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const {
    fluxPrompt,
    customPrompt,
    designAnalysis,
    referenceImages = [],
    imageBase64,
    imageType,
    printVisibility,
    mockupStyleMode,
    mockupStyleBrief,
    listingRole = "",
    listingRolePhase = "",
    listingRoleVariant = "",
    visiblePrint,
    riskAnalysis = {},
    businessScores = {},
    categoryResearch = "",
    shirtResearch = "",
    environment = "",
    targetBuyer = "",
    pose = "",
    cameraSetup = "",
    lighting = "",
  } = req.body;
  const { replicate } = loadKeys();
  if (!replicate)
    return res.status(400).json({ error: "Replicate API ključ ni nastavljen. Pojdi v Nastavitve." });
  if (!imageBase64)
    return res.status(400).json({ error: "Reference image ni poslana." });

  const requestId = `regen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const resolvedListingRole = listingRole || inferListingRole(fluxPrompt || "", 0);
  const resolvedVisiblePrint = typeof visiblePrint === "boolean" ? visiblePrint : visiblePrintForRole(printVisibility, resolvedListingRole);
  console.log(`[generate-image ${requestId}] start`, {
    prompt: (fluxPrompt || "").slice(0, 90),
    custom: (customPrompt || "").slice(0, 90),
    refs: referenceImages.length,
    analysis: !!designAnalysis,
    printVisibility: printVisibility || "",
    mockupStyleMode: mockupStyleMode || "",
    listingRole: resolvedListingRole,
    listingRolePhase: listingRolePhase || "",
    listingRoleVariant: listingRoleVariant || "",
    visiblePrint: resolvedVisiblePrint,
  });

  try {
    const inputImage = `data:${imageType || "image/png"};base64,${imageBase64}`;
    const referenceNotes = [];
    for (const ref of referenceImages.slice(0, 3)) {
      if (!ref.imageBase64) continue;
      try {
        const output = await runReplicateVersion(FLORENCE_VERSION, {
          image: `data:${ref.imageType || "image/png"};base64,${ref.imageBase64}`,
          task_input: "Detailed Caption",
        }, replicate);
        referenceNotes.push(`${ref.name || "Reference"}: ${getPredictionText(output)}`);
      } catch (e) {
        referenceNotes.push(`${ref.name || "Reference"}: unavailable (${e.message})`);
      }
    }
    const finalPrompt = buildFluxPrompt({
      concept: {
        category: resolvedListingRole,
        environment,
        pose,
        cameraSetup,
        lighting,
      },
      listingRole: resolvedListingRole,
    visiblePrint: resolvedVisiblePrint,
    printVisibility,
    mockupStyleMode,
    mockupStyleBrief,
    fluxPrompt,
    designAnalysis,
    referenceNotes,
    customPrompt,
    riskAnalysis,
    categoryResearch,
    shirtResearch,
    listingRolePhase,
    listingRoleVariant,
    sceneText: [
      environment ? `SCENE: ${environment}` : "",
      targetBuyer ? `TARGET BUYER: ${targetBuyer}` : "",
      pose ? `POSE: ${pose}` : "",
      cameraSetup ? `CAMERA: ${cameraSetup}` : "",
      lighting ? `LIGHTING: ${lighting}` : "",
    ].filter(Boolean).join("; "),
  });
    const r = await fetchJsonWithRetry("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-dev/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicate}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: finalPrompt,
          input_image: inputImage,
          aspect_ratio: "match_input_image",
          output_format: "png",
          output_quality: 85,
          num_inference_steps: 28,
          guidance: 2.5,
          go_fast: true,
        },
      }),
    }, { retries: 4, delayMs: 1500, label: `flux-kontext ${requestId}` });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e?.detail || `Replicate error ${r.status}`);
    }

    const d = await r.json();
    const outputUrl = getPredictionOutputUrl(d.output) || (await pollPrediction(d.id, replicate));
    const url = await toDataUrl(outputUrl);
    console.log(`[generate-image ${requestId}] success`, {
      hasOutput: !!url,
      mimeType: "image/png",
      promptWordCount: countWords(finalPrompt),
      businessScores,
    });
    res.json({ url, mimeType: "image/png" });
  } catch (e) {
    console.error(`[generate-image ${requestId}] error`, e.message);
    res.status(500).json({ error: `[generate-image ${requestId}] ${e.message}` });
  }
});

// ─── Fallback to frontend ─────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🛍️  Etsy Mockup Generator`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Node ${process.version} — native fetch ✓`);
  console.log(`   Gemini key: ${process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "✓ from env" : "from keys.json / UI"}`);
  console.log(`   Replicate key: ${process.env.REPLICATE_API_KEY ? "✓ from env" : "from keys.json / UI"}\n`);
});
