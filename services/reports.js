const ANALYTICS_SCHEMA = "analytics_private";

function createReportsService({
  analyticsConfigReady = () => true,
  supabaseRestQuerySchema,
  supabaseRestSelect,
  supabaseRestQuery,
  supabaseRestRpc,
  LEARNING_MIN_SAMPLES = 5,
  RESEARCH_EXPORT_MAX_ROWS = 5000,
  LEARNING_DIMENSIONS = new Set([
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
  ]),
} = {}) {
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

  function safeMinSamples(value) {
    return Math.max(5, safeInteger(value, 1, 100000) || LEARNING_MIN_SAMPLES);
  }

  function parseIsoDay(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
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

  function summarizeDailyRows(rows = [], dateKey = "created_at") {
    const grouped = new Map();
    for (const row of rows) {
      const day = parseIsoDay(row[dateKey]) || parseIsoDay(new Date()) || "";
      const item = grouped.get(day) || {
        day,
        count: 0,
        credits_used: 0,
        credits_added: 0,
        score_weighted: 0,
        score_count: 0,
      };
      item.count += 1;
      item.credits_used += Number(row.credits_used || row.credits_removed || 0);
      item.credits_added += Number(row.credits_added || 0);
      const score = Number(row.score);
      if (Number.isFinite(score)) {
        item.score_weighted += score;
        item.score_count += 1;
      }
      grouped.set(day, item);
    }
    return Array.from(grouped.values()).sort((a, b) => a.day.localeCompare(b.day)).map(item => ({
      day: item.day,
      count: item.count,
      credits_used: item.credits_used,
      credits_added: item.credits_added,
      avg_score: item.score_count ? Number((item.score_weighted / item.score_count).toFixed(2)) : null,
    }));
  }

  function summarizeGenerationRecords(rows = []) {
    const totals = {
      total_images: rows.length,
      this_month: 0,
      credits_used: 0,
      avg_score: null,
      success_rate: null,
      status_counts: {},
    };
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    let scoreSum = 0;
    let scoreCount = 0;
    let successCount = 0;
    rows.forEach(row => {
      const created = row.created_at ? new Date(row.created_at) : null;
      if (created && !Number.isNaN(created.getTime())) {
        const rowMonth = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, "0")}`;
        if (rowMonth === monthKey) totals.this_month += 1;
      }
      totals.credits_used += Number(row.credits_used) || 0;
      const score = Number(row.score);
      if (Number.isFinite(score)) {
        scoreSum += score;
        scoreCount += 1;
      }
      const status = safeText(row.status, 40) || "unknown";
      totals.status_counts[status] = (totals.status_counts[status] || 0) + 1;
      if (status === "succeeded") successCount += 1;
    });
    totals.avg_score = scoreCount ? Number((scoreSum / scoreCount).toFixed(2)) : null;
    totals.success_rate = rows.length ? Number(((successCount / rows.length) * 100).toFixed(2)) : null;
    return totals;
  }

  function summarizeUsers(rows = []) {
    let activeUsers = 0;
    for (const row of rows) {
      if (row.account_status === "active") activeUsers += 1;
    }
    return { total_users: rows.length, active_users: activeUsers };
  }

  function summarizeTransactions(rows = []) {
    let totalCreditsConsumed = 0;
    for (const row of rows) totalCreditsConsumed += Number(row.credits_removed || 0);
    return { total_credits_consumed: totalCreditsConsumed };
  }

  function summarizeFailureRows(rows = []) {
    const counts = {};
    for (const row of rows) {
      const category = row.category || "other";
      counts[category] = (counts[category] || 0) + 1;
    }
    return counts;
  }

  function summarizeQualityRows(rows = []) {
    const total = rows.length;
    const scoreSum = rows.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
    const issueCounts = new Map();
    const promptScores = new Map();
    const styleScores = new Map();

    for (const row of rows) {
      const issues = Array.isArray(row.detected_issues) ? row.detected_issues : [];
      for (const issue of issues) {
        const code = safeText(issue?.code || issue?.label, 80) || "other";
        issueCounts.set(code, (issueCounts.get(code) || 0) + 1);
      }

      const promptKey = safeText(row.prompt, 220);
      if (promptKey) {
        const current = promptScores.get(promptKey) || { prompt: promptKey, total: 0, count: 0 };
        current.total += Number(row.score) || 0;
        current.count += 1;
        promptScores.set(promptKey, current);
      }

      const styleKey = safeText(row.style_key, 120) || "unknown";
      const style = styleScores.get(styleKey) || { style_key: styleKey, total: 0, count: 0 };
      style.total += Number(row.score) || 0;
      style.count += 1;
      styleScores.set(styleKey, style);
    }

    const topPrompts = Array.from(promptScores.values())
      .map(item => ({ prompt: item.prompt, average_score: item.count ? Number((item.total / item.count).toFixed(2)) : 0, sample_count: item.count }))
      .sort((a, b) => b.average_score - a.average_score || b.sample_count - a.sample_count)
      .slice(0, 5);

    const styles = Array.from(styleScores.values())
      .map(item => ({ style_key: item.style_key, average_score: item.count ? Number((item.total / item.count).toFixed(2)) : 0, sample_count: item.count }))
      .sort((a, b) => b.average_score - a.average_score || b.sample_count - a.sample_count);

    return {
      average_score: total ? Number((scoreSum / total).toFixed(2)) : null,
      top_prompts: topPrompts,
      common_failures: Array.from(issueCounts.entries()).map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      best_styles: styles.slice(0, 5),
      worst_styles: [...styles].reverse().slice(0, 5),
    };
  }

  function summarizeRatingRows(rows = []) {
    const keys = ["overall_score", "etsy_readiness", "realism"];
    const totals = Object.fromEntries(keys.map(key => [key, { sum: 0, count: 0 }]));
    for (const row of rows) {
      for (const key of keys) {
        const value = Number(row[key]);
        if (Number.isFinite(value)) {
          totals[key].sum += value;
          totals[key].count += 1;
        }
      }
    }
    return Object.fromEntries(keys.map(key => [
      key,
      totals[key].count ? Number((totals[key].sum / totals[key].count).toFixed(2)) : null,
    ]));
  }

  function summarizeGenerationDashboardRows(rows = []) {
    const todayIso = parseIsoDay(new Date());
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const stats = {
      total_generations: rows.length,
      generations_today: 0,
      generations_this_week: 0,
      approved_generations: 0,
      rejected_generations: 0,
      needs_fix_generations: 0,
      pending_reviews: 0,
      reviewed_generations: 0,
      total_images_stored: 0,
      estimated_api_cost: 0,
      total_credits_used: 0,
      success_count: 0,
    };
    for (const row of rows) {
      const created = row.created_at ? new Date(row.created_at) : null;
      if (parseIsoDay(row.created_at) === todayIso) stats.generations_today += 1;
      if (created && !Number.isNaN(created.getTime()) && now - created.getTime() <= weekMs) stats.generations_this_week += 1;
      if (row.review_status === "approved") stats.approved_generations += 1;
      else if (row.review_status === "rejected") stats.rejected_generations += 1;
      else if (row.review_status === "needs_fix") stats.needs_fix_generations += 1;
      else if (!row.review_status || row.review_status === "pending") stats.pending_reviews += 1;
      if (row.review_status === "archived" || row.review_status === "flagged") stats.reviewed_generations += 1;
      if (row.status === "succeeded") stats.success_count += 1;
      if (row.image_url) stats.total_images_stored += 1;
      stats.total_credits_used += Number(row.credits_used || 0);
    }
    stats.estimated_api_cost = Number((stats.total_credits_used * 0.02).toFixed(2));
    stats.reviewed_generations += stats.approved_generations + stats.rejected_generations + stats.needs_fix_generations;
    return stats;
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

  async function loadUserGenerations(userId, query = {}) {
    const rows = await supabaseRestQuerySchema("public", "ko_generation_records", {
      params: { user_id: `eq.${userId}` },
      order: "created_at.desc",
      limit: 500,
    });
    const search = safeText(query.search, 120).toLowerCase();
    const filters = {
      model: safeText(query.model, 120).toLowerCase(),
      category: safeText(query.category, 120).toLowerCase(),
      score: safeText(query.score, 40),
      status: safeText(query.status, 80).toLowerCase(),
      dateFrom: safeText(query.dateFrom, 20),
      dateTo: safeText(query.dateTo, 20),
    };
    const filtered = rows.filter(row => {
      if (filters.model && !String(row.model_name || "").toLowerCase().includes(filters.model)) return false;
      if (filters.category && !String(row.category || "").toLowerCase().includes(filters.category)) return false;
      if (filters.status && !String(row.status || "").toLowerCase().includes(filters.status)) return false;
      if (filters.score) {
        const n = Number(filters.score);
        if (Number.isFinite(n) && Number(row.score) < n) return false;
      }
      const created = row.created_at ? new Date(row.created_at) : null;
      if (filters.dateFrom && created && created < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && created && created > new Date(`${filters.dateTo}T23:59:59.999Z`)) return false;
      const haystack = `${row.prompt || ""} ${row.model_name || ""} ${row.category || ""} ${row.generation_type || ""}`.toLowerCase();
      if (search && !haystack.includes(search)) return false;
      return true;
    });
    return {
      filters,
      rows: filtered.slice(0, safeLimit(query.limit, 50, 250)),
      summary: summarizeGenerationRecords(rows),
      charts: {
        generationsPerDay: summarizeDailyRows(rows),
        creditsUsedPerDay: summarizeDailyRows(rows).map(item => ({ day: item.day, credits_used: item.credits_used })),
      },
    };
  }

  async function loadUserCredits(userId) {
    const user = await supabaseRestQuerySchema("public", "ko_users", {
      params: { id: `eq.${userId}` },
      limit: 1,
    });
    const transactions = await supabaseRestQuerySchema("public", "ko_credit_transactions", {
      params: { user_id: `eq.${userId}` },
      order: "created_at.desc",
      limit: 250,
    });
    return {
      balance: Number(user?.[0]?.credits_balance) || 0,
      transactions: transactions.map(row => ({
        id: row.id,
        action: row.action,
        credits_added: Number(row.credits_added) || 0,
        credits_removed: Number(row.credits_removed) || 0,
        balance_after: Number(row.balance_after) || 0,
        credit_type: row.credit_type || "standard",
        metadata: row.metadata || {},
        created_at: row.created_at || null,
      })),
    };
  }

  async function loadUserDashboard(userId) {
    const [userResult, settingsResult, generationsResult, creditsResult, downloadsResult] = await Promise.allSettled([
      supabaseRestQuerySchema("public", "ko_users", {
        params: { id: `eq.${userId}` },
        limit: 1,
      }).then(rows => rows[0] || null),
      supabaseRestQuerySchema("public", "ko_user_settings", {
        params: { user_id: `eq.${userId}` },
        limit: 1,
      }).then(rows => rows[0] || null),
      loadUserGenerations(userId, {}),
      loadUserCredits(userId),
      supabaseRestQuerySchema(ANALYTICS_SCHEMA, "interaction_events", {
        params: { user_id: `eq.${userId}`, event_type: `in.(download_png,download_zip)` },
        order: "created_at.desc",
        limit: 50,
      }),
    ]);
    const errors = [];
    const user = userResult.status === "fulfilled" ? userResult.value : null;
    if (userResult.status === "rejected") errors.push(`user:${userResult.reason?.message || "failed"}`);
    const settings = settingsResult.status === "fulfilled" ? settingsResult.value : null;
    if (settingsResult.status === "rejected") errors.push(`settings:${settingsResult.reason?.message || "failed"}`);
    const generations = generationsResult.status === "fulfilled" ? generationsResult.value : { rows: [], summary: { this_month: 0, total_images: 0, credits_used: 0, avg_score: null, success_rate: null }, charts: { generationsPerDay: [], creditsUsedPerDay: [] } };
    if (generationsResult.status === "rejected") errors.push(`generations:${generationsResult.reason?.message || "failed"}`);
    const credits = creditsResult.status === "fulfilled" ? creditsResult.value : { balance: 0, transactions: [] };
    if (creditsResult.status === "rejected") errors.push(`credits:${creditsResult.reason?.message || "failed"}`);
    const downloads = downloadsResult.status === "fulfilled" ? downloadsResult.value : [];
    if (downloadsResult.status === "rejected") errors.push(`downloads:${downloadsResult.reason?.message || "failed"}`);
    const genRows = Array.isArray(generations.rows) ? generations.rows : [];
    const monthlyGenerations = generations.summary?.this_month || 0;
    const latestGenerations = genRows.slice(0, 8);
    const recentDownloads = downloads.slice(0, 8).map(row => ({
      id: row.event_id,
      event_type: row.event_type,
      prompt_hash: row.prompt_hash || null,
      created_at: row.created_at || null,
    }));
    return {
      user,
      settings: settings?.default_settings || {},
      summary: {
        credits_balance: credits.balance,
        total_images_generated: generations.summary?.total_images || 0,
        total_generations_this_month: monthlyGenerations,
        total_credits_used: generations.summary?.credits_used || 0,
        average_generation_score: generations.summary?.avg_score ?? null,
        average_generation_success_rate: generations.summary?.success_rate ?? null,
      },
      latest_generations: latestGenerations,
      recent_downloads: recentDownloads,
      charts: generations.charts || { generationsPerDay: [], creditsUsedPerDay: [] },
      warnings: errors,
    };
  }

  async function loadAdminUsers(query = {}) {
    const rows = await supabaseRestQuerySchema("public", "ko_users", {
      order: "created_at.desc",
      limit: 500,
    });
    const search = safeText(query.search, 120).toLowerCase();
    const status = safeText(query.status, 80).toLowerCase();
    const filtered = rows.filter(row => {
      if (search && !`${row.email || ""} ${row.username || ""}`.toLowerCase().includes(search)) return false;
      if (status && !String(row.account_status || "").toLowerCase().includes(status)) return false;
      return true;
    });
    return {
      rows: filtered.slice(0, safeLimit(query.limit, 50, 250)).map(row => ({
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
      })),
    };
  }

  async function loadAdminTransactions(query = {}) {
    const rows = await supabaseRestQuerySchema("public", "ko_credit_transactions", {
      order: "created_at.desc",
      limit: 500,
    });
    const user = safeText(query.user, 120).toLowerCase();
    const action = safeText(query.action, 120).toLowerCase();
    const filtered = rows.filter(row => {
      if (user && !String(row.user_id || "").toLowerCase().includes(user)) return false;
      if (action && !String(row.action || "").toLowerCase().includes(action)) return false;
      return true;
    });
    return {
      rows: filtered.slice(0, safeLimit(query.limit, 100, 250)).map(row => ({
        id: row.id,
        user_id: row.user_id,
        action: row.action,
        credits_added: Number(row.credits_added) || 0,
        credits_removed: Number(row.credits_removed) || 0,
        balance_after: Number(row.balance_after) || 0,
        credit_type: row.credit_type || "standard",
        metadata: row.metadata || {},
        created_at: row.created_at || null,
      })),
    };
  }

  async function loadAdminGenerations(query = {}) {
    const rows = await supabaseRestQuerySchema("public", "ko_generation_records", {
      order: "created_at.desc",
      limit: 500,
    });
    const user = safeText(query.user, 120).toLowerCase();
    const model = safeText(query.model, 120).toLowerCase();
    const category = safeText(query.category, 120).toLowerCase();
    const status = safeText(query.status, 80).toLowerCase();
    const search = safeText(query.search, 120).toLowerCase();
    const filtered = rows.filter(row => {
      if (user && !String(row.user_id || "").toLowerCase().includes(user)) return false;
      if (model && !String(row.model_name || "").toLowerCase().includes(model)) return false;
      if (category && !String(row.category || "").toLowerCase().includes(category)) return false;
      if (status && !String(row.status || "").toLowerCase().includes(status)) return false;
      if (search && !`${row.prompt || ""} ${row.category || ""} ${row.model_name || ""}`.toLowerCase().includes(search)) return false;
      return true;
    });
    return {
      rows: filtered.slice(0, safeLimit(query.limit, 100, 250)),
      summary: summarizeGenerationRecords(rows),
    };
  }

  async function loadAdminReviewCenter(query = {}) {
    const base = await loadAdminGenerations({ ...query, limit: safeLimit(query.limit, 50, 100) });
    const generationIds = base.rows.map(row => row.id).filter(Boolean);
    let ratings = [];
    let failures = [];
    if (generationIds.length) {
      const inList = `in.(${generationIds.join(",")})`;
      [ratings, failures] = await Promise.all([
        supabaseRestQuerySchema("public", "ko_generation_ratings", {
          params: { generation_id: inList },
          order: "created_at.desc",
          limit: 1000,
        }).catch(() => []),
        supabaseRestQuerySchema("public", "ko_generation_failures", {
          params: { generation_id: inList },
          order: "created_at.desc",
          limit: 1000,
        }).catch(() => []),
      ]);
    }
    const ratingsByGeneration = new Map();
    for (const rating of ratings) {
      const list = ratingsByGeneration.get(rating.generation_id) || [];
      list.push(rating);
      ratingsByGeneration.set(rating.generation_id, list);
    }
    const failuresByGeneration = new Map();
    for (const failure of failures) {
      const list = failuresByGeneration.get(failure.generation_id) || [];
      list.push(failure);
      failuresByGeneration.set(failure.generation_id, list);
    }
    const rows = base.rows.map(row => {
      const rowRatings = ratingsByGeneration.get(row.id) || [];
      const rowFailures = failuresByGeneration.get(row.id) || [];
      const latestRating = rowRatings[0] || null;
      return {
        ...row,
        review_status: row.review_status || "pending",
        latest_rating: latestRating,
        rating_count: rowRatings.length,
        failure_count: rowFailures.length,
        failures: rowFailures.slice(0, 6),
      };
    });
    const ratingStats = summarizeRatingRows(ratings);
    const failureCounts = summarizeFailureRows(failures);
    return {
      ...base,
      rows,
      review_summary: {
        pending: rows.filter(row => (row.review_status || "pending") === "pending").length,
        approved: rows.filter(row => row.review_status === "approved").length,
        rejected: rows.filter(row => row.review_status === "rejected").length,
        needs_fix: rows.filter(row => row.review_status === "needs_fix").length,
        average_rating: ratingStats.overall_score,
        most_common_failure: Object.entries(failureCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      },
      failure_categories: Array.from(new Set(["blurry_design","unreadable_text","warped_print","design_distortion","wrong_placement","low_resolution","bad_anatomy","bad_hands","extra_fingers","extra_limbs","face_problems","perspective_issues","wrong_clothing_type","wrong_dog_breed","wrong_pet_features","poor_lighting","artificial_appearance","low_realism","bad_composition","background_issues","cut_off_product","incorrect_colors","duplicate_objects","other"])),
    };
  }

  async function loadAdminDashboard() {
    const [users, generations, transactions, dailyRows, promptVersions, modelRows, promptRows, qualityRows, researchRows, ratingRows, failureRows, systemLogs] = await Promise.all([
      supabaseRestQuerySchema("public", "ko_users", { order: "created_at.desc", limit: 500 }),
      supabaseRestQuerySchema("public", "ko_generation_records", { order: "created_at.desc", limit: 500 }),
      supabaseRestQuerySchema("public", "ko_credit_transactions", { order: "created_at.desc", limit: 500 }),
      supabaseRestSelect("v_daily_metrics", { filters: {}, order: "day.asc", limit: 5000 }).catch(() => []),
      loadPromptVersions({ min_samples: LEARNING_MIN_SAMPLES }).catch(() => ({ rows: [] })),
      supabaseRestQuerySchema("public", "ko_ai_models", { order: "priority.asc", limit: 100 }).catch(() => []),
      supabaseRestQuerySchema("public", "ko_prompt_templates", { order: "updated_at.desc", limit: 100 }).catch(() => []),
      supabaseRestQuerySchema("public", "ko_quality_records", { order: "created_at.desc", limit: 100 }).catch(() => []),
      supabaseRestQuerySchema("public", "ko_research_items", { order: "created_at.desc", limit: 100 }).catch(() => []),
      supabaseRestQuerySchema("public", "ko_generation_ratings", { order: "created_at.desc", limit: 500 }).catch(() => []),
      supabaseRestQuerySchema("public", "ko_generation_failures", { order: "created_at.desc", limit: 500 }).catch(() => []),
      supabaseRestQuerySchema("public", "ko_system_logs", { order: "created_at.desc", limit: 100 }).catch(() => []),
    ]);
    const generationSummary = summarizeGenerationRecords(generations);
    const metrics = dailyRows.length ? aggregateMetrics(dailyRows) : generationSummary;
    const generationStats = summarizeGenerationDashboardRows(generations);
    const userStats = summarizeUsers(users);
    const transactionStats = summarizeTransactions(transactions);
    const failureCounts = summarizeFailureRows(failureRows);
    const ratingStats = summarizeRatingRows(ratingRows);
    const overallScore = ratingStats.overall_score;
    const mostCommonFailure = Object.entries(failureCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const failureRate = generations.length ? Number((((failureRows.length + generationStats.rejected_generations + generationStats.needs_fix_generations) / generations.length) * 100).toFixed(2)) : null;
    const successRate = generations.length ? Number(((generationStats.approved_generations || generationStats.success_count) / generations.length * 100).toFixed(2)) : generationSummary.success_rate;
    const health = {
      quality: Math.min(100, Math.round((Number(overallScore || metrics.avg_rating || 0)) * 10)),
      reliability: Math.min(100, Math.round((Number(successRate || metrics.success_rate) || 0))),
      speed: Math.max(0, Math.min(100, 100 - Math.round((Number(metrics.avg_latency_ms) || 0) / 20))),
      cost_efficiency: Math.max(0, Math.min(100, 100 - Math.round((Number(metrics.avg_latency_ms) || 0) / 25))),
    };
    const healthScore = Math.round((health.quality * 0.35) + (health.reliability * 0.3) + (health.speed * 0.15) + (health.cost_efficiency * 0.2));
    return {
      summary: {
        total_users: userStats.total_users,
        active_users: userStats.active_users,
        total_generations: generationSummary.total_images,
        generations_today: generationStats.generations_today,
        generations_this_week: generationStats.generations_this_week,
        success_rate: successRate,
        failure_rate: failureRate,
        average_score: overallScore || generationSummary.avg_score,
        average_rating: overallScore,
        average_etsy_readiness_score: ratingStats.etsy_readiness,
        average_realism_score: ratingStats.realism,
        approved_generations: generationStats.approved_generations,
        rejected_generations: generationStats.rejected_generations,
        needs_fix_generations: generationStats.needs_fix_generations,
        reviewed_generations: generationStats.reviewed_generations,
        pending_reviews: generationStats.pending_reviews,
        most_common_failure: mostCommonFailure,
        prompt_version_leader: promptVersions.rows?.[0]?.prompt_version || promptRows[0]?.version || null,
        best_performing_scene: null,
        total_credits_consumed: transactionStats.total_credits_consumed,
        estimated_api_cost: generationStats.estimated_api_cost,
        total_images_stored: generationStats.total_images_stored,
        storage_usage: null,
        queue_length: 0,
        health_score: healthScore,
        health_breakdown: health,
      },
      charts: {
        generations_per_day: summarizeDailyRows(generations),
        credits_used_per_day: summarizeDailyRows(transactions),
        user_growth: summarizeDailyRows(users, "created_at"),
        score_trends: summarizeDailyRows(generations),
        ratings_over_time: summarizeDailyRows(ratingRows),
        failures_over_time: summarizeDailyRows(failureRows),
        approval_trend: summarizeDailyRows(generations.filter(row => row.review_status === "approved")),
      },
      recent_activity: [
        ...generations.slice(0, 10).map(row => ({ type: "generation", ...row })),
        ...transactions.slice(0, 10).map(row => ({ type: "credit", ...row })),
        ...ratingRows.slice(0, 10).map(row => ({ type: "rating", ...row })),
        ...failureRows.slice(0, 10).map(row => ({ type: "failure", ...row })),
        ...systemLogs.slice(0, 10).map(row => ({ type: "system", ...row })),
      ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 20),
      recent_failed_generations: generations.filter(row => row.status !== "succeeded").slice(0, 10),
      recent_credit_transactions: transactions.slice(0, 10),
      users: users.slice(0, 20).map(row => ({
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
      })),
      generations: generations.slice(0, 20),
      transactions: transactions.slice(0, 20),
      analytics: dailyRows,
      prompt_versions: promptVersions.rows || [],
      ai_models: modelRows,
      prompts: promptRows,
      quality_records: qualityRows,
      research_items: researchRows,
      generation_ratings: ratingRows.slice(0, 50),
      generation_failures: failureRows.slice(0, 50),
      system_logs: systemLogs,
    };
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

  async function loadTopConcepts(options = {}) {
    const mode = options.mode === "bottom" ? "bottom" : "top";
    const productType = safeText(options.product_type || options.productType || "all", 80) || "all";
    const limit = safeLimit(options.limit, 20, 200);
    const minSamples = safeMinSamples(options.min_samples || options.minSamples);
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
    const mode = options.mode === "bottom" ? "bottom" : "top";
    const limit = safeLimit(options.limit, 20, 200);
    const minSamples = safeMinSamples(options.min_samples || options.minSamples);
    const productType = safeText(options.product_type || options.productType || "all", 80) || "all";
    const dimensionType = LEARNING_DIMENSIONS.has(options.dimension_type) ? options.dimension_type : "listing_role";
    const params = { dimension_type: `eq.${dimensionType}`, sample_count: `gte.${minSamples}` };
    if (productType && productType !== "all") params.product_type = `eq.${productType}`;
    const rows = await supabaseRestQuery("dimension_scores", {
      params,
      order: mode === "bottom" ? "success_score.asc,sample_count.desc" : "success_score.desc,sample_count.desc",
      limit,
    });
    return { mode, limit, min_samples: minSamples, product_type: productType, dimension_type: dimensionType, rows };
  }

  async function loadPromptVersions(options = {}) {
    const minSamples = safeMinSamples(options.min_samples || options.minSamples);
    const rows = await supabaseRestQuery("concept_scores", {
      params: { sample_count: `gte.${minSamples}` },
      limit: RESEARCH_EXPORT_MAX_ROWS,
    });
    return { min_samples: minSamples, rows: aggregatePromptVersions(rows) };
  }

  async function loadDimensionHeatmap(options = {}) {
    const minSamples = safeMinSamples(options.min_samples || options.minSamples);
    const productType = safeText(options.product_type || options.productType || "all", 80) || "all";
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
    const minSamples = safeMinSamples(options.min_samples || options.minSamples);
    const productType = safeText(options.product_type || options.productType || "all", 80) || "all";
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

  return {
    summarizeDailyRows,
    summarizeGenerationRecords,
    summarizeUsers,
    summarizeTransactions,
    summarizeFailureRows,
    summarizeQualityRows,
    summarizeRatingRows,
    summarizeGenerationDashboardRows,
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
    loadAdminReviewCenter,
    loadTopConcepts,
    loadDimensionLeaderboard,
    loadPromptVersions,
    loadDimensionHeatmap,
    loadLearningSummary,
    loadLearningBundle,
  };
}

module.exports = { createReportsService };
