// Requires Node.js >= 18 (native fetch — no node-fetch needed)
const express = require("express");
const path    = require("path");
const fs      = require("fs");

const app      = express();
const PORT     = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, "..", ".etsy-mockup-keys.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

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
FLUX_PROMPT: [90-120 word Flux prompt. Must feel like real ecommerce photography — authentic cotton texture, believable natural lighting, preserve uploaded design exactly, no CGI, no AI hands, no warped text, no fake bokeh, candid imperfect energy, social-media-native composition]
NEGATIVE_PROMPT: [40-50 comma-separated negative terms covering: CGI, plastic fabric, AI hands, warped text, distorted graphics, impossible shadows, fake bokeh, oversaturated colors, symmetrical composition, floating garments, broken seams, glossy fabric, hyper HDR, uncanny faces, mannequin plastic, neon lighting, overdesigned interiors]
QA_CHECKLIST: [exactly 5 bullet points checking: print alignment, anatomy/pose, shadow realism, seam integrity, typography legibility specific to this shot type]
AUTO_FIX_PROMPT: [2-3 sentences. Surgical correction prompt that preserves entire composition — only repairs detected anomaly, maintains original lighting, garment texture, pose, design scale, scene continuity]
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
- Avoid: glossy fabric, fake depth blur, hyper-HDR, symmetrical AI composition, floating garments, broken seams, oversaturated colors, synthetic facial expressions, repetitive layouts`;

// ─── Prompt generation ────────────────────────────────────────────────────────
app.post("/api/generate-prompts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const {
    batch, imageBase64, imageType,
    brandStyle, niche, audience, shirtModel, sceneDirection, mockupCount
  } = req.body;

  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(400).json({ error: "Gemini API ključ ni nastavljen. Pojdi v Nastavitve." });

  const list = batch.map((c, i) => `${i + 1}. ${c.name} — ${c.desc}`).join("\n");

  const userMessage = `Generate mockup prompts for these ${batch.length} categories:\n${list}\n\nDesign Details:\n- Brand Style: ${brandStyle || "Modern, clean, approachable"}\n- Niche: ${niche || "General apparel"}\n- Target Audience: ${audience || "General buyers"}\n- Shirt Model: ${shirtModel || "Unisex Classic Tee"}\n- Scene Direction: ${sceneDirection || "Natural authentic lifestyle scenes"}\n- Total mockups requested: ${mockupCount || batch.length}\n\nAnalyze the uploaded design carefully and generate all ${batch.length} mockup prompts now. Follow the format exactly.`;

  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 4000 },
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
    const raw = d.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") || "";
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
    if (p.status === "succeeded") return p.output?.[0];
    if (p.status === "failed")    throw new Error("Replicate prediction failed");
  }
  throw new Error("Timed out waiting for image");
}

app.post("/api/generate-image", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { fluxPrompt, imageBase64, imageType } = req.body;
  const { replicate } = loadKeys();
  if (!replicate)
    return res.status(400).json({ error: "Replicate API ključ ni nastavljen. Pojdi v Nastavitve." });
  if (!imageBase64)
    return res.status(400).json({ error: "Reference image ni poslana." });

  try {
    const inputImage = `data:${imageType || "image/png"};base64,${imageBase64}`;
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
            fluxPrompt,
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
    const url = d.output?.[0] || (await pollPrediction(d.id, replicate));
    res.json({ url });
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
