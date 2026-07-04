(function () {
  function buildTopNavItems(activeRoute) {
    return [{
      id: "dashboard-section",
      label: "Dashboard",
      route: "/dashboard",
      active: activeRoute === "/dashboard"
    }, {
      id: "compose-section",
      label: "Generate Mockups",
      route: "/generate",
      active: activeRoute === "/generate"
    }, {
      id: "tshirt-studio-section",
      label: "T-Shirt Studio",
      route: "/tshirt-studio",
      active: activeRoute === "/tshirt-studio"
    }, {
      id: "history-section",
      label: "History",
      route: "/generations",
      active: activeRoute === "/generations"
    }, {
      id: "credits-section",
      label: "Credits",
      route: "/credits",
      active: activeRoute === "/credits"
    }, {
      id: "account-section",
      label: "Account",
      route: "/account",
      active: activeRoute === "/account" || activeRoute === "/settings"
    }];
  }

  function buildUserShellNavItems(activeRoute) {
    return [{
      id: "nav-group-workspace",
      type: "label",
      label: "Workspace"
    }, {
      id: "dashboard-section",
      label: "Overview",
      meta: "Home",
      route: "/dashboard",
      active: activeRoute === "/dashboard"
    }, {
      id: "compose-section",
      label: "Generate",
      meta: "Create",
      route: "/generate",
      active: activeRoute === "/generate"
    }, {
      id: "tshirt-studio-section",
      label: "T-Shirt Studio",
      meta: "Canvas",
      route: "/tshirt-studio",
      active: activeRoute === "/tshirt-studio"
    }, {
      id: "results-section",
      label: "Generations",
      meta: "Gallery",
      route: "/generations",
      active: activeRoute === "/generations"
    }, {
      id: "credits-section",
      label: "Billing",
      meta: "Usage",
      route: "/credits",
      active: activeRoute === "/credits"
    }, {
      id: "nav-group-account",
      type: "label",
      label: "Account"
    }, {
      id: "account-section",
      label: "Profile",
      meta: "User",
      route: "/account",
      active: activeRoute === "/account"
    }, {
      id: "account-section",
      label: "Settings",
      meta: "Prefs",
      route: "/settings",
      active: activeRoute === "/settings"
    }];
  }

  function buildAdminShellNavItems({ isAdmin, activeRoute, onAdminOpen }) {
    if (!isAdmin) return [];
    return [{
      id: "nav-group-admin",
      type: "label",
      label: "Admin"
    }, {
      id: "dashboard-section",
      label: "Admin Overview",
      meta: "Home",
      route: "/admin",
      active: activeRoute === "/admin"
    }, {
      id: "dashboard-section",
      label: "Users",
      meta: "People",
      route: "/admin/users",
      active: activeRoute === "/admin/users"
    }, {
      id: "credits-section",
      label: "Credits",
      meta: "Rules",
      route: "/admin/credits",
      active: activeRoute === "/admin/credits"
    }, {
      id: "credits-section",
      label: "Transactions",
      meta: "Ledger",
      route: "/admin/transactions",
      active: activeRoute === "/admin/transactions"
    }, {
      id: "results-section",
      label: "Generations",
      meta: "All",
      route: "/admin/generations",
      active: activeRoute === "/admin/generations"
    }, {
      id: "learning-section",
      label: "Analytics",
      meta: "Usage",
      route: "/admin/analytics",
      active: activeRoute === "/admin/analytics"
    }, {
      id: "compose-section",
      label: "Prompts",
      meta: "Text",
      route: "/admin/prompts",
      active: activeRoute === "/admin/prompts"
    }, {
      id: "compose-section",
      label: "AI Models",
      meta: "Stack",
      route: "/admin/models",
      active: activeRoute === "/admin/models"
    }, {
      id: "learning-section",
      label: "Quality",
      meta: "QA",
      route: "/admin/quality",
      active: activeRoute === "/admin/quality"
    }, {
      id: "learning-section",
      label: "Learning",
      meta: "Signals",
      route: "/admin/learning",
      active: activeRoute === "/admin/learning"
    }, {
      id: "learning-section",
      label: "Research",
      meta: "Data",
      route: "/admin/research",
      active: activeRoute === "/admin/research"
    }, {
      id: "admin-settings",
      label: "Admin Settings",
      meta: "Config",
      route: "/admin/settings",
      active: activeRoute === "/admin/settings",
      action: onAdminOpen
    }];
  }

  function buildSectionItems({ isUser }) {
    return [...(isUser ? [{
      id: "dashboard-section",
      kicker: "00",
      label: "Dashboard",
      description: "Credits, history, and account overview."
    }] : []), {
      id: "tshirt-studio-section",
      kicker: "01",
      label: "T-Shirt Studio",
      description: "Place artwork, fine-tune print placement, and export a finished shirt mockup."
    }, {
      id: "compose-section",
      kicker: "02",
      label: "Composer",
      description: "Upload, design intent, and prompt controls."
    }, {
      id: "learning-section",
      kicker: "03",
      label: "Learning",
      description: "Local ratings and preference signals."
    }, {
      id: "results-section",
      kicker: "04",
      label: "Results",
      description: "Generated concepts, images, and exports."
    }];
  }

  function buildSummaryChips({ isAdmin, adminSession, doneCount, total, learningEnabled, resolvedMockupStyleMode, analysisReady }) {
    return isAdmin ? [{
      label: "Mode",
      value: "Admin"
    }, {
      label: "Auth",
      value: adminSession?.authenticated ? "Connected" : "Locked"
    }] : [{
      label: "Images",
      value: `${doneCount}/${total}`
    }, {
      label: "Learning",
      value: learningEnabled ? "On" : "Off"
    }, {
      label: "Mode",
      value: resolvedMockupStyleMode()
    }, {
      label: "Analysis",
      value: analysisReady ? "Locked" : "Draft"
    }];
  }

  function buildStatusCards({ isAdmin, adminSession, keyInfo, doneCount, total, learningEnabled, analysisReady, resolvedMockupStyleMode }) {
    return isAdmin ? [{
      label: "Auth",
      value: adminSession?.authenticated ? "Connected" : "Locked"
    }, {
      label: "Keys",
      value: keyInfo?.gemini?.set && keyInfo?.replicate?.set ? "Ready" : "Missing"
    }] : [{
      label: "Images",
      value: `${doneCount}/${total}`
    }, {
      label: "Mode",
      value: resolvedMockupStyleMode()
    }, {
      label: "Learning",
      value: learningEnabled ? "On" : "Off"
    }, {
      label: "Analysis",
      value: analysisReady ? "Ready" : "Draft"
    }];
  }

  function buildShellNavigation({
    isAdmin,
    isUser,
    activeRoute,
    adminSession,
    keyInfo,
    doneCount,
    total,
    learningEnabled,
    analysisReady,
    resolvedMockupStyleMode,
    onAdminOpen
  }) {
    const navItems = buildTopNavItems(activeRoute);
    const userShellNavItems = buildUserShellNavItems(activeRoute);
    const adminShellNavItems = buildAdminShellNavItems({
      isAdmin,
      activeRoute,
      onAdminOpen
    });
    return {
      navItems,
      shellNavItems: isUser ? [...userShellNavItems, ...adminShellNavItems] : adminShellNavItems,
      sectionItems: buildSectionItems({ isUser }),
      summaryChips: buildSummaryChips({
        isAdmin,
        adminSession,
        doneCount,
        total,
        learningEnabled,
        resolvedMockupStyleMode,
        analysisReady
      }),
      statusCards: buildStatusCards({
        isAdmin,
        adminSession,
        keyInfo,
        doneCount,
        total,
        learningEnabled,
        analysisReady,
        resolvedMockupStyleMode
      })
    };
  }

  window.KOShellNavigation = Object.freeze({
    buildTopNavItems,
    buildUserShellNavItems,
    buildAdminShellNavItems,
    buildSectionItems,
    buildSummaryChips,
    buildStatusCards,
    buildShellNavigation
  });
})();
