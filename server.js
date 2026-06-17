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
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "hi" }] }],
      }),
    });
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

// ─── System prompt (KO v2 — Flux Kontext Master) ─────────────────────────────
const SYSTEM_PROMPT = `You are KO, an elite Etsy POD mockup strategist and Flux Kontext optimization engine.

Your purpose is not simply to generate mockup prompts. Your purpose is to maximize: Etsy click-through rate, conversion rate, design visibility, mockup realism, catalog diversity, and brand consistency.

<design_fidelity_rule>
The uploaded image is the user's design and must be treated as fixed, pixel-exact content — never a loose style reference. Every flux_prompt you write must open with this exact non-negotiable block before any scene/photography description: "Use the exact design from the reference image. Preserve all typography, colors, linework, proportions, spacing, and graphic elements exactly as shown. Do not redraw, reinterpret, restyle, modify text, change colors, change proportions, remove elements, or add elements to the design." This rule overrides all other instructions if any conflict arises.
</design_fidelity_rule>

PRIMARY OBJECTIVE
Every concept must: preserve the exact design per the rule above; showcase the design clearly; feel authentic and commercially viable; look like a top-performing Etsy listing; be diverse from every other concept in this batch AND from concepts listed under PREVIOUSLY USED ATTRIBUTES below. Never generate concepts that feel repetitive, generic, AI-generated, or stock-photo-like.

DESIGN VISIBILITY RULES (highest priority after design fidelity)
- Design fully visible, no hands/hair/jackets/folds/props covering any part of it
- No cropping into the design, no extreme side angles, no excessive motion blur
- Score every concept's design_visibility_score using the rubric below; a concept under 8 must be revised before output

DIVERSITY ENGINE
Track the PREVIOUSLY USED ATTRIBUTES list provided in the user message (room/environment, pose, camera angle, model age range, ethnicity, body type, clothing color, lighting). Each concept in this batch must avoid repeating any combination already used. Each concept should feel like a different photoshoot — vary environment, buyer persona, pose, camera lens/angle, and lighting per concept within the batch too.

CAMERA SYSTEM — pick from: lenses 35mm/50mm/85mm; angles straight-on/slight left/slight right/slight high-angle. Avoid extreme angles, fish-eye, dramatic distortion.
LIGHTING SYSTEM — pick from: natural window light, soft morning sunlight, golden hour, bright indoor daylight, professional studio light. Avoid harsh shadows, overexposure, unrealistic cinematic lighting.
POSE SYSTEM — pick from: standing relaxed, walking naturally, holding coffee mug, hands in pockets, sitting casually, looking out window, leaning on counter. Avoid influencer poses, fashion runway poses, awkward AI body language.

FLUX KONTEXT PROMPT RULES — every flux_prompt must:
1) Open with the exact design_fidelity_rule block above.
2) Then: "Place the design naturally on a premium high-quality t-shirt." followed by model description, pose, environment, lighting, and camera setup (100-140 words total for this section).
3) Close with: "The design must remain fully visible and unobstructed. No hands covering the artwork. No hair covering the artwork. No folds obscuring important design elements. Professional Etsy bestseller mockup photography. Commercial product photography. Photorealistic. Authentic human appearance. Natural fabric texture. Realistic shadows. High-end ecommerce image."

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
    "category_research": "2-4 sentences: buyer intent, visual hook, best-seller angle, Etsy market positioning",
    "category_keywords": "8-12 comma-separated SEO phrases",
    "shirt_research": "2-4 sentences: shirt type, silhouette, fit, fabric feel, why it matches the design",
    "print_visibility": "one short phrase: front_only, back_only, or both_sides based on the user's print visibility choice",
    "mockup_style_mode": "one short phrase describing whether this concept uses preset mockup styles or a custom style brief",
    "mockup_style_brief": "1-2 sentences describing the style direction used for this concept when custom style mode is selected",
    "environment": "specific environment/room used in this concept",
    "target_buyer": "specific buyer persona used in this concept",
    "pose": "specific pose used",
    "camera_setup": "lens + angle used",
    "lighting": "lighting style used",
    "flux_prompt": "100-160 word Flux Kontext prompt following the FLUX KONTEXT PROMPT RULES above",
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

  const mockupStyleContext = mockupStyleMode === "custom"
    ? `Mockup style mode: custom. Use this style brief as the visual direction: ${mockupStyleBrief || "No custom style brief provided."}`
    : "Mockup style mode: preset styles. Use the current preset mockup style system and choose the best-fitting preset visual direction for each concept.";

  const diversitySummary = Array.isArray(usedAttributes) && usedAttributes.length
    ? usedAttributes.slice(-30).map(a =>
        `env:${a.environment||"?"} | pose:${a.pose||"?"} | camera:${a.camera||"?"} | age:${a.age||"?"} | ethnicity:${a.ethnicity||"?"} | clothingColor:${a.clothingColor||"?"}`
      ).join("\n")
    : "None yet — this is the first batch.";

  const userMessage = `Generate mockup prompts for these ${batch.length} categories:\n${list}\n\nDesign Details:\n- Brand Style: ${brandStyle || "Modern, clean, approachable"}\n- Niche: ${niche || "General apparel"}\n- Target Audience: ${audience || "General buyers"}\n- Shirt Type Mode: ${shirtMode === "__match_picture__" ? "Match the picture" : "Catalog shirt"}\n- Shirt Model: ${shirtModel || "Unisex Classic Tee"}\n- Shirt Name for Research: ${shirtName || "Not provided"}\n- Autodetect Enabled: ${autoDetect ? "Yes" : "No"}\n- Replicate Image-to-Text Analysis: ${designAnalysis || "Not provided"}\n- Shirt Research Instruction: ${shirtContext}\n- ${printVisibilityContext}\n- ${mockupStyleContext}\n- Scene Direction: ${sceneDirection || "Natural authentic lifestyle scenes"}\n- Total mockups requested: ${mockupCount || batch.length}\n- Learning Memory: ${learningContext || "None yet"}\n\nPREVIOUSLY USED ATTRIBUTES (avoid repeating these combinations — pick different environment/pose/camera/age/ethnicity/clothing color for each new concept):\n${diversitySummary}\n\nAnalyze the uploaded design deeply and generate all ${batch.length} mockup concepts now. Use the Replicate image-to-text analysis when present. Respond with ONLY a JSON array as specified — no markdown, no commentary.`;

  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
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
            { text: userMessage },
          ],
        }],
      }),
    });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const raw = getGeminiText(d);
    const concepts = extractJsonArray(raw);
    if (!concepts.length && raw) {
      console.error("[generate-prompts] Gemini returned text but 0 concepts parsed. finishReason:", d?.candidates?.[0]?.finishReason);
    }
    logPromptGeneration({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      rawResponse: raw,
      conceptsCount: concepts.length,
      finishReason: d?.candidates?.[0]?.finishReason || null,
      ok: concepts.length > 0,
    });
    res.json({ raw, concepts, warning: !concepts.length && raw ? "Gemini response could not be parsed into concepts — check server logs for raw output." : undefined });
  } catch (e) {
    logPromptGeneration({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      rawResponse: null,
      error: e.message,
      ok: false,
    });
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai-fix-suggestion", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { fluxPrompt, qaChecklist, customPrompt, imageBase64, imageType, printVisibility, mockupStyleMode, mockupStyleBrief } = req.body;
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
${printVisibility || "Not provided"}

Mockup style context:
${mockupStyleMode === "custom" && mockupStyleBrief ? mockupStyleBrief : mockupStyleMode || "Not provided"}

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
  const { fluxPrompt, customPrompt, designAnalysis, referenceImages = [], imageBase64, imageType, printVisibility, mockupStyleMode, mockupStyleBrief } = req.body;
  const { replicate } = loadKeys();
  if (!replicate)
    return res.status(400).json({ error: "Replicate API ključ ni nastavljen. Pojdi v Nastavitve." });
  if (!imageBase64)
    return res.status(400).json({ error: "Reference image ni poslana." });

  const requestId = `regen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  console.log(`[generate-image ${requestId}] start`, {
    prompt: (fluxPrompt || "").slice(0, 90),
    custom: (customPrompt || "").slice(0, 90),
    refs: referenceImages.length,
    analysis: !!designAnalysis,
    printVisibility: printVisibility || "",
    mockupStyleMode: mockupStyleMode || "",
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
    const r = await fetchJsonWithRetry("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-dev/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicate}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: [
            "Use the attached reference image as the exact source of truth for the garment design.",
            fluxPrompt,
            designAnalysis ? `Detected shirt/design analysis: ${designAnalysis}` : "",
            printVisibility === "front_only"
              ? "Print placement rule: show the print only on the front-facing side. Back-view concepts must remain blank on the back and never show the graphic."
              : printVisibility === "back_only"
                ? "Print placement rule: show the print only on the back-facing side. Front-view concepts must remain blank on the front and never show the graphic."
                : printVisibility === "both_sides"
                  ? "Print placement rule: the design may appear on both sides when the concept naturally requires it."
                  : "",
            mockupStyleMode === "custom" && mockupStyleBrief
              ? `Mockup style direction: ${mockupStyleBrief}`
              : "Mockup style direction: use the current preset mockup style system and keep the output aligned with the concept's preset visual language.",
            referenceNotes.length ? `Use these additional reference image notes for style, pose, lighting, and background only; do not replace the source garment design: ${referenceNotes.join(" | ")}` : "",
            customPrompt ? `User requested change for this regeneration: ${customPrompt}. Apply it while preserving the original design exactly.` : "",
          ].filter(Boolean).join(" "),
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
    console.log(`[generate-image ${requestId}] success`, { hasOutput: !!url, mimeType: "image/png" });
    res.json({ url, mimeType: "image/png" });
  } catch (e) {
    console.error(`[generate-image ${requestId}] error`, e.message);
    res.status(500).json({ error: e.message });
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
