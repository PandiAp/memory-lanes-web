import { ApiError, createApi, createCommandId, createDemoApi } from "./api.js";
import { buildAnalytics, decimal, money, percent, relativeTime, whole } from "./analytics.js";

const config = window.MEMORY_LANES_CONFIG || {};
let api = createApi(config);

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  appShell: document.querySelector("#app-shell"),
  setupWarning: document.querySelector("#setup-warning"),
  demoActions: document.querySelector("#demo-actions"),
  loginForm: document.querySelector("#login-form"),
  email: document.querySelector("#login-email"),
  password: document.querySelector("#login-password"),
  remember: document.querySelector("#remember-session"),
  pageTitle: document.querySelector("#page-title"),
  pageEyebrow: document.querySelector("#page-eyebrow"),
  pageContent: document.querySelector("#page-content"),
  desktopNavigation: document.querySelector("#desktop-navigation"),
  mobileNavigation: document.querySelector("#mobile-navigation"),
  sidebarBusiness: document.querySelector("#sidebar-business"),
  sidebarProfile: document.querySelector("#sidebar-profile"),
  mobileProfile: document.querySelector("#mobile-profile-button"),
  connection: document.querySelector("#connection-status"),
  offlineBanner: document.querySelector("#offline-banner"),
  loading: document.querySelector("#loading-overlay"),
  loadingMessage: document.querySelector("#loading-message"),
  toastRegion: document.querySelector("#toast-region"),
  modalBackdrop: document.querySelector("#modal-backdrop"),
  modal: document.querySelector("#modal"),
  modalTitle: document.querySelector("#modal-title"),
  modalEyebrow: document.querySelector("#modal-eyebrow"),
  modalContent: document.querySelector("#modal-content"),
};

const state = {
  context: null,
  data: null,
  analytics: null,
  route: "home",
  analyticsTab: "overview",
  inventoryFilter: "all",
  inventorySearch: "",
  installPrompt: null,
  modalReturnFocus: null,
  modalCloseable: true,
  pollTimer: null,
  refreshing: false,
};

const navigation = {
  owner: [
    { route: "home", label: "Home", icon: "⌂" },
    { route: "analytics", label: "Analytics", icon: "⌁" },
    { route: "inventory", label: "Inventory", icon: "▦" },
    { route: "approvals", label: "Approvals", icon: "✓" },
    { route: "activity", label: "Activity", icon: "◷" },
    { route: "team", label: "Team", icon: "♙" },
    { route: "settings", label: "Settings", icon: "⚙" },
  ],
  employee: [
    { route: "home", label: "Home", icon: "⌂" },
    { route: "inventory", label: "Inventory", icon: "▦" },
    { route: "products", label: "Products", icon: "◇" },
    { route: "requests", label: "Request", icon: "+" },
    { route: "activity", label: "Activity", icon: "◷" },
  ],
};

const routeTitles = {
  home: ["Home", "MEMORY LANES"],
  analytics: ["Analytics", "OWNER REPORTING"],
  inventory: ["Inventory", "LIVE CLOUD STOCK"],
  products: ["Products", "RECIPES & CAPACITY"],
  approvals: ["Approvals", "OWNER REVIEW QUEUE"],
  requests: ["Stock requests", "OWNER-APPROVED CHANGES"],
  activity: ["Activity", "TRACEABLE BUSINESS HISTORY"],
  team: ["Team", "OWNER & EMPLOYEE ACCESS"],
  settings: ["Settings", "BUSINESS RULES"],
  more: ["More", "ACCOUNT & TOOLS"],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  return String(name || "ML").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ML";
}

function profileName(userId) {
  if (!state.data) return "Member";
  return state.data.profiles.find((profile) => profile.id === userId)?.display_name
    || state.data.members.find((member) => member.user_id === userId)?.display_name
    || (userId === state.context?.user?.id ? state.context.profile?.display_name : null)
    || "Member";
}

function role() {
  return state.context?.membership?.role || "employee";
}

function isOwner() {
  return role() === "owner";
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
}

function currency() {
  return state.context?.business?.currency_code || "USD";
}

function badge(value) {
  const normalized = String(value || "").toLowerCase().replaceAll(" ", "-");
  const variants = {
    healthy: "good",
    ready: "ready",
    approved: "approved",
    pending: "pending",
    rejected: "rejected",
    out: "out",
    critical: "danger",
    low: "low",
    "low-capacity": "low",
    blocked: "blocked",
    "recipe-missing": "danger",
  };
  return `<span class="badge badge-${variants[normalized] || "info"}">${escapeHtml(value)}</span>`;
}

function kpi(label, value, meta = "", icon = "•") {
  return `<article class="kpi-card">
    <div class="kpi-label"><span>${escapeHtml(label)}</span><span class="kpi-icon" aria-hidden="true">${escapeHtml(icon)}</span></div>
    <div class="kpi-value">${escapeHtml(value)}</div>
    <p class="kpi-meta">${escapeHtml(meta)}</p>
  </article>`;
}

function bars(rows, formatter = whole, color = "") {
  if (!rows.length) return `<div class="empty-state"><div><strong>No data yet</strong><span>New activity will appear here.</span></div></div>`;
  const maximum = Math.max(...rows.map((row) => Math.abs(Number(row.value || 0))), 1);
  return `<div class="bar-list">${rows.slice(0, 8).map((row) => {
    const width = Math.max(2, Math.min(100, Math.abs(Number(row.value || 0)) / maximum * 100));
    return `<div class="bar-row">
      <span class="bar-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill ${color}" style="width:${width.toFixed(1)}%"></span></span>
      <span class="bar-value">${escapeHtml(formatter(row.value))}</span>
    </div>`;
  }).join("")}</div>`;
}

function exactSalesBreakdown(rows, labelForRow = (row) => row.key) {
  if (!rows.length) return `<div class="empty-state"><div><strong>No exact cloud sales yet</strong><span>Recorded sales will appear here.</span></div></div>`;
  return `<div class="card-list">${rows.map((row) => `<article class="list-card"><div class="card-title-row"><div><h3>${escapeHtml(labelForRow(row))}</h3><p>${whole(row.saleCount)} transaction${row.saleCount === 1 ? "" : "s"}</p></div>${badge("Exact")}</div><div class="metric-row"><div class="mini-metric"><span>Units sold</span><strong>${whole(row.units)}</strong></div><div class="mini-metric"><span>Gross sales</span><strong>${escapeHtml(money(row.grossSales, currency()))}</strong></div><div class="mini-metric"><span>Customer payments</span><strong>${escapeHtml(money(row.customerPayments, currency()))}</strong></div><div class="mini-metric"><span>Commission</span><strong>${escapeHtml(money(row.commission, currency()))}</strong></div></div></article>`).join("")}</div>`;
}

function activityList(events, limit = 6) {
  if (!events.length) return `<div class="empty-state"><div><strong>No recorded activity</strong><span>Actions will appear as the team uses the app.</span></div></div>`;
  const icons = { sale_recorded: "$", stock_change_requested: "+", stock_change_approved: "✓", stock_change_rejected: "×", employee_invited: "♙", document_updated: "↻", business_created: "ML" };
  return `<div class="activity-list">${events.slice(0, limit).map((event) => `<article class="activity-item">
    <div class="activity-icon" aria-hidden="true">${escapeHtml(icons[event.event_type] || "•")}</div>
    <div><p><strong>${escapeHtml(profileName(event.actor_user_id))}</strong> — ${escapeHtml(event.summary)}</p><time datetime="${escapeHtml(event.created_at)}">${escapeHtml(relativeTime(event.created_at))}</time></div>
  </article>`).join("")}</div>`;
}

function showLoading(message = "Loading Memory Lanes…") {
  elements.loadingMessage.textContent = message;
  elements.loading.classList.remove("hidden");
}

function hideLoading() {
  elements.loading.classList.add("hidden");
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  setTimeout(() => item.remove(), 4500);
}

function setConnectionStatus() {
  const online = navigator.onLine || api.isDemo;
  elements.connection.classList.toggle("online", online);
  elements.connection.classList.toggle("offline", !online);
  elements.connection.querySelector("span:last-child").textContent = api.isDemo ? "Demo data" : online ? "Cloud connected" : "Offline";
  elements.offlineBanner.classList.toggle("hidden", online);
}

function requireOnline() {
  if (!navigator.onLine && !api.isDemo) {
    toast("This change requires an internet connection.", "error");
    return false;
  }
  return true;
}

function navButton(item) {
  const active = state.route === item.route;
  return `<button class="nav-button ${active ? "active" : ""}" type="button" data-route="${escapeHtml(item.route)}" ${active ? 'aria-current="page"' : ""}>
    <span class="nav-icon" aria-hidden="true">${escapeHtml(item.icon)}</span><span>${escapeHtml(item.label)}</span>
  </button>`;
}

function renderNavigation() {
  const items = navigation[role()];
  elements.desktopNavigation.innerHTML = items.map(navButton).join("");
  let mobileItems = items;
  if (isOwner()) {
    mobileItems = [
      items.find((item) => item.route === "home"),
      items.find((item) => item.route === "analytics"),
      items.find((item) => item.route === "inventory"),
      items.find((item) => item.route === "approvals"),
      { route: "more", label: "More", icon: "•••" },
    ];
  }
  elements.mobileNavigation.innerHTML = mobileItems.map(navButton).join("");
}

async function loadContextAndData({ quiet = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  if (!quiet) showLoading("Synchronizing business data…");
  try {
    state.context = await api.getContext();
    if (!state.context.membership || !state.context.business) {
      throw new ApiError("This account does not have an active Memory Lanes membership. Ask the owner to invite or reactivate it.", 403);
    }
    state.data = await api.fetchAll(state.context);
    state.analytics = buildAnalytics({
      documents: state.data.documents,
      sales: state.data.sales,
      saleFinancials: state.data.saleFinancials,
      role: role(),
      timeZone: state.context.business.timezone || "UTC",
    });
    elements.sidebarBusiness.textContent = state.context.business.name;
    const name = state.context.profile?.display_name || state.context.user.email;
    elements.sidebarProfile.innerHTML = `<div class="profile-avatar">${escapeHtml(initials(name))}</div><div class="profile-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(role())}</span></div>`;
    elements.mobileProfile.textContent = initials(name);
    renderNavigation();
    renderCurrentRoute();
    setConnectionStatus();
  } catch (error) {
    if (error.status === 401) {
      await signOut(false);
    }
    toast(error.message || "Cloud synchronization failed.", "error");
    throw error;
  } finally {
    state.refreshing = false;
    if (!quiet) hideLoading();
  }
}

async function enterApp() {
  showLoading("Opening your business…");
  if (api.redirectType) setTimeout(openSetPasswordModal, 100);
  try {
    await loadContextAndData({ quiet: true });
    elements.authScreen.classList.add("hidden");
    elements.appShell.classList.remove("hidden");
    const requestedPage = new URLSearchParams(location.search).get("page");
    const allowed = [...navigation[role()].map((item) => item.route), ...(isOwner() ? ["more"] : [])];
    state.route = allowed.includes(requestedPage) ? requestedPage : "home";
    renderNavigation();
    renderCurrentRoute();
    const action = new URLSearchParams(location.search).get("action");
    if (action === "sale") setTimeout(openSaleModal, 100);
    startPolling();
  } catch {
    elements.authScreen.classList.remove("hidden");
    elements.appShell.classList.add("hidden");
  } finally {
    hideLoading();
  }
}

function navigate(routeName) {
  const allowed = navigation[role()].map((item) => item.route);
  if (isOwner()) allowed.push("more");
  state.route = allowed.includes(routeName) ? routeName : "home";
  const url = new URL(location.href);
  url.searchParams.set("page", state.route);
  url.searchParams.delete("action");
  history.replaceState({}, "", url);
  renderNavigation();
  renderCurrentRoute();
  document.querySelector("#main-content")?.focus({ preventScroll: true });
  scrollTo({ top: 0, behavior: "smooth" });
}

function renderCurrentRoute() {
  if (!state.data || !state.analytics) return;
  const [title, eyebrow] = routeTitles[state.route] || routeTitles.home;
  elements.pageTitle.textContent = title;
  elements.pageEyebrow.textContent = eyebrow;
  const renderers = {
    home: renderHome,
    analytics: renderAnalyticsPage,
    inventory: renderInventory,
    products: renderProducts,
    approvals: renderRequests,
    requests: renderRequests,
    activity: renderActivity,
    team: renderTeam,
    settings: renderSettings,
    more: renderMore,
  };
  elements.pageContent.innerHTML = (renderers[state.route] || renderHome)();
}

function renderHome() {
  return isOwner() ? renderOwnerHome() : renderEmployeeHome();
}

function renderOwnerHome() {
  const report = state.analytics;
  const pending = state.data.requests.filter((request) => request.status === "pending");
  const topValues = [...report.inventory.items].sort((a, b) => b.value - a.value).slice(0, 6);
  const capacities = [...report.products].sort((a, b) => b.capacity - a.capacity).slice(0, 6);
  return `<section class="hero-card">
      <p class="eyebrow">OWNER OVERVIEW</p>
      <h2>Your business is synchronized across desktop and phone.</h2>
      <p>${pending.length ? `${pending.length} employee stock request${pending.length === 1 ? " is" : "s are"} waiting for your decision.` : "There are no stock requests waiting for approval."}</p>
      <div class="hero-actions">
        <button class="button button-primary" type="button" data-action="record-sale">Record sale</button>
        <button class="button button-secondary" type="button" data-route="approvals">Review approvals${pending.length ? ` (${pending.length})` : ""}</button>
      </div>
    </section>
    <section class="page-section">
      <div class="kpi-grid">
        ${kpi("Business bank", money(report.total.bank_should_have, currency()), "Legacy estimate + exact cloud sales", "$")}
        ${kpi("Estimated profit", money(report.total.estimated_profit, currency()), `${percent(report.total.margin)} margin`, "↗")}
        ${kpi("Products sold", whole(report.total.products_sold), `${whole(report.exact.products_sold)} exact since cloud launch`, "◇")}
        ${kpi("Inventory value", money(report.inventory.inventoryValue, currency()), `${whole(report.inventory.currentUnits)} units held`, "▦")}
        ${kpi("Products possible", whole(report.inventory.productsPossible), "Global legacy product rule", "+")}
        ${kpi("Pending approvals", whole(pending.length), pending.length ? "Owner action needed" : "Everything reviewed", "✓")}
      </div>
    </section>
    <section class="page-section two-column">
      <article class="panel"><div class="panel-header"><div><h2>Inventory value</h2><p>Highest-value ingredients currently held</p></div><button class="button-link" data-route="inventory" type="button">View all</button></div>${bars(topValues.map((item) => ({ label: item.name, value: item.value })), (value) => money(value, currency()), "blue")}</article>
      <article class="panel"><div class="panel-header"><div><h2>Product capacity</h2><p>Independent capacity for each recipe</p></div><button class="button-link" data-route="analytics" type="button">Details</button></div>${bars(capacities.map((item) => ({ label: item.name, value: item.capacity })))}</article>
    </section>
    <section class="page-section two-column">
      <article class="panel"><div class="panel-header"><div><h2>Quick actions</h2><p>Common owner workflows</p></div></div><div class="quick-grid">
        <button class="quick-action" type="button" data-action="record-sale"><span>$</span><strong>Record sale</strong></button>
        <button class="quick-action" type="button" data-action="add-inventory"><span>+</span><strong>Add ingredient</strong></button>
        <button class="quick-action" type="button" data-action="invite-employee"><span>♙</span><strong>Invite employee</strong></button>
        <button class="quick-action" type="button" data-route="analytics"><span>⌁</span><strong>Open analytics</strong></button>
      </div></article>
      <article class="panel"><div class="panel-header"><div><h2>Recent activity</h2><p>All owner and employee actions</p></div><button class="button-link" type="button" data-route="activity">View all</button></div>${activityList(state.data.events, 5)}</article>
    </section>`;
}

function renderEmployeeHome() {
  const sales = state.data.sales;
  const ownProducts = sales.reduce((total, sale) => total + Number(sale.quantity || 0), 0);
  const commission = sales.reduce((total, sale) => total + Number(sale.employee_commission || 0), 0);
  const pending = state.data.requests.filter((request) => request.status === "pending");
  const available = state.analytics.products.filter((product) => product.capacity > 0).sort((a, b) => b.capacity - a.capacity);
  return `<section class="hero-card">
      <p class="eyebrow">EMPLOYEE WORKSPACE</p>
      <h2>Ready for the next customer?</h2>
      <p>Record each sale here for accurate stock and commission tracking. Stock corrections always wait for owner approval.</p>
      <div class="hero-actions">
        <button class="button button-primary" type="button" data-action="record-sale">Record a sale</button>
        <button class="button button-secondary" type="button" data-action="request-stock">Request stock correction</button>
      </div>
    </section>
    <section class="page-section"><div class="kpi-grid">
      ${kpi("My products sold", whole(ownProducts), "Exact cloud sales", "◇")}
      ${kpi("My commission", money(commission, currency()), "From my recorded sales", "$")}
      ${kpi("My pending requests", whole(pending.length), pending.length ? "Waiting for owner" : "Nothing waiting", "✓")}
      ${kpi("Products available", whole(available.length), "Recipes with stock", "+")}
    </div></section>
    <section class="page-section two-column">
      <article class="panel"><div class="panel-header"><div><h2>Available products</h2><p>Current recipe capacity</p></div><button class="button-link" type="button" data-route="products">View products</button></div>${bars(available.slice(0, 7).map((product) => ({ label: product.name, value: product.capacity })))}</article>
      <article class="panel"><div class="panel-header"><div><h2>My recent activity</h2><p>Sales and stock requests made by you</p></div><button class="button-link" type="button" data-route="activity">View all</button></div>${activityList(state.data.events, 6)}</article>
    </section>`;
}

function analyticsTabs() {
  const tabs = ["overview", "finance", "inventory", "products", "operations", "data quality"];
  return `<div class="tabs" role="tablist" aria-label="Analytics sections">${tabs.map((tab) => `<button class="tab-button ${state.analyticsTab === tab ? "active" : ""}" role="tab" aria-selected="${state.analyticsTab === tab}" type="button" data-action="analytics-tab" data-value="${escapeHtml(tab)}">${escapeHtml(tab.replace(/^./, (letter) => letter.toUpperCase()))}</button>`).join("")}</div>`;
}

function renderAnalyticsPage() {
  if (!isOwner()) return renderAccessDenied();
  let content = "";
  const report = state.analytics;
  if (state.analyticsTab === "overview") {
    const values = [...report.inventory.items].sort((a, b) => b.value - a.value).slice(0, 8);
    content = `<div class="kpi-grid">
      ${kpi("Business bank", money(report.total.bank_should_have, currency()), "Combined reporting", "$")}
      ${kpi("Estimated profit", money(report.total.estimated_profit, currency()), "After ingredient cost", "↗")}
      ${kpi("Products sold", whole(report.total.products_sold), `${whole(report.exact.products_sold)} exact cloud sales`, "◇")}
      ${kpi("Inventory value", money(report.inventory.inventoryValue, currency()), `${whole(report.inventory.itemCount)} ingredients`, "▦")}
      ${kpi("Products possible", whole(report.inventory.productsPossible), "Global legacy rule", "+")}
      ${kpi("Low stock", whole(report.inventory.lowCount), report.inventory.lowCount ? "Review inventory" : "All ingredients healthy", "!")}
    </div><section class="page-section two-column"><article class="panel"><div class="panel-header"><div><h2>Largest inventory values</h2><p>Current units × saved unit cost</p></div></div>${bars(values.map((item) => ({ label: item.name, value: item.value })), (value) => money(value, currency()), "blue")}</article><article class="panel"><div class="panel-header"><div><h2>Capacity by recipe</h2><p>Each recipe considered independently</p></div></div>${bars([...report.products].sort((a, b) => b.capacity - a.capacity).map((item) => ({ label: item.name, value: item.capacity })))}</article></section>`;
  } else if (state.analyticsTab === "finance") {
    content = `<div class="notice notice-warning page-section">Legacy values are preserved estimates from the desktop shortage rule. Cloud sales are exact, named, and attributed to the employee who recorded them.</div>
      <div class="three-column page-section">
        <article class="panel"><div class="panel-header"><div><h2>Legacy estimate</h2><p>Frozen at cloud launch</p></div>${badge("Estimated")}</div><div class="detail-grid"><div class="detail-item"><span>Products</span><strong>${whole(report.legacy.products_sold)}</strong></div><div class="detail-item"><span>Business bank</span><strong>${money(report.legacy.bank_should_have, currency())}</strong></div><div class="detail-item"><span>Ingredient cost</span><strong>${money(report.legacy.ingredient_cost, currency())}</strong></div><div class="detail-item"><span>Est. profit</span><strong>${money(report.legacy.estimated_profit, currency())}</strong></div></div></article>
        <article class="panel"><div class="panel-header"><div><h2>Exact cloud sales</h2><p>Since owner/employee accounts</p></div>${badge("Exact")}</div><div class="detail-grid"><div class="detail-item"><span>Products</span><strong>${whole(report.exact.products_sold)}</strong></div><div class="detail-item"><span>Business bank</span><strong>${money(report.exact.bank_should_have, currency())}</strong></div><div class="detail-item"><span>Ingredient cost</span><strong>${money(report.exact.ingredient_cost, currency())}</strong></div><div class="detail-item"><span>Est. profit</span><strong>${money(report.exact.estimated_profit, currency())}</strong></div></div></article>
        <article class="panel"><div class="panel-header"><div><h2>Combined reporting</h2><p>Legacy + exact cloud sales</p></div></div><div class="detail-grid"><div class="detail-item"><span>Gross sales</span><strong>${money(report.total.gross_sales, currency())}</strong></div><div class="detail-item"><span>Customer payments</span><strong>${money(report.total.customer_payments, currency())}</strong></div><div class="detail-item"><span>VAT</span><strong>${money(report.total.vat_liability, currency())}</strong></div><div class="detail-item"><span>Commissions</span><strong>${money(report.total.employee_commissions, currency())}</strong></div></div></article>
      </div>
      <article class="panel"><div class="panel-header"><div><h2>Financial breakdown</h2><p>Combined current reporting</p></div></div>${bars([
        { label: "Gross sales", value: report.total.gross_sales },
        { label: "Business bank", value: report.total.bank_should_have },
        { label: "Employee commissions", value: report.total.employee_commissions },
        { label: "VAT", value: report.total.vat_liability },
        { label: "Ingredient cost", value: report.total.ingredient_cost },
        { label: "Estimated profit", value: report.total.estimated_profit },
      ], (value) => money(value, currency()), "blue")}</article>`;
  } else if (state.analyticsTab === "inventory") {
    const used = [...report.inventory.items].sort((a, b) => b.used - a.used).filter((item) => item.used > 0);
    content = `<div class="kpi-grid page-section">${kpi("Ingredients", whole(report.inventory.itemCount), "Tracked SKUs", "▦")}${kpi("Units held", whole(report.inventory.currentUnits), "Current cloud quantity", "+")}${kpi("Inventory value", money(report.inventory.inventoryValue, currency()), "Saved unit costs", "$")}${kpi("Low stock", whole(report.inventory.lowCount), "Out, critical, or low", "!")}</div><div class="two-column"><article class="panel"><div class="panel-header"><div><h2>Most used vs baseline</h2><p>Legacy supplied-stock comparison</p></div></div>${bars(used.slice(0, 8).map((item) => ({ label: item.name, value: item.used })), whole, "orange")}</article><article class="panel"><div class="panel-header"><div><h2>Highest stock values</h2><p>Current inventory investment</p></div></div>${bars([...report.inventory.items].sort((a, b) => b.value - a.value).slice(0, 8).map((item) => ({ label: item.name, value: item.value })), (value) => money(value, currency()), "blue")}</article></div>`;
  } else if (state.analyticsTab === "products") {
    content = `<div class="table-wrap desktop-only"><table><thead><tr><th>Product</th><th class="numeric">Recipe cost</th><th class="numeric">Sale price</th><th class="numeric">Commission</th><th class="numeric">Est. profit</th><th class="numeric">Margin</th><th class="numeric">Can make</th><th>Limiting</th><th>Status</th></tr></thead><tbody>${report.products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td class="numeric">${money(product.recipeCost, currency())}</td><td class="numeric">${money(product.salePrice, currency())}</td><td class="numeric">${money(product.commission, currency())}</td><td class="numeric">${money(product.profit, currency())}</td><td class="numeric">${percent(product.margin)}</td><td class="numeric">${whole(product.capacity)}</td><td>${escapeHtml(product.limiting.join(", "))}</td><td>${badge(product.status)}</td></tr>`).join("")}</tbody></table></div><div class="product-grid mobile-only">${report.products.map((product) => productCard(product, true)).join("")}</div>`;
  } else if (state.analyticsTab === "operations") {
    const pending = state.data.requests.filter((request) => request.status === "pending").length;
    const activeEmployees = state.data.members.filter((member) => member.role === "employee" && member.active).length;
    content = `<div class="kpi-grid page-section">${kpi("Exact sales", whole(state.data.sales.length), "Cloud sale records", "$")}${kpi("Pending approvals", whole(pending), "Employee stock requests", "✓")}${kpi("Active employees", whole(activeEmployees), "Invited accounts", "♙")}${kpi("Cloud document version", whole(state.data.documents.inventory?.version || 0), "Inventory revision", "↻")}</div><div class="two-column"><article class="panel"><div class="panel-header"><div><h2>Approval outcomes</h2><p>All employee stock requests</p></div></div>${bars([
      { label: "Pending", value: state.data.requests.filter((item) => item.status === "pending").length },
      { label: "Approved", value: state.data.requests.filter((item) => item.status === "approved").length },
      { label: "Rejected", value: state.data.requests.filter((item) => item.status === "rejected").length },
    ])}</article><article class="panel"><div class="panel-header"><div><h2>Recent operations</h2><p>Sales, requests, and data changes</p></div></div>${activityList(state.data.events, 8)}</article></div>`;
  } else {
    content = `<section class="panel page-section"><div class="panel-header"><div><h2>What the numbers can prove</h2><p>Transparent coverage keeps decisions honest.</p></div></div><p class="muted">Cloud sales are exact because they store the product, employee, recipe, prices, VAT, commission, ingredient cost, and timestamp used for that transaction. Earlier desktop shortages remain clearly marked as estimates.</p></section><div class="quality-list">${report.quality.map((item) => `<article class="quality-item">${badge(item.level)}<div><strong>${escapeHtml(item.area)}</strong><p>${escapeHtml(item.message)}</p></div></article>`).join("")}</div>`;
  }
  if (state.analyticsTab === "products") {
    content += `<section class="page-section"><div class="section-heading"><div><h2>Exact sales by product</h2><p>Named cloud transactions, separate from legacy estimates</p></div></div>${exactSalesBreakdown(report.exactBreakdowns.byProduct)}</section>`;
  }
  if (state.analyticsTab === "operations") {
    content += `<section class="page-section two-column"><article class="panel"><div class="panel-header"><div><h2>Exact sales by employee</h2><p>Attributed cloud transactions</p></div></div>${exactSalesBreakdown(report.exactBreakdowns.byEmployee, (row) => profileName(row.key))}</article><article class="panel"><div class="panel-header"><div><h2>Exact sales by day</h2><p>Daily history in ${escapeHtml(state.context.business.timezone || "UTC")}</p></div></div>${exactSalesBreakdown(report.exactBreakdowns.byDay)}</article></section>`;
  }
  return `${analyticsTabs()}${content}`;
}

function renderInventory() {
  const items = state.analytics.inventory.items.filter((item) => {
    const searchMatch = !state.inventorySearch || item.name.toLowerCase().includes(state.inventorySearch.toLowerCase());
    const filterMatch = state.inventoryFilter === "all"
      || (state.inventoryFilter === "low" && ["Out", "Critical", "Low"].includes(item.status))
      || (state.inventoryFilter === "healthy" && item.status === "Healthy")
      || (state.inventoryFilter === "unlinked" && item.status === "Not in recipe");
    return searchMatch && filterMatch;
  });
  return `<form id="inventory-search-form" class="toolbar">
      <div class="search-box"><label class="visually-hidden" for="inventory-search">Search ingredients</label><input id="inventory-search" type="search" value="${escapeHtml(state.inventorySearch)}" placeholder="Search ingredients"></div>
      ${isOwner() ? `<button class="button button-primary" type="button" data-action="add-inventory">Add ingredient</button>` : `<button class="button button-primary" type="button" data-action="request-stock">Request correction</button>`}
    </form>
    <div class="filter-row" aria-label="Inventory health filters">${["all", "low", "healthy", "unlinked"].map((filter) => `<button class="filter-button ${state.inventoryFilter === filter ? "active" : ""}" type="button" data-action="inventory-filter" data-value="${filter}">${filter.replace(/^./, (letter) => letter.toUpperCase())}</button>`).join("")}</div>
    <p class="muted">Showing ${whole(items.length)} of ${whole(state.analytics.inventory.items.length)} ingredients · cloud revision ${whole(state.data.documents.inventory?.version || 0)}</p>
    <div class="table-wrap desktop-only"><table><thead><tr><th>Ingredient</th><th class="numeric">Current</th>${isOwner() ? '<th class="numeric">Supplied</th><th class="numeric">Used</th><th class="numeric">Unit cost</th><th class="numeric">Value</th>' : ""}<th>Recipes</th><th>Status</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td class="numeric">${whole(item.current)}</td>${isOwner() ? `<td class="numeric">${whole(item.supplied)}</td><td class="numeric">${whole(item.used)}</td><td class="numeric">${money(item.unitCost, currency())}</td><td class="numeric">${money(item.value, currency())}</td>` : ""}<td>${whole(item.products.length)}</td><td>${badge(item.status)}</td><td><button class="button-link" type="button" data-action="${isOwner() ? "edit-inventory" : "request-item"}" data-name="${escapeHtml(item.name)}">${isOwner() ? "Edit" : "Request"}</button></td></tr>`).join("")}</tbody></table></div>
    <div class="inventory-grid mobile-only">${items.map(inventoryCard).join("")}</div>`;
}

function inventoryCard(item) {
  return `<article class="list-card"><div class="card-title-row"><div><h3>${escapeHtml(item.name)}</h3><p>${item.products.length ? `Used by ${escapeHtml(item.products.join(", "))}` : "Not linked to a recipe"}</p></div>${badge(item.status)}</div><div class="metric-row"><div class="mini-metric"><span>Current</span><strong>${whole(item.current)}</strong></div>${isOwner() ? `<div class="mini-metric"><span>Used</span><strong>${whole(item.used)}</strong></div><div class="mini-metric"><span>Value</span><strong>${money(item.value, currency())}</strong></div>` : `<div class="mini-metric"><span>Recipes</span><strong>${whole(item.products.length)}</strong></div><div class="mini-metric"><span>Capacity health</span><strong>${escapeHtml(item.status)}</strong></div>`}</div><div class="card-actions"><button class="button button-quiet" type="button" data-action="${isOwner() ? "edit-inventory" : "request-item"}" data-name="${escapeHtml(item.name)}">${isOwner() ? "Edit ingredient" : "Request correction"}</button></div></article>`;
}

function renderProducts() {
  return `<div class="section-heading"><div><h2>Products and availability</h2><p>Capacities update whenever inventory changes.</p></div><button class="button button-primary" type="button" data-action="record-sale">Record sale</button></div><div class="product-grid">${state.analytics.products.map((product) => productCard(product, isOwner())).join("")}</div>`;
}

function productCard(product, showEconomics) {
  return `<article class="product-card"><div class="card-title-row"><div><h3>${escapeHtml(product.name)}</h3><p>${whole(product.ingredientUnits)} ingredient units per product</p></div>${badge(product.status)}</div><div class="metric-row"><div class="mini-metric"><span>Can make</span><strong>${whole(product.capacity)}</strong></div>${showEconomics ? `<div class="mini-metric"><span>Recipe cost</span><strong>${money(product.recipeCost, currency())}</strong></div><div class="mini-metric"><span>Est. profit</span><strong>${money(product.profit, currency())}</strong></div>` : `<div class="mini-metric"><span>Ingredients</span><strong>${whole(product.ingredients?.length || 0)}</strong></div><div class="mini-metric"><span>Limiting</span><strong>${escapeHtml(product.limiting.join(", ") || "None")}</strong></div>`}</div><div class="card-actions"><button class="button button-primary" type="button" data-action="record-product-sale" data-name="${escapeHtml(product.name)}" ${product.capacity < 1 ? "disabled" : ""}>Record sale</button></div></article>`;
}

function renderRequests() {
  const requests = state.data.requests;
  const pending = requests.filter((request) => request.status === "pending");
  const history = requests.filter((request) => request.status !== "pending");
  const requestCards = (rows) => rows.length ? `<div class="request-grid">${rows.map(requestCard).join("")}</div>` : `<div class="empty-state"><div><strong>Nothing here</strong><span>${isOwner() ? "New employee requests will appear automatically." : "Submit a correction if the saved stock does not match what you see."}</span></div></div>`;
  return `<section class="hero-card"><p class="eyebrow">${isOwner() ? "OWNER DECISIONS" : "EMPLOYEE REQUESTS"}</p><h2>${isOwner() ? `${pending.length} request${pending.length === 1 ? "" : "s"} waiting for review` : "Stock changes stay controlled"}</h2><p>${isOwner() ? "Compare the submitted value with current cloud inventory before approving." : "Your correction will not change inventory until the owner approves it."}</p>${!isOwner() ? `<div class="hero-actions"><button class="button button-primary" type="button" data-action="request-stock">New request</button></div>` : ""}</section><section class="page-section"><div class="section-heading"><div><h2>${isOwner() ? "Pending approvals" : "Pending requests"}</h2><p>${pending.length} waiting</p></div></div>${requestCards(pending)}</section><section class="page-section"><div class="section-heading"><div><h2>Decision history</h2><p>Approved and rejected requests</p></div></div>${requestCards(history)}</section>`;
}

function requestCardBase(request) {
  const requester = profileName(request.requested_by);
  const stale = request.status === "pending"
    && Number(request.base_inventory_version) !== Number(state.data.documents.inventory?.version || 0);
  return `<article class="request-card"><div class="card-title-row"><div><h3>${escapeHtml(request.ingredient_name)}</h3><p>${isOwner() ? `Requested by ${escapeHtml(requester)} · ` : ""}${escapeHtml(relativeTime(request.created_at))}</p></div>${badge(request.status)}</div><div class="metric-row"><div class="mini-metric"><span>When submitted</span><strong>${request.current_quantity == null ? "New" : whole(request.current_quantity)}</strong></div><div class="mini-metric"><span>Proposed</span><strong>${request.change_type === "delete_ingredient" ? "Delete" : whole(request.proposed_quantity)}</strong></div><div class="mini-metric"><span>Base revision</span><strong>${whole(request.base_inventory_version)}${stale ? " (stale)" : ""}</strong></div></div><p class="muted">${escapeHtml(request.reason)}</p>${request.owner_note ? `<div class="notice ${request.status === "approved" ? "notice-success" : "notice-danger"}"><strong>Owner note:</strong> ${escapeHtml(request.owner_note)}</div>` : ""}${isOwner() && request.status === "pending" ? `<div class="card-actions"><button class="button button-primary" type="button" data-action="review-request" data-id="${escapeHtml(request.id)}">Review request</button></div>` : ""}</article>`;
}

function requestCard(request) {
  const card = requestCardBase(request);
  if (!isOwner() || request.change_type !== "add_ingredient") return card;
  const cost = `<div class="mini-metric"><span>Proposed unit cost</span><strong>${escapeHtml(money(request.proposed_unit_cost, currency()))}</strong></div>`;
  return card.replace('<div class="mini-metric"><span>Base revision</span>', `${cost}<div class="mini-metric"><span>Base revision</span>`);
}

function renderActivity() {
  return `<div class="section-heading"><div><h2>${isOwner() ? "Complete business activity" : "My activity"}</h2><p>${whole(state.data.events.length)} visible event${state.data.events.length === 1 ? "" : "s"}</p></div></div><article class="panel">${activityList(state.data.events, 250)}</article>`;
}

function renderTeam() {
  if (!isOwner()) return renderAccessDenied();
  return `<section class="hero-card"><p class="eyebrow">ACCESS CONTROL</p><h2>Owner and employee accounts</h2><p>Employees can record sales and submit stock corrections. Only the owner can see complete financial analytics, approve changes, or manage accounts.</p><div class="hero-actions"><button class="button button-primary" type="button" data-action="invite-employee">Invite employee</button></div></section><div class="card-list">${state.data.members.map((member) => {
    const name = profileName(member.user_id);
    return `<article class="list-card"><div class="card-title-row"><div class="profile-chip"><div class="profile-avatar">${escapeHtml(initials(name))}</div><div class="profile-copy"><strong style="color:var(--ink-950)">${escapeHtml(name)}</strong><span style="color:var(--ink-500)">${escapeHtml(member.role)}</span></div></div>${badge(member.active ? "Active" : "Suspended")}</div><div class="metric-row"><div class="mini-metric"><span>Role</span><strong>${escapeHtml(member.role)}</strong></div><div class="mini-metric"><span>Joined</span><strong>${escapeHtml(new Date(member.joined_at).toLocaleDateString())}</strong></div><div class="mini-metric"><span>Status</span><strong>${member.active ? "Active" : "Suspended"}</strong></div></div>${member.role === "employee" ? `<div class="card-actions"><button class="button ${member.active ? "button-quiet" : "button-secondary"}" type="button" data-action="toggle-member" data-id="${escapeHtml(member.user_id)}" data-active="${member.active}">${member.active ? "Suspend account" : "Reactivate account"}</button></div>` : ""}</article>`;
  }).join("")}</div>`;
}

function renderSettings() {
  if (!isOwner()) return renderAccessDenied();
  const configData = state.data.documents.config?.content || {};
  return `<div class="two-column"><section class="panel"><div class="panel-header"><div><h2>Business rules</h2><p>These values are used for new exact cloud sales.</p></div></div><form id="settings-form" class="inline-form">
    <label><span>Default ingredient cost</span><input name="ingredient_cost" type="number" min="0" step="0.01" required value="${escapeHtml(configData.ingredient_cost)}"></label>
    <label><span>Legacy ingredients per product</span><input name="ingredients_per_product" type="number" min="1" step="1" required value="${escapeHtml(configData.ingredients_per_product)}"></label>
    <label><span>Sale price before VAT</span><input name="sale_price" type="number" min="0" step="0.01" required value="${escapeHtml(configData.sale_price)}"></label>
    <label><span>VAT percentage</span><input name="vat_percent" type="number" min="0" max="100" step="0.01" required value="${escapeHtml(configData.vat_percent)}"></label>
    <label><span>Employee commission percentage</span><input name="employee_commission_percent" type="number" min="0" max="100" step="0.01" required value="${escapeHtml(configData.employee_commission_percent)}"></label>
    <label><span>Team-size planning value</span><input name="employee_count" type="number" min="0" step="1" required value="${escapeHtml(configData.employee_count)}"></label>
    <label><span>Products per employee</span><input name="max_products_per_employee" type="number" min="0" step="1" required value="${escapeHtml(configData.max_products_per_employee)}"></label>
    <button class="button button-primary" type="submit">Save settings</button>
  </form></section><section><article class="panel page-section"><div class="panel-header"><div><h2>Cloud synchronization</h2><p>One source of truth for phone and desktop.</p></div>${badge(api.isDemo ? "Demo" : "Connected")}</div><div class="detail-grid"><div class="detail-item"><span>Inventory revision</span><strong>${whole(state.data.documents.inventory?.version)}</strong></div><div class="detail-item"><span>Settings revision</span><strong>${whole(state.data.documents.config?.version)}</strong></div><div class="detail-item"><span>Last inventory update</span><strong>${escapeHtml(relativeTime(state.data.documents.inventory?.updated_at))}</strong></div><div class="detail-item"><span>Business ID</span><strong>${escapeHtml(state.context.business.id)}</strong></div></div></article><article class="danger-zone"><h3>Security</h3><p class="muted">Never share the cloud secret key. Employee access is controlled by database policies even if someone bypasses this interface.</p><button class="button button-danger" type="button" data-action="sign-out">Sign out on this device</button></article></section></div>`;
}

function renderMore() {
  return `<div class="card-list"><button class="quick-action" type="button" data-route="activity"><span>◷</span><strong>Business activity</strong></button><button class="quick-action" type="button" data-route="team"><span>♙</span><strong>Team and access</strong></button><button class="quick-action" type="button" data-route="settings"><span>⚙</span><strong>Settings</strong></button><button class="quick-action ${state.installPrompt ? "" : "hidden"}" type="button" data-action="install-app"><span>↓</span><strong>Install on this device</strong></button><button class="quick-action" type="button" data-action="sign-out"><span>↪</span><strong>Sign out</strong></button></div>`;
}

function renderAccessDenied() {
  return `<div class="empty-state"><div><strong>Owner access required</strong><span>This page contains owner-only business information.</span></div></div>`;
}

function openModal({ title, eyebrow = "", content, onOpen, closeable = true }) {
  state.modalReturnFocus = document.activeElement;
  state.modalCloseable = closeable;
  elements.modalTitle.textContent = title;
  elements.modalEyebrow.textContent = eyebrow;
  elements.modalContent.innerHTML = content;
  elements.modalBackdrop.classList.remove("hidden");
  elements.modalBackdrop.setAttribute("aria-hidden", "false");
  document.querySelector("#close-modal").classList.toggle("hidden", !closeable);
  document.body.style.overflow = "hidden";
  elements.appShell.inert = true;
  elements.authScreen.inert = true;
  setTimeout(() => {
    const focusable = elements.modal.querySelector("input, select, textarea, button:not([disabled])");
    focusable?.focus();
    onOpen?.();
  }, 0);
}

function closeModal(force = false) {
  if (!state.modalCloseable && !force) return;
  const returnFocus = state.modalReturnFocus;
  elements.modalBackdrop.classList.add("hidden");
  elements.modalBackdrop.setAttribute("aria-hidden", "true");
  elements.modalContent.innerHTML = "";
  document.body.style.overflow = "";
  elements.appShell.inert = false;
  elements.authScreen.inert = false;
  state.modalCloseable = true;
  state.modalReturnFocus = null;
  returnFocus?.focus?.();
}

function formActions(primaryLabel, secondaryLabel = "Cancel") {
  return `<div class="modal-actions"><button class="button button-quiet button-block" type="button" data-action="close-modal">${escapeHtml(secondaryLabel)}</button><button class="button button-primary button-block" type="submit">${escapeHtml(primaryLabel)}</button></div>`;
}

function openSaleModal(productName = "") {
  const products = state.analytics.products.filter((product) => product.capacity > 0);
  if (!products.length) {
    toast("No product has enough inventory for a sale.", "error");
    return;
  }
  const clientCommandId = createCommandId();
  openModal({
    title: "Record a sale",
    eyebrow: "EXACT CLOUD SALE",
    content: `<form id="sale-form" class="stack"><label><span>Product</span><select name="product" required>${products.map((product) => `<option value="${escapeHtml(product.name)}" ${product.name === productName ? "selected" : ""}>${escapeHtml(product.name)} — can make ${whole(product.capacity)}</option>`).join("")}</select></label><label><span>Quantity sold</span><input name="quantity" type="number" min="1" max="10000" step="1" value="1" required></label><label><span>Optional note</span><textarea name="note" maxlength="500" placeholder="Customer, order, or shift note"></textarea></label><div class="notice notice-success">The sale will deduct recipe ingredients immediately and save the price, VAT, commission, employee, and timestamp used.</div>${formActions("Record sale")}</form>`,
    onOpen: () => {
      document.querySelector("#sale-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!requireOnline()) return;
        const form = new FormData(event.currentTarget);
        showLoading("Recording sale and updating inventory…");
        try {
          const result = await api.recordSale(state.context.business.id, form.get("product"), Number(form.get("quantity")), form.get("note"), clientCommandId);
          closeModal();
          await loadContextAndData({ quiet: true });
          toast(`Recorded ${result.quantity} × ${result.product_name}. Commission: ${money(result.employee_commission, currency())}`);
        } catch (error) { toast(error.message, "error"); } finally { hideLoading(); }
      });
    },
  });
}

function openRequestModal(selectedName = "") {
  if (isOwner()) {
    toast("Owners can edit inventory directly. Stock requests are for employee corrections.", "error");
    return;
  }
  const inventory = state.data.documents.inventory?.content || [];
  openModal({
    title: "Request stock correction",
    eyebrow: "OWNER APPROVAL REQUIRED",
    content: `<form id="request-form" class="stack"><label><span>Change type</span><select name="change_type" id="request-change-type"><option value="set_quantity">Correct saved quantity</option><option value="add_ingredient">Add a new ingredient</option><option value="delete_ingredient">Request ingredient deletion</option></select></label><label id="request-existing-label"><span>Ingredient</span><select name="existing_name" id="request-existing">${inventory.map((item) => `<option value="${escapeHtml(item.name)}" ${item.name === selectedName ? "selected" : ""}>${escapeHtml(item.name)} — currently ${whole(item.quantity)}</option>`).join("")}</select></label><label id="request-new-label" class="hidden"><span>New ingredient name</span><input name="new_name" maxlength="120" placeholder="Ingredient name"></label><label id="request-quantity-label"><span>Proposed quantity</span><input name="quantity" type="number" min="0" step="1" required value="0"></label><label id="request-cost-label" class="hidden"><span>Unit cost</span><input name="unit_cost" type="number" min="0" step="0.01" value="0"></label><label><span>Reason for the change</span><textarea name="reason" required minlength="2" maxlength="500" placeholder="What did you count or observe?"></textarea></label><div class="notice notice-warning">Inventory will not change until the owner reviews and approves this request.</div>${formActions("Send to owner")}</form>`,
    onOpen: () => {
      const form = document.querySelector("#request-form");
      const type = document.querySelector("#request-change-type");
      const syncFields = () => {
        const add = type.value === "add_ingredient";
        const remove = type.value === "delete_ingredient";
        document.querySelector("#request-existing-label").classList.toggle("hidden", add);
        document.querySelector("#request-new-label").classList.toggle("hidden", !add);
        document.querySelector("#request-quantity-label").classList.toggle("hidden", remove);
        document.querySelector("#request-cost-label").classList.toggle("hidden", !add);
        form.elements.existing_name.required = !add;
        form.elements.new_name.required = add;
        form.elements.quantity.required = !remove;
        form.elements.unit_cost.required = add;
      };
      type.addEventListener("change", syncFields);
      syncFields();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!requireOnline()) return;
        const values = new FormData(form);
        const changeType = values.get("change_type");
        const ingredientName = changeType === "add_ingredient" ? values.get("new_name") : values.get("existing_name");
        showLoading("Sending request to the owner…");
        try {
          await api.submitStockChange(state.context.business.id, {
            changeType,
            ingredientName,
            proposedQuantity: changeType === "delete_ingredient" ? null : Number(values.get("quantity")),
            proposedUnitCost: changeType === "add_ingredient" ? Number(values.get("unit_cost")) : null,
            reason: values.get("reason"),
          });
          closeModal();
          await loadContextAndData({ quiet: true });
          toast("Stock request sent to the owner for approval.");
        } catch (error) { toast(error.message, "error"); } finally { hideLoading(); }
      });
    },
  });
}

function openInventoryEditModal(name) {
  if (!isOwner()) {
    toast("Owner access is required to edit inventory directly.", "error");
    return;
  }
  const document = state.data.documents.inventory;
  const item = document.content.find((entry) => entry.name === name);
  if (!item) return;
  openModal({
    title: `Edit ${name}`,
    eyebrow: "OWNER DIRECT CHANGE",
    content: `<form id="inventory-edit-form" class="stack"><label><span>Quantity</span><input name="quantity" type="number" min="0" step="1" required value="${escapeHtml(item.quantity)}"></label><label><span>Unit cost</span><input name="unit_cost" type="number" min="0" step="0.01" required value="${escapeHtml(item.unit_cost || 0)}"></label><label><span>Audit note</span><textarea name="note" minlength="2" maxlength="300" required placeholder="Why are you changing this ingredient?"></textarea></label><div class="notice notice-warning">This owner change applies immediately and creates a new version in the audit history.</div>${formActions("Save ingredient")}</form>`,
    onOpen: () => document.querySelector("#inventory-edit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireOnline()) return;
      const form = new FormData(event.currentTarget);
      const updated = structuredClone(document.content);
      const target = updated.find((entry) => entry.name === name);
      target.quantity = Number(form.get("quantity"));
      target.unit_cost = Number(form.get("unit_cost"));
      showLoading("Saving cloud inventory…");
      try {
        await api.saveDocument(state.context.business.id, "inventory", updated, document.version, `${form.get("note")} (${name})`);
        closeModal();
        await loadContextAndData({ quiet: true });
        toast(`${name} was updated on phone and desktop.`);
      } catch (error) { toast(error.message, "error"); } finally { hideLoading(); }
    }),
  });
}

function openAddInventoryModal() {
  if (!isOwner()) {
    toast("Owner access is required to add inventory directly.", "error");
    return;
  }
  const document = state.data.documents.inventory;
  openModal({
    title: "Add ingredient",
    eyebrow: "OWNER DIRECT CHANGE",
    content: `<form id="inventory-add-form" class="stack"><label><span>Ingredient name</span><input name="name" maxlength="120" required></label><label><span>Starting quantity</span><input name="quantity" type="number" min="0" step="1" value="0" required></label><label><span>Unit cost</span><input name="unit_cost" type="number" min="0" step="0.01" value="${escapeHtml(state.data.documents.config?.content?.ingredient_cost || 0)}" required></label><label><span>Audit note</span><textarea name="note" minlength="2" maxlength="300" required placeholder="Why is this ingredient being added?"></textarea></label>${formActions("Add ingredient")}</form>`,
    onOpen: () => document.querySelector("#inventory-add-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireOnline()) return;
      const form = new FormData(event.currentTarget);
      const name = String(form.get("name")).trim();
      if (document.content.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        toast("That ingredient already exists.", "error");
        return;
      }
      const updated = [...structuredClone(document.content), { name, quantity: Number(form.get("quantity")), unit_cost: Number(form.get("unit_cost")) }].sort((a, b) => a.name.localeCompare(b.name));
      showLoading("Adding ingredient…");
      try {
        await api.saveDocument(state.context.business.id, "inventory", updated, document.version, `${form.get("note")} (${name})`);
        closeModal();
        await loadContextAndData({ quiet: true });
        toast(`${name} was added.`);
      } catch (error) { toast(error.message, "error"); } finally { hideLoading(); }
    }),
  });
}

function openReviewModal(requestId) {
  if (!isOwner()) {
    toast("Owner access is required to review stock requests.", "error");
    return;
  }
  const request = state.data.requests.find((item) => item.id === requestId);
  if (!request) return;
  const inventoryDocument = state.data.documents.inventory;
  const current = inventoryDocument.content.find((item) => item.name.toLowerCase() === request.ingredient_name.toLowerCase());
  const stale = Number(request.base_inventory_version) !== Number(inventoryDocument.version);
  openModal({
    title: `Review ${request.ingredient_name}`,
    eyebrow: "OWNER DECISION",
    content: `<form id="review-form" class="stack"><div class="detail-grid"><div class="detail-item"><span>Requested by</span><strong>${escapeHtml(profileName(request.requested_by))}</strong></div><div class="detail-item"><span>Submitted</span><strong>${escapeHtml(relativeTime(request.created_at))}</strong></div><div class="detail-item"><span>Value then</span><strong>${request.current_quantity == null ? "New ingredient" : whole(request.current_quantity)}</strong></div><div class="detail-item"><span>Current cloud value</span><strong>${current ? whole(current.quantity) : "Not present"}</strong></div><div class="detail-item"><span>Proposed</span><strong>${request.change_type === "delete_ingredient" ? "Delete ingredient" : whole(request.proposed_quantity)}</strong></div><div class="detail-item"><span>Inventory revision</span><strong>${whole(inventoryDocument.version)}</strong></div></div><div class="notice ${stale ? "notice-warning" : "notice-success"}">${stale ? "Inventory changed after this request was submitted. Confirm below only after comparing the current and proposed values." : "The request is based on the current inventory revision."}</div><div class="panel"><strong>Employee reason</strong><p class="muted">${escapeHtml(request.reason)}</p></div>${stale ? `<label class="check-row"><input name="confirm_stale" type="checkbox" required><span>I reviewed the newer inventory value and still want to apply this request.</span></label>` : ""}<label><span>Owner note</span><textarea name="owner_note" maxlength="500" placeholder="Optional explanation for the employee"></textarea></label><div class="modal-actions"><button class="button button-quiet button-block" type="button" data-action="close-modal">Cancel</button><button class="button button-danger button-block" type="button" id="reject-request">Reject</button><button class="button button-primary button-block" type="submit">Approve</button></div></form>`,
    onOpen: () => {
      const form = document.querySelector("#review-form");
      if (request.change_type === "add_ingredient") {
        const cost = `<div class="detail-item"><span>Proposed unit cost</span><strong>${escapeHtml(money(request.proposed_unit_cost, currency()))}</strong></div>`;
        form.querySelector(".detail-grid")?.insertAdjacentHTML("beforeend", cost);
      }
      const decide = async (decision) => {
        if (!requireOnline()) return;
        const values = new FormData(form);
        if (decision === "approved" && stale && !values.get("confirm_stale")) {
          toast("Confirm that you reviewed the newer inventory value.", "error");
          return;
        }
        showLoading(`${decision === "approved" ? "Approving" : "Rejecting"} stock request…`);
        try {
          await api.reviewStockChange(request.id, decision, values.get("owner_note"), Boolean(values.get("confirm_stale")));
          closeModal();
          await loadContextAndData({ quiet: true });
          toast(`Request ${decision}.`);
        } catch (error) { toast(error.message, "error"); } finally { hideLoading(); }
      };
      form.addEventListener("submit", (event) => { event.preventDefault(); decide("approved"); });
      document.querySelector("#reject-request").addEventListener("click", () => decide("rejected"));
    },
  });
}

function openInviteModal() {
  if (!isOwner()) {
    toast("Owner access is required to invite employees.", "error");
    return;
  }
  openModal({
    title: "Invite employee",
    eyebrow: "OWNER USER MANAGEMENT",
    content: `<form id="invite-form" class="stack"><label><span>Employee name</span><input name="display_name" maxlength="120" required placeholder="Full name"></label><label><span>Email address</span><input name="email" type="email" required placeholder="employee@example.com"></label><div class="notice notice-success">The employee receives a secure invitation link. Their account can record sales and request stock corrections, but cannot access owner finances or approve changes.</div>${formActions("Send invitation")}</form>`,
    onOpen: () => document.querySelector("#invite-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireOnline()) return;
      const form = new FormData(event.currentTarget);
      showLoading("Sending secure employee invitation…");
      try {
        const result = await api.inviteEmployee(state.context.business.id, form.get("email"), form.get("display_name"));
        closeModal();
        await loadContextAndData({ quiet: true });
        toast(result.linkedExisting ? `${result.email} was added to the team.` : `Invitation sent to ${result.email}.`);
      } catch (error) { toast(error.message, "error"); } finally { hideLoading(); }
    }),
  });
}

function openProfileModal() {
  const name = state.context.profile?.display_name || state.context.user.email;
  openModal({
    title: "Account",
    eyebrow: escapeHtml(role().toUpperCase()),
    content: `<div class="profile-chip" style="background:var(--green-50)"><div class="profile-avatar">${escapeHtml(initials(name))}</div><div class="profile-copy"><strong style="color:var(--ink-950)">${escapeHtml(name)}</strong><span style="color:var(--ink-500)">${escapeHtml(state.context.user.email || "Demo account")}</span></div></div><div class="detail-grid" style="margin-top:14px"><div class="detail-item"><span>Business</span><strong>${escapeHtml(state.context.business.name)}</strong></div><div class="detail-item"><span>Role</span><strong>${escapeHtml(role())}</strong></div></div><div class="modal-actions"><button class="button button-quiet button-block" type="button" data-action="close-modal">Close</button><button class="button button-danger button-block" type="button" data-action="sign-out">Sign out</button></div>`,
    onOpen: () => {
      if (!isStandalone()) {
        elements.modalContent.querySelector(".modal-actions")?.insertAdjacentHTML(
          "afterbegin",
          '<button class="button button-secondary button-block" type="button" data-action="install-app">Install this app</button>',
        );
      }
    },
  });
}

function openInstallHelpModal() {
  openModal({
    title: "Install Memory Lanes",
    eyebrow: "PHONE & DESKTOP APP",
    content: `<div class="stack"><div class="notice notice-success"><strong>iPhone or iPad</strong><p>Open this site in Safari, tap Share, then choose Add to Home Screen.</p></div><div class="notice notice-success"><strong>Android</strong><p>Open this site in Chrome, open the browser menu, then choose Install app or Add to Home screen.</p></div><p class="muted">Installation requires the deployed HTTPS site. Local files cannot be installed.</p><button class="button button-primary button-block" type="button" data-action="close-modal">Done</button></div>`,
  });
}

function openSetPasswordModal() {
  openModal({
    title: api.redirectType === "recovery" ? "Choose a new password" : "Finish your invitation",
    eyebrow: "SECURE ACCOUNT SETUP",
    closeable: false,
    content: `<form id="set-password-form" class="stack"><label><span>New password</span><input name="password" type="password" minlength="10" autocomplete="new-password" required></label><label><span>Confirm password</span><input name="confirm" type="password" minlength="10" autocomplete="new-password" required></label><p class="muted">Use at least 10 characters and do not reuse a password from another service.</p>${formActions("Save password", "Sign out")}</form>`,
    onOpen: () => {
      const passwordForm = document.querySelector("#set-password-form");
      passwordForm.querySelector('[data-action="close-modal"]').dataset.action = "sign-out";
      passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (form.get("password") !== form.get("confirm")) { toast("Passwords do not match.", "error"); return; }
        showLoading("Securing your account…");
        try { await api.updatePassword(form.get("password")); api.redirectType = null; closeModal(true); toast("Password saved. Welcome to Memory Lanes."); }
        catch (error) { toast(error.message, "error"); }
        finally { hideLoading(); }
      });
    },
  });
}

async function signOut(showMessage = true) {
  clearInterval(state.pollTimer);
  const wasDemo = api.isDemo;
  await api.signOut();
  if (wasDemo) api = createApi(config);
  state.context = null;
  state.data = null;
  state.analytics = null;
  closeModal(true);
  elements.appShell.classList.add("hidden");
  elements.authScreen.classList.remove("hidden");
  elements.setupWarning.classList.toggle("hidden", api.isConfigured);
  elements.demoActions.classList.toggle("hidden", !config.allowDemo);
  setConnectionStatus();
  elements.email.focus();
  if (showMessage) toast("Signed out safely.");
}

function startPolling() {
  clearInterval(state.pollTimer);
  const interval = Math.max(15000, Number(config.pollIntervalMs || 30000));
  state.pollTimer = setInterval(() => {
    const editingPage = elements.pageContent.contains(document.activeElement)
      && document.activeElement.matches("input, select, textarea");
    const modalOpen = !elements.modalBackdrop.classList.contains("hidden");
    if (!document.hidden && !editingPage && !modalOpen && (navigator.onLine || api.isDemo)) {
      loadContextAndData({ quiet: true }).catch(() => {});
    }
  }, interval);
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showLoading("Signing in securely…");
  try {
    await api.signIn(elements.email.value, elements.password.value, elements.remember.checked);
    await enterApp();
    elements.password.value = "";
  } catch (error) {
    toast(error.message || "Sign-in failed.", "error");
    hideLoading();
  }
});

document.querySelector("#demo-owner").addEventListener("click", async () => {
  api = createDemoApi(config, "owner");
  await api.signIn("owner@demo.local");
  enterApp();
});

document.querySelector("#demo-employee").addEventListener("click", async () => {
  api = createDemoApi(config, "employee");
  await api.signIn("employee@demo.local");
  enterApp();
});

document.querySelector("#forgot-password").addEventListener("click", async () => {
  const email = elements.email.value.trim();
  if (!email) { toast("Enter your email address first.", "error"); elements.email.focus(); return; }
  if (!api.isConfigured || api.isDemo) { toast("Password reset becomes available after cloud deployment.", "error"); return; }
  showLoading("Sending password reset email…");
  try { await api.requestPasswordReset(email); toast("Check your email for a password reset link."); }
  catch (error) { toast(error.message, "error"); }
  finally { hideLoading(); }
});

document.querySelector("#refresh-data").addEventListener("click", () => loadContextAndData().catch(() => {}));
document.querySelector("#desktop-sign-out").addEventListener("click", () => signOut());
elements.mobileProfile.addEventListener("click", openProfileModal);
document.querySelector("#close-modal").addEventListener("click", closeModal);
elements.modalBackdrop.addEventListener("click", (event) => { if (event.target === elements.modalBackdrop && !document.querySelector("#close-modal").classList.contains("hidden")) closeModal(); });

document.addEventListener("click", async (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) { navigate(routeButton.dataset.route); return; }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === "close-modal") closeModal();
  else if (action === "record-sale") openSaleModal();
  else if (action === "record-product-sale") openSaleModal(actionButton.dataset.name);
  else if (action === "request-stock") openRequestModal();
  else if (action === "request-item") openRequestModal(actionButton.dataset.name);
  else if (action === "edit-inventory") openInventoryEditModal(actionButton.dataset.name);
  else if (action === "add-inventory") openAddInventoryModal();
  else if (action === "review-request") openReviewModal(actionButton.dataset.id);
  else if (action === "invite-employee") openInviteModal();
  else if (action === "analytics-tab") { state.analyticsTab = actionButton.dataset.value; renderCurrentRoute(); }
  else if (action === "inventory-filter") { state.inventoryFilter = actionButton.dataset.value; renderCurrentRoute(); }
  else if (action === "sign-out") signOut();
  else if (action === "toggle-member") {
    if (!isOwner()) { toast("Owner access is required to manage employees.", "error"); return; }
    if (!requireOnline()) return;
    const active = actionButton.dataset.active === "true";
    showLoading(active ? "Suspending employee account…" : "Reactivating employee account…");
    try { await api.setMemberActive(state.context.business.id, actionButton.dataset.id, !active); await loadContextAndData({ quiet: true }); toast(active ? "Employee account suspended." : "Employee account reactivated."); }
    catch (error) { toast(error.message, "error"); }
    finally { hideLoading(); }
  } else if (action === "install-app") {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      renderCurrentRoute();
    } else {
      openInstallHelpModal();
    }
  }
});

elements.pageContent.addEventListener("submit", async (event) => {
  if (event.target.id === "inventory-search-form") {
    event.preventDefault();
    state.inventorySearch = new FormData(event.target).get("inventory-search") || document.querySelector("#inventory-search").value;
    renderCurrentRoute();
  } else if (event.target.id === "settings-form") {
    event.preventDefault();
    if (!isOwner()) { toast("Owner access is required to change business settings.", "error"); return; }
    if (!requireOnline()) return;
    const values = new FormData(event.target);
    const document = state.data.documents.config;
    const updated = {
      ...document.content,
      ingredient_cost: Number(values.get("ingredient_cost")),
      ingredients_per_product: Number(values.get("ingredients_per_product")),
      sale_price: Number(values.get("sale_price")),
      vat_percent: Number(values.get("vat_percent")),
      employee_commission_percent: Number(values.get("employee_commission_percent")),
      employee_count: Number(values.get("employee_count")),
      max_products_per_employee: Number(values.get("max_products_per_employee")),
    };
    showLoading("Saving business settings…");
    try { await api.saveDocument(state.context.business.id, "config", updated, document.version, "Updated business settings from the owner web app"); await loadContextAndData({ quiet: true }); toast("Business settings synchronized."); }
    catch (error) { toast(error.message, "error"); }
    finally { hideLoading(); }
  }
});

document.addEventListener("keydown", (event) => {
  if (elements.modalBackdrop.classList.contains("hidden")) return;
  if (event.key === "Escape" && !document.querySelector("#close-modal").classList.contains("hidden")) closeModal();
  if (event.key === "Tab") {
    const focusable = [...elements.modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')].filter((item) => item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

window.addEventListener("online", () => { setConnectionStatus(); if (state.context) loadContextAndData({ quiet: true }).catch(() => {}); });
window.addEventListener("offline", setConnectionStatus);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); state.installPrompt = event; if (state.route === "more") renderCurrentRoute(); });
window.addEventListener("appinstalled", () => { state.installPrompt = null; toast("Memory Lanes was installed on this device."); });

async function initialize() {
  elements.setupWarning.classList.toggle("hidden", api.isConfigured);
  elements.demoActions.classList.toggle("hidden", !config.allowDemo);
  setConnectionStatus();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
  if (api.redirectError) toast(api.redirectError, "error");
  if (api.currentSession) await enterApp();
}

initialize();
