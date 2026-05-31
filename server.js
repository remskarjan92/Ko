// Requires Node.js >= 18 (native fetch — no node-fetch needed)
const express = require("express");
const path    = require("path");
const fs      = require("fs");

const app      = express();
const PORT     = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, "keys.json");

app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── Key storage ──────────────────────────────────────────────────────────────
// Priority: environment variables > keys.json (fallback for local dev)
function loadKeys() {
  const envKeys = {
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    replicate: process.env.REPLICATE_API_KEY || "",
  };
  // If both env vars are set, use them directly
  if (envKeys.anthropic && envKeys.replicate) return envKeys;
  // Otherwise merge with any saved keys (local dev fallback)
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      return {
        anthropic: envKeys.anthropic || saved.anthropic || "",
        replicate: envKeys.replicate || saved.replicate || "",
      };
    }
  } catch {}
  return envKeys;
}

function saveKeys(keys) {
  // On Railway, env vars take priority — saving to file is a no-op for those
  const toSave = {
    anthropic: process.env.ANTHROPIC_API_KEY ? "" : keys.anthropic,
    replicate: process.env.REPLICATE_API_KEY ? "" : keys.replicate,
  };
  try { fs.writeFileSync(KEYS_FILE, JSON.stringify(toSave, null, 2)); } catch {}
}

function maskKey(k) {
  if (!k || k.length < 12) return k ? "••••••••" : "";
  return k.slice(0, 8) + "•".repeat(k.length - 12) + k.slice(-4);
}

// ─── Key management ───────────────────────────────────────────────────────────
app.get("/api/keys", (req, res) => {
  const keys = loadKeys();
  res.json({
    anthropic: {
      set: !!keys.anthropic,
      masked: maskKey(keys.anthropic),
      fromEnv: !!process.env.ANTHROPIC_API_KEY,
    },
    replicate: {
      set: !!keys.replicate,
      masked: maskKey(keys.replicate),
      fromEnv: !!process.env.REPLICATE_API_KEY,
    },
  });
});

app.post("/api/keys", (req, res) => {
  const { anthropic, replicate } = req.body;
  const current = loadKeys();
  saveKeys({
    anthropic: anthropic !== undefined ? anthropic : current.anthropic,
    replicate: replicate !== undefined ? replicate : current.replicate,
  });
  res.json({ ok: true, message: "Keys saved." });
});

app.delete("/api/keys/:type", (req, res) => {
  const { type } = req.params;
  if (!["anthropic", "replicate"].includes(type))
    return res.status(400).json({ error: "Invalid key type" });
  const keys = loadKeys();
  keys[type] = "";
  saveKeys(keys);
  res.json({ ok: true, message: `${type} key deleted.` });
});

// ─── Connection tests ─────────────────────────────────────────────────────────
app.post("/api/test/anthropic", async (req, res) => {
  const { anthropic } = loadKeys();
  if (!anthropic) return res.json({ ok: false, message: "Ključ ni nastavljen." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropic,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    res.json({ ok: true, message: "Povezava uspešna ✓" });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

app.post("/api/test/replicate", async (req, res) => {
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
  const {
    batch, imageBase64, imageType,
    brandStyle, niche, audience, shirtModel, sceneDirection, mockupCount
  } = req.body;

  const { anthropic } = loadKeys();
  if (!anthropic)
    return res.status(400).json({ error: "Anthropic API ključ ni nastavljen. Pojdi v Nastavitve." });

  const list = batch.map((c, i) => `${i + 1}. ${c.name} — ${c.desc}`).join("\n");

  const userMessage = `Generate mockup prompts for these ${batch.length} categories:\n${list}\n\nDesign Details:\n- Brand Style: ${brandStyle || "Modern, clean, approachable"}\n- Niche: ${niche || "General apparel"}\n- Target Audience: ${audience || "General buyers"}\n- Shirt Model: ${shirtModel || "Unisex Classic Tee"}\n- Scene Direction: ${sceneDirection || "Natural authentic lifestyle scenes"}\n- Total mockups requested: ${mockupCount || batch.length}\n\nAnalyze the uploaded design carefully and generate all ${batch.length} mockup prompts now. Follow the format exactly.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropic,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: imageType || "image/png", data: imageBase64 },
            },
            { type: "text", text: userMessage },
          ],
        }],
      }),
    });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    res.json({ raw: d.content?.map(b => b.text || "").join("\n") || "" });
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
  const { fluxPrompt } = req.body;
  const { replicate } = loadKeys();
  if (!replicate)
    return res.status(400).json({ error: "Replicate API ključ ni nastavljen. Pojdi v Nastavitve." });

  try {
    const r = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicate}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: fluxPrompt,
          num_outputs: 1,
          aspect_ratio: "1:1",
          output_format: "webp",
          output_quality: 85,
          num_inference_steps: 4,
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
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🛍️  Etsy Mockup Generator`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Node ${process.version} — native fetch ✓`);
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? "✓ from env" : "from keys.json / UI"}`);
  console.log(`   Replicate key: ${process.env.REPLICATE_API_KEY ? "✓ from env" : "from keys.json / UI"}\n`);
});
