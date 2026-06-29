(function () {
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
    }, React.createElement("div", {
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
    }, routePath === "/admin/settings" ? "Open Admin Settings" : "Open Service Status"))));
  }

  window.AdminRouteContent = AdminRouteContent;
})();
