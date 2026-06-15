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

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an elite Etsy mockup production architect specializing in high-converting apparel mockups.

Analyze the uploaded graphic design carefully — note its colors, style, mood, typography, and theme. Use these observations to select optimal shirt colors, scenes, and styling for maximum Etsy conversion.

You must think like: top Etsy apparel sellers, fashion product photographers, conversion-focused creative directors, realistic textile rendering specialists, and ecommerce thumbnail optimizers.

For EACH of the categories given, return output in this EXACT format with NO deviations:

---MOCKUP_START---
CATEGORY: [exact category name]
SHIRT_COLOR_PRIMARY: [specific color name]
SHIRT_COLOR_SECONDARY: [specific backup color name]
COLOR_REASONING: [1 sentence explaining color choice based on design analysis]
CATEGORY_RESEARCH: [2-4 sentences. Deep category analysis covering buyer intent, visual hook, best-seller angle, and how this design should be positioned in the Etsy market.]
CATEGORY_KEYWORDS: [8-12 comma-separated SEO phrases that match the niche, audience, and style]
SHIRT_RESEARCH: [2-4 sentences. Explain the shirt type, silhouette, fit, fabric feel, and why it best matches the uploaded design and reference garment.]
FLUX_PROMPT: [100-140 word Flux prompt. Must feel like real ecommerce photography — authentic cotton texture, believable natural lighting, preserve uploaded design exactly, no CGI, no AI hands, no warped text, no fake bokeh, candid imperfect energy, social-media-native composition, and clearly respect the chosen shirt type/research.]
NEGATIVE_PROMPT: [40-50 comma-separated negative terms covering: CGI, plastic fabric, AI hands, warped text, distorted graphics, impossible shadows, fake bokeh, oversaturated colors, symmetrical composition, floating garments, broken seams, glossy fabric, hyper HDR, uncanny faces, mannequin plastic, neon lighting, overdesigned interiors, generic shirt mislabeling, incorrect garment silhouette]
QA_CHECKLIST: [exactly 5 bullet points checking: print alignment, anatomy/pose, shadow realism, seam integrity, typography legibility, and shirt-model accuracy specific to this shot type]
AUTO_FIX_PROMPT: [2-3 sentences. Surgical correction prompt that preserves entire composition — only repairs detected anomaly, maintains original lighting, garment texture, pose, design scale, scene continuity, and shirt identity]
MANUAL_FIX_TEMPLATE:
Issue: [describe the type of issue this template addresses]
Target Area: [specific area of the image to target]
Desired Correction: [what the corrected result should look like]
Elements To Preserve: [list what must not change during correction]
Correction Strength: [subtle / moderate / strong — with reasoning]
THUMBNAIL_NOTES: [2-3 sentences on mobile optimization: design visibility at small size, contrast level, composition crop for Etsy search grid, emotional clickability]
---MOCKUP_END---

GLOBAL RULES — every FLUX_PROMPT must:
- Feel like real ecommerce or UGC photography, never AI-generated or CGI
- Preserve the uploaded design exactly with full print readability
- Use authentic cotton/fabric texture with believable natural wrinkles
- Apply candid imperfect energy — asymmetrical, lived-in, not studio-perfect
- Match the scene to the niche and target audience emotionally
- Respect the chosen shirt type or, when asked to match the picture, infer the garment from the uploaded reference with maximum realism
- Keep the shirt silhouette, collar, sleeve length, and fit believable for the named garment
- Avoid: glossy fabric, fake depth blur, hyper-HDR, symmetrical AI composition, floating garments, broken seams, oversaturated colors, synthetic facial expressions, repetitive layouts`;

// ─── Prompt generation ────────────────────────────────────────────────────────
app.post("/api/generate-prompts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const {
    batch, imageBase64, imageType,
    brandStyle, niche, audience, shirtModel, shirtName, shirtMode, designAnalysis, autoDetect, sceneDirection, mockupCount
  } = req.body;

  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(400).json({ error: "Gemini API ključ ni nastavljen. Pojdi v Nastavitve." });

  const list = batch.map((c, i) => `${i + 1}. ${c.name} — ${c.desc}`).join("\n");

  const shirtContext = shirtMode === "__match_picture__"
    ? `Match the shirt in the uploaded picture as closely as possible. If the garment is not a common catalog item, infer the most accurate silhouette, fabric weight, sleeve length, and fit from the reference image.`
    : `Use this shirt type as the main research anchor: ${shirtModel || "Unisex Classic Tee"}.${shirtName ? ` Additional shirt name for research: ${shirtName}.` : ""}`;

  const userMessage = `Generate mockup prompts for these ${batch.length} categories:\n${list}\n\nDesign Details:\n- Brand Style: ${brandStyle || "Modern, clean, approachable"}\n- Niche: ${niche || "General apparel"}\n- Target Audience: ${audience || "General buyers"}\n- Shirt Type Mode: ${shirtMode === "__match_picture__" ? "Match the picture" : "Catalog shirt"}\n- Shirt Model: ${shirtModel || "Unisex Classic Tee"}\n- Shirt Name for Research: ${shirtName || "Not provided"}\n- Autodetect Enabled: ${autoDetect ? "Yes" : "No"}\n- Replicate Image-to-Text Analysis: ${designAnalysis || "Not provided"}\n- Shirt Research Instruction: ${shirtContext}\n- Scene Direction: ${sceneDirection || "Natural authentic lifestyle scenes"}\n- Total mockups requested: ${mockupCount || batch.length}\n\nAnalyze the uploaded design deeply and generate all ${batch.length} mockup prompts now. Use the Replicate image-to-text analysis when present. Do category research first, then shirt research, then write the prompt outputs. Follow the format exactly.`;

  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 8000 },
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
    res.json({ raw });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Image generation ─────────────────────────────────────────────────────────
async function pollPrediction(id, key) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const p = await (await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
    })).json();
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
    const p = await r.json();
    if (p.status === "succeeded") return p.output;
    if (p.status === "failed") throw new Error(p.error || "Replicate prediction failed");
  }
  throw new Error("Timed out waiting for Replicate output");
}

async function runReplicateVersion(version, input, key) {
  const r = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input }),
  });

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

  const r = await fetch(imageUrl);
  if (!r.ok) {
    throw new Error(`Failed to fetch generated image (${r.status})`);
  }

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
      task_input: "<DETAILED_CAPTION>",
    }, replicate);
    res.json({ analysis: getPredictionText(output) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai-fix-suggestion", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { fluxPrompt, qaChecklist, customPrompt, imageBase64, imageType } = req.body;
  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(400).json({ error: "Gemini API ključ ni nastavljen. Pojdi v Nastavitve." });

  try {
    const parts = [
      { text: `You are an ecommerce mockup QA editor. Suggest one concise corrective prompt for regenerating this mockup. Preserve the garment design exactly.\n\nOriginal Flux prompt:\n${fluxPrompt || ""}\n\nQA checklist:\n${qaChecklist || ""}\n\nUser requested change:\n${customPrompt || "No custom change provided."}\n\nReturn only the improved correction prompt, 1-3 sentences.` },
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
  const { fluxPrompt, customPrompt, designAnalysis, referenceImages = [], imageBase64, imageType } = req.body;
  const { replicate } = loadKeys();
  if (!replicate)
    return res.status(400).json({ error: "Replicate API ključ ni nastavljen. Pojdi v Nastavitve." });
  if (!imageBase64)
    return res.status(400).json({ error: "Reference image ni poslana." });

  try {
    const inputImage = `data:${imageType || "image/png"};base64,${imageBase64}`;
    const referenceNotes = [];
    for (const ref of referenceImages.slice(0, 3)) {
      if (!ref.imageBase64) continue;
      try {
        const output = await runReplicateVersion(FLORENCE_VERSION, {
          image: `data:${ref.imageType || "image/png"};base64,${ref.imageBase64}`,
          task_input: "<DETAILED_CAPTION>",
        }, replicate);
        referenceNotes.push(`${ref.name || "Reference"}: ${getPredictionText(output)}`);
      } catch (e) {
        referenceNotes.push(`${ref.name || "Reference"}: unavailable (${e.message})`);
      }
    }
    const r = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-dev/predictions", {
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
            "Preserve the artwork, typography, logo shapes, line weights, print placement, scale, spacing, and colors exactly as shown.",
            "Do not reinterpret, simplify, redraw, or stylize the design.",
            "The printed design must remain crisp, legible, and centered as a faithful product mockup, with no warping, cropping, spelling changes, or layout drift.",
            designAnalysis ? `Detected shirt/design analysis: ${designAnalysis}` : "",
            referenceNotes.length ? `Use these additional reference image notes for style, pose, lighting, and background only; do not replace the source garment design: ${referenceNotes.join(" | ")}` : "",
            fluxPrompt,
            customPrompt ? `User requested change for this regeneration: ${customPrompt}. Apply it while preserving the original design exactly.` : "",
          ].join(" "),
          input_image: inputImage,
          aspect_ratio: "match_input_image",
          output_format: "webp",
          output_quality: 85,
          num_inference_steps: 28,
          guidance: 2.5,
          go_fast: true,
        },
      }),
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e?.detail || `Replicate error ${r.status}`);
    }

    const d = await r.json();
    const outputUrl = getPredictionOutputUrl(d.output) || (await pollPrediction(d.id, replicate));
    const url = await toDataUrl(outputUrl);
    res.json({ url, mimeType: "image/webp" });
  } catch (e) {
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
