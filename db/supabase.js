const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function safeText(value, max = 120) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

function safeInteger(value, min = 0, max = 2147483647) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function safeLimit(value, fallback = 20, max = 100) {
  return Math.max(1, Math.min(max, safeInteger(value, 1, max) || fallback));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
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

async function supabaseRestInsertSchema(schema, resource, rows, { onConflict, merge = false } = {}) {
  if (!rows.length) return;
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  if (onConflict) url.searchParams.set("on_conflict", onConflict);
  const prefer = ["return=minimal"];
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

async function loadUserById(userId) {
  const rows = await supabaseRestQuerySchema("public", "ko_users", {
    params: { id: `eq.${userId}` },
    limit: 1,
  });
  return rows[0] || null;
}

async function loadUserByLogin(login) {
  const rows = await supabaseRestQuerySchema("public", "ko_users", {
    params: { or: `(email.eq.${login},username.eq.${login})` },
    limit: 1,
  });
  return rows[0] || null;
}

module.exports = {
  safeText,
  safeInteger,
  safeLimit,
  isUuid,
  authStorageConfigured,
  supabaseConnectionInfo,
  authStorageErrorCode,
  authStorageDiagnostic,
  sanitizeUserRow,
  supabaseRestQuerySchema,
  supabaseRestInsertSchema,
  supabaseRestPatchSchema,
  loadUserById,
  loadUserByLogin,
};
