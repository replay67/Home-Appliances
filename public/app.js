'use strict';

/* ============================================================
 * HausPlan – Haushalt & Homeoffice gemeinsam organisieren
 *
 * Mit Server (server.js): alle Personen sehen und bearbeiten
 * dieselben Daten, Änderungen erscheinen sofort überall.
 * Ohne Server (statisch geöffnet): Daten nur auf diesem Gerät.
 * ============================================================ */

const { today, fromISO, addDays, diffDays, uid } = HP;

const LOCAL_KEY = 'hausplan.v1';
const ME_KEY = 'hausplan.me';

const RECURRENCE_LABELS = {
  none: 'Einmalig', daily: 'Täglich', weekdays: 'Werktags', weekly: 'Wöchentlich',
  biweekly: 'Alle 2 Wochen', monthly: 'Monatlich', custom: 'Alle {n} Tage',
};
const CATEGORY_LABELS = { haushalt: '🧹 Haushalt', homeoffice: '💻 Homeoffice' };
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const PALETTE = ['#2f6f5e', '#c0713b', '#4a62a8', '#a8457a', '#7a8a2f', '#6a4fb0', '#2f7f9e', '#9e5b2f'];

/* ---------- Zustand ---------- */

let state = null;
let ready = false; // erst nach Anmeldung bzw. Laden der Daten
let mode = 'local'; // 'server' | 'local'
let connection = 'connecting'; // 'live' | 'offline' | 'connecting'
const clientId = uid();
const ui = { view: 'today', category: 'all', member: 'all', editingId: null };
let pending = 0;
let queuedServerState = null;
let forceNextState = false;

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignorieren */ } },
};
const getMe = () => storage.get(ME_KEY);

/* ---------- Helfer ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const member = (id) => state.members.find((m) => m.id === id);
const memberName = (id) => member(id)?.name || 'Jemand';

function formatDate(iso) {
  const diff = diffDays(iso, today());
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  const d = fromISO(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}
function startOfWeek(iso) {
  const d = fromISO(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}
function timeAgo(isoTime) {
  const s = (Date.now() - new Date(isoTime)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  const d = new Date(isoTime);
  return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function avatarHTML(id) {
  const m = member(id);
  return m ? `<span class="avatar"><i style="background:${esc(m.color)}"></i>${esc(m.name)}</span>` : '';
}

function visibleTasks() {
  return state.tasks.filter((t) =>
    (ui.category === 'all' || t.category === ui.category) &&
    (ui.member === 'all' || t.assignee === ui.member || (ui.member === 'none' && !t.assignee)));
}
function sortTasks(list) {
  return list.slice().sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) || (b.priority - a.priority) || a.title.localeCompare(b.title, 'de'));
}
const recurrenceLabel = (t) => RECURRENCE_LABELS[t.recurrence].replace('{n}', t.interval);

/* ---------- Server-Verbindung ---------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  return { ok: res.ok, status: res.status, data };
}

function setConnection(c) {
  connection = c;
  renderStatus();
}

function acceptServerState(s) {
  if (pending > 0) { queuedServerState = s; return; }
  if (state && s.version < state.version && mode === 'server' && connection === 'live') return;
  state = s;
  render();
}

let events;
function connectEvents() {
  if (events) events.close();
  events = new EventSource('api/events');
  events.onopen = () => setConnection('live');
  events.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.state) acceptServerState(msg.state);
    if (msg.event && msg.event.clientId !== clientId) {
      showToast(`${memberName(msg.event.by)} ${msg.event.text}`);
    }
  };
  events.onerror = async () => {
    setConnection('offline');
    // Abgelaufene Anmeldung? Dann Login zeigen statt endlos neu zu verbinden.
    try {
      const r = await api('api/session');
      if (r.ok && r.data.authRequired && !r.data.authenticated) { events.close(); showLogin(); }
    } catch { /* Server weg – EventSource versucht es selbst erneut */ }
  };
}

/* Jede Änderung läuft hierüber: sofort lokal anzeigen, dann an den Server. */
async function dispatch(op) {
  op = { ...op, by: getMe(), date: today(), clientId };
  const backup = structuredClone(state);
  try {
    HP.applyOp(state, op, new Date().toISOString());
  } catch (e) {
    showToast(e.message || 'Aktion nicht möglich');
    return false;
  }
  render();

  if (mode === 'local') {
    storage.set(LOCAL_KEY, JSON.stringify(state));
    return true;
  }

  pending++;
  try {
    const r = await api('api/ops', { method: 'POST', body: op });
    if (r.ok) {
      queuedServerState = r.data.state;
      return true;
    }
    if (r.status === 401) { showLogin(); }
    showToast(r.data?.error || 'Änderung wurde nicht gespeichert.');
    // Fehlgeschlagen: verbindlichen Stand übernehmen, lokale Änderung verwerfen
    forceNextState = true;
    queuedServerState = r.data?.state || backup;
    return false;
  } catch {
    showToast('Keine Verbindung zum Server – Änderung nicht gespeichert.');
    forceNextState = true;
    queuedServerState = backup;
    return false;
  } finally {
    pending--;
    if (pending === 0 && queuedServerState) {
      const s = queuedServerState;
      queuedServerState = null;
      if (forceNextState || s.version >= (state?.version || 0)) state = s;
      forceNextState = false;
      render();
    }
  }
}

/* ---------- Aktionen ---------- */

async function completeTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const logId = uid();
  if (!(await dispatch({ type: 'task.complete', id, logId }))) return;
  const after = state.tasks.find((x) => x.id === id);
  const next = after && !after.done && after.recurrence !== 'none' ? ` – nächstes Mal ${formatDate(after.dueDate)}` : '';
  showToast(`„${t.title}“ erledigt${next}`, () => dispatch({ type: 'task.uncomplete', logId }));
}

async function postpone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const prev = t.dueDate;
  if (!(await dispatch({ type: 'task.postpone', id, days: 1 }))) return;
  const after = state.tasks.find((x) => x.id === id);
  showToast(`„${t.title}“ auf ${formatDate(after?.dueDate || prev)} verschoben`,
    () => dispatch({ type: 'task.update', id, fields: { dueDate: prev } }));
}

/* ---------- Toast ---------- */

let toastTimer;
function showToast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Rückgängig</button>' : ''}`;
  el.hidden = false;
  if (undo) el.querySelector('button').onclick = () => { el.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

/* ---------- Rendering ---------- */

function taskHTML(t, { showDate = true } = {}) {
  const t0 = today();
  const late = !t.done && t.dueDate < t0;
  const meta = [];
  if (showDate || late) {
    const lateDays = diffDays(t0, t.dueDate);
    meta.push(late
      ? `<span class="late">überfällig seit ${lateDays} ${lateDays === 1 ? 'Tag' : 'Tagen'}</span>`
      : `<span>📅 ${esc(formatDate(t.dueDate))}</span>`);
  }
  if (t.recurrence !== 'none') meta.push(`<span>🔁 ${esc(recurrenceLabel(t))}</span>`);
  if (t.area) meta.push(`<span>📍 ${esc(t.area)}</span>`);
  if (t.duration) meta.push(`<span>⏱ ${esc(t.duration)} min</span>`);
  meta.push(t.assignee && member(t.assignee) ? avatarHTML(t.assignee) : '<span>👥 Wer Zeit hat</span>');

  return `
    <li class="task ${esc(t.category)} prio-${esc(t.priority)} ${t.done ? 'done' : ''} ${t.assignee && t.assignee === getMe() ? 'mine' : ''}" data-id="${esc(t.id)}">
      <button class="check" data-action="${t.done ? 'reopen' : 'complete'}" aria-label="${t.done ? 'Wieder öffnen' : 'Erledigt'}">${t.done ? '✓' : ''}</button>
      <div class="task-body" data-action="edit">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">${meta.join('')}</div>
      </div>
      ${!t.done ? '<button class="btn small" data-action="postpone" title="Auf morgen verschieben">+1 Tag</button>' : ''}
    </li>`;
}
const listHTML = (tasks, opts) => `<ul class="task-list">${tasks.map((t) => taskHTML(t, opts)).join('')}</ul>`;
const emptyHTML = (icon, text) => `<div class="empty"><span class="big">${icon}</span>${text}</div>`;
const sectionHTML = (title, count, cls = '') => `<div class="section-title ${cls}"><span>${title}</span><span>${count}</span></div>`;

function renderToday() {
  const t0 = today();
  const open = sortTasks(visibleTasks().filter((t) => !t.done));
  const overdue = open.filter((t) => t.dueDate < t0);
  const due = open.filter((t) => t.dueDate === t0);
  const doneToday = state.log.filter((l) => l.date === t0 &&
    (ui.category === 'all' || l.category === ui.category) &&
    (ui.member === 'all' || l.assignee === ui.member || l.by === ui.member));

  const total = overdue.length + due.length + doneToday.length;
  const pct = total ? Math.round((doneToday.length / total) * 100) : 100;
  const minutes = [...overdue, ...due].reduce((s, t) => s + (Number(t.duration) || 0), 0);
  const d = new Date();

  let html = `
    <div class="progress">
      <div class="progress-head">
        <strong>${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.</strong>
        <span>${doneToday.length} von ${total} erledigt${minutes ? ` · noch ca. ${minutes} min` : ''}</span>
      </div>
      <div class="progress-bar"><span style="width:${pct}%"></span></div>
    </div>`;

  if (overdue.length) html += sectionHTML('Überfällig', overdue.length, 'overdue') + listHTML(overdue, { showDate: false });
  if (due.length) html += sectionHTML('Heute fällig', due.length) + listHTML(due, { showDate: false });
  if (!overdue.length && !due.length) html += emptyHTML('🎉', 'Alles erledigt für heute!');

  if (doneToday.length) {
    html += sectionHTML('Heute erledigt', doneToday.length) + `<ul class="task-list">${doneToday.map((l) => `
      <li class="task ${esc(l.category)} done"><span class="check">✓</span>
        <div class="task-body"><div class="task-title">${esc(l.title)}</div>
        <div class="task-meta">${l.by ? `<span>✓ von</span>${avatarHTML(l.by)}` : avatarHTML(l.assignee)}</div></div>
        <button class="btn small" data-undo="${esc(l.id)}">Rückgängig</button></li>`).join('')}</ul>`;
  }
  return html;
}

function renderWeek() {
  const t0 = today();
  const open = sortTasks(visibleTasks().filter((t) => !t.done));
  let html = '';
  const overdue = open.filter((t) => t.dueDate < t0);
  if (overdue.length) html += sectionHTML('Überfällig', overdue.length, 'overdue') + listHTML(overdue, { showDate: false });

  for (let i = 0; i < 7; i++) {
    const day = addDays(t0, i);
    const items = open.filter((t) => t.dueDate === day);
    const d = fromISO(day);
    const label = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WEEKDAYS_LONG[d.getDay()];
    const minutes = items.reduce((s, t) => s + (Number(t.duration) || 0), 0);
    html += sectionHTML(`${label} · ${d.getDate()}.${d.getMonth() + 1}.`, items.length ? `${items.length}${minutes ? ` · ${minutes} min` : ''}` : '–');
    if (items.length) html += listHTML(items, { showDate: false });
  }
  const later = open.filter((t) => t.dueDate > addDays(t0, 6));
  if (later.length) html += sectionHTML('Später', later.length) + listHTML(later);
  return html;
}

function renderAll() {
  const tasks = visibleTasks();
  if (!tasks.length) return emptyHTML('📝', 'Noch keine Aufgaben. Tippe auf „＋ Aufgabe“.');
  const open = sortTasks(tasks.filter((t) => !t.done));
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

  const groups = new Map();
  for (const t of open) {
    const key = `${CATEGORY_LABELS[t.category]} · ${t.area || 'Allgemein'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  let html = '';
  for (const [key, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
    html += sectionHTML(esc(key), list.length) + listHTML(list);
  }
  if (done.length) html += sectionHTML('Abgeschlossen', done.length) + listHTML(done);
  return html;
}

function renderStats() {
  const t0 = today();
  const weekStart = startOfWeek(t0);
  const monthAgo = addDays(t0, -29);
  const inWeek = state.log.filter((l) => l.date >= weekStart);
  const inMonth = state.log.filter((l) => l.date >= monthAgo);
  const minutesWeek = inWeek.reduce((s, l) => s + (Number(l.duration) || 0), 0);
  const overdue = state.tasks.filter((t) => !t.done && t.dueDate < t0).length;

  const days = new Set(state.log.map((l) => l.date));
  let streak = 0;
  let cursor = days.has(t0) ? t0 : addDays(t0, -1);
  while (days.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  const bars = (entries, keyFn, labelFn, colorFn, valueFn = () => 1, unit = '') => {
    const counts = new Map();
    for (const e of entries) counts.set(keyFn(e), (counts.get(keyFn(e)) || 0) + valueFn(e));
    const max = Math.max(1, ...counts.values());
    if (!counts.size) return '<p class="muted">Noch keine Daten – erledigt ein paar Aufgaben.</p>';
    return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `
      <div class="bar-row"><span>${esc(labelFn(k))}</span>
        <div class="track"><div class="fill" style="width:${(n / max) * 100}%;background:${esc(colorFn(k))}"></div></div>
        <span class="num">${n}${unit}</span></div>`).join('');
  };
  const who = (l) => l.by || l.assignee || 'none';

  const activity = state.activity.slice(-30).reverse();

  return `
    <div class="stat-grid">
      <div class="stat"><b>${inWeek.length}</b><span>erledigt diese Woche</span></div>
      <div class="stat"><b>${(minutesWeek / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h</b><span>Zeit diese Woche</span></div>
      <div class="stat"><b>${streak} 🔥</b><span>Tage in Folge aktiv</span></div>
      <div class="stat"><b>${overdue}</b><span>überfällig</span></div>
    </div>
    <div class="card"><h3>Wer hat wie viel erledigt? (letzte 30 Tage)</h3>
      ${bars(inMonth, who, (k) => member(k)?.name || 'Unbekannt', (k) => member(k)?.color || 'var(--muted)')}
    </div>
    <div class="card"><h3>Zeitaufwand pro Person (letzte 30 Tage)</h3>
      ${bars(inMonth.filter((l) => l.duration), who, (k) => member(k)?.name || 'Unbekannt', (k) => member(k)?.color || 'var(--muted)', (l) => l.duration, ' min')}
    </div>
    <div class="card"><h3>Nach Bereich (letzte 30 Tage)</h3>
      ${bars(inMonth, (l) => l.category, (k) => CATEGORY_LABELS[k] || k, (k) => `var(--${k})`)}
    </div>
    <div class="card"><h3>Verlauf – wer hat was gemacht?</h3>
      ${activity.length ? `<ul class="activity">${activity.map((a) => `
        <li><span class="dot" style="background:${esc(member(a.by)?.color || 'var(--muted)')}"></span>
          <span><b>${esc(memberName(a.by))}</b> ${esc(a.text)}</span>
          <time>${esc(timeAgo(a.at))}</time></li>`).join('')}</ul>`
        : '<p class="muted">Noch keine Einträge.</p>'}
    </div>`;
}

function renderSettings() {
  const me = getMe();
  return `
    <div class="card">
      <h3>Haushaltsmitglieder</h3>
      <p class="muted">Alle hier eingetragenen Personen können Aufgaben übernehmen. Jede Person wählt auf dem eigenen Gerät oben rechts aus, wer sie ist.</p>
      <div id="memberList">
        ${state.members.map((m) => `
          <div class="member-row" data-member="${esc(m.id)}">
            <input type="color" value="${esc(m.color)}" data-field="color" aria-label="Farbe">
            <input type="text" value="${esc(m.name)}" data-field="name" maxlength="30" aria-label="Name">
            ${m.id === me ? '<span class="tag">Du</span>' : ''}
            <button class="btn small danger" data-remove-member="${esc(m.id)}">Entfernen</button>
          </div>`).join('')}
      </div>
      <form class="inline-form" id="addMemberForm">
        <input name="name" placeholder="Neue Person" maxlength="30" required>
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>
    </div>
    <div class="card">
      <h3>Gemeinsam nutzen</h3>
      ${mode === 'server'
        ? `<p class="muted" style="margin-bottom:0">✅ Diese App ist mit dem HausPlan-Server verbunden. Alle, die diese Adresse öffnen, sehen und bearbeiten dieselben Aufgaben – Änderungen erscheinen sofort auf allen Geräten.</p>
           <p style="margin-bottom:0"><code>${esc(location.origin + location.pathname)}</code></p>`
        : `<p class="muted" style="margin-bottom:0">📱 Die App läuft gerade ohne Server – die Daten liegen nur auf diesem Gerät. Damit mehrere Personen gemeinsam planen können, starte den HausPlan-Server (<code>npm start</code>, siehe README) und öffne die App über dessen Adresse.</p>`}
    </div>
    <div class="card">
      <h3>Daten</h3>
      <p class="muted">Sicherung herunterladen oder eine Sicherung wiederherstellen${mode === 'server' ? ' (betrifft alle Personen)' : ''}.</p>
      <div class="btn-row">
        <button class="btn" id="exportBtn">⬇ Exportieren</button>
        <label class="btn">⬆ Importieren<input type="file" id="importInput" accept="application/json" hidden></label>
        <button class="btn danger" id="resetBtn">Alles zurücksetzen</button>
        ${mode === 'server' && authRequired ? '<button class="btn" id="logoutBtn">Abmelden</button>' : ''}
      </div>
    </div>`;
}

function renderStatus() {
  const el = $('#syncStatus');
  if (!el) return;
  const map = {
    local: ['local', 'Nur dieses Gerät'],
    live: ['live', 'Live – gemeinsam'],
    offline: ['offline', 'Offline – verbinde …'],
    connecting: ['offline', 'Verbinde …'],
  };
  const [cls, label] = mode === 'local' ? map.local : map[connection];
  el.className = `sync ${cls}`;
  el.title = label;
  el.querySelector('span').textContent = label;
}

function renderMeButton() {
  const m = member(getMe());
  $('#meBtn').innerHTML = m
    ? `<i style="background:${esc(m.color)}"></i>${esc(m.name)}`
    : 'Wer bist du?';
}

function render() {
  if (!state) return;
  if (ready && !member(getMe())) showIdentity();

  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  $('#filters').hidden = ['settings', 'stats'].includes(ui.view);
  document.querySelectorAll('#categoryFilter .chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === ui.category));

  const me = getMe();
  const mf = $('#memberFilter');
  mf.innerHTML = `<option value="all">Alle Personen</option>${member(me) ? `<option value="${esc(me)}">⭐ Meine Aufgaben</option>` : ''}${
    state.members.filter((m) => m.id !== me).map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')
  }<option value="none">👥 Nicht zugewiesen</option>`;
  if (![...mf.options].some((o) => o.value === ui.member)) ui.member = 'all';
  mf.value = ui.member;

  renderMeButton();
  renderStatus();

  // Eingaben in den Einstellungen nicht durch Live-Updates zerstören
  const active = document.activeElement;
  if (ui.view === 'settings' && active && $('#view').contains(active) && active.matches('input[type=text], input[name=name]')) return;

  const views = { today: renderToday, week: renderWeek, all: renderAll, stats: renderStats, settings: renderSettings };
  $('#view').innerHTML = views[ui.view]();

  // Offenen Bearbeiten-Dialog schließen, falls jemand anders die Aufgabe gelöscht hat
  if (dialog.open && ui.editingId && !state.tasks.some((t) => t.id === ui.editingId)) {
    dialog.close();
    showToast('Diese Aufgabe wurde inzwischen gelöscht.');
  }
}

/* ---------- Anmeldung & Identität ---------- */

let authRequired = false;

function showLogin() {
  const d = $('#loginDialog');
  if (!d.open) d.showModal();
  $('#loginForm').code.focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = e.target.code.value;
  $('#loginError').hidden = true;
  try {
    const r = await api('api/login', { method: 'POST', body: { code } });
    if (!r.ok) {
      $('#loginError').textContent = r.data?.error || 'Anmeldung fehlgeschlagen.';
      $('#loginError').hidden = false;
      return;
    }
    $('#loginDialog').close();
    e.target.reset();
    await startServerMode();
  } catch {
    $('#loginError').textContent = 'Server nicht erreichbar.';
    $('#loginError').hidden = false;
  }
});
$('#loginDialog').addEventListener('cancel', (e) => e.preventDefault());

function showIdentity() {
  const d = $('#identityDialog');
  const me = getMe();
  $('#identityList').innerHTML = state.members.map((m) => `
    <button type="button" class="person ${m.id === me ? 'active' : ''}" data-pick="${esc(m.id)}">
      <i style="background:${esc(m.color)}"></i>${esc(m.name)}</button>`).join('');
  $('#identityCancel').hidden = !member(me);
  $('#identityList').hidden = !state.members.length;
  if (!d.open) d.showModal();
}

$('#identityList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  storage.set(ME_KEY, b.dataset.pick);
  $('#identityDialog').close();
  ui.member = 'all';
  render();
});
$('#identityForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  const m = { id: uid(), name, color: PALETTE[state.members.length % PALETTE.length] };
  storage.set(ME_KEY, m.id);
  e.target.reset();
  $('#identityDialog').close();
  if (!(await dispatch({ type: 'member.add', member: m }))) storage.set(ME_KEY, '');
});
$('#identityCancel').addEventListener('click', () => $('#identityDialog').close());
$('#identityDialog').addEventListener('cancel', (e) => { if (!member(getMe())) e.preventDefault(); });
$('#meBtn').addEventListener('click', showIdentity);

/* ---------- Aufgaben-Dialog ---------- */

const dialog = $('#taskDialog');
const form = $('#taskForm');

function openDialog(task) {
  ui.editingId = task?.id || null;
  $('#dialogTitle').textContent = task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe';
  $('#deleteTaskBtn').hidden = !task;

  form.assignee.innerHTML = `<option value="">👥 Wer Zeit hat</option>${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}`;
  const areas = [...new Set(state.tasks.map((t) => t.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  $('#areaList').innerHTML = areas.map((a) => `<option value="${esc(a)}">`).join('');

  const defaults = {
    title: '', category: ui.category === 'homeoffice' ? 'homeoffice' : 'haushalt', area: '',
    assignee: ui.member !== 'all' && ui.member !== 'none' ? ui.member : (getMe() || ''),
    priority: 2, dueDate: today(), recurrence: 'none', interval: 3, duration: '', notes: '',
  };
  const data = { ...defaults, ...(task || {}) };
  for (const key of Object.keys(defaults)) form[key].value = data[key] ?? '';
  $('#customIntervalWrap').hidden = form.recurrence.value !== 'custom';

  const info = $('#taskInfo');
  if (task?.createdBy && member(task.createdBy)) {
    info.textContent = `Angelegt von ${memberName(task.createdBy)} am ${fromISO(task.createdAt).toLocaleDateString('de-DE')}`;
    info.hidden = false;
  } else info.hidden = true;

  dialog.showModal();
  if (!task) form.title.focus();
}

form.recurrence.addEventListener('change', () => {
  $('#customIntervalWrap').hidden = form.recurrence.value !== 'custom';
});
$('#cancelBtn').addEventListener('click', () => dialog.close());

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const fields = {
    title: fd.get('title').trim(),
    category: fd.get('category'),
    area: fd.get('area').trim(),
    assignee: fd.get('assignee') || null,
    priority: Number(fd.get('priority')),
    dueDate: fd.get('dueDate') || today(),
    recurrence: fd.get('recurrence'),
    interval: Number(fd.get('interval')) || 1,
    duration: Number(fd.get('duration')) || null,
    notes: fd.get('notes').trim(),
  };
  if (!fields.title) return;
  dialog.close();
  if (ui.editingId) dispatch({ type: 'task.update', id: ui.editingId, fields });
  else dispatch({ type: 'task.add', task: { id: uid(), ...fields } });
});

$('#deleteTaskBtn').addEventListener('click', async () => {
  const index = state.tasks.findIndex((t) => t.id === ui.editingId);
  if (index < 0) return;
  const task = structuredClone(state.tasks[index]);
  dialog.close();
  if (await dispatch({ type: 'task.delete', id: task.id })) {
    showToast(`„${task.title}“ gelöscht`, () => dispatch({ type: 'task.restore', task, index }));
  }
});

/* ---------- Events ---------- */

$('#addBtn').addEventListener('click', () => openDialog());

$('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  ui.view = b.dataset.view;
  render();
});
$('#categoryFilter').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  ui.category = c.dataset.cat;
  render();
});
$('#memberFilter').addEventListener('change', (e) => { ui.member = e.target.value; render(); });

$('#view').addEventListener('click', async (e) => {
  const undoBtn = e.target.closest('[data-undo]');
  if (undoBtn) return dispatch({ type: 'task.uncomplete', logId: undoBtn.dataset.undo });

  const removeBtn = e.target.closest('[data-remove-member]');
  if (removeBtn) {
    const m = member(removeBtn.dataset.removeMember);
    if (m && confirm(`${m.name} entfernen? Zugewiesene Aufgaben werden auf „Wer Zeit hat“ gesetzt.`)) {
      dispatch({ type: 'member.remove', id: m.id });
    }
    return;
  }

  if (e.target.id === 'exportBtn') {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hausplan-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  if (e.target.id === 'resetBtn') {
    const who = mode === 'server' ? ' – für ALLE Personen' : '';
    if (confirm(`Wirklich alle Aufgaben, Personen und den Verlauf löschen und mit Beispieldaten neu starten${who}?`)) {
      await dispatch({ type: 'state.reset' });
      showIdentity();
    }
    return;
  }
  if (e.target.id === 'logoutBtn') {
    await api('api/logout', { method: 'POST' });
    if (events) events.close();
    location.reload();
    return;
  }

  const el = e.target.closest('[data-action]');
  const li = e.target.closest('.task[data-id]');
  if (!el || !li) return;
  const id = li.dataset.id;
  const action = el.dataset.action;
  if (action === 'complete') completeTask(id);
  else if (action === 'reopen') dispatch({ type: 'task.reopen', id });
  else if (action === 'postpone') postpone(id);
  else if (action === 'edit') openDialog(state.tasks.find((t) => t.id === id));
});

$('#view').addEventListener('change', async (e) => {
  if (e.target.id === 'importInput') {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = HP.sanitizeState(JSON.parse(await file.text()));
      if (mode === 'server' && !confirm('Import ersetzt die Daten für alle Personen. Fortfahren?')) return;
      if (await dispatch({ type: 'state.import', data })) showToast('Daten importiert');
    } catch {
      showToast('Import fehlgeschlagen – ungültige Datei');
    }
    return;
  }
  const row = e.target.closest('[data-member]');
  const field = e.target.dataset.field;
  if (row && field) {
    const value = field === 'name' ? e.target.value.trim() : e.target.value;
    if (value) dispatch({ type: 'member.update', id: row.dataset.member, fields: { [field]: value } });
  }
});

$('#view').addEventListener('submit', (e) => {
  if (e.target.id !== 'addMemberForm') return;
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  dispatch({ type: 'member.add', member: { id: uid(), name, color: PALETTE[state.members.length % PALETTE.length] } });
});

/* Tageswechsel / App wieder im Vordergrund */
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

/* ---------- Start ---------- */

async function startServerMode() {
  mode = 'server';
  const r = await api('api/state');
  if (r.status === 401) { showLogin(); return; }
  state = r.data;
  ready = true;
  render();
  connectEvents();
}

async function start() {
  let session = null;
  if (location.protocol !== 'file:') {
    try {
      const r = await api('api/session');
      if (r.ok && r.data && 'authRequired' in r.data) session = r.data;
    } catch { /* kein Server */ }
  }

  if (session) {
    authRequired = session.authRequired;
    mode = 'server';
    // Bis zur Anmeldung leeren Zustand zeigen
    state = { version: 0, members: [], tasks: [], log: [], activity: [] };
    render();
    if (session.authRequired && !session.authenticated) showLogin();
    else await startServerMode();
  } else {
    mode = 'local';
    try {
      state = HP.sanitizeState(JSON.parse(storage.get(LOCAL_KEY)));
    } catch {
      state = HP.defaultState();
    }
    ready = true;
    render();
  }
}

start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
