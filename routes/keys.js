const { requireAdmin } = require("../middleware/auth");

function registerKeyRoutes(app, { loadKeys, saveKeys, maskKey, keySource, fetchJsonWithRetry }) {
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
}

module.exports = { registerKeyRoutes };
