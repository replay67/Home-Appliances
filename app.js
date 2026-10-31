'use strict';

/* ============================================================
 * HausPlan – Haushalt & Homeoffice organisieren
 * Daten werden lokal im Browser (localStorage) gespeichert.
 * ============================================================ */

const STORAGE_KEY = 'hausplan.v1';

const RECURRENCE_LABELS = {
  none: 'Einmalig',
  daily: 'Täglich',
  weekdays: 'Werktags',
  weekly: 'Wöchentlich',
  biweekly: 'Alle 2 Wochen',
  monthly: 'Monatlich',
  custom: 'Alle {n} Tage',
};

const CATEGORY_LABELS = { haushalt: '🧹 Haushalt', homeoffice: '💻 Homeoffice' };
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/* ---------- Datum-Helfer (lokale Zeit, Format YYYY-MM-DD) ---------- */

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function today() { return toISO(new Date()); }
function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function addMonths(iso, n) {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}
function diffDays(a, b) {
  return Math.round((fromISO(a) - fromISO(b)) / 86400000);
}
function formatDate(iso) {
  const t = today();
  const diff = diffDays(iso, t);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  const d = fromISO(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}
function startOfWeek(iso) {
  const d = fromISO(iso);
  const offset = (d.getDay() + 6) % 7; // Montag = 0
  d.setDate(d.getDate() - offset);
  return toISO(d);
}

/* Nächster Termin einer wiederkehrenden Aufgabe, ausgehend von "base". */
function nextDue(task, base) {
  switch (task.recurrence) {
    case 'daily': return addDays(base, 1);
    case 'weekdays': {
      let n = addDays(base, 1);
      while ([0, 6].includes(fromISO(n).getDay())) n = addDays(n, 1);
      return n;
    }
    case 'weekly': return addDays(base, 7);
    case 'biweekly': return addDays(base, 14);
    case 'monthly': return addMonths(base, 1);
    case 'custom': return addDays(base, Math.max(1, Number(task.interval) || 1));
    default: return null;
  }
}

/* ---------- Zustand ---------- */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function defaultState() {
  const t = today();
  const members = [
    { id: 'm1', name: 'Ich', color: '#2f6f5e' },
    { id: 'm2', name: 'Partner:in', color: '#c0713b' },
  ];
  const task = (title, category, area, assignee, recurrence, dueOffset, extra = {}) => ({
    id: uid(), title, category, area, assignee, recurrence,
    interval: 3, priority: 2, duration: null, notes: '',
    dueDate: addDays(t, dueOffset), createdAt: t, ...extra,
  });
  return {
    members,
    tasks: [
      task('Geschirrspüler ausräumen', 'haushalt', 'Küche', 'm1', 'daily', 0, { duration: 10 }),
      task('Bad putzen', 'haushalt', 'Bad', 'm2', 'weekly', 1, { duration: 30 }),
      task('Staubsaugen', 'haushalt', 'Wohnung', 'm1', 'weekly', 2, { duration: 25 }),
      task('Müll rausbringen', 'haushalt', 'Küche', 'm2', 'custom', 0, { interval: 3, duration: 5 }),
      task('Pflanzen gießen', 'haushalt', 'Wohnzimmer', 'm1', 'custom', 1, { interval: 4, duration: 5 }),
      task('Bettwäsche wechseln', 'haushalt', 'Schlafzimmer', 'm2', 'biweekly', 4, { duration: 20 }),
      task('E-Mails & Kalender sichten', 'homeoffice', 'Organisation', 'm1', 'weekdays', 0, { duration: 20, priority: 3 }),
      task('Schreibtisch aufräumen', 'homeoffice', 'Arbeitsplatz', 'm1', 'weekly', 3, { duration: 10 }),
      task('Wochenplanung', 'homeoffice', 'Organisation', 'm1', 'weekly', 5, { duration: 30 }),
      task('Rechnungen ablegen', 'homeoffice', 'Finanzen', 'm2', 'monthly', 6, { duration: 30 }),
    ],
    log: [], // { id, taskId, title, category, assignee, date, prevDue }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.tasks) && Array.isArray(s.members)) {
        s.log = Array.isArray(s.log) ? s.log : [];
        return s;
      }
    }
  } catch (e) { /* Speicher nicht verfügbar – mit Standarddaten weiter */ }
  return defaultState();
}

let state = loadState();
const ui = { view: 'today', category: 'all', member: 'all', editingId: null };

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
}

/* ---------- Helfer ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const member = (id) => state.members.find((m) => m.id === id);

function visibleTasks() {
  return state.tasks.filter((t) =>
    (ui.category === 'all' || t.category === ui.category) &&
    (ui.member === 'all' || t.assignee === ui.member || (ui.member === 'none' && !t.assignee)));
}

function sortTasks(list) {
  return list.slice().sort((a, b) =>
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
    (b.priority - a.priority) ||
    a.title.localeCompare(b.title, 'de'));
}

function recurrenceLabel(t) {
  return RECURRENCE_LABELS[t.recurrence].replace('{n}', t.interval);
}

/* ---------- Aktionen ---------- */

function completeTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.done) return;
  const date = today();
  const entry = { id: uid(), taskId: t.id, title: t.title, category: t.category, assignee: t.assignee, date, prevDue: t.dueDate, duration: t.duration };
  state.log.push(entry);
  if (t.recurrence === 'none') {
    t.done = true;
    t.doneAt = date;
  } else {
    // Ab dem späteren von Fälligkeit und Erledigung neu planen,
    // damit vorzeitiges Erledigen nicht dieselbe Fälligkeit wiederholt.
    const base = t.dueDate > date ? t.dueDate : date;
    t.dueDate = nextDue(t, base);
  }
  save();
  render();
  showToast(`„${t.title}“ erledigt${t.recurrence !== 'none' ? ` – nächstes Mal ${formatDate(t.dueDate)}` : ''}`, () => undoComplete(entry.id));
}

function undoComplete(logId) {
  const idx = state.log.findIndex((l) => l.id === logId);
  if (idx < 0) return;
  const entry = state.log[idx];
  const t = state.tasks.find((x) => x.id === entry.taskId);
  if (t) {
    t.dueDate = entry.prevDue;
    t.done = false;
    delete t.doneAt;
  }
  state.log.splice(idx, 1);
  save();
  render();
}

function reopenTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = false;
  delete t.doneAt;
  save();
  render();
}

function postpone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const prev = t.dueDate;
  t.dueDate = addDays(t.dueDate < today() ? today() : t.dueDate, 1);
  save();
  render();
  showToast(`„${t.title}“ auf ${formatDate(t.dueDate)} verschoben`, () => { t.dueDate = prev; save(); render(); });
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
  const m = member(t.assignee);
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
  if (m) meta.push(`<span class="avatar"><i style="background:${esc(m.color)}"></i>${esc(m.name)}</span>`);

  return `
    <li class="task ${esc(t.category)} prio-${esc(t.priority)} ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
      <button class="check" data-action="${t.done ? 'reopen' : 'complete'}" aria-label="${t.done ? 'Wieder öffnen' : 'Erledigt'}">${t.done ? '✓' : ''}</button>
      <div class="task-body" data-action="edit">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">${meta.join('')}</div>
      </div>
      ${!t.done ? '<button class="btn small" data-action="postpone" title="Auf morgen verschieben">+1 Tag</button>' : ''}
    </li>`;
}

function listHTML(tasks, opts) {
  return `<ul class="task-list">${tasks.map((t) => taskHTML(t, opts)).join('')}</ul>`;
}

function emptyHTML(icon, text) {
  return `<div class="empty"><span class="big">${icon}</span>${text}</div>`;
}

function renderToday() {
  const t0 = today();
  const open = sortTasks(visibleTasks().filter((t) => !t.done));
  const overdue = open.filter((t) => t.dueDate < t0);
  const due = open.filter((t) => t.dueDate === t0);
  const doneToday = state.log.filter((l) => l.date === t0 &&
    (ui.category === 'all' || l.category === ui.category) &&
    (ui.member === 'all' || l.assignee === ui.member));

  const total = overdue.length + due.length + doneToday.length;
  const pct = total ? Math.round((doneToday.length / total) * 100) : 100;
  const minutes = [...overdue, ...due].reduce((s, t) => s + (Number(t.duration) || 0), 0);
  const d = new Date();

  let html = `
    <div class="progress">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <strong>${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.</strong>
        <span>${doneToday.length} von ${total} erledigt${minutes ? ` · noch ca. ${minutes} min` : ''}</span>
      </div>
      <div class="progress-bar"><span style="width:${pct}%"></span></div>
    </div>`;

  if (overdue.length) html += `<div class="section-title overdue"><span>Überfällig</span><span>${overdue.length}</span></div>${listHTML(overdue, { showDate: false })}`;
  if (due.length) html += `<div class="section-title"><span>Heute fällig</span><span>${due.length}</span></div>${listHTML(due, { showDate: false })}`;
  if (!overdue.length && !due.length) html += emptyHTML('🎉', 'Alles erledigt für heute!');

  if (doneToday.length) {
    html += `<div class="section-title"><span>Heute erledigt</span><span>${doneToday.length}</span></div>
      <ul class="task-list">${doneToday.map((l) => {
        const m = member(l.assignee);
        return `<li class="task ${esc(l.category)} done"><span class="check">✓</span>
          <div class="task-body"><div class="task-title">${esc(l.title)}</div>
          <div class="task-meta">${m ? `<span class="avatar"><i style="background:${esc(m.color)}"></i>${esc(m.name)}</span>` : ''}</div></div>
          <button class="btn small" data-undo="${esc(l.id)}">Rückgängig</button></li>`;
      }).join('')}</ul>`;
  }
  return html;
}

function renderWeek() {
  const t0 = today();
  const open = sortTasks(visibleTasks().filter((t) => !t.done));
  let html = '';
  const overdue = open.filter((t) => t.dueDate < t0);
  if (overdue.length) html += `<div class="section-title overdue"><span>Überfällig</span><span>${overdue.length}</span></div>${listHTML(overdue, { showDate: false })}`;

  for (let i = 0; i < 7; i++) {
    const day = addDays(t0, i);
    const items = open.filter((t) => t.dueDate === day);
    const d = fromISO(day);
    const label = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WEEKDAYS_LONG[d.getDay()];
    const minutes = items.reduce((s, t) => s + (Number(t.duration) || 0), 0);
    html += `<div class="section-title"><span>${label} · ${d.getDate()}.${d.getMonth() + 1}.</span><span>${items.length ? `${items.length}${minutes ? ` · ${minutes} min` : ''}` : '–'}</span></div>`;
    html += items.length ? listHTML(items, { showDate: false }) : '';
  }
  const later = open.filter((t) => t.dueDate > addDays(t0, 6));
  if (later.length) html += `<div class="section-title"><span>Später</span><span>${later.length}</span></div>${listHTML(later)}`;
  return html;
}

function renderAll() {
  const tasks = visibleTasks();
  if (!tasks.length) return emptyHTML('📝', 'Noch keine Aufgaben. Tippe auf „＋ Aufgabe“.');
  const open = sortTasks(tasks.filter((t) => !t.done));
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

  // Nach Raum/Projekt gruppieren
  const groups = new Map();
  for (const t of open) {
    const key = `${CATEGORY_LABELS[t.category]} · ${t.area || 'Allgemein'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  let html = '';
  for (const [key, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
    html += `<div class="section-title"><span>${esc(key)}</span><span>${list.length}</span></div>${listHTML(list)}`;
  }
  if (done.length) html += `<div class="section-title"><span>Abgeschlossen</span><span>${done.length}</span></div>${listHTML(done)}`;
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

  // Streak: aufeinanderfolgende Tage mit mind. einer erledigten Aufgabe
  const days = new Set(state.log.map((l) => l.date));
  let streak = 0;
  let cursor = days.has(t0) ? t0 : addDays(t0, -1);
  while (days.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  const bars = (entries, keyFn, labelFn, colorFn) => {
    const counts = new Map();
    for (const e of entries) counts.set(keyFn(e), (counts.get(keyFn(e)) || 0) + 1);
    const max = Math.max(1, ...counts.values());
    if (!counts.size) return '<p style="color:var(--muted);margin:0">Noch keine Daten – erledige ein paar Aufgaben.</p>';
    return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `
      <div class="bar-row"><span>${esc(labelFn(k))}</span>
        <div class="track"><div class="fill" style="width:${(n / max) * 100}%;background:${esc(colorFn(k))}"></div></div>
        <span class="num">${n}</span></div>`).join('');
  };

  return `
    <div class="stat-grid">
      <div class="stat"><b>${inWeek.length}</b><span>erledigt diese Woche</span></div>
      <div class="stat"><b>${(minutesWeek / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h</b><span>Zeit diese Woche</span></div>
      <div class="stat"><b>${streak} 🔥</b><span>Tage in Folge aktiv</span></div>
      <div class="stat"><b>${overdue}</b><span>überfällig</span></div>
    </div>
    <div class="card"><h3>Wer hat was gemacht? (letzte 30 Tage)</h3>
      ${bars(inMonth, (l) => l.assignee || 'none', (k) => member(k)?.name || 'Niemand', (k) => member(k)?.color || 'var(--muted)')}
    </div>
    <div class="card"><h3>Nach Bereich (letzte 30 Tage)</h3>
      ${bars(inMonth, (l) => l.category, (k) => CATEGORY_LABELS[k] || k, (k) => `var(--${k})`)}
    </div>`;
}

function renderSettings() {
  return `
    <div class="card">
      <h3>Haushaltsmitglieder</h3>
      <div id="memberList">
        ${state.members.map((m) => `
          <div class="member-row" data-member="${esc(m.id)}">
            <input type="color" value="${esc(m.color)}" data-field="color" aria-label="Farbe">
            <input type="text" value="${esc(m.name)}" data-field="name" maxlength="30" aria-label="Name">
            <button class="btn small danger" data-remove-member="${esc(m.id)}">Entfernen</button>
          </div>`).join('')}
      </div>
      <form class="inline-form" id="addMemberForm">
        <input name="name" placeholder="Neue Person" maxlength="30" required>
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>
    </div>
    <div class="card">
      <h3>Daten</h3>
      <p style="color:var(--muted);margin-top:0">Alle Daten liegen nur auf diesem Gerät. Exportiere sie als Sicherung oder um sie auf ein anderes Gerät zu übertragen.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="exportBtn">⬇ Exportieren</button>
        <label class="btn" style="margin:0">⬆ Importieren<input type="file" id="importInput" accept="application/json" hidden></label>
        <button class="btn danger" id="resetBtn">Alles zurücksetzen</button>
      </div>
    </div>`;
}

function render() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  $('#filters').hidden = ['settings', 'stats'].includes(ui.view);
  document.querySelectorAll('#categoryFilter .chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === ui.category));

  const mf = $('#memberFilter');
  mf.innerHTML = `<option value="all">Alle Personen</option>${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}<option value="none">Niemand zugewiesen</option>`;
  if (![...mf.options].some((o) => o.value === ui.member)) ui.member = 'all';
  mf.value = ui.member;

  const views = { today: renderToday, week: renderWeek, all: renderAll, stats: renderStats, settings: renderSettings };
  $('#view').innerHTML = views[ui.view]();
}

/* ---------- Dialog ---------- */

const dialog = $('#taskDialog');
const form = $('#taskForm');

function openDialog(task) {
  ui.editingId = task?.id || null;
  $('#dialogTitle').textContent = task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe';
  $('#deleteTaskBtn').hidden = !task;

  form.assignee.innerHTML = `<option value="">Niemand</option>${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}`;
  const areas = [...new Set(state.tasks.map((t) => t.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  $('#areaList').innerHTML = areas.map((a) => `<option value="${esc(a)}">`).join('');

  const defaults = {
    title: '', category: ui.category === 'homeoffice' ? 'homeoffice' : 'haushalt', area: '',
    assignee: ui.member !== 'all' && ui.member !== 'none' ? ui.member : (state.members[0]?.id || ''),
    priority: 2, dueDate: today(), recurrence: 'none', interval: 3, duration: '', notes: '',
  };
  const data = { ...defaults, ...(task || {}) };
  for (const key of Object.keys(defaults)) form[key].value = data[key] ?? '';
  $('#customIntervalWrap').hidden = form.recurrence.value !== 'custom';
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
  const data = {
    title: fd.get('title').trim(),
    category: fd.get('category'),
    area: fd.get('area').trim(),
    assignee: fd.get('assignee') || null,
    priority: Number(fd.get('priority')),
    dueDate: fd.get('dueDate') || today(),
    recurrence: fd.get('recurrence'),
    interval: Math.max(1, Number(fd.get('interval')) || 1),
    duration: Number(fd.get('duration')) || null,
    notes: fd.get('notes').trim(),
  };
  if (!data.title) return;
  if (ui.editingId) {
    Object.assign(state.tasks.find((t) => t.id === ui.editingId), data);
  } else {
    state.tasks.push({ id: uid(), createdAt: today(), ...data });
  }
  save();
  dialog.close();
  render();
});

$('#deleteTaskBtn').addEventListener('click', () => {
  const idx = state.tasks.findIndex((t) => t.id === ui.editingId);
  if (idx < 0) return;
  const [removed] = state.tasks.splice(idx, 1);
  save();
  dialog.close();
  render();
  showToast(`„${removed.title}“ gelöscht`, () => { state.tasks.splice(idx, 0, removed); save(); render(); });
});

/* ---------- Events ---------- */

$('#addBtn').addEventListener('click', () => openDialog());

document.querySelector('.tabs').addEventListener('click', (e) => {
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

$('#view').addEventListener('click', (e) => {
  const undoBtn = e.target.closest('[data-undo]');
  if (undoBtn) return undoComplete(undoBtn.dataset.undo);

  const removeBtn = e.target.closest('[data-remove-member]');
  if (removeBtn) {
    const id = removeBtn.dataset.removeMember;
    const m = member(id);
    if (!confirm(`${m.name} entfernen? Zugewiesene Aufgaben werden auf „Niemand“ gesetzt.`)) return;
    state.members = state.members.filter((x) => x.id !== id);
    state.tasks.forEach((t) => { if (t.assignee === id) t.assignee = null; });
    save();
    return render();
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
    if (!confirm('Wirklich alle Aufgaben, Personen und den Verlauf löschen und mit Beispieldaten neu starten?')) return;
    state = defaultState();
    save();
    return render();
  }

  const el = e.target.closest('[data-action]');
  const li = e.target.closest('.task[data-id]');
  if (!el || !li) return;
  const id = li.dataset.id;
  const action = el.dataset.action;
  if (action === 'complete') completeTask(id);
  else if (action === 'reopen') reopenTask(id);
  else if (action === 'postpone') postpone(id);
  else if (action === 'edit') openDialog(state.tasks.find((t) => t.id === id));
});

$('#view').addEventListener('change', (e) => {
  if (e.target.id === 'importInput') {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const s = JSON.parse(txt);
      if (!Array.isArray(s.tasks) || !Array.isArray(s.members)) throw new Error('Ungültiges Format');
      s.log = Array.isArray(s.log) ? s.log : [];
      state = s;
      save();
      render();
      showToast('Daten importiert');
    }).catch(() => showToast('Import fehlgeschlagen – ungültige Datei'));
    return;
  }
  const row = e.target.closest('[data-member]');
  if (row) {
    const m = member(row.dataset.member);
    const field = e.target.dataset.field;
    if (m && field) {
      m[field] = field === 'name' ? (e.target.value.trim() || m.name) : e.target.value;
      save();
      render();
    }
  }
});

$('#view').addEventListener('submit', (e) => {
  if (e.target.id !== 'addMemberForm') return;
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  const palette = ['#2f6f5e', '#c0713b', '#4a62a8', '#a8457a', '#7a8a2f', '#6a4fb0'];
  state.members.push({ id: uid(), name, color: palette[state.members.length % palette.length] });
  save();
  render();
});

/* Beim Tageswechsel (App bleibt offen) neu zeichnen */
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
