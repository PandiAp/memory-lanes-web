import {
  demoDocuments,
  demoEvents,
  demoMembers,
  demoRequests,
  demoSaleFinancials,
  demoSales,
} from "./demo-data.js";

const SESSION_KEY = "memory-lanes-cloud-session-v1";

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function responseMessage(payload, fallback) {
  return payload?.message || payload?.msg || payload?.error_description || payload?.error || fallback;
}

function uuid() {
  return globalThis.crypto?.randomUUID?.()
    || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.random() * 16 | 0;
      return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
    });
}

export function createCommandId() {
  return uuid();
}

export class CloudApi {
  constructor(config) {
    this.config = config;
    this.baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
    this.key = String(config.publishableKey || "");
    this.session = this.#loadSession();
    this.redirectType = null;
    this.redirectError = null;
    this.#captureRedirectSession();
  }

  get isConfigured() {
    return /^https:\/\/.+\.supabase\.co$/i.test(this.baseUrl) && this.key.length > 20;
  }

  get isDemo() {
    return false;
  }

  get currentSession() {
    return this.session;
  }

  #loadSession() {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        const value = storage.getItem(SESSION_KEY);
        if (value) return JSON.parse(value);
      } catch {
        // A privacy mode may block storage. Sign-in can still work in memory.
      }
    }
    return null;
  }

  #captureRedirectSession() {
    if (location.hash.includes("error=")) {
      const values = new URLSearchParams(location.hash.slice(1));
      this.redirectError = values.get("error_description") || values.get("error") || "The invitation link is no longer valid.";
      history.replaceState({}, document.title, `${location.pathname}${location.search}`);
      return;
    }
    if (!location.hash.includes("access_token=")) return;
    const values = new URLSearchParams(location.hash.slice(1));
    const accessToken = values.get("access_token");
    const refreshToken = values.get("refresh_token");
    if (!accessToken || !refreshToken) return;
    this.redirectType = values.get("type") || "invite";
    this.#saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: values.get("token_type") || "bearer",
      expires_in: Number(values.get("expires_in") || 3600),
      expires_at: Math.floor(Date.now() / 1000) + Number(values.get("expires_in") || 3600),
      user: null,
    }, false);
    history.replaceState({}, document.title, `${location.pathname}${location.search}`);
  }

  #saveSession(session, remember = false) {
    this.session = session;
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Keep the session in memory when storage is unavailable.
    }
  }

  #clearSession() {
    this.session = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing else to clear.
    }
  }

  async #json(url, options = {}, allowRefresh = true) {
    const response = await fetch(url, options);
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    }
    if (response.status === 401 && allowRefresh && this.session?.refresh_token) {
      await this.refreshSession();
      const headers = new Headers(options.headers || {});
      headers.set("Authorization", `Bearer ${this.session.access_token}`);
      return this.#json(url, { ...options, headers }, false);
    }
    if (!response.ok) {
      throw new ApiError(responseMessage(payload, `Request failed (${response.status})`), response.status, payload);
    }
    return payload;
  }

  async signIn(email, password, remember = false) {
    if (!this.isConfigured) throw new ApiError("Cloud setup is not configured yet.");
    const session = await this.#json(`${this.baseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    }, false);
    session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
    this.#saveSession(session, remember);
    return session;
  }

  async refreshSession() {
    if (!this.session?.refresh_token) throw new ApiError("Your session has expired. Sign in again.", 401);
    try {
      const session = await this.#json(`${this.baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: this.key, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: this.session.refresh_token }),
      }, false);
      session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
      const remembered = Boolean(localStorage.getItem(SESSION_KEY));
      this.#saveSession(session, remembered);
      return session;
    } catch (error) {
      this.#clearSession();
      throw error;
    }
  }

  async ensureSession() {
    if (!this.session) throw new ApiError("Sign in is required.", 401);
    if (Number(this.session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60) {
      await this.refreshSession();
    }
    if (!this.session.user) {
      const user = await this.#json(`${this.baseUrl}/auth/v1/user`, {
        headers: { apikey: this.key, Authorization: `Bearer ${this.session.access_token}` },
      });
      this.session.user = user;
      this.#saveSession(this.session, Boolean(localStorage.getItem(SESSION_KEY)));
    }
    return this.session;
  }

  async signOut() {
    if (this.session?.access_token) {
      try {
        await this.#json(`${this.baseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: this.key, Authorization: `Bearer ${this.session.access_token}` },
        }, false);
      } catch {
        // Local sign-out must still complete if the network is unavailable.
      }
    }
    this.#clearSession();
  }

  async requestPasswordReset(email) {
    const redirectTo = this.config.appUrl || location.origin;
    return this.#json(`${this.baseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: { apikey: this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    }, false);
  }

  async updatePassword(password) {
    await this.ensureSession();
    return this.#json(`${this.baseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
  }

  async rest(path, { method = "GET", body, headers = {} } = {}) {
    await this.ensureSession();
    return this.#json(`${this.baseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.session.access_token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async restPages(path, pageSize = 500) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const separator = path.includes("?") ? "&" : "?";
      const page = await this.rest(`${path}${separator}limit=${pageSize}&offset=${offset}`);
      rows.push(...(page || []));
      if (!page || page.length < pageSize) break;
    }
    return rows;
  }

  async getContext() {
    const session = await this.ensureSession();
    const userId = session.user.id;
    const memberships = await this.rest(`business_members?select=business_id,user_id,role,active,joined_at&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&limit=1`);
    if (!memberships?.length) {
      return { user: session.user, membership: null, business: null, profile: null };
    }
    const membership = memberships[0];
    const [businessRows, profileRows] = await Promise.all([
      this.rest(`businesses?select=id,name,currency_code,timezone,created_at&id=eq.${membership.business_id}&limit=1`),
      this.rest(`profiles?select=id,display_name&id=eq.${userId}&limit=1`),
    ]);
    return {
      user: session.user,
      membership,
      business: businessRows?.[0] || null,
      profile: profileRows?.[0] || { id: userId, display_name: session.user.email?.split("@")[0] || "Member" },
    };
  }

  async fetchAll(context) {
    const businessId = context.business.id;
    const userId = context.user.id;
    const owner = context.membership.role === "owner";
    const query = encodeURIComponent(businessId);
    const tasks = [
      this.rpc("get_business_documents", { p_business_id: businessId }),
      this.restPages(`stock_change_requests?select=*&business_id=eq.${query}&order=created_at.desc,id.desc`),
      this.restPages(`audit_events?select=*&business_id=eq.${query}&order=created_at.desc,id.desc`),
      this.restPages(`sales?select=*&business_id=eq.${query}&order=occurred_at.desc,id.desc`),
    ];
    if (owner) {
      tasks.push(this.restPages(`sale_financials?select=*&business_id=eq.${query}&order=sale_id`));
      tasks.push(this.rest(`business_members?select=business_id,user_id,role,active,joined_at,updated_at&business_id=eq.${query}&order=joined_at`));
    } else {
      tasks.push(Promise.resolve([]));
      tasks.push(Promise.resolve([context.membership]));
    }
    const [documentRows, requests, events, sales, saleFinancials, members] = await Promise.all(tasks);
    const documents = Object.fromEntries((documentRows || []).map((row) => [row.document_type, row]));
    const visibleUserIds = new Set([userId]);
    if (owner) {
      members.forEach((member) => visibleUserIds.add(member.user_id));
      requests.forEach((request) => visibleUserIds.add(request.requested_by));
    }
    const ids = [...visibleUserIds];
    const profiles = ids.length
      ? await this.rest(`profiles?select=id,display_name&id=in.(${ids.map(encodeURIComponent).join(",")})`)
      : [];
    return { documents, requests, events, sales, saleFinancials, members, profiles };
  }

  rpc(name, body) {
    return this.rest(`rpc/${name}`, { method: "POST", body });
  }

  bootstrapBusiness(name, displayName, seed) {
    return this.rpc("bootstrap_business", { p_business_name: name, p_display_name: displayName, p_seed: seed });
  }

  saveDocument(businessId, type, content, version, summary) {
    return this.rpc("update_business_document", {
      p_business_id: businessId,
      p_document_type: type,
      p_content: content,
      p_expected_version: version,
      p_summary: summary,
    });
  }

  submitStockChange(businessId, request) {
    return this.rpc("submit_stock_change", {
      p_business_id: businessId,
      p_change_type: request.changeType,
      p_ingredient_name: request.ingredientName,
      p_proposed_quantity: request.proposedQuantity,
      p_proposed_unit_cost: request.proposedUnitCost,
      p_reason: request.reason,
    });
  }

  reviewStockChange(requestId, decision, ownerNote, confirmStale = false) {
    return this.rpc("review_stock_change", {
      p_request_id: requestId,
      p_decision: decision,
      p_owner_note: ownerNote,
      p_confirm_stale: confirmStale,
    });
  }

  recordSale(businessId, productName, quantity, note, clientCommandId = uuid()) {
    return this.rpc("record_sale", {
      p_business_id: businessId,
      p_product_name: productName,
      p_quantity: quantity,
      p_note: note,
      p_client_command_id: clientCommandId,
      p_occurred_at: new Date().toISOString(),
    });
  }

  async inviteEmployee(businessId, email, displayName) {
    await this.ensureSession();
    const redirectTo = this.config.appUrl || location.origin;
    return this.#json(`${this.baseUrl}/functions/v1/invite-employee`, {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ businessId, email, displayName, redirectTo }),
    });
  }

  setMemberActive(businessId, userId, active) {
    return this.rpc("set_member_active", { p_business_id: businessId, p_user_id: userId, p_active: active });
  }
}

export class DemoApi {
  constructor(config, role = "owner") {
    this.config = config;
    this.role = role;
    this.isDemo = true;
    this.session = null;
    this.documents = clone(demoDocuments);
    this.requests = clone(demoRequests);
    this.events = clone(demoEvents);
    this.sales = clone(demoSales);
    this.saleFinancials = clone(demoSaleFinancials);
    this.members = clone(demoMembers);
    this.profiles = this.members.map((member) => ({ id: member.user_id, display_name: member.display_name }));
    this.saleCommandResults = new Map();
  }

  get isConfigured() { return true; }
  get currentSession() { return this.session; }

  async signIn(email = "", _password = "", _remember = false) {
    this.role = email.toLowerCase().includes("employee") ? "employee" : this.role;
    const userId = this.role === "owner" ? "owner-demo" : "employee-demo";
    this.session = { user: { id: userId, email: this.role === "owner" ? "owner@demo.local" : "employee@demo.local" } };
    return this.session;
  }

  async signOut() { this.session = null; }
  async ensureSession() { if (!this.session) await this.signIn(); return this.session; }
  async requestPasswordReset() { return {}; }
  async updatePassword() { return {}; }

  requireOwner() {
    if (this.role !== "owner") throw new ApiError("Owner access is required for this action.", 403);
  }

  async getContext() {
    await this.ensureSession();
    const userId = this.session.user.id;
    const member = this.members.find((item) => item.user_id === userId);
    return {
      user: this.session.user,
      membership: { ...member },
      business: { id: "business-demo", name: "Memory Lanes", currency_code: "USD", timezone: "Asia/Nicosia" },
      profile: { id: userId, display_name: member.display_name },
    };
  }

  async fetchAll(context) {
    const owner = context.membership.role === "owner";
    const userId = context.user.id;
    const allowedDocuments = owner
      ? this.documents
      : Object.fromEntries(Object.entries(this.documents).filter(([type]) => ["inventory", "recipes", "stock_targets"].includes(type)));
    return clone({
      documents: allowedDocuments,
      requests: owner ? this.requests : this.requests.filter((item) => item.requested_by === userId),
      events: owner ? this.events : this.events.filter((item) => item.actor_user_id === userId),
      sales: owner ? this.sales : this.sales.filter((item) => item.recorded_by === userId),
      saleFinancials: owner ? this.saleFinancials : [],
      members: owner ? this.members : this.members.filter((item) => item.user_id === userId),
      profiles: owner ? this.profiles : this.profiles.filter((item) => item.id === userId),
    });
  }

  async saveDocument(_businessId, type, content, version, summary) {
    this.requireOwner();
    const document = this.documents[type];
    if (!document || document.version !== version) throw new ApiError("Demo conflict: refresh before saving.", 409);
    document.content = clone(content);
    document.version += 1;
    document.updated_at = new Date().toISOString();
    this.events.unshift({ id: Date.now(), business_id: "business-demo", actor_user_id: "owner-demo", event_type: "document_updated", summary, created_at: new Date().toISOString() });
    return { version: document.version, updated_at: document.updated_at };
  }

  async submitStockChange(_businessId, request) {
    if (this.role !== "employee") throw new ApiError("Employees submit stock requests; owners can edit inventory directly.", 403);
    const item = this.documents.inventory.content.find((entry) => entry.name.toLowerCase() === request.ingredientName.toLowerCase());
    const id = uuid();
    this.requests.unshift({
      id,
      business_id: "business-demo",
      requested_by: this.session.user.id,
      change_type: request.changeType,
      ingredient_name: request.ingredientName,
      current_quantity: item?.quantity ?? null,
      proposed_quantity: request.proposedQuantity,
      proposed_unit_cost: request.proposedUnitCost,
      reason: request.reason,
      base_inventory_version: this.documents.inventory.version,
      status: "pending",
      owner_note: "",
      created_at: new Date().toISOString(),
    });
    this.events.unshift({ id: Date.now(), business_id: "business-demo", actor_user_id: this.session.user.id, event_type: "stock_change_requested", summary: `Requested owner approval for ${request.ingredientName}`, created_at: new Date().toISOString() });
    return id;
  }

  async reviewStockChange(requestId, decision, ownerNote, confirmStale = false) {
    this.requireOwner();
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== "pending") throw new ApiError("This request is no longer pending.", 409);
    const stale = Number(request.base_inventory_version) !== Number(this.documents.inventory.version);
    if (decision === "approved" && stale && !confirmStale) {
      throw new ApiError("Inventory changed after this request was submitted. Confirm the current value before approving.", 409);
    }
    if (decision === "approved") {
      const inventory = this.documents.inventory.content;
      const itemIndex = inventory.findIndex((item) => item.name.toLowerCase() === request.ingredient_name.toLowerCase());
      if (request.change_type === "set_quantity" && itemIndex >= 0) inventory[itemIndex].quantity = request.proposed_quantity;
      if (request.change_type === "add_ingredient" && itemIndex < 0) inventory.push({ name: request.ingredient_name, quantity: request.proposed_quantity, unit_cost: request.proposed_unit_cost });
      if (request.change_type === "delete_ingredient" && itemIndex >= 0) inventory.splice(itemIndex, 1);
      this.documents.inventory.version += 1;
      this.documents.inventory.updated_at = new Date().toISOString();
    }
    request.status = decision;
    request.owner_note = ownerNote;
    request.reviewed_at = new Date().toISOString();
    request.reviewed_by = "owner-demo";
    this.events.unshift({ id: Date.now(), business_id: "business-demo", actor_user_id: "owner-demo", event_type: `stock_change_${decision}`, summary: `${decision === "approved" ? "Approved" : "Rejected"} stock request for ${request.ingredient_name}`, created_at: request.reviewed_at });
    return { status: decision, inventory_version: this.documents.inventory.version };
  }

  async recordSale(_businessId, productName, saleQuantity, note, clientCommandId = uuid()) {
    if (this.saleCommandResults.has(clientCommandId)) return clone(this.saleCommandResults.get(clientCommandId));
    const recipe = this.documents.recipes.content.find((item) => item.name === productName);
    if (!recipe) throw new ApiError("Product recipe was not found.");
    const inventory = this.documents.inventory.content;
    for (const requirement of recipe.ingredients) {
      const item = inventory.find((entry) => entry.name === requirement.name);
      const needed = requirement.quantity * saleQuantity;
      if (!item || item.quantity < needed) throw new ApiError(`Not enough ${requirement.name}.`);
    }
    let ingredientCost = 0;
    for (const requirement of recipe.ingredients) {
      const item = inventory.find((entry) => entry.name === requirement.name);
      const needed = requirement.quantity * saleQuantity;
      item.quantity -= needed;
      ingredientCost += needed * Number(item.unit_cost || 0);
    }
    const config = this.documents.config.content;
    const gross = saleQuantity * config.sale_price;
    const vat = gross * config.vat_percent / 100;
    const commission = gross * config.employee_commission_percent / 100;
    const id = uuid();
    this.sales.unshift({ id, business_id: "business-demo", recorded_by: this.session.user.id, product_name: productName, quantity: saleQuantity, unit_price: config.sale_price, gross_sales: gross, vat_amount: vat, customer_payment: gross + vat, employee_commission: commission, note, occurred_at: new Date().toISOString(), created_at: new Date().toISOString() });
    this.saleFinancials.push({ sale_id: id, business_id: "business-demo", ingredient_cost: ingredientCost, business_bank: gross - commission, estimated_profit: gross - commission - ingredientCost });
    this.documents.inventory.version += 1;
    this.documents.inventory.updated_at = new Date().toISOString();
    this.events.unshift({ id: Date.now(), business_id: "business-demo", actor_user_id: this.session.user.id, event_type: "sale_recorded", summary: `Recorded ${saleQuantity} x ${productName}`, created_at: new Date().toISOString() });
    const result = { sale_id: id, product_name: productName, quantity: saleQuantity, customer_payment: gross + vat, employee_commission: commission, inventory_version: this.documents.inventory.version };
    this.saleCommandResults.set(clientCommandId, result);
    return clone(result);
  }

  async inviteEmployee(_businessId, email, displayName) {
    this.requireOwner();
    const id = uuid();
    this.members.push({ business_id: "business-demo", user_id: id, role: "employee", active: true, joined_at: new Date().toISOString(), display_name: displayName, email });
    this.profiles.push({ id, display_name: displayName });
    this.events.unshift({ id: Date.now(), business_id: "business-demo", actor_user_id: "owner-demo", event_type: "employee_invited", summary: `Invited ${displayName}`, created_at: new Date().toISOString() });
    return { invited: true, userId: id, email, displayName };
  }

  async setMemberActive(_businessId, userId, active) {
    this.requireOwner();
    const member = this.members.find((item) => item.user_id === userId);
    if (!member) throw new ApiError("Employee membership not found.");
    member.active = active;
  }
}

export function createApi(config) {
  const cloud = new CloudApi(config);
  return cloud;
}

export function createDemoApi(config, role) {
  return new DemoApi(config, role);
}
