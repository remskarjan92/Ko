(function () {
  function UserRouteContent({
    routePath,
    session,
    resultsCount,
    generatedImages,
    imageStatusCounts,
    ratingCount,
    hasDesign,
    onNavigate,
    onOpenSettings
  }) {
    if (!["/dashboard", "/generate", "/credits", "/account", "/generations", "/settings", "/tshirt-studio"].includes(routePath)) return null;
    const creditBalance = session?.credits_balance ?? session?.creditBalance ?? session?.credits ?? null;
    const [creditsState, setCreditsState] = React.useState({ data: null, loading: false, error: "", loaded: false });
    const [accountState, setAccountState] = React.useState({ data: null, loading: false, error: "", loaded: false });
    const [generationsState, setGenerationsState] = React.useState({ data: null, loading: false, error: "", loaded: false });
    const [generationFilters, setGenerationFilters] = React.useState({
      search: "",
      status: "all",
      listingRole: "",
      dateFrom: "",
      dateTo: "",
      sort: "newest"
    });
    const [creditFilters, setCreditFilters] = React.useState({
      search: "",
      type: "all",
      dateFrom: "",
      dateTo: ""
    });

    async function readJson(response) {
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
      return data;
    }

    async function loadCredits() {
      setCreditsState(prev => ({ ...prev, loading: true, error: "" }));
      try {
        const data = await fetch("/api/me/credits", {
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        }).then(readJson);
        setCreditsState({ data, loading: false, error: "", loaded: true });
      } catch (error) {
        setCreditsState(prev => ({ ...prev, loading: false, error: error.message || "Could not load credits", loaded: true }));
      }
    }

    async function loadAccount() {
      setAccountState(prev => ({ ...prev, loading: true, error: "" }));
      try {
        const data = await fetch("/api/me/account", {
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        }).then(readJson);
        setAccountState({ data, loading: false, error: "", loaded: true });
      } catch (error) {
        setAccountState(prev => ({ ...prev, loading: false, error: error.message || "Could not load account", loaded: true }));
      }
    }

    async function loadGenerations() {
      setGenerationsState(prev => ({ ...prev, loading: true, error: "" }));
      try {
        const data = await fetch("/api/me/generations?limit=25", {
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        }).then(readJson);
        setGenerationsState({ data, loading: false, error: "", loaded: true });
      } catch (error) {
        setGenerationsState(prev => ({ ...prev, loading: false, error: error.message || "Could not load generations", loaded: true }));
      }
    }

    React.useEffect(() => {
      if (routePath === "/credits") loadCredits();
      if (routePath === "/account") loadAccount();
      if (routePath === "/generations") loadGenerations();
    }, [routePath]);

    const realCreditBalance = creditsState.data?.balance ?? creditBalance;
    const creditTransactions = Array.isArray(creditsState.data?.transactions) ? creditsState.data.transactions : [];
    const accountUser = accountState.data?.user || session || {};
    const generationRows = Array.isArray(generationsState.data?.rows) ? generationsState.data.rows : [];
    const generationSummary = generationsState.data?.summary || {};
    const textIncludes = (source, query) => String(source || "").toLowerCase().includes(String(query || "").trim().toLowerCase());
    const isInDateRange = (value, from, to) => {
      if (!from && !to) return true;
      if (!value) return false;
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) return false;
      if (from && time < new Date(`${from}T00:00:00.000Z`).getTime()) return false;
      if (to && time > new Date(`${to}T23:59:59.999Z`).getTime()) return false;
      return true;
    };
    const statusMatches = (status, filter) => {
      const normalized = String(status || "").toLowerCase();
      if (filter === "all") return true;
      if (filter === "success") return ["success", "succeeded", "completed", "done"].includes(normalized);
      if (filter === "failed") return ["failed", "error", "rejected"].includes(normalized);
      return normalized === filter;
    };
    const sortedGenerationRows = generationRows.filter(row => {
      const haystack = [
        row.prompt,
        row.product_name,
        row.product_type,
        row.category,
        row.model_name,
        row.generation_type,
        row.listing_role,
        row.metadata?.listingRole,
        row.metadata?.listing_role
      ].filter(Boolean).join(" ");
      if (generationFilters.search && !textIncludes(haystack, generationFilters.search)) return false;
      if (!statusMatches(row.status, generationFilters.status)) return false;
      const listingRole = row.listing_role || row.metadata?.listingRole || row.metadata?.listing_role || "";
      if (generationFilters.listingRole && !textIncludes(listingRole, generationFilters.listingRole)) return false;
      if (!isInDateRange(row.created_at, generationFilters.dateFrom, generationFilters.dateTo)) return false;
      return true;
    }).sort((a, b) => {
      if (generationFilters.sort === "oldest") return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (generationFilters.sort === "rating") return (Number(b.score) || 0) - (Number(a.score) || 0);
      if (generationFilters.sort === "rating_low") return (Number(a.score) || 0) - (Number(b.score) || 0);
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    const filteredCreditTransactions = creditTransactions.filter(row => {
      if (creditFilters.type === "added" && !(Number(row.credits_added) > 0)) return false;
      if (creditFilters.type === "used" && !(Number(row.credits_removed) > 0)) return false;
      const haystack = [row.action, row.credit_type, row.metadata && JSON.stringify(row.metadata)].filter(Boolean).join(" ");
      if (creditFilters.search && !textIncludes(haystack, creditFilters.search)) return false;
      if (!isInDateRange(row.created_at, creditFilters.dateFrom, creditFilters.dateTo)) return false;
      return true;
    });
    const persistentGenerationCount = generationsState.loaded ? generationRows.length : resultsCount;
    const persistentCompletedCount = generationsState.loaded ? (generationSummary.status_counts?.succeeded || generationSummary.status_counts?.completed || 0) : generatedImages;
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
    const inputStyle = {
      width: "100%",
      border: "1px solid rgba(255,255,255,0.09)",
      background: "rgba(0,0,0,0.18)",
      color: "rgba(255,255,255,0.82)",
      borderRadius: 10,
      padding: "9px 10px",
      fontSize: 12,
      outline: "none"
    };
    const filterGridStyle = {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
      gap: 9,
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
    const secondaryButtonStyle = {
      ...actionButtonStyle,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.04)",
      color: "rgba(255,255,255,0.74)"
    };
    const emptyState = ({ icon, title, message, actionLabel, onAction, secondaryLabel, onSecondary }) => React.createElement("div", {
      style: {
        border: "1px dashed rgba(255,220,100,0.18)",
        borderRadius: 14,
        background: "linear-gradient(135deg, rgba(255,220,100,0.055), rgba(255,255,255,0.018))",
        padding: "16px",
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        flexWrap: "wrap"
      }
    }, React.createElement("div", {
      style: {
        width: 42,
        height: 42,
        borderRadius: 14,
        display: "grid",
        placeItems: "center",
        background: "rgba(255,220,100,0.10)",
        border: "1px solid rgba(255,220,100,0.18)",
        fontSize: 22
      }
    }, icon), React.createElement("div", {
      style: {
        flex: "1 1 260px",
        minWidth: 0
      }
    }, React.createElement("div", {
      style: {
        color: "#fff",
        fontSize: 16,
        fontWeight: 800,
        marginBottom: 5
      }
    }, title), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.58)",
        fontSize: 13,
        lineHeight: 1.5,
        maxWidth: 620
      }
    }, message), React.createElement("div", {
      style: {
        display: "flex",
        gap: 9,
        flexWrap: "wrap",
        marginTop: 12
      }
    }, actionLabel && React.createElement("button", {
      type: "button",
      onClick: onAction,
      style: actionButtonStyle
    }, actionLabel), secondaryLabel && React.createElement("button", {
      type: "button",
      onClick: onSecondary,
      style: secondaryButtonStyle
    }, secondaryLabel)))));
    const loadingPanel = label => React.createElement("div", {
      style: {
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
        padding: "12px",
        marginBottom: 12,
        color: "rgba(255,255,255,0.62)",
        fontSize: 13
      }
    }, React.createElement("div", {
      style: {
        marginBottom: 10
      }
    }, label), [0, 1, 2].map(index => React.createElement("div", {
      key: index,
      style: {
        height: 12,
        width: `${92 - index * 16}%`,
        borderRadius: 999,
        marginBottom: index === 2 ? 0 : 8,
        background: "linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.11), rgba(255,255,255,0.05))",
        transition: "opacity 0.2s ease"
      }
    })));
    const errorPanel = (message, onRetry) => React.createElement("div", {
      style: {
        border: "1px solid rgba(255,105,105,0.22)",
        borderRadius: 12,
        background: "rgba(255,105,105,0.06)",
        padding: "12px",
        marginBottom: 12,
        color: "rgba(255,210,210,0.88)",
        fontSize: 13,
        display: "flex",
        gap: 10,
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap"
      }
    }, React.createElement("span", null, message), React.createElement("button", {
      type: "button",
      onClick: onRetry,
      style: secondaryButtonStyle
    }, "Retry"));
    const formatDate = value => {
      if (!value) return "Not available";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    };
    const compactList = (rows, renderRow) => React.createElement("div", {
      style: {
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 12,
        transition: "opacity 0.2s ease, transform 0.2s ease"
      }
    }, rows.map((row, index) => React.createElement("div", {
      key: row.id || `${index}`,
      style: {
        padding: "10px 12px",
        borderBottom: index === rows.length - 1 ? "none" : "1px solid rgba(255,255,255,0.06)",
        background: index % 2 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.10)"
      }
    }, renderRow(row))));
    const filterField = (label, control) => React.createElement("label", {
      style: {
        display: "grid",
        gap: 5
      }
    }, React.createElement("span", {
      style: labelStyle
    }, label), control);
    const clearGenerationFilters = () => setGenerationFilters({
      search: "",
      status: "all",
      listingRole: "",
      dateFrom: "",
      dateTo: "",
      sort: "newest"
    });
    const clearCreditFilters = () => setCreditFilters({
      search: "",
      type: "all",
      dateFrom: "",
      dateTo: ""
    });
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
    }, routePath === "/generate" ? React.createElement(React.Fragment, null, !hasDesign && emptyState({
      icon: "↥",
      title: "Start by uploading your design",
      message: "Choose a transparent PNG, JPG, or WEBP in the composer below. Once the design is loaded, KO can analyze it and build mockup prompts.",
      actionLabel: "Open Upload Area",
      onAction: () => onNavigate("compose-section", "/generate")
    }), React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Design input",
      value: hasDesign ? "Loaded" : "Waiting"
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
    }, hasDesign ? "Use the composer below to confirm context, generate prompts, and produce mockup images." : "Upload artwork in the composer below to unlock the full generation flow.")) : routePath === "/tshirt-studio" ? React.createElement(React.Fragment, null, !hasDesign && emptyState({
      icon: "□",
      title: "Upload a design to start studio",
      message: "The studio can also accept a direct upload, but starting from the generator keeps your design and generated assets available in one workspace.",
      actionLabel: "Go to Upload",
      onAction: () => onNavigate("compose-section", "/generate"),
      secondaryLabel: "Open Studio",
      onSecondary: () => onNavigate("tshirt-studio-section", "/tshirt-studio")
    }), React.createElement("div", {
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
    }, hasDesign ? "Use the studio below to place a design on a shirt, save the placement JSON, and export a finished mockup image." : "Use the upload CTA above or upload directly inside the studio canvas below."), React.createElement("div", {
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
    }, "Open Settings Modal")) : routePath === "/dashboard" ? React.createElement(React.Fragment, null, !resultsCount && !generatedImages && emptyState({
      icon: "✦",
      title: "Welcome! Ready to create mockups?",
      message: "Start a new generation set, upload your design, and KO will guide you from analysis to Etsy-ready mockup exports.",
      actionLabel: "New Generation",
      onAction: () => onNavigate("compose-section", "/generate"),
      secondaryLabel: "Open T-Shirt Studio",
      onSecondary: () => onNavigate("tshirt-studio-section", "/tshirt-studio")
    }), React.createElement("div", {
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
    }, "Manage Credits"))) : routePath === "/generations" ? React.createElement(React.Fragment, null, generationsState.loading && loadingPanel("Loading generation history..."), generationsState.error && errorPanel("Generation history could not be loaded.", loadGenerations), generationsState.loaded && !generationRows.length && emptyState({
      icon: "▦",
      title: "No generations yet",
      message: "Create your first mockup set to populate this page with prompts, generated images, ratings, and export actions.",
      actionLabel: "Create your first mockup set",
      onAction: () => onNavigate("compose-section", "/generate")
    }), React.createElement("div", {
      style: gridStyle
    }, [{
      label: "History Records",
      value: persistentGenerationCount || 0
    }, {
      label: "Completed Images",
      value: persistentCompletedCount || 0
    }, {
      label: "This Month",
      value: generationSummary.this_month ?? 0
    }, {
      label: "Credits Used",
      value: generationSummary.credits_used ?? 0
    }, {
      label: "Average Score",
      value: generationSummary.avg_score ?? "Not scored"
    }].map(card => statCard(card.label, card.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, generationRows.length ? "Recent persistent generation records from your account are shown below." : "No persistent generation history is loaded yet."), generationRows.length > 0 && React.createElement("div", {
      style: filterGridStyle
    }, filterField("Search", React.createElement("input", {
      type: "search",
      placeholder: "Prompt, product, model...",
      value: generationFilters.search,
      onChange: event => setGenerationFilters(prev => ({ ...prev, search: event.target.value })),
      style: inputStyle
    })), filterField("Status", React.createElement("select", {
      value: generationFilters.status,
      onChange: event => setGenerationFilters(prev => ({ ...prev, status: event.target.value })),
      style: inputStyle
    }, React.createElement("option", {
      value: "all"
    }, "All"), React.createElement("option", {
      value: "success"
    }, "Success"), React.createElement("option", {
      value: "failed"
    }, "Failed"))), filterField("Listing Role", React.createElement("input", {
      type: "search",
      placeholder: "Hero, lifestyle...",
      value: generationFilters.listingRole,
      onChange: event => setGenerationFilters(prev => ({ ...prev, listingRole: event.target.value })),
      style: inputStyle
    })), filterField("From", React.createElement("input", {
      type: "date",
      value: generationFilters.dateFrom,
      onChange: event => setGenerationFilters(prev => ({ ...prev, dateFrom: event.target.value })),
      style: inputStyle
    })), filterField("To", React.createElement("input", {
      type: "date",
      value: generationFilters.dateTo,
      onChange: event => setGenerationFilters(prev => ({ ...prev, dateTo: event.target.value })),
      style: inputStyle
    })), filterField("Sort", React.createElement("select", {
      value: generationFilters.sort,
      onChange: event => setGenerationFilters(prev => ({ ...prev, sort: event.target.value })),
      style: inputStyle
    }, React.createElement("option", {
      value: "newest"
    }, "Newest"), React.createElement("option", {
      value: "oldest"
    }, "Oldest"), React.createElement("option", {
      value: "rating"
    }, "Highest score"), React.createElement("option", {
      value: "rating_low"
    }, "Lowest score")))), generationRows.length > 0 && React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        color: "rgba(255,255,255,0.46)",
        fontSize: 12,
        marginBottom: 10
      }
    }, React.createElement("span", null, `${sortedGenerationRows.length} of ${generationRows.length} records`), React.createElement("button", {
      type: "button",
      onClick: clearGenerationFilters,
      style: secondaryButtonStyle
    }, "Clear Filters")), generationRows.length > 0 && (sortedGenerationRows.length ? compactList(sortedGenerationRows.slice(0, 12), row => React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) auto",
        gap: 10,
        alignItems: "start"
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        marginBottom: 3,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, row.prompt || row.generation_type || "Generation record"), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.46)",
        fontSize: 11
      }
    }, [row.model_name, row.category, formatDate(row.created_at)].filter(Boolean).join(" · "))), React.createElement("div", {
      style: {
        color: "rgba(255,220,100,0.78)",
        fontFamily: "'DM Mono',monospace",
        fontSize: 10,
        textTransform: "uppercase"
      }
    }, row.score != null ? `${row.status || "unknown"} · ${row.score}` : (row.status || "unknown")))) : emptyState({
      icon: "⌕",
      title: "No generations match your filters",
      message: "Try clearing search, date, status, or listing role filters to show more generation records.",
      actionLabel: "Clear Filters",
      onAction: clearGenerationFilters
    })), React.createElement("div", {
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
    }, "Jump to Results"))) : routePath === "/credits" ? React.createElement(React.Fragment, null, creditsState.loading && loadingPanel("Loading credit balance and transactions..."), creditsState.error && errorPanel("Credit data could not be loaded.", loadCredits), creditsState.loaded && (realCreditBalance == null || Number(realCreditBalance) <= 0) && emptyState({
      icon: "¤",
      title: realCreditBalance == null ? "Credit balance is not loaded yet" : "You are out of credits",
      message: realCreditBalance == null ? "This route is ready for billing history and packages, but the account balance was not returned by the backend." : "Add or earn credits before starting larger generation batches.",
      actionLabel: "Start Smaller Batch",
      onAction: () => onNavigate("compose-section", "/generate"),
      secondaryLabel: "Account",
      onSecondary: () => onNavigate("account-section", "/account")
    }), React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Current Credits",
      value: realCreditBalance ?? "Not loaded"
    }, {
      label: "Transactions",
      value: creditTransactions.length || 0
    }, {
      label: "Credits Added",
      value: creditTransactions.reduce((sum, row) => sum + (Number(row.credits_added) || 0), 0)
    }, {
      label: "Credits Used",
      value: creditTransactions.reduce((sum, row) => sum + (Number(row.credits_removed) || 0), 0)
    }].map(card => statCard(card.label, card.value))), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.56)",
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 12
      }
    }, creditsState.loaded ? "Credit balance and transaction history are loaded from your account ledger." : "Credit balance will load from the backend when this route opens."), creditTransactions.length > 0 && React.createElement("div", {
      style: filterGridStyle
    }, filterField("Search", React.createElement("input", {
      type: "search",
      placeholder: "Action, reason, credit type...",
      value: creditFilters.search,
      onChange: event => setCreditFilters(prev => ({ ...prev, search: event.target.value })),
      style: inputStyle
    })), filterField("Type", React.createElement("select", {
      value: creditFilters.type,
      onChange: event => setCreditFilters(prev => ({ ...prev, type: event.target.value })),
      style: inputStyle
    }, React.createElement("option", {
      value: "all"
    }, "All"), React.createElement("option", {
      value: "added"
    }, "Credits added"), React.createElement("option", {
      value: "used"
    }, "Credits used"))), filterField("From", React.createElement("input", {
      type: "date",
      value: creditFilters.dateFrom,
      onChange: event => setCreditFilters(prev => ({ ...prev, dateFrom: event.target.value })),
      style: inputStyle
    })), filterField("To", React.createElement("input", {
      type: "date",
      value: creditFilters.dateTo,
      onChange: event => setCreditFilters(prev => ({ ...prev, dateTo: event.target.value })),
      style: inputStyle
    }))), creditTransactions.length > 0 && React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        color: "rgba(255,255,255,0.46)",
        fontSize: 12,
        marginBottom: 10
      }
    }, React.createElement("span", null, `${filteredCreditTransactions.length} of ${creditTransactions.length} transactions`), React.createElement("button", {
      type: "button",
      onClick: clearCreditFilters,
      style: secondaryButtonStyle
    }, "Clear Filters")), creditTransactions.length > 0 ? (filteredCreditTransactions.length ? compactList(filteredCreditTransactions.slice(0, 12), row => React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) auto",
        gap: 10,
        alignItems: "center"
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        marginBottom: 3
      }
    }, row.action || "Credit transaction"), React.createElement("div", {
      style: {
        color: "rgba(255,255,255,0.46)",
        fontSize: 11
      }
    }, `${formatDate(row.created_at)} · Balance ${row.balance_after ?? "n/a"}`)), React.createElement("div", {
      style: {
        color: Number(row.credits_added) > 0 ? "rgba(126,232,162,0.86)" : "rgba(255,220,100,0.78)",
        fontFamily: "'DM Mono',monospace",
        fontSize: 11,
        whiteSpace: "nowrap"
      }
    }, Number(row.credits_added) > 0 ? `+${row.credits_added}` : `-${row.credits_removed || 0}`))) : emptyState({
      icon: "⌕",
      title: "No transactions match your filters",
      message: "Try clearing search, type, or date filters to show more credit history.",
      actionLabel: "Clear Filters",
      onAction: clearCreditFilters
    })) : creditsState.loaded && emptyState({
      icon: "◇",
      title: "No credit transactions yet",
      message: "Credit additions, generation charges, refunds, and admin adjustments will appear here.",
      actionLabel: "Create Mockups",
      onAction: () => onNavigate("compose-section", "/generate")
    }), React.createElement("button", {
      type: "button",
      onClick: () => onNavigate("results-section", "/generations"),
      style: actionButtonStyle
    }, "Back to Generations")) : React.createElement(React.Fragment, null, accountState.loading && loadingPanel("Loading account profile..."), accountState.error && errorPanel("Account profile could not be loaded.", loadAccount), accountState.loaded && (!accountUser?.username && !accountUser?.email) && emptyState({
      icon: "◌",
      title: "Profile details are minimal",
      message: "Your session is active, but the backend did not return complete profile details.",
      actionLabel: "Open Settings",
      onAction: onOpenSettings,
      secondaryLabel: "Create Mockups",
      onSecondary: () => onNavigate("compose-section", "/generate")
    }), React.createElement("div", {
      style: gridStyle
    }, [{
      label: "Account Status",
      value: accountUser.account_status || (session?.authenticated ? "active" : "unknown")
    }, {
      label: "Plan Type",
      value: accountUser.plan_type || "free"
    }, {
      label: "Credits",
      value: accountUser.credits_balance ?? creditBalance ?? "Not loaded"
    }].map(card => statCard(card.label, card.value))), field("Session Status", session?.authenticated ? "Authenticated" : "Not authenticated"), field("Username", accountUser.username || session?.username), field("Email", accountUser.email || session?.email), field("User ID", accountUser.id || session?.userId || session?.id), field("Account Created", formatDate(accountUser.created_at)), field("Last Login", formatDate(accountUser.last_login_at)), React.createElement("div", {
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
