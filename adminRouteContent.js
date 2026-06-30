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
    const [usersState, setUsersState] = React.useState({ rows: [], loading: false, error: "", message: "" });
    const [passwordTarget, setPasswordTarget] = React.useState(null);
    const [newPassword, setNewPassword] = React.useState("");
    const [passwordBusy, setPasswordBusy] = React.useState(false);
    const [passwordError, setPasswordError] = React.useState("");
    const [passwordMessage, setPasswordMessage] = React.useState("");

    React.useEffect(() => {
      let cancelled = false;
      async function loadAdminUsers() {
        if (routePath !== "/admin/users" || !isAdmin) return;
        setUsersState(prev => ({ ...prev, loading: true, error: "", message: "" }));
        try {
          const res = await fetch("/api/admin/users", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
          });
          const text = await res.text();
          const data = text ? JSON.parse(text) : {};
          if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
          if (!cancelled) setUsersState({ rows: Array.isArray(data.rows) ? data.rows : [], loading: false, error: "", message: "" });
        } catch (error) {
          if (!cancelled) setUsersState({ rows: [], loading: false, error: error.message || "Could not load users", message: "" });
        }
      }
      loadAdminUsers();
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
    const formatDate = value => {
      if (!value) return "Never";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Unknown";
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    };
    const refreshAdminUsers = async () => {
      setUsersState(prev => ({ ...prev, loading: true, error: "", message: "" }));
      try {
        const res = await fetch("/api/admin/users", {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        setUsersState({ rows: Array.isArray(data.rows) ? data.rows : [], loading: false, error: "", message: "Users refreshed" });
      } catch (error) {
        setUsersState(prev => ({ ...prev, loading: false, error: error.message || "Could not refresh users", message: "" }));
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
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
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
      }, usersState.loading ? "Loading..." : "Refresh")), usersState.error && React.createElement("div", {
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
      }, React.createElement("button", {
        type: "button",
        onClick: () => {
          setPasswordTarget(user);
          setNewPassword("");
          setPasswordError("");
          setPasswordMessage("");
        },
        style: actionButtonStyle
      }, "Set password")))) : React.createElement("tr", null, React.createElement("td", {
        colSpan: 7,
        style: {
          padding: "18px 12px",
          color: "rgba(255,255,255,0.56)"
        }
      }, usersState.loading ? "Loading users..." : "No registered users found."))))), passwordTarget && React.createElement("form", {
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
    }, routePath === "/admin/settings" ? "Open Admin Settings" : "Open Service Status")), routePath === "/admin/users" && renderAdminUsers()));
  }

  window.AdminRouteContent = AdminRouteContent;
})();
