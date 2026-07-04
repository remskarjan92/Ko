const {
  adminSessionConfigured,
  rateLimitAdminLogin,
  rateLimitUserLogin,
  timingSafeEqualString,
  verifyAdminPassword,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  clearUserSessionCookie,
  setUserSessionCookie,
  createPasswordHash,
  normalizeAuthEmail,
  normalizeAuthUsername,
  requireUser,
} = require("../middleware/auth");
const {
  authStorageConfigured,
  authStorageErrorCode,
  authStorageDiagnostic,
  supabaseConnectionInfo,
  supabaseRestQuerySchema,
  supabaseRestInsertSchema,
  supabaseRestPatchSchema,
  loadUserByLogin,
  loadUserById,
  sanitizeUserRow,
} = require("../db/supabase");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USER_SESSION_SECRET = process.env.USER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || "";
const DEFAULT_STARTING_CREDITS = Number(process.env.DEFAULT_STARTING_CREDITS || 100);

function registerAuthRoutes(app) {
  app.get("/api/admin/session", (req, res) => {
    const session = require("../middleware/auth").getAdminSession(req);
    res.json({
      authenticated: !!session,
      username: session?.username || null,
      configured: adminSessionConfigured(),
      tokenFallbackEnabled: !!process.env.ADMIN_TOKEN,
    });
  });

  app.post("/api/admin/login", (req, res) => {
    if (!adminSessionConfigured()) {
      return res.status(503).json({ error: "Admin login is not configured" });
    }
    if (!rateLimitAdminLogin(req, res)) return;

    const { username, password } = req.body || {};
    const usernameOk = timingSafeEqualString(username, process.env.ADMIN_USERNAME || "");
    const passwordOk = verifyAdminPassword(password);
    if (!usernameOk || !passwordOk) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    setAdminSessionCookie(res, process.env.ADMIN_USERNAME || "");
    res.json({ ok: true, username: process.env.ADMIN_USERNAME || "" });
  });

  app.post("/api/admin/logout", (req, res) => {
    clearAdminSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/session", (req, res) => {
    const session = require("../middleware/auth").getUserSession(req);
    res.json({
      authenticated: !!session,
      userId: session?.userId || null,
      username: session?.username || null,
      email: session?.email || null,
      configured: !!USER_SESSION_SECRET,
      storageConfigured: authStorageConfigured(),
      storage: supabaseConnectionInfo(),
      build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "local",
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    if (!USER_SESSION_SECRET) return res.status(503).json({ code: "user_auth_not_configured", error: "Account creation is not configured" });
    if (!authStorageConfigured()) return res.status(503).json({ code: "auth_storage_not_configured", error: "Account storage is not configured" });
    if (!rateLimitUserLogin(req, res)) return;
    try {
      const email = normalizeAuthEmail(req.body?.email);
      const username = normalizeAuthUsername(req.body?.username);
      const password = String(req.body?.password || "");
      if (!email || !email.includes("@") || !username || password.length < 8) {
        return res.status(400).json({ code: "invalid_registration", error: "Invalid registration details" });
      }
      if (username.length < 3) {
        return res.status(400).json({ code: "invalid_registration", error: "Username must be at least 3 characters (letters, numbers, _ or -)" });
      }
      const existingByEmail = await supabaseRestQuerySchema("public", "ko_users", {
        params: { email: `eq.${email}` },
        limit: 1,
      });
      if (existingByEmail.length) return res.status(409).json({ code: "account_exists", error: "Account already exists" });
      const existingByUsername = await supabaseRestQuerySchema("public", "ko_users", {
        params: { username: `eq.${username}` },
        limit: 1,
      });
      if (existingByUsername.length) return res.status(409).json({ code: "account_exists", error: "Account already exists" });
      const password_hash = createPasswordHash(password);
      const [user] = await (async () => {
        const res2 = await fetch(`${SUPABASE_URL}/rest/v1/ko_users`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "Content-Profile": "public",
          },
          body: JSON.stringify([{
            email,
            username,
            password_hash,
            plan_type: "free",
            account_status: "active",
            credits_balance: DEFAULT_STARTING_CREDITS,
          }]),
        });
        if (!res2.ok) {
          const text = await res2.text().catch(() => "");
          throw new Error(text || `HTTP ${res2.status}`);
        }
        return await res2.json();
      })();
      if (!user?.id) throw new Error("Supabase ko_users insert returned no user");
      await supabaseRestInsertSchema("public", "ko_credit_transactions", [{
        user_id: user.id,
        action: "welcome_credit",
        credit_type: "standard",
        credits_added: DEFAULT_STARTING_CREDITS,
        credits_removed: 0,
        balance_after: DEFAULT_STARTING_CREDITS,
        metadata: { source: "register" },
      }]).catch(error => {
        console.warn("[auth/register] welcome credit transaction skipped:", error.message);
      });
      setUserSessionCookie(res, user);
      res.json({ ok: true, user: sanitizeUserRow(user) });
    } catch (e) {
      const code = authStorageErrorCode(e);
      console.error("[auth/register] failed:", e.message);
      if (code === "account_exists") return res.status(409).json({ code, error: "Account already exists" });
      if (code === "auth_storage_not_configured") return res.status(503).json({ code, error: "Account storage is not configured" });
      if (code === "auth_storage_permission") return res.status(503).json({ code, error: "Account storage permission failed" });
      if (code === "auth_schema_missing") return res.status(503).json({ code, error: "Account database is not ready" });
      if (code === "auth_schema_mismatch") return res.status(503).json({ code, error: "Account database schema does not match the app" });
      res.status(500).json({ code: "server_error", error: "Registration failed", diagnostic: authStorageDiagnostic(e) });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    if (!USER_SESSION_SECRET) return res.status(503).json({ code: "user_auth_not_configured", error: "Account sessions are not configured" });
    if (!authStorageConfigured()) return res.status(503).json({ code: "auth_storage_not_configured", error: "Account storage is not configured" });
    if (!rateLimitUserLogin(req, res)) return;
    try {
      const login = String(req.body?.login || req.body?.email || req.body?.username || "").trim().slice(0, 180);
      const password = String(req.body?.password || "");
      if (!login || !password) return res.status(400).json({ code: "missing_credentials", error: "Email or username and password are required" });
      const user = await loadUserByLogin(login);
      if (!user) return res.status(404).json({ code: "user_not_found", error: "User not found" });
      if (user.account_status !== "active") return res.status(403).json({ code: "account_disabled", error: "Account is not active" });
      if (!require("../middleware/auth").verifyPasswordHash(password, user.password_hash)) return res.status(401).json({ code: "wrong_password", error: "Wrong password" });
      await supabaseRestPatchSchema("public", "ko_users", "id", user.id, {
        last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setUserSessionCookie(res, user);
      res.json({ ok: true, user: sanitizeUserRow(user) });
    } catch (e) {
      const code = authStorageErrorCode(e);
      console.error("[auth/login] failed:", e.message);
      if (code === "auth_storage_not_configured") return res.status(503).json({ code, error: "Account storage is not configured" });
      if (code === "auth_storage_permission") return res.status(503).json({ code, error: "Account storage permission failed" });
      if (code === "auth_schema_missing") return res.status(503).json({ code, error: "Account database is not ready" });
      if (code === "auth_schema_mismatch") return res.status(503).json({ code, error: "Account database schema does not match the app" });
      res.status(500).json({ code: "server_error", error: "Login failed", diagnostic: authStorageDiagnostic(e) });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    clearUserSessionCookie(res);
    res.json({ ok: true });
  });

  app.post("/api/auth/forgot-password", (req, res) => {
    res.json({ ok: true, message: "If the account exists, a reset link would be sent." });
  });

  app.patch("/api/me/account", async (req, res) => {
    const session = requireUser(req, res);
    if (!session) return;
    try {
      const patch = {};
      if (req.body?.username) patch.username = String(req.body.username).slice(0, 80);
      if (req.body?.password) patch.password_hash = createPasswordHash(String(req.body.password));
      patch.updated_at = new Date().toISOString();
      await supabaseRestPatchSchema("public", "ko_users", "id", session.userId, patch);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Account update failed" });
    }
  });

  app.get("/api/me/account", async (req, res) => {
    const session = requireUser(req, res);
    if (!session) return;
    try {
      const user = await loadUserById(session.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json({ user: sanitizeUserRow(user) });
    } catch (e) {
      res.status(500).json({ error: "Account lookup failed" });
    }
  });
}

module.exports = { registerAuthRoutes };
