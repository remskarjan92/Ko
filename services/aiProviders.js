function keySource(type) {
  if (type === "gemini") return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "env" : "file";
  return process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN ? "env" : "file";
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

module.exports = { keySource, getGeminiText, sleep, extractRateLimitWaitMs, fetchJsonWithRetry };
