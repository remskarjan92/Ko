const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANALYTICS_HMAC_SECRET = process.env.ANALYTICS_HMAC_SECRET || "";
const ANALYTICS_SCHEMA = "analytics_private";
const ANALYTICS_RATE_WINDOW_MS = 60 * 1000;
const ANALYTICS_RATE_MAX = 30;
const ANALYTICS_MAX_PAYLOAD_BYTES = 160 * 1024;
const analyticsRateBuckets = new Map();

function analyticsConfigReady() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && ANALYTICS_HMAC_SECRET);
}

function hashInstallId(installId) {
  return crypto.createHmac("sha256", ANALYTICS_HMAC_SECRET).update(String(installId)).digest("hex");
}

function hashRateLimitKey(req) {
  const source = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  return crypto.createHash("sha256").update(String(source)).digest("hex");
}

function rateLimitAnalytics(req, res) {
  const key = hashRateLimitKey(req);
  const now = Date.now();
  const bucket = analyticsRateBuckets.get(key) || { count: 0, resetAt: now + ANALYTICS_RATE_WINDOW_MS };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + ANALYTICS_RATE_WINDOW_MS;
  }
  bucket.count += 1;
  analyticsRateBuckets.set(key, bucket);
  if (bucket.count > ANALYTICS_RATE_MAX) {
    res.status(429).json({ error: "Too many analytics requests" });
    return false;
  }
  return true;
}

function safeText(value, max = 120) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

function safeInteger(value, min = 0, max = 2147483647) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

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

const ANALYTICS_NUMERIC_METADATA_FIELDS = new Set(["latencyMs", "rating", "imageCount"]);

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
  if (!body || typeof body !== "object") return false;
  if (!Array.isArray(body.events) || body.events.length === 0) return false;
  if (body.events.length > 100) return false;
  return true;
}

module.exports = {
  ANALYTICS_SCHEMA,
  ANALYTICS_MAX_PAYLOAD_BYTES,
  analyticsConfigReady,
  hashInstallId,
  hashRateLimitKey,
  rateLimitAnalytics,
  sanitizeAnalyticsMetadata,
  validateAnalyticsBulkBody,
};
