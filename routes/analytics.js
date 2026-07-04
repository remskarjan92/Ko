const {
  analyticsConfigReady,
  rateLimitAnalytics,
  hashInstallId,
  sanitizeAnalyticsMetadata,
  validateAnalyticsBulkBody,
  ANALYTICS_MAX_PAYLOAD_BYTES,
} = require("../services/analytics");
const { getUserSession } = require("../middleware/auth");

function registerAnalyticsRoutes(app, { supabaseRestInsertSchema }) {
  app.post("/api/analytics/events/bulk", async (req, res) => {
    const validationError = validateAnalyticsBulkBody(req.body);
    if (validationError === false) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    if (!rateLimitAnalytics(req, res)) return;
    const rawSize = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
    if (rawSize > ANALYTICS_MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: "Analytics payload too large" });
    }

    const { installId, consent, events, locale } = req.body || {};
    if (consent !== true) return res.status(403).json({ error: "Analytics consent required" });
    if (!analyticsConfigReady()) {
      return res.status(503).json({ error: "Analytics ingest is not configured" });
    }

    const clientInstallHash = hashInstallId(installId);
    const userSession = getUserSession(req);
    const generationRows = [];
    const interactionRows = [];
    const rejected = [];
    const seenClientEventIds = new Set();

    events.forEach((event, index) => {
      if (!event || typeof event !== "object") return;
      const eventId = String(event.event_id || event.id || `${Date.now()}-${index}`);
      if (seenClientEventIds.has(eventId)) return;
      seenClientEventIds.add(eventId);
      const eventType = String(event.event_type || "").trim();
      const createdAt = event.created_at || new Date().toISOString();
      const metadata = sanitizeAnalyticsMetadata(eventType, event.metadata || {});
      const base = {
        client_install_hash: clientInstallHash,
        user_id: userSession?.userId || null,
        generation_event_id: null,
        event_type: eventType,
        rating: eventType === "rating_set" ? Number(event.rating || metadata.rating || 0) || null : null,
        dwell_ms: null,
        prompt_hash: String(event.prompt_hash || metadata.promptHash || ""),
        metadata,
        created_at: createdAt,
      };
      if (eventType === "generation_started" || eventType === "generation_succeeded" || eventType === "generation_failed") {
        generationRows.push({
          ...base,
          generation_event_id: event.generation_id || null,
        });
      } else {
        interactionRows.push(base);
      }
    });

    try {
      if (generationRows.length) await supabaseRestInsertSchema("analytics_private", "generation_events", generationRows);
      if (interactionRows.length) await supabaseRestInsertSchema("analytics_private", "interaction_events", interactionRows);
      res.json({ ok: true, inserted: generationRows.length + interactionRows.length, rejected });
    } catch (e) {
      console.error("[analytics ingest] failed:", e.message);
      res.status(502).json({ error: "Analytics ingest failed" });
    }
  });
}

module.exports = { registerAnalyticsRoutes };
