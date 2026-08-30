const KEY_STORAGE = "robinexis_admin_api_key";

function initialTab() {
  const params = new URLSearchParams(location.search);
  if (params.get("tab")) return params.get("tab");
  return document.documentElement.getAttribute("data-initial-tab") || "overview";
}

function adminHeaders() {
  const key = sessionStorage.getItem(KEY_STORAGE) || "";
  return key ? { Authorization: "Bearer " + key } : {};
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), ...adminHeaders() };
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return fetch(path, { ...opts, headers });
}

function showTab(name) {
  document.querySelectorAll(".panel").forEach((el) => el.classList.toggle("active", el.id === "panel-" + name));
  document.querySelectorAll("nav.tabs [data-tab]").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.getAttribute("data-tab") === name ? "true" : "false");
  });
  if (name === "systems") refreshSystems();
  if (name === "calendar") refreshCalendar();
  if (name === "lab") refreshLabStatus();
  if (name === "activity") refreshActivity();
  if (name === "clients") refreshOperator();
  if (name === "overview") refreshOverview();
}

function flag(label, on) {
  const li = document.createElement("li");
  li.className = on ? "on" : "off";
  li.textContent = (on ? "yes · " : "no · ") + label;
  return li;
}

function toneCard(title, ok, detail, warn) {
  const div = document.createElement("div");
  div.className = "card " + (warn ? "warn" : ok ? "ok" : "bad");
  div.innerHTML = "<strong></strong><div class=\"state\"></div><div class=\"muted\"></div>";
  div.querySelector("strong").textContent = title;
  div.querySelector(".state").textContent = warn ? "check" : ok ? "ok" : "down";
  div.querySelector(".muted").textContent = detail || "";
  return div;
}

function renderCallInto(call, metaEl, transcriptEl, toolsEl) {
  metaEl.textContent =
    (call.status || "unknown") +
    (call.outcome ? " · " + call.outcome : "") +
    " · " + (call.direction || "") +
    (call.contactPhone ? " · " + call.contactPhone : "");
  transcriptEl.replaceChildren();
  for (const turn of call.transcript || []) {
    const li = document.createElement("li");
    li.className = turn.role === "agent" ? "agent" : "";
    li.textContent = turn.role + ": " + turn.text;
    transcriptEl.appendChild(li);
  }
  toolsEl.textContent = JSON.stringify(call.toolHistory || [], null, 2);
}

let statusCache = null;
let activeSid = "";
let pollTimer = 0;

async function loadStatus() {
  const res = await fetch("/demo/status");
  statusCache = await res.json();
  return statusCache;
}

async function refreshOverview() {
  const host = document.getElementById("overview-cards");
  if (!host) return;
  try {
    const data = await loadStatus();
    host.replaceChildren(
      toneCard("Demo tenant", Boolean(data.demoTenantReady), data.tenant || "robinexis-demo"),
      toneCard("Outbound", Boolean(data.outboundEnabled), "sandbox Call Me Now"),
      toneCard("Twilio", Boolean(data.twilioConfigured), data.labFrom || "no From"),
      toneCard("Groq", Boolean(data.groqConfigured), "STT + Llama"),
      toneCard("ElevenLabs", Boolean(data.elevenLabsConfigured), "TTS"),
      toneCard("Cal.com keys", Boolean(data.calcomConfigured), "live slots on Calendar tab"),
    );
  } catch {
    host.replaceChildren(toneCard("API", false, "Could not load /demo/status"));
  }
}

async function refreshSystems() {
  const host = document.getElementById("system-cards");
  const meta = document.getElementById("systems-meta");
  if (!host) return;
  let data = {};
  let cal = {};
  try {
    data = await loadStatus();
  } catch {
    data = {};
  }
  try {
    cal = await (await fetch("/demo/calendar")).json();
  } catch {
    cal = { ok: false, error: "calendar_unreachable" };
  }
  const g = data.gateway || {};
  host.replaceChildren(
    toneCard("API", true, "this console"),
    toneCard("Gateway", Boolean(g.reachable), g.reachable ? (g.status || "ok") + (g.architecture ? " · " + g.architecture : "") : (g.error || "offline")),
    toneCard("Public URL", Boolean(data.publicBaseUrlConfigured), data.publicBaseUrlConfigured ? "ngrok / host set" : "set PUBLIC_BASE_URL to the gateway"),
    toneCard("Twilio", Boolean(data.twilioConfigured), data.labFrom || ""),
    toneCard("Groq", Boolean(data.groqConfigured)),
    toneCard("ElevenLabs", Boolean(data.elevenLabsConfigured)),
    toneCard("Cal.com live", Boolean(cal.ok), cal.ok ? cal.slotCount + " slots · " + (cal.usernameMasked || "") : (cal.error || "not configured"), Boolean(cal.configured && !cal.ok)),
    toneCard("Stripe keys", Boolean(data.stripeConfigured), "webhook only — brain never sees keys", !data.stripeConfigured),
    toneCard("Pakistan geo", Boolean(data.pakistanDialingEnabled), data.geoNote || "", data.pakistanDialingEnabled !== true),
  );
  if (data.labFromIsLiveSalon) {
    meta.textContent = "Lab From is the live UK salon number. Inbound salon routing is unchanged; do not cut this number over to /twiml.";
  } else {
    meta.textContent = cal.probedAt ? "Cal.com probed at " + cal.probedAt : "";
  }
}

async function refreshCalendar() {
  const meta = document.getElementById("calendar-meta");
  const list = document.getElementById("calendar-slots");
  const slug = document.getElementById("event-slug")?.value || "15min";
  if (!meta || !list) return;
  meta.textContent = "Probing Cal.com…";
  list.replaceChildren();
  try {
    const data = await (await fetch("/demo/calendar?eventTypeSlug=" + encodeURIComponent(slug))).json();
    if (data.apiKey || data.credentialRef || data.CALCOM_API_KEY) {
      meta.textContent = "Refusing to render — payload looked like it contained a secret.";
      return;
    }
    meta.textContent =
      (data.ok ? "Live" : "Failed") +
      " · " + (data.usernameMasked || "no username") +
      " · slug " + (data.eventTypeSlug || slug) +
      " · " + (data.slotCount ?? 0) + " slots" +
      (data.probedAt ? " · " + data.probedAt : "") +
      (data.error ? " · " + data.error : "");
    if (!data.nextSlots || !data.nextSlots.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No slots in the next 7 days (or probe failed).";
      list.appendChild(p);
      return;
    }
    for (const start of data.nextSlots) {
      const div = document.createElement("div");
      div.className = "slot";
      div.textContent = start;
      list.appendChild(div);
    }
  } catch {
    meta.textContent = "Could not reach /demo/calendar";
  }
}

async function refreshLabStatus() {
  const flags = document.getElementById("flags");
  if (!flags) return;
  try {
    const data = await loadStatus();
    flags.replaceChildren(
      flag("Twilio", data.twilioConfigured),
      flag("Lab From set", Boolean(data.labFrom)),
      flag("Public gateway URL", data.publicBaseUrlConfigured),
      flag("Groq", data.groqConfigured),
      flag("ElevenLabs", data.elevenLabsConfigured),
      flag("Cal.com", data.calcomConfigured),
      flag("Pakistan geo (Twilio)", data.pakistanDialingEnabled),
      flag("Demo tenant", data.demoTenantReady),
      flag("Outbound feature", data.outboundEnabled),
    );
    document.getElementById("geo-note").textContent = data.geoNote || "";
    document.getElementById("lab-from").textContent = data.labFrom
      ? "Lab From " + data.labFrom + (data.labFromIsLiveSalon ? " (existing UK number; inbound salon routing unchanged)" : "")
      : "";
    const g = data.gateway || {};
    document.getElementById("gateway-line").textContent = g.reachable
      ? "Gateway health: " + (g.status || "ok") + (g.architecture ? " · " + g.architecture : "")
      : "Gateway health unreachable (" + (g.error || "offline") + "). PUBLIC_BASE_URL must be ngrok to the voice-gateway :8080.";
  } catch {
    flags.replaceChildren(flag("API", false));
  }
  try {
    document.getElementById("twilio-check").textContent = JSON.stringify(await (await fetch("/demo/twilio-check")).json(), null, 2);
  } catch {
    document.getElementById("twilio-check").textContent = "Could not load /demo/twilio-check";
  }
}

function renderCall(call) {
  renderCallInto(call, document.getElementById("call-meta"), document.getElementById("transcript"), document.getElementById("tools"));
}

async function pollCall() {
  if (!activeSid) return;
  try {
    const res = await fetch("/demo/calls?sid=" + encodeURIComponent(activeSid));
    if (res.status === 404) {
      document.getElementById("call-meta").textContent = "Waiting for the gateway to open the media stream… sid " + activeSid;
      return;
    }
    const data = await res.json();
    if (data.ok && data.call) renderCall(data.call);
  } catch {
    /* keep polling */
  }
}

function watchSid(sid) {
  activeSid = sid;
  document.getElementById("sid-line").textContent = sid ? "Twilio sid " + sid : "";
  if (pollTimer) clearInterval(pollTimer);
  pollCall();
  pollTimer = setInterval(pollCall, 1500);
}

async function refreshActivity() {
  const host = document.getElementById("activity-table");
  if (!host) return;
  try {
    const data = await (await fetch("/demo/calls?limit=12")).json();
    const calls = data.calls || [];
    if (!calls.length) {
      host.textContent = "No demo calls stored yet. Place one from Test Lab.";
      return;
    }
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>When</th><th>Status</th><th>Direction</th><th>Phone</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const call of calls) {
      const tr = document.createElement("tr");
      tr.className = "clickable";
      tr.innerHTML =
        "<td>" + (call.updatedAt || call.createdAt || "") + "</td>" +
        "<td>" + (call.status || "") + (call.outcome ? " · " + call.outcome : "") + "</td>" +
        "<td>" + (call.direction || "") + "</td>" +
        "<td>" + (call.contactPhone || call.twilioCallSid || call.id) + "</td>";
      tr.addEventListener("click", () => {
        renderCallInto(
          call,
          document.getElementById("activity-meta"),
          document.getElementById("activity-transcript"),
          document.getElementById("activity-tools"),
        );
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    host.replaceChildren(table);
  } catch {
    host.textContent = "Could not load /demo/calls";
  }
}

function setAdminStatus(text, isErr) {
  const el = document.getElementById("admin-status");
  if (!el) return;
  el.className = isErr ? "err" : "muted";
  el.textContent = text;
}

async function refreshOperator() {
  const list = document.getElementById("clients-list");
  const jobsHost = document.getElementById("jobs-list");
  if (!list) return;
  const clientsRes = await api("/clients");
  if (clientsRes.status === 401) {
    list.textContent = "Unauthorized. Save ADMIN_API_KEY above.";
    jobsHost.textContent = "";
    setAdminStatus("Admin key required on this host.", true);
    return;
  }
  if (!clientsRes.ok) {
    list.textContent = "Failed to load clients (" + clientsRes.status + ")";
    return;
  }
  setAdminStatus("Admin routes reachable.");
  const clients = await clientsRes.json();
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Business</th><th>Status</th><th>Published</th><th>Access</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const c of clients) {
    const tr = document.createElement("tr");
    tr.className = "clickable";
    const inbound = c.access?.inbound ? "in" : "";
    const outbound = c.access?.outbound ? "out" : "";
    tr.innerHTML =
      "<td>" + c.businessName + "<div class=\"muted\">" + c.slug + "</div></td>" +
      "<td>" + c.serviceStatus + "</td>" +
      "<td>" + (c.published ? "yes" : "no") + "</td>" +
      "<td>" + [inbound, outbound].filter(Boolean).join(" · ") + "</td>";
    tr.addEventListener("click", () => loadUsage(c.id, c.businessName));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  list.replaceChildren(table);

  const jobsRes = await api("/jobs");
  if (!jobsRes.ok) {
    jobsHost.textContent = "Could not load jobs (" + jobsRes.status + ")";
    return;
  }
  const jobs = await jobsRes.json();
  if (!jobs.length) {
    jobsHost.textContent = "No outbound jobs queued.";
    return;
  }
  const jt = document.createElement("table");
  jt.innerHTML = "<thead><tr><th>Job</th><th>Campaign</th><th>Status</th><th></th></tr></thead>";
  const jb = document.createElement("tbody");
  for (const job of jobs) {
    const tr = document.createElement("tr");
    const btn = job.approved
      ? ""
      : "<button type=\"button\" class=\"ghost\" data-approve=\"" + job.id + "\">Approve</button>";
    tr.innerHTML =
      "<td>" + (job.contactName || job.contactPhone) + "<div class=\"muted\">" + job.id + "</div></td>" +
      "<td>" + job.campaign + "</td>" +
      "<td>" + job.status + (job.approved ? " · approved" : "") + "</td>" +
      "<td>" + btn + "</td>";
    jb.appendChild(tr);
  }
  jt.appendChild(jb);
  jobsHost.replaceChildren(jt);
  jobsHost.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-approve");
      const res = await api("/jobs/" + encodeURIComponent(id) + "/approve", { method: "POST" });
      if (!res.ok) {
        setAdminStatus("Approve failed (" + res.status + ")", true);
        return;
      }
      refreshOperator();
    });
  });
}

async function loadUsage(clientId, name) {
  document.getElementById("usage-meta").textContent = name + " · " + clientId;
  const res = await api("/clients/" + encodeURIComponent(clientId) + "/usage");
  const detail = await api("/clients/" + encodeURIComponent(clientId));
  const usage = res.ok ? await res.json() : { error: res.status };
  const client = detail.ok ? await detail.json() : {};
  const blob = JSON.stringify({ usage, client }, null, 2);
  if (/credentialRef|apiKey|CALCOM_API_KEY/.test(JSON.stringify(client))) {
    document.getElementById("usage-json").textContent = JSON.stringify({ usage, client: { id: client.id, warning: "stripped_credentials" } }, null, 2);
    return;
  }
  document.getElementById("usage-json").textContent = blob;
}

document.querySelectorAll("nav.tabs [data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.getAttribute("data-tab")));
});

document.getElementById("calendar-refresh")?.addEventListener("click", refreshCalendar);

const form = document.getElementById("demo-form");
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("status");
  const button = form.querySelector("button");
  status.className = "";
  status.textContent = "Calling you now…";
  button.disabled = true;
  try {
    const res = await fetch("/demo/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: document.getElementById("phone").value }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      status.className = "err";
      status.textContent = data.error || "Call failed";
    } else {
      status.className = "ok";
      status.textContent = "Calling you now…";
      watchSid(data.callSid);
    }
  } catch {
    status.className = "err";
    status.textContent = "Could not reach the demo API";
  } finally {
    button.disabled = false;
  }
});

document.getElementById("admin-save")?.addEventListener("click", () => {
  const value = document.getElementById("admin-key").value.trim();
  if (value) sessionStorage.setItem(KEY_STORAGE, value);
  else sessionStorage.removeItem(KEY_STORAGE);
  refreshOperator();
});

const saved = sessionStorage.getItem(KEY_STORAGE);
if (saved) document.getElementById("admin-key").value = saved;

showTab(initialTab());
setInterval(() => {
  const lab = document.getElementById("panel-lab");
  if (lab?.classList.contains("active")) refreshLabStatus();
}, 8000);
