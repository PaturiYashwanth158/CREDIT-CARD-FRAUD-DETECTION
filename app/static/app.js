const state = {
  token: null,
  role: null,
  session: null,
};

const sessionBadge = document.getElementById("sessionBadge");
const metricRole = document.getElementById("metricRole");
const metricName = document.getElementById("metricName");
const metricFocus = document.getElementById("metricFocus");
const alertsList = document.getElementById("alertsList");
const adminWorkspace = document.getElementById("adminWorkspace");
const userWorkspace = document.getElementById("userWorkspace");
const predictResult = document.getElementById("predictResult");
const batchResult = document.getElementById("batchResult");
const paymentResult = document.getElementById("paymentResult");
const userProfileSummary = document.getElementById("userProfileSummary");
const userCards = document.getElementById("userCards");
const userTransactions = document.getElementById("userTransactions");
const cardAccountSelect = document.getElementById("cardAccountSelect");
const paymentDeviceId = document.getElementById("paymentDeviceId");
const paymentLatitude = document.getElementById("paymentLatitude");
const paymentLongitude = document.getElementById("paymentLongitude");

function setRoleTheme(role) {
  document.body.classList.remove("role-guest", "role-admin", "role-user");
  if (role === "admin") {
    document.body.classList.add("role-admin");
  } else if (role === "user") {
    document.body.classList.add("role-user");
  } else {
    document.body.classList.add("role-guest");
  }
}

function setSessionBadge(text, tone = "muted") {
  sessionBadge.textContent = text;
  sessionBadge.className = `badge ${tone}`;
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

function renderJsonCard(target, payload, tone = "success") {
  target.className = `result-card toast ${tone}`;
  target.innerHTML = `<pre>${JSON.stringify(payload, null, 2)}</pre>`;
}

function renderError(target, error) {
  target.className = "result-card toast error";
  target.innerHTML = `<strong>Request failed</strong><pre>${error}</pre>`;
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
    alertsList.innerHTML = `<p class="placeholder">Unable to load alerts: ${error.message}</p>`;
  }
}

function renderUserCards(cards) {
  if (!cards.length) {
    userCards.innerHTML = `<p class="placeholder">No active cards found.</p>`;
    return;
  }

  userCards.innerHTML = cards.map((card) => `
    <article class="result-card">
      <strong>${card.nickname}</strong>
      <p class="meta">${card.issuer} | ${card.masked_card_number}</p>
      <p class="meta">Expiry ${String(card.expiry_month).padStart(2, "0")}/${card.expiry_year}</p>
      <p class="meta">Available Limit: ${Number(card.available_limit).toLocaleString()}</p>
      <p class="meta">Outstanding: ${Number(card.outstanding_balance).toLocaleString()}</p>
      <p class="meta">Status: ${card.card_status}</p>
    </article>
  `).join("");

  cardAccountSelect.innerHTML = cards.map((card) => `<option value="${card.id}">${card.nickname} • ${card.masked_card_number}</option>`).join("");
}

function renderUserTransactions(transactions) {
  if (!transactions.length) {
    userTransactions.innerHTML = `<p class="placeholder">No payment decisions yet.</p>`;
    return;
  }

  userTransactions.innerHTML = transactions.map((tx) => `
    <article class="alert-card">
      <div class="alert-head">
        <span class="severity ${(tx.is_fraud ? "critical" : "medium")}">${tx.decision}</span>
        <span class="risk">risk=${Number(tx.risk_score).toFixed(4)}</span>
      </div>
      <strong>${tx.masked_card_number} | ${tx.merchant_id}</strong>
      <p class="meta">${Number(tx.amount).toLocaleString()} | ${tx.merchant_country} | ${new Date(tx.created_at).toLocaleString()}</p>
    </article>
  `).join("");
}

function renderUserSession(me) {
  const profile = me.user_profile;
  metricRole.textContent = "User";
  metricName.textContent = me.full_name || profile.full_name;
  metricFocus.textContent = `${profile.cards.length} cards`;
  setRoleTheme("user");
  userWorkspace.classList.remove("hidden");

  userProfileSummary.className = "result-card toast success";
  userProfileSummary.innerHTML = `
    <strong>${profile.full_name}</strong>
    <p class="meta">${profile.email}</p>
    <p class="meta">Home country: ${profile.home_country}</p>
    <p class="meta">Average spend: ${Number(profile.avg_spend).toLocaleString()}</p>
    <p class="meta">Typical transactions per day: ${profile.typical_tx_per_day}</p>
    <p class="meta">Known devices: ${profile.known_devices.join(", ") || "None"}</p>
  `;

  renderUserCards(profile.cards);
  renderUserTransactions(profile.recent_transactions);
  paymentDeviceId.value = profile.known_devices[0] || `device_${profile.user_id}_web`;
  paymentLatitude.value = profile.home_latitude;
  paymentLongitude.value = profile.home_longitude;
  renderAlerts(
    profile.recent_transactions.map((tx) => ({
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
  adminWorkspace.classList.remove("hidden");
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
    } else {
      renderUserSession(me);
    }
  } catch (error) {
    resetWorkspaces();
    alertsList.innerHTML = `<p class="placeholder">Unable to load session: ${error.message}</p>`;
  }
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new URLSearchParams();
  formData.append("username", document.getElementById("username").value);
  formData.append("password", document.getElementById("password").value);

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

document.getElementById("refreshAlerts").addEventListener("click", () => {
  if (!state.token) {
    return;
  }
  if (state.role === "admin") {
    loadAlerts();
  } else {
    loadSession();
  }
});

document.getElementById("predictForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = Object.fromEntries(formData.entries());
  payload.expiry_month = Number(payload.expiry_month);
  payload.expiry_year = Number(payload.expiry_year);
  payload.amount = Number(payload.amount);
  payload.latitude = Number(payload.latitude);
  payload.longitude = Number(payload.longitude);
  payload.is_foreign = payload.is_foreign === "true";

  predictResult.className = "result-card placeholder";
  predictResult.textContent = "Running real-time decisioning...";

  try {
    const result = await fetchJson("/predict", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    renderJsonCard(predictResult, result, result.is_fraud ? "error" : "success");
    await loadAlerts();
  } catch (error) {
    renderError(predictResult, error.message);
  }
});

document.getElementById("batchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
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
    renderJsonCard(batchResult, result, "success");
    await loadAlerts();
  } catch (error) {
    renderError(batchResult, error.message);
  }
});

document.getElementById("paymentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = Object.fromEntries(formData.entries());
  payload.card_account_id = Number(payload.card_account_id);
  payload.amount = Number(payload.amount);
  payload.latitude = Number(payload.latitude);
  payload.longitude = Number(payload.longitude);
  if (payload.is_foreign === "") {
    delete payload.is_foreign;
  } else {
    payload.is_foreign = payload.is_foreign === "true";
  }

  paymentResult.className = "result-card placeholder";
  paymentResult.textContent = "Evaluating payment decision...";

  try {
    const result = await fetchJson("/payments", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    renderJsonCard(paymentResult, result, result.decision === "approved" ? "success" : "error");
    await loadSession();
  } catch (error) {
    renderError(paymentResult, error.message);
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
