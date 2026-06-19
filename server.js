// Requires Node.js >= 18 (native fetch — no node-fetch needed)
const express = require("express");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");
const pkg     = require("./package.json");

const app      = express();
const PORT     = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, "..", ".etsy-mockup-keys.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const APP_ACCESS_TOKEN = process.env.APP_ACCESS_TOKEN || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";
const ADMIN_SESSION_COOKIE = "ko_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_LOGIN_RATE_WINDOW_MS = 60 * 1000;
const ADMIN_LOGIN_RATE_MAX = 8;
const FLORENCE_VERSION = "da53547e17d45b9cfb48174b2f18af8b83ca020fa76db62136bf9c6616762595";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANALYTICS_HMAC_SECRET = process.env.ANALYTICS_HMAC_SECRET || "";
const ANALYTICS_SCHEMA = "analytics_private";
const ANALYTICS_MAX_EVENTS = 100;
const ANALYTICS_MAX_PAYLOAD_BYTES = 160 * 1024;
const ANALYTICS_RATE_WINDOW_MS = 60 * 1000;
const ANALYTICS_RATE_MAX = 30;
const ADMIN_ANALYTICS_CACHE_MS = 45 * 1000;
const LEARNING_MIN_SAMPLES = Number(process.env.LEARNING_MIN_SAMPLES || 5);
const LEARNING_REFRESH_TTL_MS = Number(process.env.LEARNING_REFRESH_TTL_MS || 15 * 60 * 1000);
const RESEARCH_EXPORT_MAX_ROWS = Number(process.env.RESEARCH_EXPORT_MAX_ROWS || 5000);
const ANALYTICS_GENERATION_TYPES = new Set(["generation_started", "generation_succeeded", "generation_failed"]);
const ANALYTICS_INTERACTION_TYPES = new Set(["rating_set", "regenerate_clicked", "ai_fix_clicked", "download_png", "download_zip", "export_selected", "copy_prompt", "select_favorite"]);
const analyticsRateBuckets = new Map();
const adminAnalyticsCache = new Map();
const adminLoginRateBuckets = new Map();

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

function parseCookies(req) {
  const header = req.get("cookie") || "";
  return Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    if (index === -1) return null;
    const key = decodeURIComponent(part.slice(0, index).trim());
    const value = decodeURIComponent(part.slice(index + 1).trim());
    return [key, value];
  }).filter(Boolean));
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function adminSessionConfigured() {
  return !!(ADMIN_USERNAME && ADMIN_PASSWORD_HASH && ADMIN_SESSION_SECRET);
}

function signAdminSession(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyAdminSessionToken(token) {
  if (!adminSessionConfigured() || !token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(body).digest("base64url");
  if (!timingSafeEqualString(sig, expected)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (payload?.role !== "admin") return null;
    if (payload?.username !== ADMIN_USERNAME) return null;
    if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getAdminSession(req) {
  return verifyAdminSessionToken(parseCookies(req)[ADMIN_SESSION_COOKIE]);
}

function adminCookieParts(maxAgeMs = ADMIN_SESSION_TTL_MS) {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts;
}

function setAdminSessionCookie(res, username) {
  const token = signAdminSession({
    role: "admin",
    username,
    iat: Date.now(),
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  });
  res.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; ${adminCookieParts().join("; ")}`);
}

function clearAdminSessionCookie(res) {
  res.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; ${adminCookieParts(0).join("; ")}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function verifyAdminPassword(password) {
  const [scheme, iterationsRaw, saltHex, hashHex] = String(ADMIN_PASSWORD_HASH || "").split("$");
  if (scheme !== "pbkdf2") return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 100000 || !saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.pbkdf2Sync(String(password || ""), salt, iterations, expected.length, "sha256");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function rateLimitAdminLogin(req, res) {
  const key = hashRateLimitKey(req);
  const now = Date.now();
  const bucket = adminLoginRateBuckets.get(key) || { count: 0, resetAt: now + ADMIN_LOGIN_RATE_WINDOW_MS };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + ADMIN_LOGIN_RATE_WINDOW_MS;
  }
  bucket.count += 1;
  adminLoginRateBuckets.set(key, bucket);
  if (bucket.count > ADMIN_LOGIN_RATE_MAX) {
    res.status(429).json({ error: "Too many login attempts" });
    return false;
  }
  return true;
}

function getAppAccessToken(req) {
  const header = req.get("x-app-token") || "";
  if (header) return header;

  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  return "";
}

function requireAdmin(req, res) {
  if (getAdminSession(req)) return true;
  const token = getAuthToken(req);
  if (ADMIN_TOKEN && token && token === ADMIN_TOKEN) return true;
  if (!adminSessionConfigured() && !ADMIN_TOKEN) {
    res.status(503).json({ error: "Admin access is not configured" });
    return false;
  }
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function requireAppAccess(req, res) {
  if (!APP_ACCESS_TOKEN) return true;
  if (getAppAccessToken(req) === APP_ACCESS_TOKEN) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function sendAdminError(res, label, error, status = 500) {
  console.error(`[${label}] failed:`, error.message);
  res.status(status).json({ error: "Admin request failed" });
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function safeText(value, max = 120) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

function safePrimitiveText(value, max = 120) {
  if (!["string", "number", "boolean"].includes(typeof value)) return null;
  return safeText(value, max);
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

const ANALYTICS_NUMERIC_METADATA_FIELDS = new Set([
  "latencyMs",
  "rating",
  "imageCount",
]);

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

async function supabaseRestInsert(table, rows, { onConflict, merge = false } = {}) {
  if (!rows.length) return;
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (onConflict) url.searchParams.set("on_conflict", onConflict);
  const prefer = ["return=minimal"];
  if (onConflict) prefer.push(`resolution=${merge ? "merge-duplicates" : "ignore-duplicates"}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": ANALYTICS_SCHEMA,
      Prefer: prefer.join(","),
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${table} insert failed (${res.status}): ${text.slice(0, 240)}`);
  }
}

async function supabaseRestPatch(table, matchColumn, matchValue, row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set(matchColumn, `eq.${matchValue}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      "Accept-Profile": ANALYTICS_SCHEMA,
      "Content-Type": "application/json",
      "Content-Profile": ANALYTICS_SCHEMA,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${table} update failed (${res.status}): ${text.slice(0, 240)}`);
  }
}

function analyticsFiltersFromQuery(query = {}) {
  const filters = {};
  const map = {
    mode: "mode",
    printVisibility: "print_visibility",
    listingRole: "listing_role",
    category: "category",
    provider: "provider",
    modelName: "model_name",
  };
  for (const [inputKey, column] of Object.entries(map)) {
    const value = safeText(query[inputKey], 180);
    if (value) filters[column] = value;
  }
  const dateFrom = safeText(query.dateFrom, 20);
  const dateTo = safeText(query.dateTo, 20);
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  return filters;
}

function cacheKeyForAdminAnalytics(scope, filters = {}) {
  return `${scope}:${JSON.stringify(Object.keys(filters).sort().reduce((acc, key) => {
    acc[key] = filters[key];
    return acc;
  }, {}))}`;
}

async function withAdminAnalyticsCache(scope, filters, loader) {
  const key = cacheKeyForAdminAnalytics(scope, filters);
  const now = Date.now();
  const cached = adminAnalyticsCache.get(key);
  if (cached && cached.expiresAt > now) return { ...cached.value, cached: true };
  const value = await loader();
  adminAnalyticsCache.set(key, { value, expiresAt: now + ADMIN_ANALYTICS_CACHE_MS });
  return { ...value, cached: false };
}

async function supabaseRestSelect(view, { filters = {}, order = "", limit = 1000 } = {}) {
  if (!analyticsConfigReady()) throw new Error("Analytics ingest is not configured");
  const url = new URL(`${SUPABASE_URL}/rest/v1/${view}`);
  url.searchParams.set("select", "*");
  if (filters.dateFrom) url.searchParams.set("day", `gte.${filters.dateFrom}`);
  if (filters.dateTo) url.searchParams.append("day", `lte.${filters.dateTo}`);
  for (const [column, value] of Object.entries(filters)) {
    if (column === "dateFrom" || column === "dateTo") continue;
    url.searchParams.set(column, `eq.${value}`);
  }
  if (order) url.searchParams.set("order", order);
  if (limit) url.searchParams.set("limit", String(limit));

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      "Accept-Profile": ANALYTICS_SCHEMA,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${view} select failed (${res.status}): ${text.slice(0, 240)}`);
  }
  return await res.json();
}

async function supabaseRestQuery(resource, { params = {}, order = "", limit = 1000, select = "*" } = {}) {
  if (!analyticsConfigReady()) throw new Error("Analytics ingest is not configured");
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  url.searchParams.set("select", select);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  if (order) url.searchParams.set("order", order);
  if (limit) url.searchParams.set("limit", String(limit));

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      "Accept-Profile": ANALYTICS_SCHEMA,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${resource} query failed (${res.status}): ${text.slice(0, 240)}`);
  }
  return await res.json();
}

async function supabaseRestRpc(functionName) {
  if (!analyticsConfigReady()) throw new Error("Analytics ingest is not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": ANALYTICS_SCHEMA,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase RPC ${functionName} failed (${res.status}): ${text.slice(0, 240)}`);
  }
}

function safeLimit(value, fallback = 20, max = 100) {
  return Math.max(1, Math.min(max, safeInteger(value, 1, max) || fallback));
}

function safeMinSamples(value) {
  return Math.max(5, safeInteger(value, 1, 100000) || LEARNING_MIN_SAMPLES);
}

const LEARNING_DIMENSIONS = new Set([
  "listing_role",
  "mockup_style_mode",
  "environment",
  "camera_setup",
  "pose",
  "lighting",
  "shirt_type",
  "print_visibility",
  "audience",
  "category",
  "product_type",
]);

let learningRefreshInFlight = null;

function learningParams(query = {}) {
  const mode = query.mode === "bottom" ? "bottom" : "top";
  const productType = safeText(query.product_type || query.productType || "all", 80) || "all";
  return {
    mode,
    limit: safeLimit(query.limit, 20, 200),
    minSamples: safeMinSamples(query.min_samples || query.minSamples),
    productType,
    refresh: query.refresh === "1" || query.refresh === "true",
  };
}

async function ensureLearningFresh({ force = false } = {}) {
  const latest = await supabaseRestQuery("concept_scores", {
    select: "updated_at",
    order: "updated_at.desc",
    limit: 1,
  });
  const latestMs = latest[0]?.updated_at ? Date.parse(latest[0].updated_at) : 0;
  if (!(force || !latestMs || Date.now() - latestMs > LEARNING_REFRESH_TTL_MS)) return false;
  if (!learningRefreshInFlight) {
    learningRefreshInFlight = (async () => {
      await supabaseRestRpc("refresh_learning_scores");
      adminAnalyticsCache.clear();
      return true;
    })().finally(() => {
      learningRefreshInFlight = null;
    });
  }
  await learningRefreshInFlight;
  return true;
}

async function loadTopConcepts(options = {}) {
  const { mode, limit, minSamples, productType } = learningParams(options);
  const params = { sample_count: `gte.${minSamples}` };
  if (productType && productType !== "all") params.product_type = `eq.${productType}`;
  const rows = await supabaseRestQuery("concept_scores", {
    params,
    order: mode === "bottom" ? "success_score.asc,sample_count.desc" : "success_score.desc,sample_count.desc",
    limit,
  });
  return { mode, limit, min_samples: minSamples, product_type: productType, rows };
}

async function loadDimensionLeaderboard(options = {}) {
  const base = learningParams(options);
  const dimensionType = LEARNING_DIMENSIONS.has(options.dimension_type) ? options.dimension_type : "listing_role";
  const params = {
    dimension_type: `eq.${dimensionType}`,
    sample_count: `gte.${base.minSamples}`,
  };
  if (base.productType) params.product_type = `eq.${base.productType}`;
  const rows = await supabaseRestQuery("dimension_scores", {
    params,
    order: base.mode === "bottom" ? "success_score.asc,sample_count.desc" : "success_score.desc,sample_count.desc",
    limit: base.limit,
  });
  return { ...base, dimension_type: dimensionType, rows };
}

function aggregatePromptVersions(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.prompt_version || "unknown";
    const item = grouped.get(key) || {
      prompt_version: key,
      concept_count: 0,
      sample_count: 0,
      rating_weighted: 0,
      rating_weight: 0,
      score_weighted: 0,
      downloads: 0,
      exports: 0,
      regenerates: 0,
      promptHashes: new Set(),
    };
    const samples = Number(row.sample_count) || 0;
    const ratings = Number(row.rating_count) || 0;
    item.concept_count += 1;
    item.sample_count += samples;
    item.rating_weighted += (Number(row.avg_rating) || 0) * Math.max(ratings, 1);
    item.rating_weight += Math.max(ratings, 1);
    item.score_weighted += (Number(row.success_score) || 0) * Math.max(samples, 1);
    item.downloads += Number(row.download_count) || 0;
    item.exports += Number(row.export_count) || 0;
    item.regenerates += Number(row.regenerate_count) || 0;
    if (row.prompt_hash) item.promptHashes.add(String(row.prompt_hash));
    grouped.set(key, item);
  }
  return Array.from(grouped.values()).map(item => ({
    prompt_version: item.prompt_version,
    concept_count: item.concept_count,
    sample_count: item.sample_count,
    prompt_hash_count: item.promptHashes.size,
    avg_success_score: item.sample_count ? Number((item.score_weighted / Math.max(item.sample_count, 1)).toFixed(2)) : null,
    avg_rating: item.rating_weight ? Number((item.rating_weighted / item.rating_weight).toFixed(2)) : null,
    download_rate: item.sample_count ? Number((item.downloads / item.sample_count).toFixed(5)) : 0,
    export_rate: item.sample_count ? Number((item.exports / item.sample_count).toFixed(5)) : 0,
    regenerate_rate: item.sample_count ? Number((item.regenerates / item.sample_count).toFixed(5)) : 0,
  })).sort((a, b) => (b.avg_success_score || 0) - (a.avg_success_score || 0) || (b.sample_count || 0) - (a.sample_count || 0));
}

function buildLearningSummaryFromRows({ conceptRows = [], dimensionRows = [], promptVersionRows = [], minSamples = 1, productType = "all" } = {}) {
  return {
    generated_at: new Date().toISOString(),
    min_samples: minSamples,
    product_type: productType,
    cards: {
      best_concept: conceptRows[0] || null,
      best_dimension: dimensionRows[0] || null,
      worst_dimension: dimensionRows.length ? dimensionRows[dimensionRows.length - 1] : null,
      best_prompt_version: promptVersionRows[0] || null,
    },
  };
}

async function loadPromptVersions(options = {}) {
  const { minSamples } = learningParams(options);
  const rows = await supabaseRestQuery("concept_scores", {
    params: { sample_count: `gte.${minSamples}` },
    limit: RESEARCH_EXPORT_MAX_ROWS,
  });
  return { min_samples: minSamples, rows: aggregatePromptVersions(rows) };
}

async function loadDimensionHeatmap(options = {}) {
  const { minSamples, productType } = learningParams(options);
  const x = LEARNING_DIMENSIONS.has(options.x) ? options.x : "audience";
  const y = LEARNING_DIMENSIONS.has(options.y) ? options.y : "mockup_style_mode";
  const params = { sample_count: `gte.${minSamples}` };
  if (productType && productType !== "all") params.product_type = `eq.${productType}`;
  const sourceRows = await supabaseRestQuery("concept_scores", { params, limit: RESEARCH_EXPORT_MAX_ROWS });
  const grouped = new Map();
  for (const row of sourceRows) {
    const xValue = row[x];
    const yValue = row[y];
    if (!xValue || !yValue) continue;
    const key = `${xValue}\u001f${yValue}`;
    const item = grouped.get(key) || { product_type: productType, x_value: xValue, y_value: yValue, sample_count: 0, score_weighted: 0 };
    const samples = Number(row.sample_count) || 0;
    item.sample_count += samples;
    item.score_weighted += (Number(row.success_score) || 0) * samples;
    grouped.set(key, item);
  }
  const rows = Array.from(grouped.values()).map(item => ({
    product_type: item.product_type,
    x_value: item.x_value,
    y_value: item.y_value,
    sample_count: item.sample_count,
    success_score: item.sample_count ? Number((item.score_weighted / item.sample_count).toFixed(2)) : 0,
  })).sort((a, b) => b.success_score - a.success_score || b.sample_count - a.sample_count);
  return { x, y, min_samples: minSamples, product_type: productType, rows };
}

async function loadLearningSummary(options = {}) {
  const minSamples = safeMinSamples(options.min_samples || options.minSamples);
  const productType = safeText(options.product_type || options.productType || "all", 80) || "all";
  const [topConcepts, bestDimensions, worstDimensions, promptVersions] = await Promise.all([
    loadTopConcepts({ ...options, mode: "top", limit: 1, min_samples: minSamples }),
    supabaseRestQuery("dimension_scores", {
      params: (() => {
        const params = { sample_count: `gte.${minSamples}` };
        if (productType && productType !== "all") params.product_type = `eq.${productType}`;
        return params;
      })(),
      order: "success_score.desc,sample_count.desc",
      limit: 1,
    }),
    supabaseRestQuery("dimension_scores", {
      params: (() => {
        const params = { sample_count: `gte.${minSamples}` };
        if (productType && productType !== "all") params.product_type = `eq.${productType}`;
        return params;
      })(),
      order: "success_score.asc,sample_count.desc",
      limit: 1,
    }),
    loadPromptVersions({ ...options, min_samples: minSamples }),
  ]);
  return {
    generated_at: new Date().toISOString(),
    min_samples: minSamples,
    product_type: productType,
    cards: {
      best_concept: topConcepts.rows[0] || null,
      best_dimension: bestDimensions[0] || null,
      worst_dimension: worstDimensions[0] || null,
      best_prompt_version: promptVersions.rows[0] || null,
    },
  };
}

async function loadLearningBundle(options = {}) {
  const { minSamples, productType } = learningParams(options);
  const conceptParams = { sample_count: `gte.${minSamples}` };
  if (productType && productType !== "all") conceptParams.product_type = `eq.${productType}`;
  const dimensionParams = { sample_count: `gte.${minSamples}` };
  if (productType && productType !== "all") dimensionParams.product_type = `eq.${productType}`;
  const [conceptRows, dimensionRows] = await Promise.all([
    supabaseRestQuery("concept_scores", {
      params: conceptParams,
      order: "success_score.desc,sample_count.desc",
      limit: RESEARCH_EXPORT_MAX_ROWS,
    }),
    supabaseRestQuery("dimension_scores", {
      params: dimensionParams,
      order: "success_score.desc,sample_count.desc",
      limit: RESEARCH_EXPORT_MAX_ROWS,
    }),
  ]);
  const promptVersionRows = aggregatePromptVersions(conceptRows);
  const topConcepts = conceptRows.slice(0, safeLimit(options.limit, 20, 200));
  const bottomConcepts = [...conceptRows].sort((a, b) => (a.success_score || 0) - (b.success_score || 0) || (b.sample_count || 0) - (a.sample_count || 0)).slice(0, safeLimit(options.limit, 20, 200));
  const x = LEARNING_DIMENSIONS.has(options.x) ? options.x : "audience";
  const y = LEARNING_DIMENSIONS.has(options.y) ? options.y : "mockup_style_mode";
  const heatmapGrouped = new Map();
  for (const row of conceptRows) {
    const xValue = row[x];
    const yValue = row[y];
    if (!xValue || !yValue) continue;
    const key = `${xValue}\u001f${yValue}`;
    const item = heatmapGrouped.get(key) || { product_type: productType, x_value: xValue, y_value: yValue, sample_count: 0, score_weighted: 0 };
    const samples = Number(row.sample_count) || 0;
    item.sample_count += samples;
    item.score_weighted += (Number(row.success_score) || 0) * samples;
    heatmapGrouped.set(key, item);
  }
  const heatmap = Array.from(heatmapGrouped.values()).map(item => ({
    product_type: item.product_type,
    x_value: item.x_value,
    y_value: item.y_value,
    sample_count: item.sample_count,
    success_score: item.sample_count ? Number((item.score_weighted / item.sample_count).toFixed(2)) : 0,
  })).sort((a, b) => b.success_score - a.success_score || b.sample_count - a.sample_count);
  const summary = buildLearningSummaryFromRows({
    conceptRows: topConcepts,
    dimensionRows,
    promptVersionRows,
    minSamples,
    productType,
  });
  return {
    ...summary,
    topConcepts,
    bottomConcepts,
    dimensionLeaderboard: dimensionRows.slice(0, safeLimit(options.limit, 20, 200)),
    promptVersions: promptVersionRows,
    heatmap: heatmap.slice(0, safeLimit(options.limit, 20, 200)),
  };
}

function addProxyMetrics(row = {}) {
  const generations = Number(row.generations_total) || 0;
  const succeeded = Number(row.generations_succeeded) || 0;
  const failed = Number(row.generations_failed) || 0;
  const downloads = Number(row.downloads ?? row.download_count) || 0;
  const exportsCount = Number(row.exports ?? row.export_count) || 0;
  const favorites = Number(row.favorites) || 0;
  const regenerates = Number(row.regenerates ?? row.regenerate_count) || 0;
  const aiFixes = Number(row.ai_fixes ?? row.ai_fix_count) || 0;
  const avgRating = Number(row.avg_rating);
  const saveRate = generations ? ((downloads + exportsCount + favorites) / generations) * 100 : null;
  const regenerateRate = generations ? (regenerates / generations) * 100 : null;
  const fixRate = generations ? (aiFixes / generations) * 100 : null;
  const riskProxy = generations ? ((failed + regenerates + aiFixes) / generations) * 100 : null;
  const ratingScore = Number.isFinite(avgRating) ? (avgRating / 5) * 100 : 0;
  const saveScore = saveRate === null ? 0 : Math.min(100, saveRate);
  const successScore = generations ? (succeeded / generations) * 100 : 0;
  const trustProxy = generations || Number.isFinite(avgRating)
    ? Number(((ratingScore * 0.45) + (saveScore * 0.35) + (successScore * 0.2)).toFixed(2))
    : null;
  return {
    ...row,
    save_rate_proxy: saveRate === null ? null : Number(saveRate.toFixed(2)),
    regenerate_rate: regenerateRate === null ? null : Number(regenerateRate.toFixed(2)),
    fix_rate: fixRate === null ? null : Number(fixRate.toFixed(2)),
    trust_proxy: trustProxy,
    risk_proxy: riskProxy === null ? null : Number(riskProxy.toFixed(2)),
  };
}

function aggregateMetrics(rows = []) {
  const totals = rows.reduce((acc, row) => {
    const generations = Number(row.generations_total) || 0;
    const succeeded = Number(row.generations_succeeded) || 0;
    const failed = Number(row.generations_failed) || 0;
    const ratings = Number(row.ratings_count) || 0;
    const latency = Number(row.avg_latency_ms);
    acc.generations_total += generations;
    acc.generations_succeeded += succeeded;
    acc.generations_failed += failed;
    acc.ratings_count += ratings;
    acc.rating_weighted += (Number(row.avg_rating) || 0) * ratings;
    acc.downloads += Number(row.downloads) || 0;
    acc.exports += Number(row.exports) || 0;
    acc.regenerates += Number(row.regenerates) || 0;
    acc.ai_fixes += Number(row.ai_fixes) || 0;
    acc.favorites += Number(row.favorites) || 0;
    if (Number.isFinite(latency) && generations > 0) {
      acc.latency_weighted += latency * generations;
      acc.latency_count += generations;
    }
    return acc;
  }, {
    generations_total: 0,
    generations_succeeded: 0,
    generations_failed: 0,
    ratings_count: 0,
    rating_weighted: 0,
    downloads: 0,
    exports: 0,
    regenerates: 0,
    ai_fixes: 0,
    favorites: 0,
    latency_weighted: 0,
    latency_count: 0,
  });

  return addProxyMetrics({
    generations_total: totals.generations_total,
    generations_succeeded: totals.generations_succeeded,
    generations_failed: totals.generations_failed,
    success_rate: totals.generations_total ? Number(((totals.generations_succeeded / totals.generations_total) * 100).toFixed(2)) : null,
    avg_latency_ms: totals.latency_count ? Math.round(totals.latency_weighted / totals.latency_count) : null,
    ratings_count: totals.ratings_count,
    avg_rating: totals.ratings_count ? Number((totals.rating_weighted / totals.ratings_count).toFixed(2)) : null,
    downloads: totals.downloads,
    exports: totals.exports,
    regenerates: totals.regenerates,
    ai_fixes: totals.ai_fixes,
    favorites: totals.favorites,
  });
}

function aggregateByDay(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const day = row.day;
    const list = grouped.get(day) || [];
    list.push(row);
    grouped.set(day, list);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([day, dayRows]) => addProxyMetrics({ day, ...aggregateMetrics(dayRows) }));
}

function aggregateConceptRows(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const key = [
      row.listing_role || "",
      row.category || "",
      row.mode || "",
      row.print_visibility || "",
    ].join("\u001f");
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }
  return Array.from(grouped.entries()).map(([key, groupRows]) => {
    const [listing_role, category, mode, print_visibility] = key.split("\u001f");
    const metrics = aggregateMetrics(groupRows);
    const recentFailures = groupRows
      .filter(row => Number(row.generations_failed) > 0)
      .sort((a, b) => String(b.day).localeCompare(String(a.day)))
      .slice(0, 5)
      .map(row => ({
        day: row.day,
        generations_failed: Number(row.generations_failed) || 0,
        provider: row.provider || null,
        model_name: row.model_name || null,
      }));
    return addProxyMetrics({
      listing_role,
      category,
      mode,
      print_visibility,
      generations_total: metrics.generations_total,
      generations_succeeded: metrics.generations_succeeded,
      generations_failed: metrics.generations_failed,
      success_rate: metrics.success_rate,
      avg_rating: metrics.avg_rating,
      download_count: metrics.downloads,
      export_count: metrics.exports,
      regenerate_count: metrics.regenerates,
      ai_fix_count: metrics.ai_fixes,
      favorites: metrics.favorites,
      recent_failures: recentFailures,
      sanitized_metadata: {
        listing_role,
        category,
        mode,
        print_visibility,
      },
    });
  }).sort((a, b) => (b.generations_total || 0) - (a.generations_total || 0));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows = []) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.join(","),
    ...rows.map(row => columns.map(column => csvEscape(row[column])).join(",")),
  ].join("\n");
}

async function loadAdminResearchBundle(filters) {
  const dailyRows = await supabaseRestSelect("v_daily_metrics", { filters, order: "day.asc", limit: 5000 });
  const timeseries = aggregateByDay(dailyRows);
  const breakdown = aggregateConceptRows(dailyRows).slice(0, 250);
  return {
    filters,
    summary: aggregateMetrics(dailyRows),
    timeseries,
    breakdown,
  };
}

function normalizeAnalyticsEvent(event, clientInstallHash) {
  const eventType = safeText(event?.eventType, 80);
  if (!eventType || (!ANALYTICS_GENERATION_TYPES.has(eventType) && !ANALYTICS_INTERACTION_TYPES.has(eventType))) {
    return { error: "unsupported_event_type" };
  }
  if (!isUuid(event?.clientEventId)) return { error: "invalid_client_event_id" };

  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const createdAt = Date.parse(event.createdAt) ? new Date(event.createdAt).toISOString() : new Date().toISOString();
  const metadata = sanitizeAnalyticsMetadata(eventType, payload);

  if (ANALYTICS_GENERATION_TYPES.has(eventType)) {
    const outcome = eventType === "generation_succeeded" ? "succeeded" : eventType === "generation_failed" ? "failed" : "started";
    return {
      table: "generation",
      row: {
        event_id: crypto.randomUUID(),
        client_event_id: event.clientEventId,
        client_install_hash: clientInstallHash,
        batch_id: isUuid(payload.batchId) ? payload.batchId : null,
        concept_id: safePrimitiveText(payload.conceptId || payload.clientGenerationId, 80),
        design_fingerprint: safePrimitiveText(payload.conceptFingerprint, 128),
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
        event_id: crypto.randomUUID(),
        client_event_id: event.clientEventId,
        client_install_hash: clientInstallHash,
        generation_event_id: isUuid(payload.generationId) ? payload.generationId : null,
        event_type: eventType,
        rating: eventType === "rating_set" ? safeInteger(payload.rating, 1, 5) : null,
      dwell_ms: null,
      metadata,
      created_at: createdAt,
    },
  };
}

app.post("/api/analytics/events/bulk", async (req, res) => {
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
  if (!installId || typeof installId !== "string" || installId.length > 128) {
    return res.status(400).json({ error: "Invalid installId" });
  }
  if (!Array.isArray(events)) return res.status(400).json({ error: "events must be an array" });
  if (events.length > ANALYTICS_MAX_EVENTS) {
    return res.status(413).json({ error: `Max ${ANALYTICS_MAX_EVENTS} analytics events per batch` });
  }

  const clientInstallHash = hashInstallId(installId);
  const generationRows = [];
  const interactionRows = [];
  const rejected = [];
  const seenClientEventIds = new Set();

  events.forEach((event, index) => {
    const normalized = normalizeAnalyticsEvent(event, clientInstallHash);
    if (normalized.error) {
      rejected.push({ index, error: normalized.error });
      return;
    }
    const clientEventId = normalized.row.client_event_id;
    if (seenClientEventIds.has(clientEventId)) {
      rejected.push({ index, error: "duplicate_client_event_id" });
      return;
    }
    seenClientEventIds.add(clientEventId);
    if (normalized.table === "generation") generationRows.push(normalized.row);
    else interactionRows.push(normalized.row);
  });

  try {
    const nowIso = new Date().toISOString();
    const clientUpdate = {
      last_seen_at: nowIso,
      consent_analytics: true,
      locale: safeText(locale || req.get("accept-language"), 80),
      app_version: safeText(pkg.version, 40),
      opt_out_at: null,
    };

    await supabaseRestInsert("clients", [{
      client_install_hash: clientInstallHash,
      first_seen_at: nowIso,
      ...clientUpdate,
    }], { onConflict: "client_install_hash" });
    await supabaseRestPatch("clients", "client_install_hash", clientInstallHash, clientUpdate);

    await supabaseRestInsert("generation_events", generationRows, { onConflict: "client_event_id" });
    await supabaseRestInsert("interaction_events", interactionRows, { onConflict: "client_event_id" });

    res.json({
      accepted: generationRows.length + interactionRows.length,
      acceptedClientEventIds: [
        ...generationRows.map(row => row.client_event_id),
        ...interactionRows.map(row => row.client_event_id),
      ],
      rejected,
    });
  } catch (e) {
    console.error("[analytics ingest] failed:", e.message);
    res.status(502).json({ error: "Analytics ingest failed" });
  }
});

// ─── Admin session auth ───────────────────────────────────────────────────────
app.get("/api/admin/session", (req, res) => {
  const session = getAdminSession(req);
  res.json({
    authenticated: !!session,
    username: session?.username || null,
    configured: adminSessionConfigured(),
    tokenFallbackEnabled: !!ADMIN_TOKEN,
  });
});

app.post("/api/admin/login", (req, res) => {
  if (!adminSessionConfigured()) {
    return res.status(503).json({ error: "Admin login is not configured" });
  }
  if (!rateLimitAdminLogin(req, res)) return;

  const { username, password } = req.body || {};
  const usernameOk = timingSafeEqualString(username, ADMIN_USERNAME);
  const passwordOk = verifyAdminPassword(password);
  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  setAdminSessionCookie(res, ADMIN_USERNAME);
  res.json({ ok: true, username: ADMIN_USERNAME });
});

app.post("/api/admin/logout", (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

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
  if (!requireAppAccess(req, res)) return;
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
  if (!requireAppAccess(req, res)) return;
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
  if (!requireAppAccess(req, res)) return;
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
  if (!requireAppAccess(req, res)) return;
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

app.get("/api/admin/research/summary", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const filters = analyticsFiltersFromQuery(req.query);
    const data = await withAdminAnalyticsCache("summary", filters, async () => {
      const rows = await supabaseRestSelect("v_daily_metrics", { filters, limit: 5000 });
      return { filters, summary: aggregateMetrics(rows) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research summary", e);
  }
});

app.get("/api/admin/research/timeseries", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const filters = analyticsFiltersFromQuery(req.query);
    const data = await withAdminAnalyticsCache("timeseries", filters, async () => {
      const rows = await supabaseRestSelect("v_daily_metrics", { filters, order: "day.asc", limit: 5000 });
      return { filters, rows: aggregateByDay(rows) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research timeseries", e);
  }
});

app.get("/api/admin/research/breakdown", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const filters = analyticsFiltersFromQuery(req.query);
    const data = await withAdminAnalyticsCache("breakdown", filters, async () => {
      const rows = await supabaseRestSelect("v_daily_metrics", { filters, order: "day.desc", limit: 5000 });
      return { filters, rows: aggregateConceptRows(rows).slice(0, 250) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research breakdown", e);
  }
});

app.get("/api/admin/research/top-concepts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const options = { ...req.query };
    const data = await withAdminAnalyticsCache("learning-top-concepts", options, async () => {
      const refreshed = await ensureLearningFresh({ force: options.refresh === "1" || options.refresh === "true" });
      return { refreshed, ...(await loadTopConcepts(options)) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research top concepts", e);
  }
});

app.get("/api/admin/research/dimension-leaderboard", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const options = { ...req.query };
    const data = await withAdminAnalyticsCache("learning-dimension-leaderboard", options, async () => {
      const refreshed = await ensureLearningFresh({ force: options.refresh === "1" || options.refresh === "true" });
      return { refreshed, ...(await loadDimensionLeaderboard(options)) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research dimension leaderboard", e);
  }
});

app.get("/api/admin/research/learning-summary", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const options = { ...req.query };
    const data = await withAdminAnalyticsCache("learning-summary", options, async () => {
      const refreshed = await ensureLearningFresh({ force: options.refresh === "1" || options.refresh === "true" });
      return { refreshed, ...(await loadLearningSummary(options)) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research learning summary", e);
  }
});

app.get("/api/admin/research/learning-bundle", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const options = { ...req.query };
    const data = await withAdminAnalyticsCache("learning-bundle", options, async () => {
      const refreshed = await ensureLearningFresh({ force: options.refresh === "1" || options.refresh === "true" });
      return { refreshed, ...(await loadLearningBundle(options)) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research learning bundle", e);
  }
});

app.get("/api/admin/research/prompt-versions", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const options = { ...req.query };
    const data = await withAdminAnalyticsCache("learning-prompt-versions", options, async () => {
      const refreshed = await ensureLearningFresh({ force: options.refresh === "1" || options.refresh === "true" });
      return { refreshed, ...(await loadPromptVersions(options)) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research prompt versions", e);
  }
});

app.get("/api/admin/research/dimension-heatmap", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const options = { ...req.query };
    const data = await withAdminAnalyticsCache("learning-dimension-heatmap", options, async () => {
      const refreshed = await ensureLearningFresh({ force: options.refresh === "1" || options.refresh === "true" });
      return { refreshed, ...(await loadDimensionHeatmap(options)) };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research dimension heatmap", e);
  }
});

async function loadResearchExportDataset(query = {}) {
  const dataset = safeText(query.dataset, 80) || "breakdown";
  if (dataset === "top-concepts") return { dataset, ...(await loadTopConcepts(query)) };
  if (dataset === "dimension-leaderboard") return { dataset, ...(await loadDimensionLeaderboard(query)) };
  if (dataset === "prompt-versions") return { dataset, ...(await loadPromptVersions(query)) };
  if (dataset === "dimension-heatmap") return { dataset, ...(await loadDimensionHeatmap(query)) };
  const filters = analyticsFiltersFromQuery(query);
  return { dataset: "breakdown", ...(await loadAdminResearchBundle(filters)) };
}

app.get("/api/admin/research/export.json", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const query = { ...req.query };
    const data = await withAdminAnalyticsCache("export-json", query, async () => {
      if (query.dataset && query.dataset !== "breakdown") await ensureLearningFresh({ force: query.refresh === "1" || query.refresh === "true" });
      return loadResearchExportDataset(query);
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin research export json", e);
  }
});

app.get("/api/admin/research/export.csv", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const query = { ...req.query };
    const data = await withAdminAnalyticsCache("export-csv", query, async () => {
      if (query.dataset && query.dataset !== "breakdown") await ensureLearningFresh({ force: query.refresh === "1" || query.refresh === "true" });
      return loadResearchExportDataset(query);
    });
    const sourceRows = data.rows || data.breakdown || [];
    const rows = data.dataset === "breakdown" ? sourceRows.map(row => ({
        listing_role: row.listing_role,
        category: row.category,
        mode: row.mode,
        print_visibility: row.print_visibility,
        generations_total: row.generations_total,
        success_rate: row.success_rate,
        avg_rating: row.avg_rating,
        save_rate_proxy: row.save_rate_proxy,
        regenerate_rate: row.regenerate_rate,
        fix_rate: row.fix_rate,
        trust_proxy: row.trust_proxy,
        risk_proxy: row.risk_proxy,
        downloads: row.download_count,
        exports: row.export_count,
        regenerates: row.regenerate_count,
        ai_fixes: row.ai_fix_count,
        favorites: row.favorites,
      })) : sourceRows.slice(0, RESEARCH_EXPORT_MAX_ROWS);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ko-research-${data.dataset || "analytics"}.csv"`);
    res.send(toCsv(rows));
  } catch (e) {
    sendAdminError(res, "admin research export csv", e);
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
