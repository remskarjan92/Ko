const crypto = require("crypto");

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
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
const USER_LOGIN_RATE_WINDOW_MS = 60 * 1000;
const USER_LOGIN_RATE_MAX = 10;

const adminLoginRateBuckets = new Map();
const userLoginRateBuckets = new Map();

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

function verifyUserSessionToken(token) {
  if (!USER_SESSION_SECRET || !token || !token.includes(".")) return null;
  const lastDot = token.lastIndexOf(".");
  const body = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
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

function getAdminSession(req) {
  return verifyAdminSessionToken(parseCookies(req)[ADMIN_SESSION_COOKIE]);
}

function getUserSession(req) {
  return verifyUserSessionToken(parseCookies(req)[USER_SESSION_COOKIE]);
}

function cookieParts(maxAgeMs = ADMIN_SESSION_TTL_MS) {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts;
}

function adminCookieParts(maxAgeMs = ADMIN_SESSION_TTL_MS) {
  return cookieParts(maxAgeMs);
}

function userCookieParts(maxAgeMs = USER_SESSION_TTL_MS) {
  return cookieParts(maxAgeMs);
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

function rateLimitBucket(buckets, windowMs, max, req, res, label) {
  const key = hashRateLimitKey(req);
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > max) {
    res.status(429).json({ error: `Too many ${label}` });
    return false;
  }
  return true;
}

function rateLimitUserLogin(req, res) {
  return rateLimitBucket(userLoginRateBuckets, USER_LOGIN_RATE_WINDOW_MS, USER_LOGIN_RATE_MAX, req, res, "requests");
}

function rateLimitAdminLogin(req, res) {
  return rateLimitBucket(adminLoginRateBuckets, ADMIN_LOGIN_RATE_WINDOW_MS, ADMIN_LOGIN_RATE_MAX, req, res, "login attempts");
}

function getAuthToken(req) {
  const header = req.get("x-admin-token") || "";
  if (header) return header;
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function getAppAccessToken(req) {
  const header = req.get("x-app-token") || "";
  if (header) return header;
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function hashRateLimitKey(req) {
  const source = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  return crypto.createHash("sha256").update(String(source)).digest("hex");
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

function requireAppAccess(req, res) {
  if (getUserSession(req) || getAdminSession(req)) return true;
  if (process.env.APP_ACCESS_TOKEN && getAppAccessToken(req) === process.env.APP_ACCESS_TOKEN) return true;
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

function adminActor(req) {
  const session = getAdminSession(req);
  return session?.username || ADMIN_USERNAME || "admin";
}

function normalizeAuthEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 180);
}

function normalizeAuthUsername(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30);
}

module.exports = {
  ADMIN_TOKEN,
  ADMIN_USERNAME,
  ADMIN_PASSWORD_HASH,
  ADMIN_SESSION_COOKIE,
  USER_SESSION_COOKIE,
  adminSessionConfigured,
  parseCookies,
  timingSafeEqualString,
  signAdminSession,
  signUserSession,
  verifyAdminSessionToken,
  verifyUserSessionToken,
  getAdminSession,
  getUserSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  setUserSessionCookie,
  clearUserSessionCookie,
  verifyAdminPassword,
  createPasswordHash,
  verifyPasswordHash,
  rateLimitUserLogin,
  rateLimitAdminLogin,
  getAuthToken,
  getAppAccessToken,
  hashRateLimitKey,
  requireAdmin,
  requireAppAccess,
  requireUser,
  requireAuth,
  adminActor,
  normalizeAuthEmail,
  normalizeAuthUsername,
};
