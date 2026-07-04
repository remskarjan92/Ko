(function () {
  function UserRouteContent({
    routePath,
    session,
    resultsCount,
    generatedImages,
    imageStatusCounts,
    ratingCount,
    onNavigate,
    onOpenSettings
  }) {
    if (!["/dashboard", "/generate", "/credits", "/account", "/generations", "/settings", "/tshirt-studio"].includes(routePath)) return null;
    const creditBalance = session?.credits_balance ?? session?.creditBalance ?? session?.credits ?? null;
    const rowStyle = {
      display: "grid",
      gridTemplateColumns: "minmax(130px, 0.45fr) minmax(0, 1fr)",
      gap: 12,
      padding: "10px 0",
      borderBottom: "1px solid rgba(255,255,255,0.06)"
    };
    const labelStyle = {
      color: "rgba(255,220,100,0.60)",
      fontFamily: "'DM Mono',monospace",
      fontSize: 10,
      letterSpacing: "0.12em",
      textTransform: "uppercase"
    };
    const valueStyle = {
      color: "rgba(255,255,255,0.82)",
      fontSize: 13,
      overflowWrap: "anywhere"
    };
    const field = (label, value) => React.createElement("div", {
      key: label,
      style: rowStyle
    }, React.createElement("div", {
      style: labelStyle
    }, label), React.createElement("div", {
      style: valueStyle
    }, value ?? "Not available"));
    const statCard = (label, value) => React.createElement("div", {
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
        color: "#fff",
        fontSize: 20,
        fontWeight: 800,
        marginTop: 5
      }
    }, value));
    const gridStyle = {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
      gap: 10,
      marginBottom: 12
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
    const sectionCard = (label, value) => React.createElement("div", {
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
        color: "rgba(255,255,255,0.68)",
        fontSize: 13,
        lineHeight: 1.5,
        marginTop: 5
      }
    }, value));
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
    }, routePath === "/generate" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Design input",
      value: "Ready"
    }, {
      label: "Mockup prompts",
      value: resultsCount || 0
    }, {
      label: "Generated images",
      value: generatedImages || 0
    }].map(card => statCard(card.label, card.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, "Use the composer below to upload artwork, confirm context, generate prompts, and produce mockup images.")) : routePath === "/tshirt-studio" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Placement Canvas",
      value: "Front mockup"
    }, {
      label: "Export",
      value: "2000 x 2000"
    }, {
      label: "Saved Layouts",
      value: "User scoped"
    }].map(card => statCard(card.label, card.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, "Use the studio below to place a design on a shirt, save the placement JSON, and export a finished mockup image."), React.createElement("div", {
      style: {
        display: "flex",
        gap: 9,
        flexWrap: "wrap"
      }
    }, React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("tshirt-studio-section", "/tshirt-studio"),
      style: actionButtonStyle
    }, "Open Studio"), React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("compose-section", "/generate"),
      style: actionButtonStyle
    }, "Back to Composer"))) : routePath === "/settings" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Generation Defaults",
      value: "Current defaults remain in the existing generation controls below."
    }, {
      label: "Prompt Preferences",
      value: "Prompt learning and saved preference controls remain in the current workspace for now."
    }, {
      label: "Account / Session",
      value: session?.authenticated ? "This browser has an active user session." : "No active user session details are loaded."
    }, {
      label: "API / Provider Keys",
      value: "Provider keys are still managed through the existing settings modal."
    }].map(item => sectionCard(item.label, item.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, "Settings are still managed through the existing modal for now. This panel is a route wrapper only."), React.createElement("button", {
      type: "button",
      onClick: onOpenSettings,
      style: actionButtonStyle
    }, "Open Settings Modal")) : routePath === "/dashboard" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Credit Balance",
      value: creditBalance ?? "Not loaded"
    }, {
      label: "Current Prompts",
      value: resultsCount || 0
    }, {
      label: "Completed Images",
      value: generatedImages || 0
    }, {
      label: "Ratings / Signals",
      value: ratingCount || 0
    }].map(card => statCard(card.label, card.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, creditBalance == null ? "Dashboard uses the current local session and in-memory generation state. Credit balance is not loaded in this session payload." : "Dashboard uses the current local session and in-memory generation state."), React.createElement("div", {
      style: {
        display: "flex",
        gap: 9,
        flexWrap: "wrap"
      }
    }, React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("compose-section", "/generate"),
      style: actionButtonStyle
    }, "Start Generation"), React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("results-section", "/generations"),
      style: actionButtonStyle
    }, "View Results"), React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("credits-section", "/credits"),
      style: actionButtonStyle
    }, "Manage Credits"))) : routePath === "/generations" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Prompt Results",
      value: resultsCount || 0
    }, {
      label: "Completed Images",
      value: generatedImages || 0
    }, {
      label: "Pending",
      value: imageStatusCounts?.pending || 0
    }, {
      label: "Failed",
      value: imageStatusCounts?.failed || 0
    }, {
      label: "Rated",
      value: ratingCount || 0
    }].map(card => statCard(card.label, card.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, resultsCount ? "This panel summarizes the current in-memory generation session. The full results grid remains below." : "No generated prompts are loaded in the current workspace yet."), React.createElement("div", {
      style: {
        display: "flex",
        gap: 9,
        flexWrap: "wrap"
      }
    }, React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("compose-section", "/generate"),
      style: actionButtonStyle
    }, "Jump to Composer"), React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("results-section", "/generations"),
      style: actionButtonStyle
    }, "Jump to Results"))) : routePath === "/credits" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Current Credits",
      value: creditBalance ?? "Not loaded"
    }, {
      label: "Prompt Sets This Session",
      value: resultsCount || 0
    }, {
      label: "Images This Session",
      value: generatedImages || 0
    }].map(card => statCard(card.label, card.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, creditBalance == null ? "Credit balance is not present in the current session payload. No extra backend call was added in this phase." : "Credit balance is shown from the current frontend session payload."), React.createElement("div", {
      style: {
        border: "1px dashed rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: "12px",
        color: "rgba(255,255,255,0.46)",
        fontSize: 13,
        marginBottom: 12
      }
    }, "Transaction history is not loaded in this route yet."), React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("results-section", "/generations"),
      style: actionButtonStyle
    }, "Back to Generations")) : React.createElement(React.Fragment, null, field("Session Status", session?.authenticated ? "Authenticated" : "Not authenticated"), field("Username", session?.username), field("Email", session?.email), field("User ID", session?.userId || session?.id), field("Account Type", "User"), field("Role", session?.role || "seller"), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.42)",
        fontSize: 12,
        lineHeight: 1.55,
        paddingTop: 10
      }
    }, "Profile editing and password management remain in the existing account/settings flow for now."))));
  }

  window.UserRouteContent = UserRouteContent;
})();
