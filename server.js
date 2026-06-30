// Requires Node.js >= 18 (native fetch — no node-fetch needed)
const express = require("express");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");
const pkg     = require("./package.json");
const { runAgent } = require("./lib/agentOrchestrator");
const { createAnalyticsEventHelpers } = require("./services/analyticsEvents");
const { createReportsService } = require("./services/reports");
const { registerAuthRoutes } = require("./routes/auth");
const { registerKeyRoutes } = require("./routes/keys");
const { registerAnalyticsRoutes } = require("./routes/analytics");
const {
  keySource,
  getGeminiText,
  sleep,
  extractRateLimitWaitMs,
  fetchJsonWithRetry,
} = require("./services/providerUtils");
const aiProviders = require("./services/aiProviders");

const app      = express();
const PORT     = process.env.PORT || 3000;
const KEYS_FILE = path.join(__dirname, ".etsy-mockup-keys.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const APP_ACCESS_TOKEN = process.env.APP_ACCESS_TOKEN || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";
const ADMIN_SESSION_COOKIE = "ko_admin_session";
const USER_SESSION_SECRET = process.env.USER_SESSION_SECRET || ADMIN_SESSION_SECRET || "";
const USER_SESSION_COOKIE = "ko_user_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const USER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ADMIN_LOGIN_RATE_WINDOW_MS = 60 * 1000;
const ADMIN_LOGIN_RATE_MAX = 8;
const FLORENCE_VERSION = "da53547e17d45b9cfb48174b2f18af8b83ca020fa76db62136bf9c6616762595";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANALYTICS_HMAC_SECRET = process.env.ANALYTICS_HMAC_SECRET || "";
const ANALYTICS_SCHEMA = "analytics_private";
const ANALYTICS_MAX_EVENTS = 100;
const ANALYTICS_MAX_PAYLOAD_BYTES = 160 * 1024;
const ANALYTICS_RATE_WINDOW_MS = 60 * 1000;
const ANALYTICS_RATE_MAX = 30;
const ADMIN_ANALYTICS_CACHE_MS = 45 * 1000;
const ANALYZE_PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000;
const LEARNING_MIN_SAMPLES = Number(process.env.LEARNING_MIN_SAMPLES || 5);
const LEARNING_REFRESH_TTL_MS = Number(process.env.LEARNING_REFRESH_TTL_MS || 15 * 60 * 1000);
const RESEARCH_EXPORT_MAX_ROWS = Number(process.env.RESEARCH_EXPORT_MAX_ROWS || 5000);
const DEFAULT_STARTING_CREDITS = Number(process.env.DEFAULT_STARTING_CREDITS || 100);
const CHARGE_FAILED_GENERATIONS = /^(1|true|yes|on)$/i.test(String(process.env.CHARGE_FAILED_GENERATIONS || ""));
const USER_LOGIN_RATE_WINDOW_MS = 60 * 1000;
const USER_LOGIN_RATE_MAX = 10;
const ANALYTICS_GENERATION_TYPES = new Set(["generation_started", "generation_succeeded", "generation_failed"]);
const ANALYTICS_INTERACTION_TYPES = new Set(["rating_set", "regenerate_clicked", "ai_fix_clicked", "download_png", "download_zip", "export_selected", "copy_prompt", "select_favorite"]);
const REVIEW_ACTIONS = new Set(["approve", "reject", "needs_fix", "favorite", "archive", "flag_for_review", "duplicate_test"]);
const REVIEW_STATUSES = new Set(["pending", "approved", "rejected", "needs_fix", "archived", "flagged"]);
const FAILURE_CATEGORIES = new Set([
  "blurry_design",
  "unreadable_text",
  "warped_print",
  "design_distortion",
  "wrong_placement",
  "low_resolution",
  "bad_anatomy",
  "bad_hands",
  "extra_fingers",
  "extra_limbs",
  "face_problems",
  "perspective_issues",
  "wrong_clothing_type",
  "wrong_dog_breed",
  "wrong_pet_features",
  "poor_lighting",
  "artificial_appearance",
  "low_realism",
  "bad_composition",
  "background_issues",
  "cut_off_product",
  "incorrect_colors",
  "duplicate_objects",
  "other",
]);
const FAILURE_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const analyticsRateBuckets = new Map();
const adminAnalyticsCache = new Map();
const adminLoginRateBuckets = new Map();
const userLoginRateBuckets = new Map();
const analyzeProductCache = new Map();
const ANALYZE_PRODUCT_CACHE_MAX = 100;
function pruneAnalyzeCache() {
  if (analyzeProductCache.size <= ANALYZE_PRODUCT_CACHE_MAX) return;
  const now = Date.now();
  // first pass: drop expired
  for (const [k, v] of analyzeProductCache) {
    if (v.expiresAt <= now) analyzeProductCache.delete(k);
    if (analyzeProductCache.size <= ANALYZE_PRODUCT_CACHE_MAX) return;
  }
  // second pass: drop oldest by insertion order until under cap
  for (const k of analyzeProductCache.keys()) {
    analyzeProductCache.delete(k);
    if (analyzeProductCache.size <= ANALYZE_PRODUCT_CACHE_MAX) return;
  }
}

app.use(express.json({ limit: "25mb" }));
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/index.html") {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  next();
});
app.use(express.static(__dirname));
registerAnalyticsRoutes(app, { supabaseRestInsertSchema });
registerAuthRoutes(app);
registerKeyRoutes(app, {
  loadKeys,
  saveKeys,
  maskKey,
  keySource,
  fetchJsonWithRetry: aiProviders.fetchJsonWithRetry,
});

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

function signUserSession(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", USER_SESSION_SECRET).update(body).digest("base64url");
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

function verifyUserSessionToken(token) {
  if (!USER_SESSION_SECRET || !token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", USER_SESSION_SECRET).update(body).digest("base64url");
  if (!timingSafeEqualString(sig, expected)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (payload?.role !== "user") return null;
    if (!payload?.userId) return null;
    if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getUserSession(req) {
  return verifyUserSessionToken(parseCookies(req)[USER_SESSION_COOKIE]);
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

function userCookieParts(maxAgeMs = USER_SESSION_TTL_MS) {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts;
}

function setUserSessionCookie(res, user) {
  const token = signUserSession({
    role: "user",
    userId: user.id,
    email: user.email,
    username: user.username,
    iat: Date.now(),
    exp: Date.now() + USER_SESSION_TTL_MS,
  });
  res.setHeader("Set-Cookie", `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}; ${userCookieParts().join("; ")}`);
}

function clearUserSessionCookie(res) {
  res.setHeader("Set-Cookie", `${USER_SESSION_COOKIE}=; ${userCookieParts(0).join("; ")}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
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

function createPasswordHash(password) {
  const iterations = 210000;
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256");
  return `pbkdf2$${iterations}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPasswordHash(password, hash) {
  const [scheme, iterationsRaw, saltHex, hashHex] = String(hash || "").split("$");
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

function creditStorageErrorCode(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("insufficient credits")) return "insufficient_credits";
  if (message.includes("user not found")) return "user_not_found";
  if (message.includes("supabase is not configured")) return "auth_storage_not_configured";
  return null;
}

function rateLimitUserLogin(req, res) {
  const key = hashRateLimitKey(req);
  const now = Date.now();
  const bucket = userLoginRateBuckets.get(key) || { count: 0, resetAt: now + USER_LOGIN_RATE_WINDOW_MS };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + USER_LOGIN_RATE_WINDOW_MS;
  }
  bucket.count += 1;
  userLoginRateBuckets.set(key, bucket);
  if (bucket.count > USER_LOGIN_RATE_MAX) {
    res.status(429).json({ error: "Too many requests" });
    return false;
  }
  return true;
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
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function adminActor(req) {
  const session = getAdminSession(req);
  return session?.username || ADMIN_USERNAME || "admin";
}

function requireAppAccess(req, res) {
  if (getUserSession(req) || getAdminSession(req)) return true;
  if (APP_ACCESS_TOKEN && getAppAccessToken(req) === APP_ACCESS_TOKEN) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function requireUser(req, res) {
  const session = getUserSession(req);
  if (session) return session;
  res.status(401).json({ error: "Unauthorized" });
  return null;
}

function requireAuth(req, res) {
  const session = getUserSession(req) || getAdminSession(req);
  if (session) return session;
  res.status(401).json({ error: "Unauthorized" });
  return null;
}

function sendAdminError(res, label, error, status = 500) {
  console.error(`[${label}] failed:`, error.message);
  res.status(status).json({ error: "Admin request failed" });
}

function sanitizeUserRow(row = {}) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    plan_type: row.plan_type,
    account_status: row.account_status,
    credits_balance: Number(row.credits_balance) || 0,
    avatar_url: row.avatar_url || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login_at: row.last_login_at || null,
  };
}

function authStorageConfigured() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const url = new URL(SUPABASE_URL);
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

function supabaseConnectionInfo() {
  if (!SUPABASE_URL) return { configured: false, urlValid: false, host: null };
  try {
    const url = new URL(SUPABASE_URL);
    return {
      configured: authStorageConfigured(),
      urlValid: url.protocol === "https:" && url.hostname.endsWith(".supabase.co"),
      host: url.hostname,
    };
  } catch {
    return { configured: authStorageConfigured(), urlValid: false, host: null };
  }
}

function authStorageErrorCode(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("supabase is not configured")) return "auth_storage_not_configured";
  if (
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache") ||
    message.includes("column") && message.includes("does not exist") ||
    message.includes("pgrst204") ||
    message.includes("pgrst205")
  ) {
    return "auth_schema_missing";
  }
  if (
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("invalid api key") ||
    message.includes("jwt") ||
    message.includes("invalid claim") ||
    message.includes("apikey")
  ) {
    return "auth_storage_permission";
  }
  if (
    message.includes("null value") ||
    message.includes("violates not-null constraint") ||
    message.includes("violates check constraint") ||
    message.includes("invalid input syntax")
  ) {
    return "auth_schema_mismatch";
  }
  if (message.includes("duplicate key") || message.includes("23505")) return "account_exists";
  return "server_error";
}

function authStorageDiagnostic(error) {
  const raw = String(error?.message || error || "");
  const cause = error?.cause ? ` cause=${error.cause.code || error.cause.name || "unknown"} ${error.cause.hostname || ""}` : "";
  return `${raw}${cause}`
    .replace(new RegExp(SUPABASE_SERVICE_ROLE_KEY, "g"), "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .slice(0, 420);
}

function normalizeAuthEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 180);
}

function normalizeAuthUsername(value) {
  return String(value || "").trim().replace(/\s+/g, "_").slice(0, 80);
}

function stablePromptHash(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

async function loadUserById(userId) {
  const rows = await supabaseRestQuerySchema("public", "ko_users", {
    params: { id: `eq.${userId}` },
    limit: 1,
  });
  return rows[0] || null;
}

async function loadUserByLogin(login) {
  const rows = await supabaseRestQuerySchema("public", "ko_users", {
    params: {
      or: `(email.eq.${login},username.eq.${login})`,
    },
    limit: 1,
  });
  return rows[0] || null;
}

async function loadFeatureCosts() {
  const rows = await supabaseRestQuerySchema("public", "ko_feature_costs", {
    limit: 100,
    order: "feature_key.asc",
  });
  return rows.reduce((acc, row) => {
    acc[row.feature_key] = {
      feature_key: row.feature_key,
      display_name: row.display_name,
      credits: Number(row.credits) || 0,
      enabled: row.enabled !== false,
    };
    return acc;
  }, {});
}

async function getUserBalance(userId) {
  const user = await loadUserById(userId);
  return Number(user?.credits_balance) || 0;
}

async function addCreditTransaction(userId, action, delta, metadata = {}) {
  const rows = await supabaseRestRpcSchema("public", "ko_adjust_user_credits", {
    p_user_id: userId,
    p_delta: delta,
    p_action: action,
    p_metadata: metadata,
    p_credit_type: "standard",
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return Number(row?.balance_after) || 0;
}

async function enforceUserCredits(userId, featureKey, metadata = {}) {
  const costs = await loadFeatureCosts();
  const cost = costs[featureKey]?.enabled === false ? 0 : Number(costs[featureKey]?.credits || 0);
  if (!cost) return { allowed: true, cost: 0, balance: await getUserBalance(userId) };
  try {
    const balance = await addCreditTransaction(userId, `consume:${featureKey}`, -cost, {
      ...metadata,
      feature_key: featureKey,
    });
    return { allowed: true, cost, balance };
  } catch (error) {
    if (creditStorageErrorCode(error) === "insufficient_credits") {
      return { allowed: false, cost, balance: await getUserBalance(userId) };
    }
    throw error;
  }
}

function parseIsoDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
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

function safeText(value, max = 120) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

function safeInteger(value, min = 0, max = 2147483647) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

const {
  isUuid,
  isPlainObject,
  validateAnalyticsBulkBody,
  normalizeAnalyticsEvent,
} = createAnalyticsEventHelpers({
  maxEvents: ANALYTICS_MAX_EVENTS,
  generationTypes: ANALYTICS_GENERATION_TYPES,
  interactionTypes: ANALYTICS_INTERACTION_TYPES,
  safeText,
  safeInteger,
  randomUUID: () => crypto.randomUUID(),
});

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

function supabaseRestBaseUrl(schema, resource) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  url.searchParams.set("select", "*");
  return url;
}

async function supabaseRestQuerySchema(schema, resource, { params = {}, order = "", limit = 1000, select = "*" } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured");
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
      "Accept-Profile": schema,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${schema}.${resource} query failed (${res.status}): ${text.slice(0, 240)}`);
  }
  return await res.json();
}

async function supabaseRestInsertSchema(schema, resource, rows, { onConflict, merge = false, returning = false } = {}) {
  if (!rows.length) return;
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  if (onConflict) url.searchParams.set("on_conflict", onConflict);
  const prefer = [returning ? "return=representation" : "return=minimal"];
  if (onConflict) prefer.push(`resolution=${merge ? "merge-duplicates" : "ignore-duplicates"}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": schema,
      Prefer: prefer.join(","),
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${schema}.${resource} insert failed (${res.status}): ${text.slice(0, 240)}`);
  }
  if (returning) return await res.json();
}

async function supabaseRestPatchSchema(schema, resource, matchColumn, matchValue, row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  url.searchParams.set(matchColumn, `eq.${matchValue}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      "Accept-Profile": schema,
      "Content-Type": "application/json",
      "Content-Profile": schema,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${schema}.${resource} update failed (${res.status}): ${text.slice(0, 240)}`);
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

async function supabaseRestRpcSchema(schema, functionName, payload = {}) {
  if (!authStorageConfigured()) throw new Error("Supabase is not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": schema,
      "Accept-Profile": schema,
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase RPC ${schema}.${functionName} failed (${res.status}): ${text.slice(0, 240)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function supabaseRestRpc(functionName) {
  if (!analyticsConfigReady()) throw new Error("Analytics ingest is not configured");
  return supabaseRestRpcSchema(ANALYTICS_SCHEMA, functionName, {});
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

const reports = createReportsService({
  analyticsConfigReady,
  supabaseRestQuerySchema,
  supabaseRestSelect,
  supabaseRestQuery,
  supabaseRestRpc,
  LEARNING_MIN_SAMPLES,
  RESEARCH_EXPORT_MAX_ROWS,
  LEARNING_DIMENSIONS,
});

const {
  summarizeDailyRows,
  summarizeGenerationRecords,
  summarizeUsers,
  summarizeTransactions,
  summarizeFailureRows,
  summarizeQualityRows,
  summarizeRatingRows,
  summarizeGenerationDashboardRows,
  analyticsFiltersFromQuery,
  aggregateMetrics,
  aggregateByDay,
  aggregateConceptRows,
  aggregatePromptVersions,
  buildLearningSummaryFromRows,
  loadUserDashboard,
  loadUserCredits,
  loadUserGenerations,
  loadAdminDashboard,
  loadAdminUsers,
  loadAdminTransactions,
  loadAdminGenerations,
  loadAdminGenerationsSummary,
  loadAdminResearchBundle,
  loadAdminReviewCenter,
  loadTopConcepts,
  loadDimensionLeaderboard,
  loadPromptVersions,
  loadDimensionHeatmap,
  loadLearningSummary,
  loadLearningBundle,
  loadResearchExportDataset,
} = reports;

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
    const normalized = normalizeAnalyticsEvent(event, clientInstallHash, userSession);
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
      user_id: userSession?.userId || null,
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

app.get("/api/me/dashboard", async (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  try {
    const data = await loadUserDashboard(session.userId);
    res.json(data);
  } catch (e) {
    sendAdminError(res, "user dashboard", e);
  }
});

app.get("/api/me/credits", async (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  try {
    res.json(await loadUserCredits(session.userId));
  } catch (e) {
    sendAdminError(res, "user credits", e);
  }
});

app.get("/api/me/generations", async (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  try {
    res.json(await loadUserGenerations(session.userId, req.query || {}));
  } catch (e) {
    sendAdminError(res, "user generations", e);
  }
});

app.post("/api/quality-feedback", async (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  const generationId = safeText(req.body?.generationId, 64);
  const feedback = sanitizeQualityFeedback(req.body?.feedback || {});
  if (!generationId) {
    return res.status(400).json({ code: "missing_generation_id", error: "Generation id is required" });
  }
  try {
    const updated = await updateQualityFeedbackByGeneration({
      generationId,
      userId: session.userId,
      feedback,
    });
    res.json({ ok: true, ...updated });
  } catch (e) {
    if (e.message === "invalid_generation_id") return res.status(400).json({ code: "invalid_generation_id", error: "Generation id is invalid" });
    if (e.message === "generation_not_found") return res.status(404).json({ code: "generation_not_found", error: "Generation not found" });
    if (e.message === "quality_record_not_found") return res.status(404).json({ code: "quality_record_not_found", error: "Quality record not found" });
    if (e.message === "forbidden_generation") return res.status(403).json({ code: "forbidden_generation", error: "You do not have access to this generation" });
    console.error("[quality-feedback] failed:", e.message);
    res.status(500).json({ code: "server_error", error: "Quality feedback update failed" });
  }
});

app.get("/api/me/settings", async (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  try {
    const settings = await loadUserSettings(session.userId);
    res.json({
      user_id: session.userId,
      default_settings: settings?.default_settings || {},
      saved_prompt_preferences: settings?.saved_prompt_preferences || [],
      notification_preferences: settings?.notification_preferences || {},
      updated_at: settings?.updated_at || null,
    });
  } catch (e) {
    sendAdminError(res, "user settings", e);
  }
});

app.patch("/api/me/settings", async (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  try {
    const current = (await loadUserSettings(session.userId)) || { user_id: session.userId };
    const patch = {
      user_id: session.userId,
      default_settings: typeof req.body?.default_settings === "object" && req.body.default_settings ? req.body.default_settings : current.default_settings || {},
      saved_prompt_preferences: Array.isArray(req.body?.saved_prompt_preferences) ? req.body.saved_prompt_preferences.slice(0, 50) : current.saved_prompt_preferences || [],
      notification_preferences: typeof req.body?.notification_preferences === "object" && req.body.notification_preferences ? req.body.notification_preferences : current.notification_preferences || {},
      updated_at: new Date().toISOString(),
    };
    await supabaseRestInsertSchema("public", "ko_user_settings", [patch], { onConflict: "user_id", merge: true });
    res.json({ ok: true, settings: patch });
  } catch (e) {
    sendAdminError(res, "user settings update", e);
  }
});

app.get("/api/admin/dashboard", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await loadAdminDashboard());
  } catch (e) {
    sendAdminError(res, "admin dashboard", e);
  }
});

app.get("/api/admin/agents", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await loadAdminAgents());
  } catch (e) {
    sendAdminError(res, "admin agents", e);
  }
});

app.get("/api/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await loadAdminUsers(req.query || {}));
  } catch (e) {
    sendAdminError(res, "admin users", e);
  }
});

app.get("/api/admin/users/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const user = await loadUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const [credits, generations, settings] = await Promise.all([
      loadUserCredits(user.id),
      loadUserGenerations(user.id, {}),
      loadUserSettings(user.id),
    ]);
    res.json({
      user: sanitizeUserRow(user),
      credits,
      generations: generations.rows.slice(0, 50),
      settings: settings || {},
    });
  } catch (e) {
    sendAdminError(res, "admin user detail", e);
  }
});

app.patch("/api/admin/users/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const patch = {};
    if (req.body?.username) patch.username = safeText(req.body.username, 80);
    if (req.body?.account_status) patch.account_status = safeText(req.body.account_status, 40);
    if (req.body?.plan_type) patch.plan_type = safeText(req.body.plan_type, 40);
    if (req.body?.avatar_url !== undefined) patch.avatar_url = safeText(req.body.avatar_url, 500);
    patch.updated_at = new Date().toISOString();
    await supabaseRestPatchSchema("public", "ko_users", "id", req.params.id, patch);
    res.json({ ok: true });
  } catch (e) {
    sendAdminError(res, "admin user update", e);
  }
});

app.post("/api/admin/users/:id/credits", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const delta = safeInteger(req.body?.delta, -100000, 100000);
    const action = safeText(req.body?.action, 80) || (delta >= 0 ? "admin_adjustment_add" : "admin_adjustment_remove");
    const metadata = typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : {};
    const balance = await addCreditTransaction(req.params.id, action, delta, {
      ...metadata,
      source: "admin",
      note: safeText(req.body?.note, 200),
    });
    res.json({ ok: true, balance });
  } catch (e) {
    const code = creditStorageErrorCode(e);
    if (code === "insufficient_credits") {
      return res.status(409).json({ code, error: "Insufficient credits" });
    }
    if (code === "user_not_found") {
      return res.status(404).json({ code, error: "User not found" });
    }
    sendAdminError(res, "admin credit adjust", e);
  }
});

app.get("/api/admin/transactions", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await loadAdminTransactions(req.query || {}));
  } catch (e) {
    sendAdminError(res, "admin transactions", e);
  }
});

app.get("/api/admin/generations", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await loadAdminGenerations(req.query || {}));
  } catch (e) {
    sendAdminError(res, "admin generations", e);
  }
});

app.get("/api/admin/review-center", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await loadAdminReviewCenter(req.query || {}));
  } catch (e) {
    sendAdminError(res, "admin review center", e);
  }
});

app.post("/api/admin/generations/:id/review", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const action = safeText(req.body?.action, 80);
    if (!REVIEW_ACTIONS.has(action)) return res.status(400).json({ error: "Invalid review action" });
    const now = new Date().toISOString();
    const patch = {
      review_status: reviewStatusForAction(action),
      reviewed_by: adminActor(req),
      reviewed_at: now,
    };
    if (action === "archive") patch.archived_at = now;
    if (action === "favorite") patch.favorite_at = now;
    if (action === "flag_for_review") patch.flagged_at = now;
    await supabaseRestPatchSchema("public", "ko_generation_records", "id", req.params.id, patch);
    await writeSystemLog("generation_reviewed", `Generation ${action}`, {
      generationId: req.params.id,
      metadata: {
        action,
        review_status: patch.review_status,
        comment: safeText(req.body?.comment, 1000),
      },
    });
    res.json({ ok: true, review_status: patch.review_status });
  } catch (e) {
    sendAdminError(res, "admin generation review", e);
  }
});

app.post("/api/admin/generations/:id/rating", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rating = normalizeGenerationRating(req.body || {}, adminActor(req));
    const overall = generationRatingScore(rating);
    await supabaseRestInsertSchema("public", "ko_generation_ratings", [{
      generation_id: req.params.id,
      ...rating,
      overall_score: overall,
    }]);
    await supabaseRestPatchSchema("public", "ko_generation_records", "id", req.params.id, {
      score: overall,
      review_status: "pending",
      reviewed_by: adminActor(req),
      reviewed_at: new Date().toISOString(),
    });
    await writeSystemLog("generation_rated", "Generation rating saved", {
      generationId: req.params.id,
      metadata: { overall_score: overall },
    });
    res.json({ ok: true, overall_score: overall });
  } catch (e) {
    sendAdminError(res, "admin generation rating", e, e.message.startsWith("Missing rating field") ? 400 : 500);
  }
});

app.get("/api/admin/generations/:id/failures", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await supabaseRestQuerySchema("public", "ko_generation_failures", {
      params: { generation_id: `eq.${req.params.id}` },
      order: "created_at.desc",
      limit: 100,
    });
    res.json({ rows, categories: Array.from(FAILURE_CATEGORIES), severities: Array.from(FAILURE_SEVERITIES) });
  } catch (e) {
    sendAdminError(res, "admin generation failures", e);
  }
});

app.post("/api/admin/generations/:id/failures", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const category = safeText(req.body?.category, 120);
    const severity = safeText(req.body?.severity, 40) || "medium";
    if (!FAILURE_CATEGORIES.has(category)) return res.status(400).json({ error: "Invalid failure category" });
    if (!FAILURE_SEVERITIES.has(severity)) return res.status(400).json({ error: "Invalid failure severity" });
    const [generation] = await supabaseRestQuerySchema("public", "ko_generation_records", {
      params: { id: `eq.${req.params.id}` },
      limit: 1,
    });
    await supabaseRestInsertSchema("public", "ko_generation_failures", [{
      generation_id: req.params.id,
      category,
      severity,
      comment: safeText(req.body?.comment, 1000),
      prompt_version: safeText(req.body?.prompt_version || generation?.meta?.promptVersion || "", 120),
      model_name: safeText(req.body?.model_name || generation?.model_name || "", 120),
      admin_username: adminActor(req),
      metadata: typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : {},
    }]);
    await supabaseRestPatchSchema("public", "ko_generation_records", "id", req.params.id, {
      review_status: severity === "critical" || severity === "high" ? "needs_fix" : (generation?.review_status || "pending"),
      reviewed_by: adminActor(req),
      reviewed_at: new Date().toISOString(),
    });
    await writeSystemLog("generation_failure_reported", `Failure reported: ${category}`, {
      severity,
      generationId: req.params.id,
      metadata: { category },
    });
    res.json({ ok: true });
  } catch (e) {
    sendAdminError(res, "admin generation failure create", e);
  }
});

app.get("/api/admin/analytics", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const filters = analyticsFiltersFromQuery(req.query);
    const data = await withAdminAnalyticsCache("platform-analytics", filters, async () => {
      const rows = await supabaseRestSelect("v_daily_metrics", { filters, order: "day.asc", limit: 5000 });
      const summary = aggregateMetrics(rows);
      return {
        filters,
        summary,
        rows: aggregateByDay(rows),
        categories: aggregateConceptRows(rows).slice(0, 100),
      };
    });
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin analytics", e);
  }
});

app.get("/api/admin/prompts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await supabaseRestQuerySchema("public", "ko_prompt_templates", {
      order: "updated_at.desc",
      limit: 100,
    });
    res.json({ rows });
  } catch (e) {
    sendAdminError(res, "admin prompts", e);
  }
});

app.post("/api/admin/prompt-comparisons", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const promptA = safeText(req.body?.prompt_a_id, 80);
    const promptB = safeText(req.body?.prompt_b_id, 80);
    if (promptA && !isUuid(promptA)) return res.status(400).json({ error: "Invalid prompt_a_id" });
    if (promptB && !isUuid(promptB)) return res.status(400).json({ error: "Invalid prompt_b_id" });
    const rows = await supabaseRestQuerySchema("public", "ko_generation_records", {
      order: "created_at.desc",
      limit: 1000,
    }).catch(() => []);
    const ratingRows = await supabaseRestQuerySchema("public", "ko_generation_ratings", {
      order: "created_at.desc",
      limit: 1000,
    }).catch(() => []);
    const ratingByGeneration = new Map();
    for (const rating of ratingRows) {
      if (!ratingByGeneration.has(rating.generation_id)) ratingByGeneration.set(rating.generation_id, rating);
    }
    const statsFor = promptId => {
      const matches = rows.filter(row => row.prompt_version_id === promptId || row.meta?.promptVersionId === promptId || row.meta?.prompt_version_id === promptId);
      const rated = matches.map(row => ratingByGeneration.get(row.id)).filter(Boolean);
      const approved = matches.filter(row => row.review_status === "approved").length;
      const failed = matches.filter(row => row.status === "failed" || row.review_status === "rejected" || row.review_status === "needs_fix").length;
      return {
        count: matches.length,
        average_rating: rated.length ? Number((rated.reduce((sum, row) => sum + Number(row.overall_score || 0), 0) / rated.length).toFixed(2)) : null,
        success_rate: matches.length ? Number((((matches.length - failed) / matches.length) * 100).toFixed(2)) : null,
        failure_rate: matches.length ? Number(((failed / matches.length) * 100).toFixed(2)) : null,
        approval_percentage: matches.length ? Number(((approved / matches.length) * 100).toFixed(2)) : null,
      };
    };
    const a = promptA ? statsFor(promptA) : { count: 0 };
    const b = promptB ? statsFor(promptB) : { count: 0 };
    const aScore = Number(a.average_rating || 0) + Number(a.success_rate || 0) / 10 - Number(a.failure_rate || 0) / 10;
    const bScore = Number(b.average_rating || 0) + Number(b.success_rate || 0) / 10 - Number(b.failure_rate || 0) / 10;
    const winner = aScore === bScore ? "tie" : aScore > bScore ? "A" : "B";
    await supabaseRestInsertSchema("public", "ko_prompt_comparisons", [{
      prompt_a_id: promptA || null,
      prompt_b_id: promptB || null,
      prompt_a_version: safeText(req.body?.prompt_a_version, 80),
      prompt_b_version: safeText(req.body?.prompt_b_version, 80),
      average_rating_a: a.average_rating ?? null,
      average_rating_b: b.average_rating ?? null,
      success_rate_a: a.success_rate ?? null,
      success_rate_b: b.success_rate ?? null,
      failure_rate_a: a.failure_rate ?? null,
      failure_rate_b: b.failure_rate ?? null,
      generation_count_a: a.count || 0,
      generation_count_b: b.count || 0,
      approval_percentage_a: a.approval_percentage ?? null,
      approval_percentage_b: b.approval_percentage ?? null,
      winner,
      metadata: {
        created_by: adminActor(req),
      },
    }]);
    res.json({ ok: true, winner, A: a, B: b });
  } catch (e) {
    sendAdminError(res, "admin prompt comparison", e);
  }
});

app.get("/api/admin/models", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await supabaseRestQuerySchema("public", "ko_ai_models", {
      order: "priority.asc",
      limit: 100,
    });
    res.json({ rows });
  } catch (e) {
    sendAdminError(res, "admin models", e);
  }
});

app.get("/api/admin/quality", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await supabaseRestQuerySchema("public", "ko_quality_records", {
      order: "created_at.desc",
      limit: 100,
    });
    res.json({
      cards: summarizeQualityRows(rows),
      rows,
    });
  } catch (e) {
    sendAdminError(res, "admin quality", e);
  }
});

app.get("/api/admin/learning", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const data = await withAdminAnalyticsCache("admin-learning", req.query || {}, async () => loadLearningBundle(req.query || {}));
    res.json(data);
  } catch (e) {
    sendAdminError(res, "admin learning", e);
  }
});

app.get("/api/admin/research-database", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await supabaseRestQuerySchema("public", "ko_research_items", {
      order: "created_at.desc",
      limit: 200,
    });
    res.json({ rows });
  } catch (e) {
    sendAdminError(res, "admin research database", e);
  }
});

app.get("/api/admin/settings", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await supabaseRestQuerySchema("public", "ko_platform_settings", {
      order: "setting_key.asc",
      limit: 100,
    });
    res.json({ rows });
  } catch (e) {
    sendAdminError(res, "admin settings", e);
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
  selectedNiche = [],
  selectedAudience = [],
  selectedStyle = [],
  selectedOccasion = [],
  selectedPricePoint = "",
  selectedKeywords = [],
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
  const productContext = buildSelectedContextBlock({
    selectedNiche,
    selectedAudience,
    selectedStyle,
    selectedOccasion,
    selectedPricePoint,
    selectedKeywords,
  });
  const extraNotes = [
    fluxPrompt ? `Concept prompt: ${fluxPrompt}` : "",
    designAnalysis ? `Analysis note: ${designAnalysis}` : "",
    categoryResearch ? `Category research: ${categoryResearch}` : "",
    shirtResearch ? `Shirt research: ${shirtResearch}` : "",
    productContext ? productContext : "",
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
  const etsyListing = concept.etsy_listing && typeof concept.etsy_listing === "object"
    ? {
        title: safeText(concept.etsy_listing.title, 180),
        tags: Array.isArray(concept.etsy_listing.tags)
          ? concept.etsy_listing.tags.map(tag => safeText(tag, 40)).filter(Boolean).slice(0, 13)
          : [],
        description: safeText(concept.etsy_listing.description, 5000),
        materials: safeText(concept.etsy_listing.materials, 500),
        care_instructions: safeText(concept.etsy_listing.care_instructions, 800),
        size_chart_note: safeText(concept.etsy_listing.size_chart_note, 500),
        image_alt_text: safeText(concept.etsy_listing.image_alt_text, 500),
      }
    : {
        title: "",
        tags: [],
        description: "",
        materials: "",
        care_instructions: "",
        size_chart_note: "",
        image_alt_text: "",
      };
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
    etsy_listing: etsyListing,
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
  generateFullListing = false,
  additionalInfo = "",
  sizeChartIncluded = false,
  selectedNiche = [],
  selectedAudience = [],
  selectedStyle = [],
  selectedOccasion = [],
  selectedPricePoint = "",
  selectedKeywords = [],
}) {
  const selectedContext = buildSelectedContextBlock({
    selectedNiche,
    selectedAudience,
    selectedStyle,
    selectedOccasion,
    selectedPricePoint,
    selectedKeywords,
  });
  const listingMode = generateFullListing
    ? `Full Etsy Listing Mode: ON
- For every concept, include etsy_listing with a listing-ready title, exactly 13 Etsy tags, a buyer-facing description, materials, care instructions, size chart note, and image alt text.
- Tags must be Etsy-safe, comma-free individual phrases, each 20 characters or less when possible.
- Description should be polished, conversion-focused, and ready to paste into Etsy. Mention sizing and size chart only as a helpful note, not as a guarantee.
- Additional Listing Info: ${additionalInfo || "None provided"}
- Size Chart Generated Separately: ${sizeChartIncluded ? "Yes. Mention that buyers should review the size chart in the listing." : "No."}`
    : "Full Etsy Listing Mode: OFF. Keep listing copy minimal and focus on mockup generation.";
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
- ${listingMode}
${selectedContext ? `- ${selectedContext}` : ""}

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
    "etsy_listing": {
      "title": "SEO-ready Etsy listing title, 120-140 characters when possible",
      "tags": ["exactly 13 Etsy tags, each concise and buyer-searchable"],
      "description": "ready-to-paste Etsy product description with buyer benefits, sizing note, gift/use case, production note, and natural call to action",
      "materials": "short materials/fabric line based on the shirt model and user info",
      "care_instructions": "short garment care instructions",
      "size_chart_note": "short note telling buyers to review the size chart image when provided",
      "image_alt_text": "accessible alt text for the primary mockup/listing image"
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

function extractJsonObject(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    console.error("[extractJsonObject] no JSON object braces found. Raw length:", cleaned.length, "Preview:", cleaned.slice(0, 500));
    return null;
  }
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.error("[extractJsonObject] JSON.parse failed:", err.message, "Slice length:", slice.length, "Slice tail:", slice.slice(-300));
    return null;
  }
}

function normalizeListingCopyPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const title = safeText(payload.title, 140).trim();
  const description = safeText(payload.description, 1200).trim();
  const seoNotes = safeText(payload.seo_notes || payload.seoNotes, 500).trim();
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(tag => safeText(tag, 20).trim()).filter(Boolean).slice(0, 13)
    : [];
  const materials = Array.isArray(payload.materials)
    ? payload.materials.map(item => safeText(item, 60).trim()).filter(Boolean).slice(0, 5)
    : [];

  const titleOk = title.length > 0 && title.length <= 140;
  const descriptionOk = description.length >= 800 && description.length <= 1200;
  const tagsOk = tags.length === 13 && tags.every(tag => tag.length > 0 && tag.length <= 20);
  const materialsOk = materials.length >= 3 && materials.length <= 5;
  const seoOk = seoNotes.length > 0;

  if (!titleOk || !descriptionOk || !tagsOk || !materialsOk || !seoOk) return null;

  return {
    title,
    description,
    tags,
    materials,
    seo_notes: seoNotes,
  };
}

function sha256Short(value = "", length = 16) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function normalizeStringArray(value, min = 0, max = 12, itemMax = 80) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => safeText(item, itemMax).trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeAnalysisSuggestions(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const niche = normalizeStringArray(payload.niche, 3, 5, 90);
  const targetAudience = normalizeStringArray(payload.targetAudience, 4, 6, 90);
  const style = normalizeStringArray(payload.style, 4, 6, 80);
  const occasion = normalizeStringArray(payload.occasion, 3, 5, 80);
  const pricePoint = normalizeStringArray(payload.pricePoint, 1, 3, 40);
  const keywords = normalizeStringArray(payload.keywords, 8, 10, 50);
  if (niche.length < 3 || targetAudience.length < 4 || style.length < 4 || occasion.length < 3 || pricePoint.length < 1 || keywords.length < 8) {
    return null;
  }
  return { niche, targetAudience, style, occasion, pricePoint, keywords };
}

function buildSelectedContextBlock({
  selectedNiche = [],
  selectedAudience = [],
  selectedStyle = [],
  selectedOccasion = [],
  selectedPricePoint = "",
  selectedKeywords = [],
} = {}) {
  const niche = Array.isArray(selectedNiche) ? selectedNiche.filter(Boolean).slice(0, 3) : [];
  const audience = Array.isArray(selectedAudience) ? selectedAudience.filter(Boolean).slice(0, 4) : [];
  const style = Array.isArray(selectedStyle) ? selectedStyle.filter(Boolean).slice(0, 4) : [];
  const occasion = Array.isArray(selectedOccasion) ? selectedOccasion.filter(Boolean).slice(0, 3) : [];
  const keywords = Array.isArray(selectedKeywords) ? selectedKeywords.filter(Boolean).slice(0, 10) : [];
  const pricePoint = safeText(selectedPricePoint, 40).trim();
  const hasContext = niche.length || audience.length || style.length || occasion.length || pricePoint || keywords.length;
  if (!hasContext) return "";
  return `Product context: niche=[${niche.join(", ")}], audience=[${audience.join(", ")}], style=[${style.join(", ")}], occasion=[${occasion.join(", ")}], price point=[${pricePoint || "Not provided"}], focus keywords=[${keywords.join(", ")}]`;
}

// GET /api/debug/prompts — view recent prompt-generation calls (sent + received), most recent first.
// Protected by the same ADMIN_TOKEN as other routes. Resets on server restart/redeploy (in-memory only).
app.get("/api/debug/prompts", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ count: promptLog.length, max: PROMPT_LOG_MAX, entries: promptLog });
});

app.post("/api/agents/quality-inspect", async (req, res) => {
  if (!requireAppAccess(req, res)) return;
  const { imageUrl, originalDesignUrl, mockupPrompt } = req.body || {};
  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(503).json({ code: "service_missing", error: "Quality inspection service is not configured" });
  try {
    const result = await runAgent("quality_inspector", {
      imageUrl,
      originalDesignUrl,
      mockupPrompt,
    }, {
      gemini,
      fetchJsonWithRetry,
      getGeminiText,
      persistLog: persistAgentLog,
    });
    res.json({
      report: result.data,
      agentMeta: {
        agent: result.agent,
        success: result.success,
        executionTime: result.executionTime,
      },
    });
  } catch (e) {
    console.error("[quality-inspect] failed:", e.message);
    res.status(e.code === "bad_request" ? 400 : 500).json({ code: e.code || "server_error", error: "Quality inspection failed" });
  }
});

app.post("/api/admin/agents/run", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { agent, input = {} } = req.body || {};
  const { gemini } = loadKeys();
  try {
    const output = await runAgent(agent, input, {
      gemini,
      fetchJsonWithRetry,
      getGeminiText,
      persistLog: persistAgentLog,
    });
    res.json({ ok: true, agent, output: output.data, agentResult: output });
  } catch (e) {
    console.error("[admin agents run] failed:", e.message);
    res.status(e.code === "unknown_agent" ? 400 : 500).json({ code: e.code || "server_error", error: "Agent run failed" });
  }
});

app.post("/api/generate-prompts", async (req, res) => {
  if (!requireAppAccess(req, res)) return;
  const {
    batch, imageBase64, imageType,
    brandStyle, niche, audience, shirtModel, shirtName, shirtMode, designAnalysis, autoDetect, sceneDirection, mockupCount,
    printVisibility, mockupStyleMode, mockupStyleBrief,
    learningContext, usedAttributes,
    generateFullListing, additionalInfo, sizeChartIncluded,
    selectedNiche, selectedAudience, selectedStyle, selectedOccasion, selectedPricePoint, selectedKeywords,
  } = req.body;

  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(503).json({ code: "service_missing", error: "Mockup generation service is not configured" });

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
    generateFullListing: !!generateFullListing,
    additionalInfo: safeText(additionalInfo, 2000),
    sizeChartIncluded: !!sizeChartIncluded,
    selectedNiche: Array.isArray(selectedNiche) ? selectedNiche : [],
    selectedAudience: Array.isArray(selectedAudience) ? selectedAudience : [],
    selectedStyle: Array.isArray(selectedStyle) ? selectedStyle : [],
    selectedOccasion: Array.isArray(selectedOccasion) ? selectedOccasion : [],
    selectedPricePoint: safeText(selectedPricePoint, 40),
    selectedKeywords: Array.isArray(selectedKeywords) ? selectedKeywords : [],
  });

  try {
    const result = await runAgent("prompt_architect", {
      batch,
      printVisibility,
      mockupStyleMode,
      mockupStyleBrief,
      niche,
      audience,
      shirtModel,
      mockupCount,
      selectedNiche,
      selectedAudience,
      selectedStyle,
      selectedOccasion,
      selectedPricePoint,
      selectedKeywords,
    }, {
      gemini,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: roleAwareUserMessage,
      imageBase64,
      imageType,
      fetchJsonWithRetry,
      getGeminiText,
      enrichConceptData,
      persistLog: persistAgentLog,
    });
    const raw = result.data.raw;
    const enrichedConcepts = result.data.enrichedConcepts;
    if (!enrichedConcepts.length && raw) {
      console.error("[generate-prompts] Gemini returned text but 0 concepts parsed. finishReason:", result.finishReason);
    }
    logPromptGeneration({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: roleAwareUserMessage,
      rawResponse: raw,
      conceptsCount: enrichedConcepts.length,
      finishReason: result.data.finishReason,
      ok: enrichedConcepts.length > 0,
    });
    res.json({ raw, concepts: enrichedConcepts, warning: result.data.warning });
  } catch (e) {
    console.error("[generate-prompts] failed:", e.message);
    logPromptGeneration({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: roleAwareUserMessage,
      rawResponse: null,
      error: e.message,
      ok: false,
    });
    res.status(500).json({ code: "server_error", error: "Mockup generation failed" });
  }
});

app.post("/api/analyze-product", async (req, res) => {
  if (!requireAuth(req, res)) return;
  const productDescription = safeText(req.body?.productDescription || "", 5000).trim();
  if (!productDescription) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const cacheKey = sha256Short(productDescription.trim().toLowerCase(), 16);
  const cached = analyzeProductCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.data, cacheKey, cached: true });
  }
  const { gemini } = loadKeys();
  if (!gemini) {
    return res.status(503).json({ code: "service_missing", error: "Product analysis service is not configured" });
  }
  const systemPrompt = `You are a print-on-demand Etsy market expert.
Analyze this product and return suggestions in JSON:
{
  niche: string[] (3-5 niche suggestions, specific not generic),
  targetAudience: string[] (4-6 audience segments, e.g. 'dog moms 25-40',
    'college students', 'cottagecore enthusiasts'),
  style: string[] (4-6 visual styles that fit this product,
    e.g. 'minimalist', 'bold maximalist', 'dark academia', 'pastel aesthetic'),
  occasion: string[] (3-5 occasions, e.g. 'birthday gift', 'self-purchase',
    'mothers day', 'back to school'),
  pricePoint: string[] (2-3 options: 'budget $15-20', 'mid $25-35', 'premium $40+'),
  keywords: string[] (8-10 top Etsy search keywords for this product)
}
Product: [productDescription]
Return only valid JSON, no markdown.`;
  const buildBody = () => ({
    systemInstruction: { parts: [{ text: systemPrompt.replace("[productDescription]", productDescription) }] },
    generationConfig: { maxOutputTokens: 400, responseMimeType: "application/json" },
    contents: [{
      role: "user",
      parts: [{ text: `Product: ${productDescription}` }],
    }],
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetchJsonWithRetry("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": gemini,
        },
        body: JSON.stringify(buildBody()),
      }, { retries: 1, delayMs: 800, label: "gemini analyze-product" });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const raw = getGeminiText(data);
      const parsed = normalizeAnalysisSuggestions(extractJsonObject(raw));
      if (parsed) {
        const payload = { ...parsed, cacheKey, cached: false };
        pruneAnalyzeCache();
        analyzeProductCache.set(cacheKey, { data: parsed, expiresAt: Date.now() + ANALYZE_PRODUCT_CACHE_TTL_MS });
        return res.json(payload);
      }
      console.warn(`[analyze-product] invalid JSON on attempt ${attempt + 1}`, {
        rawLength: raw.length,
        preview: raw.slice(0, 300),
      });
    }
    return res.status(502).json({ error: "Product analysis failed" });
  } catch (error) {
    console.error("[analyze-product] failed:", error.message);
    return res.status(502).json({ error: "Product analysis failed" });
  }
});

app.post("/api/generate-listing-copy", async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const productDescription = safeText(req.body?.productDescription || "", 4000).trim();
  const niche = safeText(req.body?.niche || "", 200).trim();
  const targetAudience = safeText(req.body?.targetAudience || "", 200).trim();
  const style = safeText(req.body?.style || "", 200).trim();
  const selectedNiche = Array.isArray(req.body?.selectedNiche) ? req.body.selectedNiche : [];
  const selectedAudience = Array.isArray(req.body?.selectedAudience) ? req.body.selectedAudience : [];
  const selectedStyle = Array.isArray(req.body?.selectedStyle) ? req.body.selectedStyle : [];
  const selectedOccasion = Array.isArray(req.body?.selectedOccasion) ? req.body.selectedOccasion : [];
  const selectedPricePoint = safeText(req.body?.selectedPricePoint || "", 40).trim();
  const selectedKeywords = Array.isArray(req.body?.selectedKeywords) ? req.body.selectedKeywords : [];

  if (!productDescription || !niche || !targetAudience || !style) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { gemini } = loadKeys();
  if (!gemini) {
    return res.status(503).json({ code: "service_missing", error: "Listing copy service is not configured" });
  }

  const systemPrompt = `You are an expert Etsy SEO copywriter specializing in print-on-demand.
Generate a complete Etsy listing in JSON with these exact fields:
{
  title: string (max 140 chars, front-load top keywords),
  description: string (800-1200 chars, conversational tone,
    structure: hook → product details → sizing/care → brand story → CTA),
  tags: string[] (exactly 13 tags, each max 20 chars,
    mix of: 2-3 broad, 4-5 mid-tail, 4-5 long-tail, 1-2 occasion/gift),
  materials: string[] (3-5 material tags for Etsy materials field),
  seo_notes: string (brief explanation of keyword strategy used)
}
Base everything on this product research:
niche: [niche], audience: [targetAudience], style: [style],
product: [productDescription].
${buildSelectedContextBlock({
  selectedNiche,
  selectedAudience,
  selectedStyle,
  selectedOccasion,
  selectedPricePoint,
  selectedKeywords,
})}
Return only valid JSON, no markdown.`;

  const userMessage = `niche: ${niche}
targetAudience: ${targetAudience}
style: ${style}
productDescription: ${productDescription}`;

  const attemptGenerate = async () => {
    const response = await fetchJsonWithRetry("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: systemPrompt,
          }],
        },
        generationConfig: {
          maxOutputTokens: 2400,
          responseMimeType: "application/json",
        },
        contents: [{
          role: "user",
          parts: [{
            text: userMessage,
          }],
        }],
      }),
    }, { retries: 2, delayMs: 1200, label: "gemini listing-copy" });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  };

  try {
    let raw = "";
    let parsed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await attemptGenerate();
      raw = getGeminiText(data);
      parsed = normalizeListingCopyPayload(extractJsonObject(raw));
      if (parsed) {
        return res.json(parsed);
      }
      console.warn(`[listing-copy] invalid JSON on attempt ${attempt + 1}`, {
        rawLength: raw.length,
        preview: raw.slice(0, 300),
      });
    }
    return res.status(502).json({ error: "Listing copy generation failed" });
  } catch (error) {
    console.error("[listing-copy] failed:", error.message);
    return res.status(502).json({ error: "Listing copy generation failed" });
  }
});

function normalizeListingSetPayload(payload) {
  if (!Array.isArray(payload) || payload.length !== 20) return null;
  const normalized = payload.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const slotNumber = Number(item.slot_number);
    const slotName = safeText(item.slot_name, 80).trim();
    const prompt = safeText(item.prompt, 5000).trim();
    const shotType = safeText(item.shot_type, 80).trim();
    const priority = Number(item.priority);
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 20) return null;
    if (!slotName || !prompt || !shotType) return null;
    if (![1, 2, 3].includes(priority)) return null;
    if (slotNumber !== index + 1) return null;
    return {
      slot_number: slotNumber,
      slot_name: slotName,
      prompt,
      shot_type: shotType,
      priority,
    };
  });
  if (normalized.some(item => !item)) return null;
  return normalized;
}

app.post("/api/generate-listing-set", async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const productDescription = safeText(req.body?.productDescription || "", 5000).trim();
  const selectedNiche = Array.isArray(req.body?.selectedNiche) ? req.body.selectedNiche : [];
  const selectedAudience = Array.isArray(req.body?.selectedAudience) ? req.body.selectedAudience : [];
  const selectedStyle = Array.isArray(req.body?.selectedStyle) ? req.body.selectedStyle : [];
  const selectedOccasion = Array.isArray(req.body?.selectedOccasion) ? req.body.selectedOccasion : [];
  const selectedPricePoint = safeText(req.body?.selectedPricePoint || "", 40).trim();
  const selectedKeywords = Array.isArray(req.body?.selectedKeywords) ? req.body.selectedKeywords : [];

  const { gemini } = loadKeys();
  if (!gemini) {
    return res.status(503).json({ code: "service_missing", error: "Listing set service is not configured" });
  }

  const systemPrompt = `You are an expert Etsy product photographer and mockup strategist
specializing in print-on-demand.
Generate exactly 20 mockup prompts as a complete Etsy listing image set.
Each prompt must serve a distinct slot role from this ordered list:
  1  hero           - main listing image, lifestyle, highest conversion impact
  2  lifestyle_1    - in-use, natural setting
  3  lifestyle_2    - different environment or demographic
  4  lifestyle_3    - gifting or occasion context
  5  detail_1       - closeup of print or graphic
  6  detail_2       - fabric texture or material quality
  7  detail_3       - stitching, tag, or finishing detail
  8  scale          - worn or held to show size in context
  9  flat_lay_1     - clean flat lay, neutral background
  10 flat_lay_2     - flat lay with props or context items
  11 packaging      - folded, tagged, or in packaging
  12 back_view      - rear angle of garment
  13 side_view      - side profile angle
  14 group          - multiple colorways or variants together
  15 editorial_1    - styled, fashion-forward shot
  16 editorial_2    - movement or action shot
  17 size_chart     - mockup-style size guide visual
  18 gifting        - wrapped, gift bag, or occasion scene
  19 social_proof   - review quote overlaid on product shot
  20 brand_story    - brand or shop identity lifestyle shot

Slots 1-10 must prioritize visual impact and conversion.
Slots 11-20 support trust, brand, and SEO.

Product context:
  niche: [selectedNiche]
  audience: [selectedAudience]
  style: [selectedStyle]
  occasion: [selectedOccasion]
  price point: [selectedPricePoint]
  focus keywords: [selectedKeywords]
  product: [productDescription]

Return ONLY a valid JSON array of exactly 20 objects, no markdown:
[
  {
    slot_number: number,
    slot_name: string,
    prompt: string (detailed Flux-ready image generation prompt),
    shot_type: string,
    priority: number (1=highest, 3=lowest)
  }
]`;

  const joinOrEmpty = arr => (Array.isArray(arr) ? arr.map(item => safeText(item, 120).trim()).filter(Boolean).join(", ") : "");
  const userMessage = `Product context:
niche: ${joinOrEmpty(selectedNiche)}
audience: ${joinOrEmpty(selectedAudience)}
style: ${joinOrEmpty(selectedStyle)}
occasion: ${joinOrEmpty(selectedOccasion)}
price point: ${selectedPricePoint}
focus keywords: ${joinOrEmpty(selectedKeywords)}
product: ${productDescription}`;

  const attemptGenerate = async () => {
    const response = await fetchJsonWithRetry("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: systemPrompt.replace("[selectedNiche]", joinOrEmpty(selectedNiche))
              .replace("[selectedAudience]", joinOrEmpty(selectedAudience))
              .replace("[selectedStyle]", joinOrEmpty(selectedStyle))
              .replace("[selectedOccasion]", joinOrEmpty(selectedOccasion))
              .replace("[selectedPricePoint]", selectedPricePoint || "Not provided")
              .replace("[selectedKeywords]", joinOrEmpty(selectedKeywords))
              .replace("[productDescription]", productDescription || "Not provided"),
          }],
        },
        generationConfig: {
          maxOutputTokens: 2000,
          responseMimeType: "application/json",
        },
        contents: [{
          role: "user",
          parts: [{
            text: userMessage,
          }],
        }],
      }),
    }, { retries: 1, delayMs: 900, label: "gemini listing-set" });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  };

  try {
    let parsed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await attemptGenerate();
      parsed = normalizeListingSetPayload(extractJsonArray(getGeminiText(data)));
      if (parsed) {
        return res.json({ slots: parsed, total: parsed.length });
      }
      console.warn(`[listing-set] invalid JSON on attempt ${attempt + 1}`, {
        rawLength: getGeminiText(data).length,
        preview: getGeminiText(data).slice(0, 300),
      });
    }
    return res.status(502).json({ error: "Listing set generation failed" });
  } catch (error) {
    console.error("[listing-set] failed:", error.message);
    return res.status(502).json({ error: "Listing set generation failed" });
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
    return res.status(503).json({ code: "service_missing", error: "Image analysis service is not configured" });
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
    res.status(500).json({ code: "server_error", error: "Image analysis failed" });
  }
});

app.post("/api/ai-fix-suggestion", async (req, res) => {
  if (!requireAppAccess(req, res)) return;
  const { fluxPrompt, qaChecklist, customPrompt, imageBase64, imageType, printVisibility, mockupStyleMode, mockupStyleBrief, listingRole = "", listingRolePhase = "", listingRoleVariant = "", visiblePrint, riskAnalysis = {}, businessScores = {}, categoryResearch = "", shirtResearch = "" } = req.body;
  const { gemini } = loadKeys();
  if (!gemini)
    return res.status(503).json({ code: "service_missing", error: "AI fix service is not configured" });

  try {
    const instruction = `You are an ecommerce mockup QA editor performing a SURGICAL correction, not a redo.

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
No preamble, no extra commentary — just the correction prompt.`;
    const result = await runAgent("auto_fix", {
      instruction,
      imageBase64,
      imageType,
      listingRole,
      mockupStyleMode,
    }, {
      gemini,
      getGeminiText,
      persistLog: persistAgentLog,
    });
    res.json({ suggestion: result.data.suggestion });
  } catch (e) {
    console.error("[ai-fix-suggestion] failed:", e.message);
    res.status(500).json({ code: "server_error", error: "AI fix failed" });
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
    selectedNiche = [],
    selectedAudience = [],
    selectedStyle = [],
    selectedOccasion = [],
    selectedPricePoint = "",
    selectedKeywords = [],
  } = req.body;
  const { replicate } = loadKeys();
  if (!replicate)
    return res.status(503).json({ code: "service_missing", error: "Image generation service is not configured" });
  if (!imageBase64)
    return res.status(400).json({ error: "Reference image ni poslana." });

  const requestId = `regen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  const userSession = getUserSession(req);
  let creditCharge = { allowed: true, cost: 0, balance: null };
  if (userSession?.userId) {
    try {
      creditCharge = await enforceUserCredits(userSession.userId, "mockup_generation", {
        requestId,
        source: "generate-image",
        model_name: "black-forest-labs/flux-kontext-dev",
      });
    } catch (error) {
      const code = creditStorageErrorCode(error);
      if (code === "user_not_found") {
        return res.status(404).json({ code: "user_not_found", error: "User not found" });
      }
      console.error(`[generate-image ${requestId}] credit check failed:`, error.message);
      return res.status(500).json({ code: "server_error", error: "Credit check failed" });
    }
    if (!creditCharge.allowed) {
      return res.status(402).json({ code: "insufficient_credits", error: "Insufficient credits" });
    }
  }
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
    for (const ref of referenceImages.slice(0, 4)) {
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
      selectedNiche,
      selectedAudience,
      selectedStyle,
      selectedOccasion,
      selectedPricePoint,
      selectedKeywords,
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
    let qualityReport = null;
    if (gemini) {
      try {
        const qualityResult = await runAgent("quality_inspector", {
          imageUrl: url,
          originalDesignUrl: inputImage,
          mockupPrompt: finalPrompt,
        }, {
          gemini,
          fetchJsonWithRetry,
          getGeminiText,
          persistLog: persistAgentLog,
        });
        qualityReport = qualityResult.data;
      } catch (inspectError) {
        console.warn(`[generate-image ${requestId}] quality inspection skipped:`, inspectError.message);
      }
    }
    if (!qualityReport) {
      qualityReport = fallbackQualityReport({
        businessScores,
        riskAnalysis,
        prompt: finalPrompt,
      });
    }
    console.log(`[generate-image ${requestId}] success`, {
      hasOutput: !!url,
      mimeType: "image/png",
      promptWordCount: countWords(finalPrompt),
      qualityScore: qualityReport?.score ?? null,
      businessScores,
    });
    const generationRecord = await recordGenerationRecord({
      user_id: userSession?.userId || null,
      client_generation_id: requestId,
      generation_type: "mockup_image",
      prompt: finalPrompt,
      prompt_hash: stablePromptHash(finalPrompt),
      model_name: "black-forest-labs/flux-kontext-dev",
      category: listingRole || categoryResearch || "",
      status: "succeeded",
      score: qualityReport?.score ?? businessScores?.etsy_conversion_score ?? businessScores?.realism_score ?? null,
      credits_used: creditCharge.cost || 0,
      negative_prompt: "",
      scene_type: environment || mockupStyleMode || "",
      target_audience: targetBuyer || "",
      duration_ms: Date.now() - startedAt,
      estimated_cost: 0,
      review_status: "pending",
      meta: {
        requestId,
        printVisibility,
        mockupStyleMode,
        mockupStyleBrief,
        listingRole,
        listingRolePhase,
        listingRoleVariant,
        visiblePrint: resolvedVisiblePrint,
        riskAnalysis,
        businessScores,
        categoryResearch,
        shirtResearch,
        environment,
        targetBuyer,
        pose,
        cameraSetup,
        lighting,
        selectedNiche,
        selectedAudience,
        selectedStyle,
        selectedOccasion,
        selectedPricePoint,
        selectedKeywords,
        referenceCount: referenceImages.length,
        qualityReport,
      },
    });
    const qualityRecord = await recordQualityRecord({
      user_id: userSession?.userId || null,
      generation_id: generationRecord?.id || null,
      prompt: finalPrompt,
      model_name: "black-forest-labs/flux-kontext-dev",
      style_key: mockupStyleMode || "",
      category: listingRole || categoryResearch || "",
      report: qualityReport,
      metadata: {
        requestId,
        printVisibility,
        listingRole,
        listingRolePhase,
        listingRoleVariant,
        visiblePrint: resolvedVisiblePrint,
      },
    });
    res.json({
      url,
      mimeType: "image/png",
      qualityReport,
      generationId: generationRecord?.id || null,
      qualityRecordId: qualityRecord?.id || null,
    });
  } catch (e) {
    console.error(`[generate-image ${requestId}] error`, e.message);
    if (userSession?.userId && creditCharge.cost > 0 && !CHARGE_FAILED_GENERATIONS) {
      try {
        await addCreditTransaction(userSession.userId, "refund:mockup_generation", creditCharge.cost, {
          requestId,
          source: "generate-image",
          reason: "generation_failed",
          model_name: "black-forest-labs/flux-kontext-dev",
        });
      } catch (refundError) {
        console.error(`[generate-image ${requestId}] refund failed:`, refundError.message);
        await writeSystemLog("credit_refund_failed", "Generation refund failed", {
          severity: "high",
          userId: userSession?.userId || null,
          metadata: {
            requestId,
            model: "black-forest-labs/flux-kontext-dev",
            error: refundError.message,
          },
        }).catch(() => {});
      }
    }
    await recordGenerationRecord({
      user_id: userSession?.userId || null,
      client_generation_id: requestId,
      generation_type: "mockup_image",
      prompt: fluxPrompt || "",
      prompt_hash: stablePromptHash(fluxPrompt || ""),
      model_name: "black-forest-labs/flux-kontext-dev",
      category: listingRole || categoryResearch || "",
      status: "failed",
      credits_used: 0,
      scene_type: environment || mockupStyleMode || "",
      target_audience: targetBuyer || "",
      duration_ms: Date.now() - startedAt,
      review_status: "needs_fix",
      meta: {
        requestId,
        failureCode: "image_generation_failed",
        printVisibility,
        mockupStyleMode,
        listingRole,
        environment,
        targetBuyer,
      },
    });
    await writeSystemLog("generation_failed", "Image generation failed", {
      severity: "high",
      userId: getUserSession(req)?.userId || null,
      metadata: { requestId, model: "black-forest-labs/flux-kontext-dev" },
    });
    res.status(500).json({ code: "server_error", error: "Image generation failed" });
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
