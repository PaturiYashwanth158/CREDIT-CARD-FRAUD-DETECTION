const state = {
  token: null,
  role: null,
  session: null,
  adminCustomerOptions: [],
  adminRecentAnalyses: [],
  activeTabs: {
    "user-workspace": "user-overview",
    "admin-workspace": "admin-monitor",
  },
};

const sessionBadge = document.getElementById("sessionBadge");
const metricRole = document.getElementById("metricRole");
const metricName = document.getElementById("metricName");
const metricFocus = document.getElementById("metricFocus");
const portalTitle = document.getElementById("portalTitle");
const portalLead = document.getElementById("portalLead");
const loginDeviceId = document.getElementById("loginDeviceId");
const logoutButton = document.getElementById("logoutButton");
const alertsList = document.getElementById("alertsList");
const adminWorkspace = document.getElementById("adminWorkspace");
const userWorkspace = document.getElementById("userWorkspace");
const predictResult = document.getElementById("predictResult");
const batchResult = document.getElementById("batchResult");
const paymentResult = document.getElementById("paymentResult");
const adminPaymentAnalyses = document.getElementById("adminPaymentAnalyses");
const adminRecentTransactions = document.getElementById("adminRecentTransactions");
const userProfileSummary = document.getElementById("userProfileSummary");
const userCards = document.getElementById("userCards");
const userTransactions = document.getElementById("userTransactions");
const userPortfolioStat = document.getElementById("userPortfolioStat");
const userDeviceStat = document.getElementById("userDeviceStat");
const userDecisionStat = document.getElementById("userDecisionStat");
const cardAccountSelect = document.getElementById("cardAccountSelect");
const paymentMerchantSelect = document.getElementById("paymentMerchantSelect");
const paymentDeviceId = document.getElementById("paymentDeviceId");
const paymentLatitude = document.getElementById("paymentLatitude");
const paymentLongitude = document.getElementById("paymentLongitude");
const adminTransactionSelect = document.getElementById("adminTransactionSelect");
const adminLoadTransaction = document.getElementById("adminLoadTransaction");
const adminTransactionSnapshot = document.getElementById("adminTransactionSnapshot");

let adminAnalysisIntervalId = null;
let adminRecentTransactionsIntervalId = null;

const PAYMENT_MERCHANT_OPTIONS = [
  { id: "m_grocery_04", label: "Fresh Basket Grocery", country: "IN" },
  { id: "m_pharmacy_18", label: "CityCare Pharmacy", country: "IN" },
  { id: "m_supermarket_12", label: "Metro Supermarket", country: "IN" },
  { id: "m_fuel_27", label: "Highway Fuel Station", country: "IN" },
  { id: "m_clinic_44", label: "Wellness Clinic", country: "IN" },
  { id: "m_lifestyle_22", label: "Urban Lifestyle", country: "IN" },
  { id: "m_fashion_63", label: "Velvet Fashion House", country: "IN" },
  { id: "m_restaurant_71", label: "Royal Spice Dining", country: "IN" },
  { id: "m_electronics_77", label: "Electro Hub", country: "IN" },
  { id: "m_appliances_54", label: "Home Appliance World", country: "IN" },
  { id: "m_mobile_88", label: "Smart Mobile Store", country: "IN" },
  { id: "m_airline_99", label: "SkyBridge Airlines", country: "AE" },
  { id: "m_hotel_31", label: "Harbor Grand Hotel", country: "SG" },
  { id: "m_booking_67", label: "Global Travel Booking", country: "AE" },
  { id: "m_dutyfree_83", label: "Bay Duty Free", country: "SG" },
];

function activateWorkspaceTab(group, tabId) {
  state.activeTabs[group] = tabId;

  document.querySelectorAll(`[data-tab-panel="${group}"]`).forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.tabId === tabId);
  });

  document.querySelectorAll(".workspace-tabs").forEach((tabsRow) => {
    if (tabsRow.dataset.tabGroup !== group) {
      return;
    }
    tabsRow.querySelectorAll(".workspace-tab").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tabTarget === tabId);
    });
  });
}

function ensureWorkspaceTab(group, defaultTabId) {
  activateWorkspaceTab(group, state.activeTabs[group] || defaultTabId);
}

function initWorkspaceTabs() {
  document.querySelectorAll(".workspace-tabs").forEach((tabsRow) => {
    const group = tabsRow.dataset.tabGroup;
    tabsRow.querySelectorAll(".workspace-tab").forEach((button) => {
      button.addEventListener("click", () => {
        activateWorkspaceTab(group, button.dataset.tabTarget);
      });
    });
  });
}

function smoothFocus(element) {
  if (!element) {
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function setRoleTheme(role) {
  document.body.classList.remove("role-guest", "role-admin", "role-user", "is-authenticated");
  if (role === "admin") {
    document.body.classList.add("role-admin", "is-authenticated");
  } else if (role === "user") {
    document.body.classList.add("role-user", "is-authenticated");
  } else {
    document.body.classList.add("role-guest");
  }
}

function toggleLogoutButton(visible) {
  if (!logoutButton) {
    return;
  }
  logoutButton.classList.toggle("hidden", !visible);
}

function setPortalCopy(role) {
  if (!portalTitle || !portalLead) {
    return;
  }

  if (role === "admin") {
    portalTitle.textContent = "Admin Fraud Console";
    portalLead.textContent = "One dedicated admin surface for live monitoring, transaction investigation, and batch fraud review.";
    return;
  }

  if (role === "user") {
    portalTitle.textContent = "Customer Banking Workspace";
    portalLead.textContent = "One dedicated customer surface for cards, payment checks, and transaction history.";
    return;
  }

  portalTitle.textContent = "Fraud Decision Portal";
  portalLead.textContent = "Clean role-based workspaces for fraud operations and customer payment decisions.";
}

function setSessionBadge(text, tone = "muted") {
  sessionBadge.textContent = text;
  sessionBadge.className = `badge ${tone}`;
}

function populateMerchantSelect() {
  if (!paymentMerchantSelect) {
    return;
  }
  paymentMerchantSelect.innerHTML = PAYMENT_MERCHANT_OPTIONS
    .map((merchant) => `<option value="${merchant.id}">${escapeHtml(merchant.label)} - ${escapeHtml(merchant.country)}</option>`)
    .join("");
}

function ensureAuth() {
  if (!state.token) {
    throw new Error("Authenticate first from the Portal Login panel.");
  }
}

function authHeaders(extra = {}) {
  ensureAuth();
  return {
    Authorization: `Bearer ${state.token}`,
    ...extra,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildBrowserDeviceId() {
  const parts = [
    navigator.platform || "platform",
    navigator.userAgent || "agent",
    navigator.language || "lang",
  ];
  const seed = parts.join("|");
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  return `browser_device_${Math.abs(hash)}`;
}

function syncLoginDeviceId() {
  if (!loginDeviceId) {
    return;
  }
  loginDeviceId.value = buildBrowserDeviceId();
}

function detectBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 2500,
        maximumAge: 300000,
      },
    );
  });
}

function refreshBrowserLocation() {
  detectBrowserLocation().then((browserLocation) => {
    if (!browserLocation) {
      return;
    }
    if (paymentLatitude) {
      paymentLatitude.value = String(browserLocation.latitude);
    }
    if (paymentLongitude) {
      paymentLongitude.value = String(browserLocation.longitude);
    }
  });
}

function formatValue(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return escapeHtml(value);
}

function decisionTone(result) {
  if (result.decision === "blocked" || result.is_fraud) {
    return "alert";
  }
  if (result.decision === "review") {
    return "warning";
  }
  return "success";
}

function renderJsonCard(target, payload, tone = "success") {
  target.className = `result-card toast ${tone}`;
  target.innerHTML = `<pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
}

function renderDecisionCard(target, result, modeLabel) {
  const tone = decisionTone(result);
  const reasons = Array.isArray(result.reasons) ? result.reasons : [];
  const rules = Array.isArray(result.triggered_rules) ? result.triggered_rules : [];
  const prettyPayload = escapeHtml(JSON.stringify(result, null, 2));
  const summaryClass = tone === "alert"
    ? "decision-summary alert"
    : tone === "warning"
      ? "decision-summary warning"
      : "decision-summary";

  target.className = `result-card toast ${tone === "alert" ? "error" : "success"}`;
  target.innerHTML = `
    <div class="decision-hero">
      <div class="${summaryClass}">
        <span>${escapeHtml(modeLabel)}</span>
        <strong>${formatValue(result.decision, "processed")}</strong>
        <small>Risk score ${Number(result.risk_score || 0).toFixed(4)}</small>
        <div class="risk-meter">
          <div class="risk-meter-track">
            <div class="risk-meter-fill" style="width: ${Math.max(4, Math.min(100, Number(result.risk_score || 0) * 100))}%"></div>
          </div>
        </div>
      </div>
      <div class="decision-grid">
        <article class="decision-pill">
          <span>Card</span>
          <strong>${formatValue(result.masked_card_number)}</strong>
        </article>
        <article class="decision-pill">
          <span>Issuer</span>
          <strong>${formatValue(result.issuer)}</strong>
        </article>
        <article class="decision-pill">
          <span>Validity</span>
          <strong>${result.valid_card ? "Valid" : "Blocked"}</strong>
        </article>
        <article class="decision-pill">
          <span>Merchant</span>
          <strong>${formatValue(result.merchant_id)}</strong>
        </article>
        <article class="decision-pill">
          <span>Transaction</span>
          <strong>${formatValue(result.transaction_id)}</strong>
        </article>
      </div>
    </div>
    <div class="decision-rules">
      <h4>Triggered Rules</h4>
      <div class="tag-row">
        ${rules.length ? rules.map((rule) => `<span>${formatValue(rule.name || rule.rule_id)}</span>`).join("") : "<span>No explicit rule triggers</span>"}
      </div>
    </div>
    <div class="decision-reasons">
      <h4>Why the model decided this</h4>
      ${reasons.length ? `<ul>${reasons.map((reason) => `<li>${formatValue(reason)}</li>`).join("")}</ul>` : `<p class="meta">No explanation text returned.</p>`}
    </div>
    <details>
      <summary>Technical payload</summary>
      <pre>${prettyPayload}</pre>
    </details>
  `;
}

function mapAdminAnalysisToDecision(analysis) {
  return {
    transaction_id: analysis.transaction_id,
    decision: analysis.decision,
    is_fraud: analysis.is_fraud,
    risk_score: analysis.risk_score,
    valid_card: analysis.valid_card,
    issuer: analysis.issuer,
    masked_card_number: analysis.masked_card_number,
    triggered_rules: analysis.triggered_rules || [],
    reasons: analysis.summary || [],
    explanation: analysis.explanation || {},
  };
}

function renderAdminTransactionSnapshot(analysis) {
  if (!adminTransactionSnapshot) {
    return;
  }
  if (!analysis) {
    adminTransactionSnapshot.className = "result-card placeholder";
    adminTransactionSnapshot.textContent = "Selected user transaction details will appear here.";
    return;
  }

  adminTransactionSnapshot.className = "result-card toast success";
  adminTransactionSnapshot.innerHTML = `
    <div class="file-result-grid">
      <article class="decision-pill">
        <span>User</span>
        <strong>${formatValue(analysis.full_name)}</strong>
      </article>
      <article class="decision-pill">
        <span>Card</span>
        <strong>${formatValue(analysis.masked_card_number)}</strong>
      </article>
      <article class="decision-pill">
        <span>Merchant</span>
        <strong>${formatValue(analysis.merchant_id)}</strong>
      </article>
      <article class="decision-pill">
        <span>Amount</span>
        <strong>${Number(analysis.amount || 0).toLocaleString()}</strong>
      </article>
      <article class="decision-pill">
        <span>Decision</span>
        <strong>${formatValue(analysis.decision)}</strong>
      </article>
      <article class="decision-pill">
        <span>Risk</span>
        <strong>${Number(analysis.risk_score || 0).toFixed(4)}</strong>
      </article>
    </div>
    <p class="meta">${analysis.summary?.length ? escapeHtml(analysis.summary[0]) : "No summary available."}</p>
  `;
}

function getSelectedAdminAnalysis() {
  return state.adminRecentAnalyses.find((analysis) => analysis.transaction_id === adminTransactionSelect?.value) || null;
}

function openAdminTransactionAnalysis(analysis) {
  if (!analysis) {
    return;
  }
  activateWorkspaceTab("admin-workspace", "admin-investigate");
  if (adminTransactionSelect) {
    adminTransactionSelect.value = analysis.transaction_id;
  }
  renderAdminTransactionSnapshot(analysis);
  renderDecisionCard(predictResult, mapAdminAnalysisToDecision(analysis), "User Transaction Analysis");
  smoothFocus(adminTransactionSnapshot || predictResult);
}

function populateAdminTransactionSelect(analyses) {
  state.adminRecentAnalyses = Array.isArray(analyses) ? analyses : [];
  if (!adminTransactionSelect) {
    return;
  }
  if (!state.adminRecentAnalyses.length) {
    adminTransactionSelect.innerHTML = `<option value="">No recent user transactions</option>`;
    renderAdminTransactionSnapshot(null);
    return;
  }

  const previousValue = adminTransactionSelect.value;
  adminTransactionSelect.innerHTML = state.adminRecentAnalyses
    .map((analysis) => {
      const createdAt = analysis.created_at ? new Date(analysis.created_at).toLocaleString() : "recent";
      const label = `${analysis.full_name} | ${analysis.masked_card_number} | ${analysis.merchant_id} | ${Number(analysis.amount || 0).toLocaleString()} | ${createdAt}`;
      return `<option value="${analysis.transaction_id}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const selected = state.adminRecentAnalyses.find((analysis) => analysis.transaction_id === previousValue) || state.adminRecentAnalyses[0];
  adminTransactionSelect.value = selected.transaction_id;
  renderAdminTransactionSnapshot(selected);
}

function renderBatchSummary(target, result) {
  const prettyPayload = escapeHtml(JSON.stringify(result, null, 2));
  target.className = "result-card toast success";
  target.innerHTML = `
    <div class="file-result-grid">
      <article class="decision-pill">
        <span>Rows Processed</span>
        <strong>${Number(result.processed_count || 0).toLocaleString()}</strong>
      </article>
      <article class="decision-pill">
        <span>Fraud Cases</span>
        <strong>${Number(result.fraud_count || 0).toLocaleString()}</strong>
      </article>
      <article class="decision-pill">
        <span>Blocked</span>
        <strong>${Number(result.blocked_count || 0).toLocaleString()}</strong>
      </article>
      <article class="decision-pill">
        <span>Export File</span>
        <strong>${formatValue(result.output_file)}</strong>
      </article>
    </div>
    <details>
      <summary>Technical payload</summary>
      <pre>${prettyPayload}</pre>
    </details>
  `;
}

function renderError(target, error) {
  target.className = "result-card toast error";
  target.innerHTML = `<strong>Request failed</strong><pre>${escapeHtml(error)}</pre>`;
}

function predictFormElement(name) {
  const form = document.getElementById("predictForm");
  return form?.elements?.namedItem(name) || null;
}

function getSelectedAdminCustomer() {
  return state.adminCustomerOptions.find((customer) => customer.user_id === adminKnownUser?.value) || null;
}

function getSelectedAdminCard() {
  const customer = getSelectedAdminCustomer();
  if (!customer) {
    return null;
  }
  return customer.cards.find((card) => String(card.id) === String(adminKnownCard?.value)) || null;
}

function toggleAdminAnalysisMode() {
  if (!adminKnownSelectors || !adminAnalysisMode) {
    return;
  }
  const isKnownMode = adminAnalysisMode.value === "known";
  adminKnownSelectors.classList.toggle("hidden", !isKnownMode);
}

function populateAdminCardOptions(cards) {
  if (!adminKnownCard) {
    return;
  }
  if (!cards.length) {
    adminKnownCard.innerHTML = `<option value="">No active cards</option>`;
    return;
  }
  adminKnownCard.innerHTML = cards
    .map((card) => `<option value="${card.id}">${escapeHtml(card.nickname)} - ${escapeHtml(card.masked_card_number)} - ${escapeHtml(card.issuer)}</option>`)
    .join("");
}

function applySelectedAdminCardToForm() {
  const customer = getSelectedAdminCustomer();
  const card = getSelectedAdminCard();
  if (!customer) {
    return;
  }

  const userIdInput = predictFormElement("user_id");
  const deviceIdInput = predictFormElement("device_id");
  const latitudeInput = predictFormElement("latitude");
  const longitudeInput = predictFormElement("longitude");
  const merchantCountryInput = predictFormElement("merchant_country");

  if (userIdInput) {
    userIdInput.value = customer.user_id;
  }
  if (deviceIdInput && !deviceIdInput.value) {
    deviceIdInput.value = customer.known_devices?.[0] || `device_${customer.user_id}_admin_review`;
  }
  if (latitudeInput) {
    latitudeInput.value = customer.home_latitude;
  }
  if (longitudeInput) {
    longitudeInput.value = customer.home_longitude;
  }
  if (merchantCountryInput && !merchantCountryInput.value) {
    merchantCountryInput.value = customer.home_country;
  }

  if (!card) {
    return;
  }

  const cardNumberInput = predictFormElement("card_number");
  const expiryMonthInput = predictFormElement("expiry_month");
  const expiryYearInput = predictFormElement("expiry_year");
  const cvvInput = predictFormElement("cvv");

  if (cardNumberInput) {
    cardNumberInput.value = card.card_number;
  }
  if (expiryMonthInput) {
    expiryMonthInput.value = card.expiry_month;
  }
  if (expiryYearInput) {
    expiryYearInput.value = card.expiry_year;
  }
  if (cvvInput) {
    cvvInput.value = card.cvv;
  }
}

function populateAdminCustomerOptions(customers) {
  state.adminCustomerOptions = Array.isArray(customers) ? customers : [];
  if (!adminKnownUser || !adminKnownCard) {
    return;
  }

  if (!state.adminCustomerOptions.length) {
    adminKnownUser.innerHTML = `<option value="">No customers available</option>`;
    adminKnownCard.innerHTML = `<option value="">No cards available</option>`;
    return;
  }

  adminKnownUser.innerHTML = state.adminCustomerOptions
    .map((customer) => `<option value="${customer.user_id}">${escapeHtml(customer.full_name)} - ${escapeHtml(customer.user_id)}</option>`)
    .join("");

  const currentCustomer = getSelectedAdminCustomer() || state.adminCustomerOptions[0];
  adminKnownUser.value = currentCustomer.user_id;
  populateAdminCardOptions(currentCustomer.cards || []);
  if (currentCustomer.cards?.length) {
    adminKnownCard.value = String(currentCustomer.cards[0].id);
  }
  applySelectedAdminCardToForm();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (error) {
    body = text;
  }
  if (!response.ok) {
    throw new Error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  return body;
}

function resetWorkspaces() {
  adminWorkspace.classList.add("hidden");
  userWorkspace.classList.add("hidden");
  setRoleTheme("guest");
  setPortalCopy("guest");
  toggleLogoutButton(false);
  metricRole.textContent = "Guest";
  metricName.textContent = "-";
  metricFocus.textContent = "0";
}

function renderAlerts(alerts) {
  if (!alerts.length) {
    alertsList.innerHTML = `<p class="placeholder">No alerts or personal decisions available yet.</p>`;
    return;
  }

  const template = document.getElementById("alertTemplate");
  alertsList.innerHTML = "";
  alerts.slice(0, 8).forEach((alert) => {
    const fragment = template.content.cloneNode(true);
    const severity = fragment.querySelector(".severity");
    const risk = fragment.querySelector(".risk");
    const message = fragment.querySelector(".message");
    const meta = fragment.querySelector(".meta");
    severity.textContent = alert.severity || alert.decision || "info";
    severity.classList.add((alert.severity || "medium").toLowerCase());
    risk.textContent = `risk=${Number(alert.risk_score || 0).toFixed(4)}`;
    message.textContent = alert.message || `${alert.transaction_id} | ${alert.decision}`;
    const ts = alert.created_at ? new Date(alert.created_at).toLocaleString() : "latest decision";
    meta.textContent = `${alert.transaction_id} | ${alert.alert_type || "payment"} | ${ts}`;
    alertsList.appendChild(fragment);
  });
}

async function loadAlerts() {
  try {
    const alerts = await fetchJson("/alerts", { headers: authHeaders() });
    renderAlerts(alerts);
  } catch (error) {
    alertsList.innerHTML = `<p class="placeholder">Unable to load alerts: ${escapeHtml(error.message)}</p>`;
  }
}

async function loadAdminCustomerOptions() {
  if (state.role !== "admin") {
    return;
  }

  try {
    const customers = await fetchJson("/admin/customer-options", { headers: authHeaders() });
    populateAdminCustomerOptions(customers);
    toggleAdminAnalysisMode();
  } catch (error) {
    state.adminCustomerOptions = [];
    if (adminKnownUser) {
      adminKnownUser.innerHTML = `<option value="">Unable to load customers</option>`;
    }
    if (adminKnownCard) {
      adminKnownCard.innerHTML = `<option value="">Unable to load cards</option>`;
    }
  }
}

function renderUserCards(cards) {
  if (!cards.length) {
    userCards.innerHTML = `<p class="placeholder">No active cards found.</p>`;
    return;
  }

  userCards.innerHTML = cards.map((card) => `
    <article class="wallet-card">
      <div class="wallet-face issuer-${escapeHtml(card.issuer).toLowerCase()}">
        <div class="wallet-top">
          <span class="wallet-chip"></span>
          <span class="wallet-issuer">${escapeHtml(card.issuer)}</span>
        </div>
        <div>
          <strong class="wallet-name">${escapeHtml(card.nickname)}</strong>
          <div class="wallet-number">${escapeHtml(card.masked_card_number)}</div>
        </div>
        <div class="wallet-metrics">
          <div class="wallet-metric">
            <span>Available</span>
            <strong>${Number(card.available_limit).toLocaleString()}</strong>
          </div>
          <div class="wallet-metric">
            <span>Outstanding</span>
            <strong>${Number(card.outstanding_balance).toLocaleString()}</strong>
          </div>
        </div>
        <div class="wallet-bottom">
          <span class="wallet-subtle">Expiry ${String(card.expiry_month).padStart(2, "0")}/${card.expiry_year}</span>
          <span class="wallet-subtle">${escapeHtml(card.card_status)}</span>
        </div>
      </div>
    </article>
  `).join("");

  cardAccountSelect.innerHTML = cards
    .map((card) => `<option value="${card.id}">${escapeHtml(card.nickname)} - ${escapeHtml(card.masked_card_number)}</option>`)
    .join("");
}

function renderUserTransactions(transactions) {
  if (!transactions.length) {
    userTransactions.innerHTML = `<p class="placeholder">No payment decisions yet.</p>`;
    return;
  }

  userTransactions.innerHTML = transactions.map((tx) => `
    <article class="alert-card timeline-card ${escapeHtml(tx.decision).toLowerCase()}">
      <div class="alert-head">
        <span class="severity ${(tx.is_fraud ? "critical" : "medium")}">${escapeHtml(tx.decision)}</span>
        <span class="risk">risk=${Number(tx.risk_score).toFixed(4)}</span>
      </div>
      <strong>${escapeHtml(tx.masked_card_number)} | ${escapeHtml(tx.merchant_id)}</strong>
      <div class="timeline-meta">
        <span>${Number(tx.amount).toLocaleString()}</span>
        <span>${escapeHtml(tx.merchant_country)}</span>
        <span>${new Date(tx.created_at).toLocaleString()}</span>
      </div>
    </article>
  `).join("");
}

function renderAdminPaymentAnalyses(analyses) {
  if (!adminPaymentAnalyses) {
    return;
  }

  if (!analyses.length) {
    adminPaymentAnalyses.innerHTML = `<p class="placeholder">No customer payment analyses have been recorded yet.</p>`;
    return;
  }

  adminPaymentAnalyses.innerHTML = analyses.map((analysis) => `
    <article class="alert-card timeline-card ${escapeHtml(analysis.decision).toLowerCase()}">
      <div class="alert-head">
        <span class="severity ${(analysis.is_fraud ? "critical" : "medium")}">${escapeHtml(analysis.decision)}</span>
        <span class="risk">risk=${Number(analysis.risk_score).toFixed(4)}</span>
      </div>
      <strong>${escapeHtml(analysis.full_name)} | ${escapeHtml(analysis.masked_card_number)} | ${escapeHtml(analysis.merchant_id)}</strong>
      <div class="timeline-meta">
        <span>${Number(analysis.amount).toLocaleString()}</span>
        <span>${escapeHtml(analysis.merchant_country)}</span>
        <span>${new Date(analysis.created_at).toLocaleString()}</span>
      </div>
      <p class="meta">User ${escapeHtml(analysis.user_id)} | ${escapeHtml(analysis.issuer)}${analysis.triggered_rules.length ? ` | Rules: ${escapeHtml(analysis.triggered_rules.map((rule) => rule.name || rule.rule_id).join(", "))}` : ""}</p>
    </article>
  `).join("");
}

function renderAdminRecentTransactions(analyses) {
  if (!adminRecentTransactions) {
    return;
  }

  if (!analyses.length) {
    adminRecentTransactions.innerHTML = `<p class="placeholder">No recent transactions are available yet.</p>`;
    populateAdminTransactionSelect([]);
    return;
  }

  populateAdminTransactionSelect(analyses);

  adminRecentTransactions.innerHTML = analyses.map((analysis) => `
    <article class="alert-card timeline-card ${escapeHtml(analysis.decision).toLowerCase()}">
      <div class="alert-head">
        <span class="severity ${(analysis.is_fraud ? "critical" : "medium")}">${escapeHtml(analysis.decision)}</span>
        <span class="risk">risk=${Number(analysis.risk_score).toFixed(4)}</span>
      </div>
      <strong>${escapeHtml(analysis.full_name)} | ${escapeHtml(analysis.masked_card_number)} | ${escapeHtml(analysis.merchant_id)}</strong>
      <div class="timeline-meta">
        <span>${Number(analysis.amount).toLocaleString()}</span>
        <span>${escapeHtml(analysis.merchant_country)}</span>
        <span>${escapeHtml(analysis.source)}</span>
        <span>${new Date(analysis.created_at).toLocaleString()}</span>
      </div>
      <p class="meta">${analysis.summary?.length ? escapeHtml(analysis.summary[0]) : "No summary available."}</p>
      <div class="analysis-actions">
        <button type="button" class="ghost-button analyse-recent-transaction" data-transaction-id="${escapeHtml(analysis.transaction_id)}">Open Analysis</button>
      </div>
    </article>
  `).join("");

  adminRecentTransactions.querySelectorAll(".analyse-recent-transaction").forEach((button) => {
    button.addEventListener("click", () => {
      const transactionId = button.dataset.transactionId;
      const selected = analyses.find((analysis) => analysis.transaction_id === transactionId);
      if (!selected) {
        return;
      }
      openAdminTransactionAnalysis(selected);
    });
  });
}

async function loadAdminPaymentAnalyses() {
  if (!adminPaymentAnalyses || state.role !== "admin") {
    return;
  }

  try {
    const analyses = await fetchJson("/admin/payment-analyses", { headers: authHeaders() });
    renderAdminPaymentAnalyses(analyses);
  } catch (error) {
    adminPaymentAnalyses.innerHTML = `<p class="placeholder">Unable to load customer payment analyses: ${escapeHtml(error.message)}</p>`;
  }
}

async function loadAdminRecentTransactions() {
  if (!adminRecentTransactions || state.role !== "admin") {
    return;
  }

  try {
    const analyses = await fetchJson("/admin/recent-transactions", { headers: authHeaders() });
    renderAdminRecentTransactions(analyses);
  } catch (error) {
    adminRecentTransactions.innerHTML = `<p class="placeholder">Unable to load recent transactions: ${escapeHtml(error.message)}</p>`;
  }
}

function startAdminAnalysisPolling() {
  if (adminAnalysisIntervalId) {
    window.clearInterval(adminAnalysisIntervalId);
  }
  if (adminRecentTransactionsIntervalId) {
    window.clearInterval(adminRecentTransactionsIntervalId);
  }

  if (state.role !== "admin") {
    adminAnalysisIntervalId = null;
    adminRecentTransactionsIntervalId = null;
    return;
  }

  adminAnalysisIntervalId = window.setInterval(() => {
    loadAdminPaymentAnalyses();
  }, 8000);

  adminRecentTransactionsIntervalId = window.setInterval(() => {
    loadAdminRecentTransactions();
  }, 10000);
}

function renderUserSession(me) {
  const profile = me.user_profile;
  const decisions = profile.recent_transactions || [];
  const approvedCount = decisions.filter((tx) => String(tx.decision).toLowerCase() === "approved").length;
  const approvalRate = decisions.length ? Math.round((approvedCount / decisions.length) * 100) : 0;

  metricRole.textContent = "User";
  metricName.textContent = me.full_name || profile.full_name;
  metricFocus.textContent = `${profile.cards.length} cards`;
  setRoleTheme("user");
  setPortalCopy("user");
  toggleLogoutButton(true);
  userWorkspace.classList.remove("hidden");
  userWorkspace.classList.add("is-visible");
  ensureWorkspaceTab("user-workspace", "user-overview");
  window.setTimeout(() => smoothFocus(userWorkspace), 80);

  userProfileSummary.className = "result-card toast success";
  userProfileSummary.innerHTML = `
    <strong>${escapeHtml(profile.full_name)}</strong>
    <p class="meta">${escapeHtml(profile.email)}</p>
    <p class="meta">Home country: ${escapeHtml(profile.home_country)}</p>
    <p class="meta">Average spend: ${Number(profile.avg_spend).toLocaleString()}</p>
    <p class="meta">Typical transactions per day: ${profile.typical_tx_per_day}</p>
    <p class="meta">Known devices: ${escapeHtml(profile.known_devices.join(", ") || "None")}</p>
  `;

  renderUserCards(profile.cards);
  populateMerchantSelect();
  renderUserTransactions(decisions);
  userPortfolioStat.textContent = `${profile.cards.length} cards`;
  userDeviceStat.textContent = `${profile.known_devices.length} devices`;
  userDecisionStat.textContent = `${approvalRate}%`;
  if (paymentDeviceId) {
    paymentDeviceId.value = profile.known_devices[0] || buildBrowserDeviceId();
  }
  if (paymentLatitude) {
    paymentLatitude.value = profile.home_latitude;
  }
  if (paymentLongitude) {
    paymentLongitude.value = profile.home_longitude;
  }
  refreshBrowserLocation();
  renderAlerts(
    decisions.map((tx) => ({
      transaction_id: tx.transaction_id,
      decision: tx.decision,
      risk_score: tx.risk_score,
      created_at: tx.created_at,
      message: `${tx.decision.toUpperCase()} | ${tx.masked_card_number} | ${tx.merchant_id}`,
      severity: tx.is_fraud ? "critical" : "medium",
    })),
  );
}

function renderAdminSession(me) {
  const overview = me.admin_overview;
  metricRole.textContent = "Admin";
  metricName.textContent = me.full_name || me.username;
  metricFocus.textContent = `${overview.alerts} alerts`;
  setRoleTheme("admin");
  setPortalCopy("admin");
  toggleLogoutButton(true);
  adminWorkspace.classList.remove("hidden");
  adminWorkspace.classList.add("is-visible");
  ensureWorkspaceTab("admin-workspace", "admin-monitor");
  window.setTimeout(() => smoothFocus(adminWorkspace), 80);
}

function initRevealAnimations() {
  const nodes = document.querySelectorAll(".reveal, .reveal-card");
  if (!nodes.length) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16 });

  nodes.forEach((node) => observer.observe(node));
}

function renderSlideDots(total) {
  if (!slideDots) {
    return;
  }

  slideDots.innerHTML = "";
  for (let index = 0; index < total; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slide-dot${index === activeSlideIndex ? " active" : ""}`;
    button.setAttribute("aria-label", `Show slide ${index + 1}`);
    button.addEventListener("click", () => goToSlide(index));
    slideDots.appendChild(button);
  }
}

function goToSlide(index) {
  if (!slidesTrack) {
    return;
  }

  const totalSlides = slidesTrack.children.length;
  activeSlideIndex = (index + totalSlides) % totalSlides;
  slidesTrack.style.transform = `translateX(-${activeSlideIndex * 100}%)`;

  Array.from(slideDots.children).forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === activeSlideIndex);
  });
}

function startSlides() {
  if (!slidesTrack) {
    return;
  }

  renderSlideDots(slidesTrack.children.length);
  goToSlide(0);

  const startInterval = () => {
    slideIntervalId = window.setInterval(() => {
      goToSlide(activeSlideIndex + 1);
    }, 4800);
  };

  if (slideIntervalId) {
    window.clearInterval(slideIntervalId);
  }
  startInterval();

  if (slidesWindow) {
    slidesWindow.addEventListener("mouseenter", () => {
      if (slideIntervalId) {
        window.clearInterval(slideIntervalId);
        slideIntervalId = null;
      }
    });

    slidesWindow.addEventListener("mouseleave", () => {
      if (!slideIntervalId) {
        startInterval();
      }
    });
  }
}

async function loadSession() {
  try {
    const me = await fetchJson("/me", { headers: authHeaders() });
    state.session = me;
    state.role = me.role;
    resetWorkspaces();
    if (me.role === "admin") {
      renderAdminSession(me);
      await loadAlerts();
      await loadAdminPaymentAnalyses();
      await loadAdminRecentTransactions();
      startAdminAnalysisPolling();
    } else {
      if (adminAnalysisIntervalId) {
        window.clearInterval(adminAnalysisIntervalId);
        adminAnalysisIntervalId = null;
      }
      if (adminRecentTransactionsIntervalId) {
        window.clearInterval(adminRecentTransactionsIntervalId);
        adminRecentTransactionsIntervalId = null;
      }
      renderUserSession(me);
    }
  } catch (error) {
    resetWorkspaces();
    alertsList.innerHTML = `<p class="placeholder">Unable to load session: ${escapeHtml(error.message)}</p>`;
  }
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  syncLoginDeviceId();
  const formData = new URLSearchParams();
  formData.append("username", document.getElementById("username").value);
  formData.append("password", document.getElementById("password").value);
  formData.append("device_id", loginDeviceId?.value || buildBrowserDeviceId());

  try {
    const result = await fetchJson("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    state.token = result.access_token;
    setSessionBadge(`Authenticated as ${result.role}`, "success");
    await loadSession();
  } catch (error) {
    setSessionBadge("Authentication failed", "muted");
    renderError(predictResult || paymentResult, error.message);
  }
});

document.getElementById("refreshSession").addEventListener("click", () => {
  if (state.token) {
    loadSession();
  }
});

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    state.token = null;
    state.role = null;
    state.session = null;
    resetWorkspaces();
    setSessionBadge("Not authenticated", "muted");
    alertsList.innerHTML = `<p class="placeholder">Authenticate to load alerts or personal decision history.</p>`;
    paymentResult.className = "result-card placeholder";
    paymentResult.textContent = "Payment decisions will appear here with approval, review, or block status.";
    batchResult.className = "result-card placeholder";
    batchResult.textContent = "Batch upload results will appear here with fraud counts and export path.";
    predictResult.className = "result-card placeholder";
    predictResult.textContent = "Admin transaction analysis results will appear here.";
  });
}

document.getElementById("refreshAlerts").addEventListener("click", () => {
  if (!state.token) {
    return;
  }
  if (state.role === "admin") {
    loadAlerts();
    loadAdminPaymentAnalyses();
    loadAdminRecentTransactions();
  } else {
    loadSession();
  }
});

if (adminTransactionSelect) {
  adminTransactionSelect.addEventListener("change", () => {
    renderAdminTransactionSnapshot(getSelectedAdminAnalysis());
  });
}

if (adminLoadTransaction) {
  adminLoadTransaction.addEventListener("click", () => {
    const selected = getSelectedAdminAnalysis();
    if (!selected) {
      renderError(predictResult, "Select a user transaction first.");
      return;
    }
    openAdminTransactionAnalysis(selected);
  });
}

document.getElementById("batchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  activateWorkspaceTab("admin-workspace", "admin-batch");
  const fileInput = document.getElementById("csvFile");
  const file = fileInput.files[0];
  if (!file) {
    renderError(batchResult, "Please select a CSV file first.");
    return;
  }

  batchResult.className = "result-card placeholder";
  batchResult.textContent = "Uploading and scoring CSV...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const result = await fetchJson("/upload-csv", {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    renderBatchSummary(batchResult, result);
    smoothFocus(batchResult);
    await loadAlerts();
    await loadAdminPaymentAnalyses();
    await loadAdminRecentTransactions();
  } catch (error) {
    renderError(batchResult, error.message);
    smoothFocus(batchResult);
  }
});

document.getElementById("paymentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  activateWorkspaceTab("user-workspace", "user-payment");
  if (paymentDeviceId && !paymentDeviceId.value) {
    paymentDeviceId.value = buildBrowserDeviceId();
  }
  refreshBrowserLocation();
  paymentResult.className = "result-card placeholder";
  paymentResult.textContent = "Evaluating payment decision...";
  const formData = new FormData(event.currentTarget);
  const payload = Object.fromEntries(formData.entries());
  payload.card_account_id = Number(payload.card_account_id);
  payload.amount = Number(payload.amount);
  if (payload.latitude) {
    payload.latitude = Number(payload.latitude);
  } else {
    delete payload.latitude;
  }
  if (payload.longitude) {
    payload.longitude = Number(payload.longitude);
  } else {
    delete payload.longitude;
  }

  try {
    const result = await fetchJson("/payments", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    renderDecisionCard(paymentResult, result, "Payment Decision");
    smoothFocus(paymentResult);
    await loadSession();
    activateWorkspaceTab("user-workspace", "user-history");
  } catch (error) {
    renderError(paymentResult, error.message);
    smoothFocus(paymentResult);
  }
});

document.getElementById("useSampleCsv").addEventListener("click", async () => {
  try {
    const response = await fetch("/static/sample_batch_upload.csv");
    if (!response.ok) {
      throw new Error("Bundled sample CSV is not available.");
    }
    const blob = await response.blob();
    const file = new File([blob], "sample_batch_upload.csv", { type: "text/csv" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    document.getElementById("csvFile").files = dataTransfer.files;
  } catch (error) {
    renderError(batchResult, error.message);
  }
});

document.querySelectorAll(".quick-login").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById("username").value = button.dataset.username || "";
    document.getElementById("password").value = button.dataset.password || "";
  });
});

initRevealAnimations();
initWorkspaceTabs();
populateMerchantSelect();
syncLoginDeviceId();
