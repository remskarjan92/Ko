(function () {
  const USER_ROUTE_MAP = Object.freeze({
    "/dashboard": { shell: "user", label: "Dashboard", title: "Overview", description: "Account health, credits, recent work, and the current generation workspace.", sectionId: "dashboard-section", status: "existing" },
    "/generate": { shell: "user", label: "Generate", title: "Generate Mockups", description: "Upload artwork, tune generation context, create mockup prompts, and generate images.", sectionId: "compose-section", status: "existing" },
    "/tshirt-studio": { shell: "user", label: "T-Shirt Studio", title: "T-Shirt Studio", description: "Place a design on a shirt mockup, adjust it, save placement data, and export the final asset.", sectionId: "tshirt-studio-section", status: "existing" },
    "/generations": { shell: "user", label: "Generations", title: "Generations", description: "Generated mockups, prompt outputs, downloads, and regeneration actions.", sectionId: "results-section", status: "existing" },
    "/credits": { shell: "user", label: "Credits", title: "Billing", description: "Credit balance and usage history are shown in the account overview for now.", sectionId: "credits-section", status: "existing" },
    "/account": { shell: "user", label: "Account", title: "Profile", description: "Profile details, account status, and account management.", sectionId: "account-section", status: "existing" },
    "/settings": { shell: "user", label: "Settings", title: "Settings", description: "Generation preferences, prompt preferences, and account/session controls.", sectionId: "account-section", status: "existing" }
  });

  const ADMIN_ROUTE_MAP = Object.freeze({
    "/admin": { shell: "admin", label: "Dashboard", title: "Admin Overview", description: "Platform status, provider readiness, and operational controls.", sectionId: "dashboard-section", status: "existing" },
    "/admin/users": { shell: "admin", label: "Users", title: "Users", description: "Search, inspect, and manage user accounts.", sectionId: "dashboard-section", status: "existing" },
    "/admin/credits": { shell: "admin", label: "Credits", title: "Credit Management", description: "Credit rules, packages, pricing, and manual adjustments.", sectionId: "credits-section", status: "existing" },
    "/admin/transactions": { shell: "admin", label: "Transactions", title: "Transactions", description: "Complete credit ledger and account balance history.", sectionId: "credits-section", status: "existing" },
    "/admin/generations": { shell: "admin", label: "Generations", title: "Generation Management", description: "Review platform generation activity, outputs, failures, and refunds.", sectionId: "results-section", status: "existing" },
    "/admin/analytics": { shell: "admin", label: "Analytics", title: "Analytics", description: "Usage, quality, cost, model, and category performance.", sectionId: "learning-section", status: "existing" },
    "/admin/prompts": { shell: "admin", label: "Prompts", title: "Prompt Management", description: "Master, fix, scoring, research, and video prompt operations.", sectionId: "compose-section", status: "existing" },
    "/admin/models": { shell: "admin", label: "AI Models", title: "AI Models", description: "Provider status, priority, fallback, cost, and response time controls.", sectionId: "compose-section", status: "existing" },
    "/admin/quality": { shell: "admin", label: "Quality", title: "Quality Control", description: "Quality score trends, issue breakdowns, fixes, and regeneration behavior.", sectionId: "learning-section", status: "existing" },
    "/admin/learning": { shell: "admin", label: "Learning", title: "Learning Center", description: "Concept scores, dimensions, prompt variants, and self-improvement signals.", sectionId: "learning-section", status: "existing" },
    "/admin/research": { shell: "admin", label: "Research", title: "Research Database", description: "Learning analytics, concept leaderboards, and research exports.", sectionId: "learning-section", status: "existing" },
    "/admin/settings": { shell: "admin", label: "Settings", title: "Admin Settings", description: "Keys, storage, model settings, feature toggles, and deployment controls.", sectionId: "account-section", status: "existing" }
  });

  const FRONTEND_ROUTE_MAP = Object.freeze({
    ...USER_ROUTE_MAP,
    ...ADMIN_ROUTE_MAP
  });

  const normalizeRoute = path => {
    let value = String(path || "").trim();
    if (!value && typeof window !== "undefined") {
      value = window.location.hash || window.location.pathname || "/dashboard";
    }
    if (value.startsWith("#")) value = value.slice(1);
    try {
      if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
    } catch {}
    value = value.split("?")[0].split("#")[0] || "/dashboard";
    if (!value.startsWith("/")) value = `/${value}`;
    value = value.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/dashboard";
    if (FRONTEND_ROUTE_MAP[value]) return value;
    return value.startsWith("/admin") ? "/admin" : "/dashboard";
  };

  const getRouteConfig = path => FRONTEND_ROUTE_MAP[normalizeRoute(path)] || FRONTEND_ROUTE_MAP["/dashboard"];
  const getShellType = path => getRouteConfig(path).shell;
  const isAdminRoute = path => getShellType(path) === "admin";

  window.KOFrontendRoutes = Object.freeze({
    routeMaps: Object.freeze({
      user: USER_ROUTE_MAP,
      admin: ADMIN_ROUTE_MAP,
      all: FRONTEND_ROUTE_MAP
    }),
    normalizeRoute,
    getRouteConfig,
    getShellType,
    isAdminRoute
  });
})();
