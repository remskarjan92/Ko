(function () {
  function adminResponseError(data, status) {
    const code = data?.code ? ` [${data.code}]` : "";
    const detail = data?.detail ? `: ${data.detail}` : "";
    return `${data?.error || `Request failed (${status})`}${code}${detail}`;
  }

  function AdminRouteContent({
    routePath,
    isAdmin,
    adminSession,
    keyInfo,
    resultsCount,
    generatedImages,
    imageStatusCounts,
    ratingCount,
    onNavigate,
    onOpenSettings
  }) {
    const [usersState, setUsersState] = React.useState({ rows: [], loading: false, error: "", message: "" });
    const [passwordTarget, setPasswordTarget] = React.useState(null);
    const [newPassword, setNewPassword] = React.useState("");
    const [passwordBusy, setPasswordBusy] = React.useState(false);
    const [passwordError, setPasswordError] = React.useState("");
    const [passwordMessage, setPasswordMessage] = React.useState("");
    const [userSearch, setUserSearch] = React.useState("");
    const [statusFilter, setStatusFilter] = React.useState("");
    const [roleFilter, setRoleFilter] = React.useState("");
    const [selectedUser, setSelectedUser] = React.useState(null);
    const [userDetail, setUserDetail] = React.useState(null);
    const [detailLoading, setDetailLoading] = React.useState(false);
    const [detailError, setDetailError] = React.useState("");
    const [statusBusy, setStatusBusy] = React.useState(false);
    const [creditAmount, setCreditAmount] = React.useState("");
    const [creditReason, setCreditReason] = React.useState("");
    const [creditBusy, setCreditBusy] = React.useState(false);
    const [creditError, setCreditError] = React.useState("");
    const [creditMessage, setCreditMessage] = React.useState("");
    const [analyticsState, setAnalyticsState] = React.useState({ data: null, loading: false, error: "" });
    const [researchState, setResearchState] = React.useState({ rows: [], loading: false, error: "" });
    const [learningState, setLearningState] = React.useState({ quality: null, learning: null, loading: false, error: "" });
    const [creditsState, setCreditsState] = React.useState({ users: [], transactions: [], loading: false, error: "" });
    const [transactionsState, setTransactionsState] = React.useState({ users: [], rows: [], loading: false, error: "" });

    React.useEffect(() => {
      let cancelled = false;
      async function loadAdminUsers() {
        if (routePath !== "/admin/users" || !isAdmin) return;
        setUsersState(prev => ({ ...prev, loading: true, error: "", message: "" }));
        try {
          const params = new URLSearchParams({ limit: "100" });
          if (userSearch.trim()) params.set("q", userSearch.trim());
          if (statusFilter) params.set("status", statusFilter);
          if (roleFilter) params.set("role", roleFilter);
          const res = await fetch(`/api/admin/users?${params.toString()}`, {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
          });
          const text = await res.text();
          const data = text ? JSON.parse(text) : {};
          if (!res.ok) throw new Error(adminResponseError(data, res.status));
          if (!cancelled) setUsersState({ rows: Array.isArray(data.rows) ? data.rows : [], loading: false, error: "", message: "" });
        } catch (error) {
          if (!cancelled) setUsersState({ rows: [], loading: false, error: error.message || "Could not load users", message: "" });
        }
      }
      loadAdminUsers();
      return () => {
        cancelled = true;
      };
    }, [routePath, isAdmin, userSearch, statusFilter, roleFilter]);

    React.useEffect(() => {
      let cancelled = false;
      async function loadAnalyticsSummary() {
        if (routePath !== "/admin/analytics" || !isAdmin) return;
        setAnalyticsState(prev => ({ ...prev, loading: true, error: "" }));
        try {
          const res = await fetch("/api/admin/analytics", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
          });
          const text = await res.text();
          const data = text ? JSON.parse(text) : {};
          if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
          if (!cancelled) setAnalyticsState({ data, loading: false, error: "" });
        } catch (error) {
          if (!cancelled) setAnalyticsState(prev => ({ ...prev, loading: false, error: error.message || "Could not load analytics" }));
        }
      }
      loadAnalyticsSummary();
      return () => {
        cancelled = true;
      };
    }, [routePath, isAdmin]);

    React.useEffect(() => {
      let cancelled = false;
      async function loadResearchDatabase() {
        if (routePath !== "/admin/research" || !isAdmin) return;
        setResearchState(prev => ({ ...prev, loading: true, error: "" }));
        try {
          const res = await fetch("/api/admin/research-database", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
          });
          const text = await res.text();
          const data = text ? JSON.parse(text) : {};
          if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
          if (!cancelled) setResearchState({ rows: Array.isArray(data.rows) ? data.rows : [], loading: false, error: "" });
        } catch (error) {
          if (!cancelled) setResearchState(prev => ({ ...prev, loading: false, error: error.message || "Could not load research" }));
        }
      }
      loadResearchDatabase();
      return () => {
        cancelled = true;
      };
    }, [routePath, isAdmin]);

    React.useEffect(() => {
      let cancelled = false;
      async function loadLearningPanel() {
        if (routePath !== "/admin/learning" || !isAdmin) return;
        setLearningState(prev => ({ ...prev, loading: true, error: "" }));
        try {
          const [qualityResult, learningResult] = await Promise.allSettled([
            fetch("/api/admin/quality", {
              method: "GET",
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            }),
            fetch("/api/admin/learning", {
              method: "GET",
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            })
          ]);
          const parseResponse = async result => {
            if (result.status !== "fulfilled") throw result.reason;
            const text = await result.value.text();
            const data = text ? JSON.parse(text) : {};
            if (!result.value.ok) throw new Error(data?.error || `Request failed (${result.value.status})`);
            return data;
          };
          const quality = await parseResponse(qualityResult).catch(error => ({ rows: [], cards: {}, error: error.message || "Quality unavailable" }));
          const learning = await parseResponse(learningResult).catch(error => ({ error: error.message || "Learning unavailable" }));
          const error = [quality.error, learning.error].filter(Boolean).join("; ");
          if (!cancelled) setLearningState({ quality, learning, loading: false, error });
        } catch (error) {
          if (!cancelled) setLearningState(prev => ({ ...prev, loading: false, error: error.message || "Could not load learning data" }));
        }
      }
      loadLearningPanel();
      return () => {
        cancelled = true;
      };
    }, [routePath, isAdmin]);

    React.useEffect(() => {
      let cancelled = false;
      async function loadCreditsPanel() {
        if (routePath !== "/admin/credits" || !isAdmin) return;
        setCreditsState(prev => ({ ...prev, loading: true, error: "" }));
        try {
          const [usersResult, transactionsResult] = await Promise.all([
            fetch("/api/admin/users?limit=250", {
              method: "GET",
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            }),
            fetch("/api/admin/transactions?limit=100", {
              method: "GET",
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            })
          ]);
          const parseJson = async response => {
            const text = await response.text();
            const data = text ? JSON.parse(text) : {};
            if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
            return data;
          };
          const users = await parseJson(usersResult);
          const transactions = await parseJson(transactionsResult);
          if (!cancelled) {
            setCreditsState({
              users: Array.isArray(users.rows) ? users.rows : [],
              transactions: Array.isArray(transactions.rows) ? transactions.rows : [],
              loading: false,
              error: ""
            });
          }
        } catch (error) {
          if (!cancelled) setCreditsState(prev => ({ ...prev, loading: false, error: error.message || "Could not load credit data" }));
        }
      }
      loadCreditsPanel();
      return () => {
        cancelled = true;
      };
    }, [routePath, isAdmin]);

    React.useEffect(() => {
      let cancelled = false;
      async function loadTransactionsPanel() {
        if (routePath !== "/admin/transactions" || !isAdmin) return;
        setTransactionsState(prev => ({ ...prev, loading: true, error: "" }));
        try {
          const [usersResult, transactionsResult] = await Promise.all([
            fetch("/api/admin/users?limit=250", {
              method: "GET",
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            }),
            fetch("/api/admin/transactions?limit=250", {
              method: "GET",
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            })
          ]);
          const parseJson = async response => {
            const text = await response.text();
            const data = text ? JSON.parse(text) : {};
            if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
            return data;
          };
          const users = await parseJson(usersResult);
          const transactions = await parseJson(transactionsResult);
          if (!cancelled) {
            setTransactionsState({
              users: Array.isArray(users.rows) ? users.rows : [],
              rows: Array.isArray(transactions.rows) ? transactions.rows : [],
              loading: false,
              error: ""
            });
          }
        } catch (error) {
          if (!cancelled) setTransactionsState(prev => ({ ...prev, loading: false, error: error.message || "Could not load transactions" }));
        }
      }
      loadTransactionsPanel();
      return () => {
        cancelled = true;
      };
    }, [routePath, isAdmin]);

    const routeHelpers = window.KOFrontendRoutes || {};
    if (!routeHelpers.isAdminRoute?.(routePath)) return null;
    if (!isAdmin) return null;
    const route = routeHelpers.getRouteConfig?.(routePath) || {};
    const panelCopy = {
      "/admin": "Platform overview, provider readiness, quality signals, and recent operational activity will consolidate here.",
      "/admin/users": "User search, account status, credit balance, last activity, and admin user actions will live here.",
      "/admin/credits": "Credit packages, feature costs, manual adjustments, refunds, and pricing controls will live here.",
      "/admin/transactions": "A filterable ledger of credit additions, usage, refunds, balance changes, and admin adjustments will live here.",
      "/admin/generations": "All generation records, status, model, score, credit usage, refunds, and detail actions will live here.",
      "/admin/analytics": "Usage, success rate, average score, cost, latency, model usage, and category trends will live here.",
      "/admin/prompts": "Master, fix, scoring, research, video prompts, version history, rollback, testing, and performance tracking will live here.",
      "/admin/models": "Gemini, Claude, Flux, video providers, status, response time, priority, fallback, and cost controls will live here.",
      "/admin/quality": "Quality score trends, issue breakdowns, fix rate, regeneration rate, and failure diagnostics will live here.",
      "/admin/learning": "Concept scores, dimension scores, prompt hashes, confidence, and self-improvement signals will live here.",
      "/admin/research": "Research analytics, concept leaderboards, learning exports, and future Etsy/competitor research will live here.",
      "/admin/settings": "API keys, Railway/storage settings, feature toggles, model settings, and admin preferences will move here."
    };
    const existingTarget = {
      "/admin": "dashboard-section",
      "/admin/users": "dashboard-section",
      "/admin/credits": "credits-section",
      "/admin/transactions": "credits-section",
      "/admin/generations": "results-section",
      "/admin/analytics": "learning-section",
      "/admin/prompts": "compose-section",
      "/admin/models": "compose-section",
      "/admin/quality": "learning-section",
      "/admin/learning": "learning-section",
      "/admin/research": "learning-section",
      "/admin/settings": "account-section"
    }[routePath];
    const labelStyle = {
      color: "rgba(255,220,100,0.60)",
      fontFamily: "'DM Mono',monospace",
      fontSize: 10,
      letterSpacing: "0.12em",
      textTransform: "uppercase"
    };
    const actionButtonStyle = {
      border: "1px solid rgba(255,220,100,0.24)",
      background: "rgba(255,220,100,0.08)",
      color: "var(--accent-gold)",
      borderRadius: 10,
      padding: "9px 12px",
      fontWeight: 700,
      cursor: "pointer"
    };
    const secondaryButtonStyle = {
      ...actionButtonStyle,
      borderColor: "rgba(255,255,255,0.13)",
      background: "rgba(255,255,255,0.05)",
      color: "rgba(255,255,255,0.78)"
    };
    const inputStyle = {
      width: "100%",
      border: "1px solid rgba(255,255,255,0.13)",
      background: "rgba(0,0,0,0.22)",
      color: "rgba(255,255,255,0.88)",
      borderRadius: 10,
      padding: "10px 11px",
      outline: "none"
    };
    const mutedStyle = {
      color: "rgba(255,255,255,0.54)",
      fontSize: 12,
      lineHeight: 1.45
    };
    const card = (label, value) => React.createElement("div", {
      key: label,
      style: {
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12,
        background: "rgba(0,0,0,0.14)",
        padding: "12px"
      }
    }, React.createElement("div", {
      style: labelStyle
    }, label), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.72)",
        fontSize: 13,
        lineHeight: 1.5,
        marginTop: 5
      }
    }, value));
    const metricCard = item => React.createElement("div", {
      key: item.label,
      style: {
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        background: "rgba(0,0,0,0.18)",
        padding: "12px",
        minHeight: 104
      }
    }, React.createElement("div", {
      style: labelStyle
    }, item.label), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.90)",
        fontSize: 24,
        fontWeight: 800,
        lineHeight: 1.1,
        marginTop: 9
      }
    }, item.value), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.44)",
        fontSize: 11,
        lineHeight: 1.35,
        marginTop: 7
      }
    }, item.detail));
    const metricGrid = items => React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
        gap: 10,
        marginBottom: 14
      }
    }, items.map(metricCard));
    const inlineError = message => message && React.createElement("div", {
      style: {
        color: "#ffb4a8",
        fontSize: 13,
        marginTop: 12
      }
    }, message);
    const providerReady = !!(keyInfo?.gemini?.set && keyInfo?.replicate?.set);
    const pendingImages = Number(imageStatusCounts?.pending || 0);
    const failedImages = Number(imageStatusCounts?.failed || 0);
    const metricValue = (value, fallback = 0) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };
    const displayMetric = value => value === null || value === undefined || value === "" ? "N/A" : value;
    const adminDashboardCards = [{
      label: "Admin status",
      value: adminSession?.authenticated ? "Authenticated" : "Locked",
      detail: adminSession?.username || "admin"
    }, {
      label: "Provider key status",
      value: providerReady ? "Ready" : "Review",
      detail: providerReady ? "Gemini and Replicate configured" : "Open settings to review keys"
    }, {
      label: "Current session prompts",
      value: resultsCount || 0,
      detail: "Prompt records in this browser session"
    }, {
      label: "Completed images",
      value: generatedImages || 0,
      detail: "Finished image outputs"
    }, {
      label: "Pending / failed images",
      value: `${pendingImages} / ${failedImages}`,
      detail: "Current image queue state"
    }, {
      label: "Rating signals",
      value: ratingCount || 0,
      detail: "Local prompt quality signals"
    }];
    const adminQuickActions = [{
      label: "Users",
      route: "/admin/users",
      target: "dashboard-section"
    }, {
      label: "Analytics",
      route: "/admin/analytics",
      target: "learning-section"
    }, {
      label: "Research",
      route: "/admin/research",
      target: "learning-section"
    }, {
      label: "Settings",
      route: "/admin/settings",
      target: "account-section"
    }];
    const renderAdminDashboardOverview = () => React.createElement(React.Fragment, null, metricGrid(adminDashboardCards), React.createElement("div", {
      style: {
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingTop: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap"
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.86)",
        fontWeight: 800,
        fontSize: 15
      }
    }, "Quick actions"), React.createElement("div", {
      style: mutedStyle
    }, "Open the main admin work areas from this dashboard.")), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        flexWrap: "wrap"
      }
    }, adminQuickActions.map(action => React.createElement("button", {
      key: action.route,
      type: "button",
      onClick: () => onNavigate(action.target, action.route),
      style: secondaryButtonStyle
    }, action.label)), React.createElement("button", {
      type: "button",
      onClick: onOpenSettings,
      style: actionButtonStyle
    }, "Service Status"))));
    const renderAnalyticsOverview = () => {
      const analytics = analyticsState.data || {};
      const summary = analytics.summary || {};
      const rows = Array.isArray(analytics.rows) ? analytics.rows : [];
      const categories = Array.isArray(analytics.categories) ? analytics.categories : [];
      const totalGenerations = metricValue(summary.generations_total, resultsCount || 0);
      const successfulGenerations = metricValue(summary.generations_succeeded, generatedImages || imageStatusCounts?.done || 0);
      const failedGenerations = metricValue(summary.generations_failed, failedImages);
      const avgRating = summary.avg_rating ?? null;
      const avgRatingNumber = Number(avgRating);
      const successRateNumber = Number(summary.success_rate);
      const ratings = metricValue(summary.ratings_count, ratingCount || 0);
      const recentRows = rows.slice(-7).reverse();
      const providerMap = new Map();
      const providerSources = [
        ...(Array.isArray(analytics.provider_usage) ? analytics.provider_usage : []),
        ...(Array.isArray(analytics.providers) ? analytics.providers : []),
        ...categories
      ];
      for (const row of providerSources) {
        const provider = row.provider || row.provider_name || row.model_provider;
        if (!provider) continue;
        const current = providerMap.get(provider) || 0;
        providerMap.set(provider, current + metricValue(row.generations_total || row.usage_count || row.count, 0));
      }
      const providerRows = Array.from(providerMap.entries())
        .map(([provider, count]) => ({ provider, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      const analyticsCards = [{
        label: "Total generations",
        value: totalGenerations,
        detail: "All tracked generation attempts"
      }, {
        label: "Successful generations",
        value: successfulGenerations,
        detail: "Completed generation events"
      }, {
        label: "Failed generations",
        value: failedGenerations,
        detail: "Failed generation events"
      }, {
        label: "Average rating",
        value: Number.isFinite(avgRatingNumber) ? avgRatingNumber.toFixed(2) : "N/A",
        detail: ratings ? "Weighted from rating events" : "No rating average yet"
      }, {
        label: "Rating count",
        value: ratings,
        detail: "Tracked rating events"
      }, {
        label: "Success rate",
        value: Number.isFinite(successRateNumber) ? `${successRateNumber.toFixed(1)}%` : "N/A",
        detail: "Successful / total generations"
      }];

      return React.createElement(React.Fragment, null, metricGrid(analyticsCards), React.createElement("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 12,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 14
        }
      }, React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: 12
        }
      }, React.createElement("div", {
        style: labelStyle
      }, "Provider usage"), providerRows.length ? React.createElement("div", {
        style: {
          display: "grid",
          gap: 8,
          marginTop: 10
        }
      }, providerRows.map(row => React.createElement("div", {
        key: row.provider,
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          color: "rgba(255,255,255,0.74)",
          fontSize: 13
        }
      }, React.createElement("span", null, row.provider), React.createElement("span", {
        style: {
          fontFamily: "'DM Mono',monospace",
          color: "rgba(255,220,100,0.76)"
        }
      }, row.count)))) : React.createElement("div", {
        style: {
          ...mutedStyle,
          marginTop: 10
        }
      }, "No provider usage rows available.")), React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: 12
        }
      }, React.createElement("div", {
        style: labelStyle
      }, "Recent generation activity"), recentRows.length ? React.createElement("div", {
        style: {
          display: "grid",
          gap: 8,
          marginTop: 10
        }
      }, recentRows.map((row, index) => React.createElement("div", {
        key: row.day || index,
        style: {
          display: "grid",
          gridTemplateColumns: "minmax(92px,0.7fr) repeat(3,minmax(54px,0.32fr))",
          gap: 8,
          alignItems: "center",
          color: "rgba(255,255,255,0.72)",
          fontSize: 12
        }
      }, React.createElement("span", null, row.day || "Unknown"), React.createElement("span", null, `Total ${displayMetric(row.generations_total)}`), React.createElement("span", null, `OK ${displayMetric(row.generations_succeeded)}`), React.createElement("span", null, `Fail ${displayMetric(row.generations_failed)}`)))) : React.createElement("div", {
        style: {
          ...mutedStyle,
          marginTop: 10
        }
      }, analyticsState.loading ? "Loading analytics..." : "No recent activity rows available."))), inlineError(analyticsState.error));
    };
    const textValue = value => {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    };
    const shortText = (value, max = 180) => {
      const text = textValue(value).trim();
      return text.length > max ? `${text.slice(0, max - 1)}...` : text;
    };
    const researchMeta = row => row && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
    const researchTopic = row => {
      const metadata = researchMeta(row);
      return row.keyword || metadata.query || metadata.topic || metadata.keyword || row.title || "Untitled research";
    };
    const researchProvider = row => {
      const metadata = researchMeta(row);
      return row.provider || row.model || metadata.provider || metadata.model || metadata.model_name || metadata.provider_model || "N/A";
    };
    const researchStatus = row => {
      const metadata = researchMeta(row);
      return row.status || metadata.status || metadata.state || "stored";
    };
    const researchSummary = row => {
      const metadata = researchMeta(row);
      return shortText(row.notes || metadata.summary || metadata.result_summary || metadata.result || metadata.description || metadata.output || "", 220);
    };
    const renderResearchOverview = () => {
      const rows = researchState.rows || [];
      const recentRows = rows.slice(0, 12);
      const sources = Array.from(new Set(rows.map(row => row.source).filter(Boolean)));
      const latestDate = rows[0]?.created_at || null;
      const researchCards = [{
        label: "Research status",
        value: researchState.loading ? "Loading" : researchState.error ? "Unavailable" : rows.length ? "Ready" : "Empty",
        detail: researchState.error || "Read-only research database"
      }, {
        label: "Recent research runs",
        value: rows.length,
        detail: "Stored research items"
      }, {
        label: "Sources",
        value: sources.length,
        detail: sources.slice(0, 3).join(", ") || "No sources yet"
      }, {
        label: "Latest run",
        value: latestDate ? formatDate(latestDate) : "N/A",
        detail: latestDate || "No research date available"
      }];

      return React.createElement(React.Fragment, null, metricGrid(researchCards), React.createElement("div", {
        style: {
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 14
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10
        }
      }, React.createElement("div", null, React.createElement("div", {
        style: {
          color: "rgba(255,255,255,0.86)",
          fontWeight: 800,
          fontSize: 15
        }
      }, "Recent research runs"), React.createElement("div", {
        style: mutedStyle
      }, "Stored research items from the existing research database."))), recentRows.length ? React.createElement("div", {
        style: {
          overflowX: "auto",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8
        }
      }, React.createElement("table", {
        style: {
          width: "100%",
          borderCollapse: "collapse",
          minWidth: 780
        }
      }, React.createElement("thead", null, React.createElement("tr", null, ["Status", "Query / topic", "Provider / model", "Created", "Result summary"].map(label => React.createElement("th", {
        key: label,
        style: {
          ...labelStyle,
          textAlign: "left",
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.16)"
        }
      }, label)))), React.createElement("tbody", null, recentRows.map(row => React.createElement("tr", {
        key: row.id || `${row.source || "research"}-${row.created_at || researchTopic(row)}`,
        style: {
          borderBottom: "1px solid rgba(255,255,255,0.06)"
        }
      }, React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, researchStatus(row)), React.createElement("td", {
        style: { padding: "11px 12px" }
      }, React.createElement("div", {
        style: { color: "rgba(255,255,255,0.86)", fontWeight: 800 }
      }, shortText(researchTopic(row), 90)), React.createElement("div", {
        style: mutedStyle
      }, [row.source, row.category].filter(Boolean).join(" / ") || row.title || "Research item")), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, researchProvider(row)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, formatDate(row.created_at)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.62)", lineHeight: 1.45 }
      }, researchSummary(row) || "No summary available")))))) : React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: "18px 14px",
          color: "rgba(255,255,255,0.56)",
          fontSize: 13
        }
      }, researchState.loading ? "Loading research runs..." : researchState.error ? researchState.error : "No research data exists yet.")));
    };
    const hasFeedback = row => {
      const feedback = row?.user_feedback;
      return feedback && typeof feedback === "object" && !Array.isArray(feedback) && Object.keys(feedback).length > 0;
    };
    const isSelectedOutput = row => {
      const feedback = row?.user_feedback || {};
      return !!(feedback.selected || feedback.accepted || feedback.favorite || feedback.downloaded || row?.review_status === "approved" || row?.status === "approved");
    };
    const renderLearningOverview = () => {
      const quality = learningState.quality || {};
      const learning = learningState.learning || {};
      const qualityRows = Array.isArray(quality.rows) ? quality.rows : [];
      const feedbackRows = qualityRows.filter(hasFeedback);
      const selectedOutputs = qualityRows.filter(isSelectedOutput);
      const averageScore = quality.cards?.average_score ?? null;
      const averageScoreNumber = Number(averageScore);
      const bestConcept = learning.cards?.best_concept || null;
      const bestDimension = learning.cards?.best_dimension || null;
      const bestPromptVersion = learning.cards?.best_prompt_version || null;
      const topConcepts = Array.isArray(learning.topConcepts?.rows) ? learning.topConcepts.rows : Array.isArray(learning.topConcepts) ? learning.topConcepts : [];
      const dimensions = Array.isArray(learning.dimensionLeaderboard?.rows) ? learning.dimensionLeaderboard.rows : Array.isArray(learning.dimensionLeaderboard) ? learning.dimensionLeaderboard : [];
      const promptVersions = Array.isArray(learning.promptVersions?.rows) ? learning.promptVersions.rows : Array.isArray(learning.promptVersions) ? learning.promptVersions : [];
      const recentQualitySignals = qualityRows.slice(0, 6).map(row => ({
        type: "Quality",
        title: row.category || row.style_key || row.issue_type || "Quality record",
        score: row.score,
        detail: row.reasoning || row.status || row.model_name || "Quality signal",
        created_at: row.created_at
      }));
      const recentConceptSignals = topConcepts.slice(0, 4).map(row => ({
        type: "Concept",
        title: row.concept_id || row.concept_fingerprint || row.listing_role || "Concept score",
        score: row.success_score,
        detail: [row.listing_role, row.mockup_style_mode, row.environment].filter(Boolean).join(" / ") || "Concept learning signal",
        created_at: row.updated_at || row.last_seen_at
      }));
      const recentDimensionSignals = dimensions.slice(0, 4).map(row => ({
        type: "Dimension",
        title: [row.dimension_type, row.dimension_value].filter(Boolean).join(": ") || "Dimension score",
        score: row.success_score,
        detail: `${row.sample_count || 0} samples`,
        created_at: row.updated_at || row.last_seen_at
      }));
      const recentSignals = [...recentQualitySignals, ...recentConceptSignals, ...recentDimensionSignals]
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 10);
      const learningCards = [{
        label: "Quality records",
        value: qualityRows.length,
        detail: "Stored quality checks"
      }, {
        label: "Feedback count",
        value: feedbackRows.length,
        detail: "Quality rows with user feedback"
      }, {
        label: "Average score",
        value: Number.isFinite(averageScoreNumber) ? averageScoreNumber.toFixed(2) : "N/A",
        detail: "From quality records"
      }, {
        label: "Selected outputs",
        value: selectedOutputs.length,
        detail: "Accepted, favorite, downloaded, or approved"
      }, {
        label: "Top concepts",
        value: topConcepts.length,
        detail: bestConcept ? `Best ${displayMetric(bestConcept.success_score)}` : "No concept scores yet"
      }, {
        label: "Prompt versions",
        value: promptVersions.length,
        detail: bestPromptVersion?.prompt_version || "No prompt version signal"
      }];

      return React.createElement(React.Fragment, null, metricGrid(learningCards), React.createElement("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 12,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 14
        }
      }, React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: 12
        }
      }, React.createElement("div", {
        style: labelStyle
      }, "Learning highlights"), React.createElement("div", {
        style: {
          display: "grid",
          gap: 8,
          marginTop: 10
        }
      }, React.createElement("div", {
        style: mutedStyle
      }, bestConcept ? `Best concept: ${bestConcept.concept_id || bestConcept.concept_fingerprint || "unknown"} (${displayMetric(bestConcept.success_score)})` : "No best concept available."), React.createElement("div", {
        style: mutedStyle
      }, bestDimension ? `Best dimension: ${bestDimension.dimension_type || "dimension"} / ${bestDimension.dimension_value || "value"} (${displayMetric(bestDimension.success_score)})` : "No best dimension available."), React.createElement("div", {
        style: mutedStyle
      }, bestPromptVersion ? `Best prompt version: ${bestPromptVersion.prompt_version || "unknown"}` : "No prompt version leader available."))), React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: 12
        }
      }, React.createElement("div", {
        style: labelStyle
      }, "Recent learning signals"), recentSignals.length ? React.createElement("div", {
        style: {
          display: "grid",
          gap: 8,
          marginTop: 10
        }
      }, recentSignals.map((signal, index) => React.createElement("div", {
        key: `${signal.type}-${signal.title}-${index}`,
        style: {
          borderBottom: index === recentSignals.length - 1 ? "none" : "1px solid rgba(255,255,255,0.06)",
          paddingBottom: 8
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          color: "rgba(255,255,255,0.82)",
          fontSize: 13,
          fontWeight: 700
        }
      }, React.createElement("span", null, `${signal.type}: ${shortText(signal.title, 72)}`), React.createElement("span", {
        style: {
          color: "rgba(255,220,100,0.76)",
          fontFamily: "'DM Mono',monospace"
        }
      }, displayMetric(signal.score))), React.createElement("div", {
        style: {
          ...mutedStyle,
          marginTop: 3
        }
      }, shortText(signal.detail, 120))))) : React.createElement("div", {
        style: {
          ...mutedStyle,
          marginTop: 10
        }
      }, learningState.loading ? "Loading learning signals..." : "No learning data exists yet."))), inlineError(learningState.error));
    };
    const renderCreditsOverview = () => {
      const users = creditsState.users || [];
      const transactions = creditsState.transactions || [];
      const userById = new Map(users.map(user => [user.id, user]));
      const usersWithCredits = users.filter(user => Number(user.credits_balance || 0) > 0);
      const totalCreditsAvailable = users.reduce((sum, user) => sum + metricValue(user.credits_balance, 0), 0);
      const creditsUsed = transactions.reduce((sum, row) => sum + metricValue(row.credits_removed, 0), 0);
      const creditsAdded = transactions.reduce((sum, row) => sum + metricValue(row.credits_added, 0), 0);
      const recentRows = transactions.slice(0, 12);
      const creditCards = [{
        label: "Users with credits",
        value: usersWithCredits.length,
        detail: `${users.length} users loaded`
      }, {
        label: "Total credits available",
        value: totalCreditsAvailable,
        detail: "Current user balances"
      }, {
        label: "Credits used",
        value: creditsUsed,
        detail: "Removed credits in loaded transactions"
      }, {
        label: "Credits added",
        value: creditsAdded,
        detail: "Added credits in loaded transactions"
      }];
      const userLabel = row => {
        const user = userById.get(row.user_id);
        return user?.email || user?.username || row.user_id || "Unknown user";
      };
      const transactionAmount = row => {
        const added = metricValue(row.credits_added, 0);
        const removed = metricValue(row.credits_removed, 0);
        if (added) return `+${added}`;
        if (removed) return `-${removed}`;
        return "0";
      };

      return React.createElement(React.Fragment, null, metricGrid(creditCards), React.createElement("div", {
        style: {
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 14
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10
        }
      }, React.createElement("div", null, React.createElement("div", {
        style: {
          color: "rgba(255,255,255,0.86)",
          fontWeight: 800,
          fontSize: 15
        }
      }, "Recent credit activity"), React.createElement("div", {
        style: mutedStyle
      }, "Read-only ledger from existing transaction data."))), recentRows.length ? React.createElement("div", {
        style: {
          overflowX: "auto",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8
        }
      }, React.createElement("table", {
        style: {
          width: "100%",
          borderCollapse: "collapse",
          minWidth: 760
        }
      }, React.createElement("thead", null, React.createElement("tr", null, ["User", "Action", "Credits", "Balance after", "Date"].map(label => React.createElement("th", {
        key: label,
        style: {
          ...labelStyle,
          textAlign: "left",
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.16)"
        }
      }, label)))), React.createElement("tbody", null, recentRows.map(row => React.createElement("tr", {
        key: row.id || `${row.user_id}-${row.created_at}-${row.action}`,
        style: {
          borderBottom: "1px solid rgba(255,255,255,0.06)"
        }
      }, React.createElement("td", {
        style: { padding: "11px 12px" }
      }, React.createElement("div", {
        style: { color: "rgba(255,255,255,0.86)", fontWeight: 800 }
      }, shortText(userLabel(row), 90)), React.createElement("div", {
        style: mutedStyle
      }, row.user_id || "No user id")), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, row.action || row.credit_type || "credit"), React.createElement("td", {
        style: {
          padding: "11px 12px",
          color: metricValue(row.credits_added, 0) ? "rgba(143,255,196,0.9)" : "rgba(255,220,100,0.82)",
          fontFamily: "'DM Mono',monospace",
          fontWeight: 800
        }
      }, transactionAmount(row)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, displayMetric(row.balance_after)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, formatDate(row.created_at))))))) : React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: "18px 14px",
          color: "rgba(255,255,255,0.56)",
          fontSize: 13
        }
      }, creditsState.loading ? "Loading credit activity..." : creditsState.error ? creditsState.error : "No credit activity exists yet.")), creditsState.error && recentRows.length > 0 && inlineError(creditsState.error));
    };
    const renderTransactionsOverview = () => {
      const rows = transactionsState.rows || [];
      const users = transactionsState.users || [];
      const userById = new Map(users.map(user => [user.id, user]));
      const creditsAdded = rows.reduce((sum, row) => sum + metricValue(row.credits_added, 0), 0);
      const creditsUsed = rows.reduce((sum, row) => sum + metricValue(row.credits_removed, 0), 0);
      const recentRows = rows.slice(0, 20);
      const transactionCards = [{
        label: "Total transactions",
        value: rows.length,
        detail: "Loaded credit ledger rows"
      }, {
        label: "Credits added",
        value: creditsAdded,
        detail: "Added credits in loaded rows"
      }, {
        label: "Credits spent / used",
        value: creditsUsed,
        detail: "Removed credits in loaded rows"
      }, {
        label: "Users resolved",
        value: users.length,
        detail: "Loaded user labels"
      }];
      const userLabel = row => {
        const user = userById.get(row.user_id);
        return user?.email || user?.username || row.user_id || "Unknown user";
      };
      const transactionAmount = row => {
        const added = metricValue(row.credits_added, 0);
        const removed = metricValue(row.credits_removed, 0);
        if (added) return `+${added}`;
        if (removed) return `-${removed}`;
        return "0";
      };
      const transactionReason = row => {
        const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
        return row.reason || row.status || metadata.reason || metadata.note || metadata.status || row.credit_type || "standard";
      };

      return React.createElement(React.Fragment, null, metricGrid(transactionCards), React.createElement("div", {
        style: {
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 14
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10
        }
      }, React.createElement("div", null, React.createElement("div", {
        style: {
          color: "rgba(255,255,255,0.86)",
          fontWeight: 800,
          fontSize: 15
        }
      }, "Recent transactions"), React.createElement("div", {
        style: mutedStyle
      }, "Read-only credit transaction history."))), recentRows.length ? React.createElement("div", {
        style: {
          overflowX: "auto",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8
        }
      }, React.createElement("table", {
        style: {
          width: "100%",
          borderCollapse: "collapse",
          minWidth: 860
        }
      }, React.createElement("thead", null, React.createElement("tr", null, ["User", "Action", "Type / reason / status", "Credits", "Balance after", "Created"].map(label => React.createElement("th", {
        key: label,
        style: {
          ...labelStyle,
          textAlign: "left",
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.16)"
        }
      }, label)))), React.createElement("tbody", null, recentRows.map(row => React.createElement("tr", {
        key: row.id || `${row.user_id}-${row.created_at}-${row.action}`,
        style: {
          borderBottom: "1px solid rgba(255,255,255,0.06)"
        }
      }, React.createElement("td", {
        style: { padding: "11px 12px" }
      }, React.createElement("div", {
        style: { color: "rgba(255,255,255,0.86)", fontWeight: 800 }
      }, shortText(userLabel(row), 90)), React.createElement("div", {
        style: mutedStyle
      }, row.user_id || "No user id")), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, row.action || "transaction"), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.62)", lineHeight: 1.45 }
      }, shortText(transactionReason(row), 120)), React.createElement("td", {
        style: {
          padding: "11px 12px",
          color: metricValue(row.credits_added, 0) ? "rgba(143,255,196,0.9)" : "rgba(255,220,100,0.82)",
          fontFamily: "'DM Mono',monospace",
          fontWeight: 800
        }
      }, transactionAmount(row)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, displayMetric(row.balance_after)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.72)" }
      }, formatDate(row.created_at))))))) : React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: "18px 14px",
          color: "rgba(255,255,255,0.56)",
          fontSize: 13
        }
      }, transactionsState.loading ? "Loading transactions..." : transactionsState.error ? transactionsState.error : "No transactions exist yet.")), transactionsState.error && recentRows.length > 0 && inlineError(transactionsState.error));
    };
    const renderSettingsOverview = () => {
      const providers = [{
        key: "gemini",
        label: "Gemini",
        state: keyInfo?.gemini
      }, {
        key: "replicate",
        label: "Replicate",
        state: keyInfo?.replicate
      }];
      const providerReadyCount = providers.filter(provider => provider.state?.set).length;
      const keyInfoUnavailable = !keyInfo || keyInfo.authRequired;
      const settingsCards = [{
        label: "Admin session",
        value: adminSession?.authenticated ? "Authenticated" : "Locked",
        detail: adminSession?.username || "admin"
      }, {
        label: "Provider keys",
        value: keyInfoUnavailable ? "Unavailable" : `${providerReadyCount}/${providers.length}`,
        detail: keyInfoUnavailable ? "Key status not loaded" : "Configured providers"
      }, {
        label: "Environment keys",
        value: keyInfoUnavailable ? "N/A" : providers.filter(provider => provider.state?.fromEnv).length,
        detail: "Keys sourced from Railway/env"
      }, {
        label: "Editable keys",
        value: keyInfoUnavailable ? "N/A" : providers.filter(provider => provider.state?.set && !provider.state?.fromEnv).length,
        detail: "Keys stored outside env"
      }];

      return React.createElement(React.Fragment, null, metricGrid(settingsCards), React.createElement("div", {
        style: {
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
          gap: 12
        }
      }, React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: 12
        }
      }, React.createElement("div", {
        style: labelStyle
      }, "Provider key status"), keyInfoUnavailable ? React.createElement("div", {
        style: {
          ...mutedStyle,
          marginTop: 10
        }
      }, keyInfo?.authRequired ? "Admin authentication is required to load key status." : "Provider key status is not available yet.") : React.createElement("div", {
        style: {
          display: "grid",
          gap: 8,
          marginTop: 10
        }
      }, providers.map(provider => React.createElement("div", {
        key: provider.key,
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          color: "rgba(255,255,255,0.74)",
          fontSize: 13
        }
      }, React.createElement("span", null, provider.label), React.createElement("span", {
        style: {
          color: provider.state?.set ? "rgba(143,255,196,0.9)" : "#ffb4a8",
          fontFamily: "'DM Mono',monospace"
        }
      }, provider.state?.set ? provider.state?.fromEnv ? "env" : "saved" : "missing"))))), React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.14)",
          padding: 12
        }
      }, React.createElement("div", {
        style: labelStyle
      }, "Service status modal"), React.createElement("div", {
        style: {
          ...mutedStyle,
          marginTop: 10,
          marginBottom: 12
        }
      }, "Settings remain managed in the existing service status modal for now."), React.createElement("button", {
        type: "button",
        onClick: onOpenSettings,
        style: actionButtonStyle
      }, "Open Service Status"))));
    };
    const formatDate = value => {
      if (!value) return "Never";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Unknown";
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    };
    const buildUsersPath = () => {
      const params = new URLSearchParams({ limit: "100" });
      if (userSearch.trim()) params.set("q", userSearch.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (roleFilter) params.set("role", roleFilter);
      return `/api/admin/users?${params.toString()}`;
    };
    const refreshAdminUsers = async () => {
      setUsersState(prev => ({ ...prev, loading: true, error: "", message: "" }));
      try {
        const res = await fetch(buildUsersPath(), {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(adminResponseError(data, res.status));
        setUsersState({ rows: Array.isArray(data.rows) ? data.rows : [], loading: false, error: "", message: "Users refreshed" });
      } catch (error) {
        setUsersState(prev => ({ ...prev, loading: false, error: error.message || "Could not refresh users", message: "" }));
      }
    };
    const loadUserDetail = async user => {
      setSelectedUser(user);
      setUserDetail(null);
      setDetailError("");
      setCreditError("");
      setCreditMessage("");
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(adminResponseError(data, res.status));
        setUserDetail(data);
      } catch (error) {
        setDetailError(error.message || "Could not load user detail");
      } finally {
        setDetailLoading(false);
      }
    };
    const toggleUserStatus = async user => {
      setStatusBusy(true);
      setDetailError("");
      try {
        const disabled = !(user.disabled || user.account_status !== "active");
        const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/status`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ disabled })
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(adminResponseError(data, res.status));
        await refreshAdminUsers();
        await loadUserDetail(data.user || { ...user, disabled, account_status: disabled ? "disabled" : "active" });
      } catch (error) {
        setDetailError(error.message || "Could not update user status");
      } finally {
        setStatusBusy(false);
      }
    };
    const submitCreditAdjustment = async event => {
      event.preventDefault();
      setCreditError("");
      setCreditMessage("");
      if (!selectedUser?.id) return;
      const amount = Number(creditAmount);
      if (!Number.isInteger(amount) || amount === 0) {
        setCreditError("Amount must be a non-zero integer.");
        return;
      }
      if (!creditReason.trim()) {
        setCreditError("Reason is required.");
        return;
      }
      setCreditBusy(true);
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedUser.id)}/credits`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ amount, reason: creditReason.trim() })
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(adminResponseError(data, res.status));
        setCreditMessage(`Balance updated to ${data.balance}`);
        setCreditAmount("");
        setCreditReason("");
        await refreshAdminUsers();
        await loadUserDetail(selectedUser);
      } catch (error) {
        setCreditError(error.message || "Credit adjustment failed");
      } finally {
        setCreditBusy(false);
      }
    };
    const submitPassword = async event => {
      event.preventDefault();
      setPasswordError("");
      setPasswordMessage("");
      if (!passwordTarget?.id) return;
      if (newPassword.length < 8) {
        setPasswordError("Password must be at least 8 characters.");
        return;
      }
      setPasswordBusy(true);
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(passwordTarget.id)}/password`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ password: newPassword })
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(adminResponseError(data, res.status));
        setPasswordMessage(data?.message || "Password updated");
        setNewPassword("");
        setPasswordTarget(null);
      } catch (error) {
        setPasswordError(error.message || "Password update failed");
      } finally {
        setPasswordBusy(false);
      }
    };
    const renderAdminUsers = () => {
      const rows = usersState.rows || [];
      return React.createElement("div", {
        style: {
          borderTop: "1px solid rgba(255,255,255,0.08)",
          marginTop: 14,
          paddingTop: 14
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10
        }
      }, React.createElement("div", null, React.createElement("div", {
        style: {
          color: "rgba(255,255,255,0.86)",
          fontWeight: 800,
          fontSize: 15
        }
      }, "Registered users"), React.createElement("div", {
        style: mutedStyle
      }, "Password hashes are not returned or displayed.")), React.createElement("button", {
        type: "button",
        onClick: refreshAdminUsers,
        disabled: usersState.loading,
        style: secondaryButtonStyle
      }, usersState.loading ? "Loading..." : "Refresh")), React.createElement("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "minmax(180px,1fr) minmax(130px,0.35fr) minmax(130px,0.35fr)",
          gap: 9,
          marginBottom: 10
        }
      }, React.createElement("input", {
        type: "search",
        value: userSearch,
        onChange: event => setUserSearch(event.target.value),
        placeholder: "Search username, email, or id",
        style: inputStyle
      }), React.createElement("select", {
        value: statusFilter,
        onChange: event => setStatusFilter(event.target.value),
        style: inputStyle
      }, React.createElement("option", {
        value: ""
      }, "Any status"), React.createElement("option", {
        value: "active"
      }, "Active"), React.createElement("option", {
        value: "disabled"
      }, "Disabled")), React.createElement("select", {
        value: roleFilter,
        onChange: event => setRoleFilter(event.target.value),
        style: inputStyle
      }, React.createElement("option", {
        value: ""
      }, "Any role"), React.createElement("option", {
        value: "user"
      }, "User"), React.createElement("option", {
        value: "admin"
      }, "Admin"))), usersState.error && React.createElement("div", {
        style: {
          color: "#ffb4a8",
          fontSize: 13,
          marginBottom: 10
        }
      }, usersState.error), usersState.message && React.createElement("div", {
        style: {
          color: "rgba(143,255,196,0.9)",
          fontSize: 13,
          marginBottom: 10
        }
      }, usersState.message), React.createElement("div", {
        style: {
          overflowX: "auto",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12
        }
      }, React.createElement("table", {
        style: {
          width: "100%",
          borderCollapse: "collapse",
          minWidth: 760
        }
      }, React.createElement("thead", null, React.createElement("tr", null, ["User", "Role", "Status", "Credits", "Created", "Last login", "Action"].map(label => React.createElement("th", {
        key: label,
        style: {
          ...labelStyle,
          textAlign: "left",
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.16)"
        }
      }, label)))), React.createElement("tbody", null, rows.length ? rows.map(user => React.createElement("tr", {
        key: user.id,
        style: {
          borderBottom: "1px solid rgba(255,255,255,0.06)"
        }
      }, React.createElement("td", {
        style: { padding: "11px 12px" }
      }, React.createElement("div", {
        style: { color: "rgba(255,255,255,0.86)", fontWeight: 800 }
      }, user.username || user.email || "Unnamed user"), React.createElement("div", {
        style: mutedStyle
      }, user.email || user.id)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.7)" }
      }, user.role || "user"), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.7)" }
      }, user.account_status || "unknown"), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.7)" }
      }, Number(user.credits_balance || 0)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.7)" }
      }, formatDate(user.created_at)), React.createElement("td", {
        style: { padding: "11px 12px", color: "rgba(255,255,255,0.7)" }
      }, formatDate(user.last_login_at)), React.createElement("td", {
        style: { padding: "11px 12px" }
      }, React.createElement("div", {
        style: {
          display: "flex",
          gap: 7,
          flexWrap: "wrap"
        }
      }, React.createElement("button", {
        type: "button",
        onClick: () => loadUserDetail(user),
        style: secondaryButtonStyle
      }, "Details"), React.createElement("button", {
        type: "button",
        onClick: () => toggleUserStatus(user),
        disabled: statusBusy,
        style: secondaryButtonStyle
      }, user.account_status === "active" ? "Disable" : "Enable"), React.createElement("button", {
        type: "button",
        onClick: () => {
          setPasswordTarget(user);
          setNewPassword("");
          setPasswordError("");
          setPasswordMessage("");
        },
        style: actionButtonStyle
      }, "Set password"))))) : React.createElement("tr", null, React.createElement("td", {
        colSpan: 7,
        style: {
          padding: "18px 12px",
          color: "rgba(255,255,255,0.56)"
        }
      }, usersState.loading ? "Loading users..." : "No registered users found."))))), selectedUser && React.createElement("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          background: "rgba(0,0,0,0.14)",
          padding: 12,
          marginTop: 12
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10
        }
      }, React.createElement("div", null, React.createElement("div", {
        style: { color: "rgba(255,255,255,0.88)", fontWeight: 800 }
      }, selectedUser.username || selectedUser.email || "Selected user"), React.createElement("div", {
        style: mutedStyle
      }, selectedUser.email || selectedUser.id)), React.createElement("div", {
        style: {
          display: "flex",
          gap: 8,
          flexWrap: "wrap"
        }
      }, React.createElement("button", {
        type: "button",
        onClick: () => toggleUserStatus(userDetail?.user || selectedUser),
        disabled: statusBusy,
        style: secondaryButtonStyle
      }, (userDetail?.user?.account_status || selectedUser.account_status) === "active" ? "Disable login" : "Enable login"), React.createElement("button", {
        type: "button",
        onClick: () => {
          setSelectedUser(null);
          setUserDetail(null);
          setDetailError("");
        },
        style: secondaryButtonStyle
      }, "Close"))), detailLoading && React.createElement("div", {
        style: mutedStyle
      }, "Loading user detail..."), detailError && React.createElement("div", {
        style: { color: "#ffb4a8", fontSize: 13, marginBottom: 10 }
      }, detailError), userDetail && React.createElement("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 9,
          marginBottom: 12
        }
      }, card("Credit balance", userDetail.credits?.balance ?? userDetail.user?.credits_balance ?? 0), card("Recent transactions", Array.isArray(userDetail.credits?.transactions) ? userDetail.credits.transactions.length : 0), card("Recent generations", Array.isArray(userDetail.generations) ? userDetail.generations.length : 0), card("Status", userDetail.user?.account_status || selectedUser.account_status || "unknown")), React.createElement("form", {
        onSubmit: submitCreditAdjustment,
        style: {
          display: "grid",
          gap: 9,
          gridTemplateColumns: "minmax(110px,0.25fr) minmax(220px,1fr) auto",
          alignItems: "end",
          marginBottom: 10
        }
      }, React.createElement("label", {
        style: { display: "grid", gap: 5 }
      }, React.createElement("span", {
        style: labelStyle
      }, "Credits"), React.createElement("input", {
        type: "number",
        step: "1",
        value: creditAmount,
        onChange: event => setCreditAmount(event.target.value),
        placeholder: "10 or -10",
        style: inputStyle
      })), React.createElement("label", {
        style: { display: "grid", gap: 5 }
      }, React.createElement("span", {
        style: labelStyle
      }, "Reason"), React.createElement("input", {
        type: "text",
        value: creditReason,
        onChange: event => setCreditReason(event.target.value),
        placeholder: "Manual admin adjustment",
        style: inputStyle
      })), React.createElement("button", {
        type: "submit",
        disabled: creditBusy,
        style: actionButtonStyle
      }, creditBusy ? "Saving..." : "Adjust credits")), creditError && React.createElement("div", {
        style: { color: "#ffb4a8", fontSize: 13, marginBottom: 8 }
      }, creditError), creditMessage && React.createElement("div", {
        style: { color: "rgba(143,255,196,0.9)", fontSize: 13, marginBottom: 8 }
      }, creditMessage), userDetail?.credits?.transactions?.length ? React.createElement("div", {
        style: mutedStyle
      }, `Latest transaction: ${userDetail.credits.transactions[0].action || "adjustment"} on ${formatDate(userDetail.credits.transactions[0].created_at)}`) : null), passwordTarget && React.createElement("form", {
        onSubmit: submitPassword,
        style: {
          marginTop: 12,
          display: "grid",
          gap: 9,
          gridTemplateColumns: "minmax(220px,1fr) auto auto",
          alignItems: "end"
        }
      }, React.createElement("label", {
        style: { display: "grid", gap: 5 }
      }, React.createElement("span", {
        style: labelStyle
      }, `New password for ${passwordTarget.username || passwordTarget.email || "user"}`), React.createElement("input", {
        type: "password",
        value: newPassword,
        onChange: event => setNewPassword(event.target.value),
        minLength: 8,
        autoComplete: "new-password",
        style: inputStyle
      })), React.createElement("button", {
        type: "submit",
        disabled: passwordBusy,
        style: actionButtonStyle
      }, passwordBusy ? "Saving..." : "Save password"), React.createElement("button", {
        type: "button",
        onClick: () => {
          setPasswordTarget(null);
          setNewPassword("");
          setPasswordError("");
        },
        style: secondaryButtonStyle
      }, "Cancel")), passwordError && React.createElement("div", {
        style: { color: "#ffb4a8", fontSize: 13, marginTop: 8 }
      }, passwordError), passwordMessage && React.createElement("div", {
        style: { color: "rgba(143,255,196,0.9)", fontSize: 13, marginTop: 8 }
      }, passwordMessage));
    };
    const statusCards = [{
      label: "Admin Session",
      value: adminSession?.authenticated ? "Authenticated" : "Locked"
    }, {
      label: "Provider Keys",
      value: keyInfo?.gemini?.set && keyInfo?.replicate?.set ? "Ready" : "Check settings"
    }, {
      label: "Session Prompts",
      value: resultsCount || 0
    }, {
      label: "Completed Images",
      value: generatedImages || 0
    }, {
      label: "Local Signals",
      value: ratingCount || 0
    }];
    const overviewCards = [{
      label: "Admin Status",
      value: adminSession?.authenticated ? "Authenticated" : "Locked"
    }, {
      label: "API Key Status",
      value: keyInfo?.gemini?.set && keyInfo?.replicate?.set ? "Gemini + Replicate ready" : "Needs review"
    }, {
      label: "Current Session Prompts",
      value: resultsCount || 0
    }, {
      label: "Completed Images",
      value: generatedImages || 0
    }, {
      label: "Quality / Rating Signals",
      value: ratingCount || 0
    }];
    const analyticsCards = [{
      label: "Generated Prompts",
      value: resultsCount || 0
    }, {
      label: "Completed Images",
      value: generatedImages || 0
    }, {
      label: "Pending Images",
      value: imageStatusCounts?.pending || 0
    }, {
      label: "Failed Images",
      value: imageStatusCounts?.failed || 0
    }, {
      label: "Rating Signals",
      value: ratingCount || 0
    }];
    const researchCards = [{
      label: "Research Tools",
      value: "Available in Service Status"
    }, {
      label: "Admin Access",
      value: adminSession?.authenticated ? "Authenticated" : "Locked"
    }, {
      label: "Provider Keys",
      value: keyInfo?.gemini?.set && keyInfo?.replicate?.set ? "Ready" : "Check settings"
    }, {
      label: "Current Prompts",
      value: resultsCount || 0
    }];
    const learningCards = [{
      label: "Prompt Rating Signals",
      value: ratingCount || 0
    }, {
      label: "Current Session Prompts",
      value: resultsCount || 0
    }, {
      label: "Completed Images",
      value: generatedImages || 0
    }, {
      label: "Pending Images",
      value: imageStatusCounts?.pending || 0
    }];
    const cardsForRoute = routePath === "/admin"
      ? overviewCards
      : routePath === "/admin/analytics"
        ? analyticsCards
        : routePath === "/admin/research"
          ? researchCards
          : routePath === "/admin/learning"
            ? learningCards
            : statusCards;
    const copyForRoute = routePath === "/admin"
      ? "This overview uses the current admin session and in-memory workspace state. Full platform totals will move here after admin data pages are separated."
      : routePath === "/admin/analytics"
        ? "This analytics summary uses only the current browser session. Server-side analytics and research views remain available in the existing admin research area."
        : routePath === "/admin/research"
          ? "Research tools are still hosted in the existing admin settings modal. This route provides a landing panel and safe jumps until the real research UI is moved."
          : routePath === "/admin/learning"
            ? "Learning summary uses local prompt ratings and current session generation state. Server-side learning views stay in the existing research/admin tools for now."
            : panelCopy[routePath] || route.description || "This admin page will get dedicated content in a later phase.";
    return React.createElement("section", {
      style: {
        maxWidth: 1120,
        margin: "0 auto",
        padding: "14px 20px 0"
      }
    }, React.createElement("div", {
      style: {
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        background: "rgba(255,255,255,0.028)",
        padding: "15px"
      }
    }, routePath === "/admin" ? renderAdminDashboardOverview() : routePath === "/admin/analytics" ? renderAnalyticsOverview() : routePath === "/admin/research" ? renderResearchOverview() : routePath === "/admin/learning" ? renderLearningOverview() : routePath === "/admin/credits" ? renderCreditsOverview() : routePath === "/admin/transactions" ? renderTransactionsOverview() : routePath === "/admin/settings" ? renderSettingsOverview() : React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        gap: 10,
        marginBottom: 12
      }
    }, cardsForRoute.map(item => card(item.label, item.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.58)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, copyForRoute), React.createElement("div", {
      style: {
        display: "flex",
        gap: 9,
        flexWrap: "wrap"
      }
    }, existingTarget && React.createElement("button", {
      type: "button",
      onClick: () => onNavigate(existingTarget, routePath),
      style: actionButtonStyle
    }, "Jump to Current Section"), React.createElement("button", {
      type: "button",
      onClick: onOpenSettings,
      style: actionButtonStyle
    }, routePath === "/admin/settings" ? "Open Admin Settings" : "Open Service Status")), routePath === "/admin/users" && renderAdminUsers())));
  }

  window.AdminRouteContent = AdminRouteContent;
})();
