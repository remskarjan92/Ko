(function () {
  function AdminShell({
    route,
    items = [],
    adminSession,
    keyInfo,
    summaryChips = [],
    statusCards = [],
    onNavigate,
    onOpenSettings,
    onLogout,
    children
  }) {
    const title = route?.title || "Admin";
    const description = route?.description || "Platform management workspace.";
    const authStatus = adminSession?.authenticated ? "Authenticated" : "Locked";
    const providerStatus = keyInfo?.gemini?.set && keyInfo?.replicate?.set ? "Core providers ready" : "Provider review needed";
    const navItems = Array.isArray(items) ? items : [];
    const safeNavigate = item => {
      if (!item || item.type === "label") return;
      if (item.route && typeof onNavigate === "function") {
        onNavigate(item.id, item.route);
        return;
      }
      if (typeof item.action === "function") item.action();
    };

    const sidebarItem = item => {
      if (item.type === "label") {
        return React.createElement("div", {
          key: item.id,
          style: {
            color: "rgba(255,255,255,0.34)",
            fontSize: 10,
            fontFamily: "'DM Mono', monospace",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            padding: "14px 12px 7px"
          }
        }, item.label);
      }
      return React.createElement("button", {
        key: item.route || item.id,
        onClick: () => safeNavigate(item),
        style: {
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          border: item.active ? "1px solid rgba(255,220,100,0.34)" : "1px solid rgba(255,255,255,0.07)",
          background: item.active ? "rgba(255,220,100,0.11)" : "rgba(255,255,255,0.025)",
          color: item.active ? "rgba(255,240,180,0.96)" : "rgba(255,255,255,0.72)",
          borderRadius: 11,
          padding: "10px 11px",
          cursor: "pointer",
          textAlign: "left"
        }
      }, React.createElement("span", {
        style: {
          fontSize: 13,
          fontWeight: item.active ? 700 : 500
        }
      }, item.label), item.meta && React.createElement("span", {
        style: {
          color: item.active ? "rgba(255,220,100,0.78)" : "rgba(255,255,255,0.34)",
          fontSize: 10,
          fontFamily: "'DM Mono', monospace"
        }
      }, item.meta));
    };

    const statCard = (card, index) => React.createElement("div", {
      key: card.label || index,
      style: {
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.035)",
        borderRadius: 13,
        padding: "12px 13px"
      }
    }, React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.38)",
        fontSize: 10,
        fontFamily: "'DM Mono', monospace",
        letterSpacing: "0.11em",
        textTransform: "uppercase"
      }
    }, card.label), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.88)",
        fontSize: 15,
        fontWeight: 700,
        marginTop: 5
      }
    }, card.value));

    return React.createElement("div", {
      className: "admin-app-shell",
      style: {
        position: "relative",
        zIndex: 1,
        minHeight: "100vh",
        display: "flex",
        flexWrap: "wrap",
        gap: 0,
        color: "var(--text)"
      }
    }, React.createElement("aside", {
      style: {
        flex: "0 0 264px",
        minHeight: "100vh",
        padding: "18px 14px",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018))",
        backdropFilter: "blur(18px)"
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px 18px"
      }
    }, React.createElement("div", {
      style: {
        width: 34,
        height: 34,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        background: "rgba(255,220,100,0.14)",
        border: "1px solid rgba(255,220,100,0.25)",
        color: "rgba(255,230,150,0.96)",
        fontWeight: 800,
        fontFamily: "'DM Mono', monospace"
      }
    }, "KO"), React.createElement("div", null, React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.94)",
        fontSize: 15,
        fontWeight: 800
      }
    }, "KO Admin"), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.38)",
        fontSize: 11
      }
    }, "Platform console"))), React.createElement("nav", {
      style: {
        display: "grid",
        gap: 7
      }
    }, navItems.map(sidebarItem)), React.createElement("div", {
      style: {
        marginTop: 16,
        display: "grid",
        gap: 8
      }
    }, React.createElement("button", {
      onClick: onOpenSettings,
      style: {
        border: "1px solid rgba(90,180,255,0.24)",
        background: "rgba(90,180,255,0.08)",
        color: "rgba(180,220,255,0.92)",
        borderRadius: 11,
        padding: "10px 11px",
        cursor: "pointer",
        textAlign: "left",
        fontWeight: 700
      }
    }, "Open Legacy Settings"), React.createElement("button", {
      onClick: onLogout,
      style: {
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        color: "rgba(255,255,255,0.58)",
        borderRadius: 11,
        padding: "10px 11px",
        cursor: "pointer",
        textAlign: "left"
      }
    }, "Logout"))), React.createElement("main", {
      style: {
        flex: "1 1 720px",
        minWidth: 0,
        padding: "18px 22px 42px"
      }
    }, React.createElement("header", {
      style: {
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.035)",
        borderRadius: 18,
        padding: "16px",
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap"
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        color: "rgba(255,220,100,0.82)",
        fontFamily: "'DM Mono', monospace",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginBottom: 7
      }
    }, "Admin app shell"), React.createElement("h1", {
      style: {
        margin: 0,
        color: "rgba(255,255,255,0.95)",
        fontSize: 28,
        lineHeight: 1.05
      }
    }, title), React.createElement("p", {
      style: {
        margin: "8px 0 0",
        color: "rgba(255,255,255,0.52)",
        fontSize: 13,
        maxWidth: 680,
        lineHeight: 1.55
      }
    }, description)), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        justifyContent: "flex-end"
      }
    }, [...summaryChips, { label: "Admin", value: authStatus }, { label: "Providers", value: providerStatus }].map((chip, index) => React.createElement("div", {
      key: chip.label + index,
      style: {
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.24)",
        borderRadius: 999,
        padding: "7px 10px",
        color: "rgba(255,255,255,0.72)",
        fontSize: 11
      }
    }, React.createElement("span", {
      style: {
        color: "rgba(255,255,255,0.38)",
        marginRight: 6
      }
    }, chip.label), chip.value)))), statusCards.length > 0 && React.createElement("section", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 10,
        marginBottom: 16
      }
    }, statusCards.map(statCard)), React.createElement("section", {
      style: {
        display: "grid",
        gap: 14
      }
    }, children)));
  }

  window.AdminShell = AdminShell;
})();
