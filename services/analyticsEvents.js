const ANALYTICS_COMMON_METADATA_FIELDS = [
  "generationId",
  "clientGenerationId",
  "batchId",
  "conceptId",
  "conceptFingerprint",
  "promptHash",
  "promptVersion",
  "productType",
  "listingRole",
  "category",
  "mode",
  "printVisibility",
  "provider",
  "modelName",
  "targetBuyer",
  "environment",
  "pose",
  "cameraSetup",
  "lighting",
  "shirtType",
];

const ANALYTICS_EVENT_METADATA_FIELDS = Object.fromEntries(Object.entries({
  generation_started: [...ANALYTICS_COMMON_METADATA_FIELDS, "outcome", "latencyMs"],
  generation_succeeded: [...ANALYTICS_COMMON_METADATA_FIELDS, "outcome", "latencyMs", "imageCount"],
  generation_failed: [...ANALYTICS_COMMON_METADATA_FIELDS, "outcome", "failureCode", "latencyMs", "reasonCodes"],
  rating_set: [...ANALYTICS_COMMON_METADATA_FIELDS, "rating"],
  regenerate_clicked: [...ANALYTICS_COMMON_METADATA_FIELDS, "regenerateReason", "reasonCodes"],
  ai_fix_clicked: [...ANALYTICS_COMMON_METADATA_FIELDS, "fixType", "reasonCodes"],
  download_png: [...ANALYTICS_COMMON_METADATA_FIELDS, "fileType"],
  download_zip: [...ANALYTICS_COMMON_METADATA_FIELDS, "fileType", "exportType", "imageCount"],
  export_selected: [...ANALYTICS_COMMON_METADATA_FIELDS, "exportType", "fileType", "imageCount"],
  copy_prompt: [...ANALYTICS_COMMON_METADATA_FIELDS],
  select_favorite: [...ANALYTICS_COMMON_METADATA_FIELDS],
}).map(([eventType, fields]) => [eventType, new Set(fields)]));

const ANALYTICS_NUMERIC_METADATA_FIELDS = new Set([
  "latencyMs",
  "rating",
  "imageCount",
]);

function createAnalyticsEventHelpers({
  maxEvents = 100,
  generationTypes = new Set(),
  interactionTypes = new Set(),
  safeText,
  safeInteger,
  randomUUID,
} = {}) {
  if (typeof safeText !== "function") throw new Error("safeText is required");
  if (typeof safeInteger !== "function") throw new Error("safeInteger is required");
  if (typeof randomUUID !== "function") throw new Error("randomUUID is required");

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function safePrimitiveText(value, max = 120) {
    if (!["string", "number", "boolean"].includes(typeof value)) return null;
    return safeText(value, max);
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function sanitizeAnalyticsMetadata(eventType, payload = {}) {
    const allowedFields = ANALYTICS_EVENT_METADATA_FIELDS[eventType] || new Set();
    const allowed = {};
    for (const [key, value] of Object.entries(payload || {})) {
      if (!allowedFields.has(key) || value === undefined || value === null) continue;
      if (key === "reasonCodes") {
        if (Array.isArray(value)) {
          allowed[key] = value
            .filter(item => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
            .slice(0, 10)
            .map(item => safeText(item, 80));
        }
        continue;
      }
      if (ANALYTICS_NUMERIC_METADATA_FIELDS.has(key)) {
        const n = safeInteger(value, key === "rating" ? 1 : 0, key === "rating" ? 5 : 2147483647);
        if (n !== null) allowed[key] = n;
        continue;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        allowed[key] = safeText(value, 160);
      }
    }
    return allowed;
  }

  function validateAnalyticsBulkBody(body) {
    if (!isPlainObject(body)) return false;
    if (!Array.isArray(body.events)) return false;
    if (body.events.length > maxEvents) return false;
    for (let index = 0; index < body.events.length; index += 1) {
      const event = body.events[index];
      if (!isPlainObject(event)) return false;
      const eventId = typeof event.event_id === "string" ? event.event_id : event.clientEventId;
      const installHash = typeof event.client_install_hash === "string" ? event.client_install_hash : event.installId;
      const eventType = typeof event.event_type === "string" ? event.event_type : event.eventType;
      if (typeof eventId !== "string" || !eventId.trim()) return false;
      if (typeof installHash !== "string" || !installHash.trim()) return false;
      if (typeof eventType !== "string" || !eventType.trim()) return false;
      if (!generationTypes.has(eventType) && !interactionTypes.has(eventType)) return false;
      if (event.clientEventId == null) event.clientEventId = eventId;
      if (event.eventType == null) event.eventType = eventType;
      if (event.installId == null) event.installId = installHash;
    }
    return null;
  }

  function normalizeAnalyticsEvent(event, clientInstallHash, userSession = null) {
    const eventType = safeText(event?.eventType, 80);
    if (!eventType || (!generationTypes.has(eventType) && !interactionTypes.has(eventType))) {
      return { error: "unsupported_event_type" };
    }
    if (!isUuid(event?.clientEventId)) return { error: "invalid_client_event_id" };

    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    const createdAt = Date.parse(event.createdAt) ? new Date(event.createdAt).toISOString() : new Date().toISOString();
    const metadata = sanitizeAnalyticsMetadata(eventType, payload);

    if (generationTypes.has(eventType)) {
      const outcome = eventType === "generation_succeeded" ? "succeeded" : eventType === "generation_failed" ? "failed" : "started";
      return {
        table: "generation",
        row: {
          event_id: randomUUID(),
          client_event_id: event.clientEventId,
          client_install_hash: clientInstallHash,
          user_id: userSession?.userId || null,
          batch_id: isUuid(payload.batchId) ? payload.batchId : null,
          concept_id: safePrimitiveText(payload.conceptId || payload.clientGenerationId, 80),
          design_fingerprint: safePrimitiveText(payload.conceptFingerprint, 128),
          prompt_hash: safePrimitiveText(payload.promptHash, 128),
          mode: safePrimitiveText(payload.mode, 80),
          print_visibility: safePrimitiveText(payload.printVisibility, 80),
          listing_role: safePrimitiveText(payload.listingRole, 80),
          category: safePrimitiveText(payload.category, 160),
          provider: safePrimitiveText(payload.provider, 80),
          model_name: safePrimitiveText(payload.modelName, 120),
          outcome,
          failure_code: outcome === "failed" ? safePrimitiveText(payload.failureCode, 160) : null,
          latency_ms: safeInteger(payload.latencyMs),
          metadata,
          created_at: createdAt,
        },
      };
    }

    return {
      table: "interaction",
      row: {
        event_id: randomUUID(),
        client_event_id: event.clientEventId,
        client_install_hash: clientInstallHash,
        user_id: userSession?.userId || null,
        generation_event_id: isUuid(payload.generationId) ? payload.generationId : null,
        event_type: eventType,
        rating: eventType === "rating_set" ? safeInteger(payload.rating, 1, 5) : null,
        dwell_ms: null,
        prompt_hash: safePrimitiveText(payload.promptHash, 128),
        metadata,
        created_at: createdAt,
      },
    };
  }

  return {
    isUuid,
    safePrimitiveText,
    isPlainObject,
    sanitizeAnalyticsMetadata,
    validateAnalyticsBulkBody,
    normalizeAnalyticsEvent,
  };
}

module.exports = {
  ANALYTICS_COMMON_METADATA_FIELDS,
  ANALYTICS_EVENT_METADATA_FIELDS,
  ANALYTICS_NUMERIC_METADATA_FIELDS,
  createAnalyticsEventHelpers,
};
