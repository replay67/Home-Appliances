/* ============================================================
 * HausPlan – gemeinsame Logik für Browser und Server
 * Alle Änderungen laufen als "Operationen" (ops) durch applyOp().
 * So kommen Browser (sofortige Anzeige) und Server (verbindlicher
 * Stand für alle Personen) immer zum selben Ergebnis.
 * ============================================================ */
(function (root) {
  'use strict';

  const CATEGORIES = ['haushalt', 'homeoffice'];
  const RECURRENCES = ['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'custom'];
  const LIMITS = { members: 50, tasks: 2000, log: 10000, activity: 300 };

  /* ---------- Datum (lokal, YYYY-MM-DD) ---------- */

  function toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fromISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function today() { return toISO(new Date()); }
  function isISODate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromISO(s)); }
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
  function diffDays(a, b) { return Math.round((fromISO(a) - fromISO(b)) / 86400000); }

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

  /* ---------- Bereinigen / Prüfen ---------- */

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const id = (v) => { const s = str(v, 40); return /^[\w-]+$/.test(s) ? s : ''; };
  const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; };

  function sanitizeMember(m) {
    return {
      id: id(m.id) || uid(),
      name: str(m.name, 30) || 'Person',
      color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#2f6f5e',
    };
  }

  function sanitizeTask(t, fallbackDate) {
    return {
      id: id(t.id) || uid(),
      title: str(t.title, 100) || 'Aufgabe',
      category: CATEGORIES.includes(t.category) ? t.category : 'haushalt',
      area: str(t.area, 40),
      assignee: id(t.assignee) || null,
      priority: num(t.priority, 1, 3, 2),
      dueDate: isISODate(t.dueDate) ? t.dueDate : fallbackDate,
      recurrence: RECURRENCES.includes(t.recurrence) ? t.recurrence : 'none',
      interval: num(t.interval, 1, 365, 3),
      duration: num(t.duration, 0, 600, 0) || null,
      notes: str(t.notes, 500),
      done: t.done === true,
      doneAt: isISODate(t.doneAt) ? t.doneAt : null,
      createdAt: isISODate(t.createdAt) ? t.createdAt : fallbackDate,
      createdBy: id(t.createdBy) || null,
    };
  }

  function sanitizeLog(l) {
    return {
      id: id(l.id) || uid(),
      taskId: id(l.taskId),
      title: str(l.title, 100),
      category: CATEGORIES.includes(l.category) ? l.category : 'haushalt',
      assignee: id(l.assignee) || null,
      by: id(l.by) || null,
      date: isISODate(l.date) ? l.date : today(),
      prevDue: isISODate(l.prevDue) ? l.prevDue : null,
      prevDone: l.prevDone === true,
      duration: num(l.duration, 0, 600, 0) || null,
    };
  }

  function sanitizeState(s) {
    const d = today();
    if (!s || !Array.isArray(s.tasks) || !Array.isArray(s.members)) throw new Error('Ungültiges Datenformat');
    return {
      version: num(s.version, 0, Number.MAX_SAFE_INTEGER, 0),
      members: s.members.slice(0, LIMITS.members).map(sanitizeMember),
      tasks: s.tasks.slice(0, LIMITS.tasks).map((t) => sanitizeTask(t, d)),
      log: (Array.isArray(s.log) ? s.log : []).slice(-LIMITS.log).map(sanitizeLog),
      activity: (Array.isArray(s.activity) ? s.activity : []).slice(-LIMITS.activity).map((a) => ({
        id: id(a.id) || uid(), at: str(a.at, 40), by: id(a.by) || null, text: str(a.text, 200),
      })),
    };
  }

  /* ---------- Startdaten ---------- */

  function defaultState() {
    const t = today();
    // Keine Personen vorgegeben: jede Person trägt sich beim ersten Öffnen selbst ein.
    // Beispielaufgaben sind niemandem zugewiesen ("wer Zeit hat").
    const task = (title, category, area, assignee, recurrence, dueOffset, extra = {}) => sanitizeTask({
      id: uid(), title, category, area, assignee, recurrence, dueDate: addDays(t, dueOffset), createdAt: t, ...extra,
    }, t);
    return {
      version: 0,
      members: [],
      tasks: [
        task('Geschirrspüler ausräumen', 'haushalt', 'Küche', null, 'daily', 0, { duration: 10 }),
        task('Bad putzen', 'haushalt', 'Bad', null, 'weekly', 1, { duration: 30 }),
        task('Staubsaugen', 'haushalt', 'Wohnung', null, 'weekly', 2, { duration: 25 }),
        task('Müll rausbringen', 'haushalt', 'Küche', null, 'custom', 0, { interval: 3, duration: 5 }),
        task('Pflanzen gießen', 'haushalt', 'Wohnzimmer', null, 'custom', 1, { interval: 4, duration: 5 }),
        task('Bettwäsche wechseln', 'haushalt', 'Schlafzimmer', null, 'biweekly', 4, { duration: 20 }),
        task('E-Mails & Kalender sichten', 'homeoffice', 'Organisation', null, 'weekdays', 0, { duration: 20, priority: 3 }),
        task('Schreibtisch aufräumen', 'homeoffice', 'Arbeitsplatz', null, 'weekly', 3, { duration: 10 }),
        task('Wochenplanung', 'homeoffice', 'Organisation', null, 'weekly', 5, { duration: 30 }),
        task('Rechnungen ablegen', 'homeoffice', 'Finanzen', null, 'monthly', 6, { duration: 30 }),
      ],
      log: [],
      activity: [],
    };
  }

  /* ---------- Operationen ---------- */

  class OpError extends Error {}

  /**
   * Wendet eine Operation auf den Zustand an (verändert ihn).
   * op: { type, by, date, ...daten }  – by = Person, date = "heute" beim Absender
   * now: Zeitstempel (ISO) für den Verlauf
   * Gibt einen Verlaufstext zurück (oder null).
   */
  function applyOp(state, op, now) {
    const date = isISODate(op.date) ? op.date : today();
    const by = id(op.by) || null;
    const findTask = (tid) => {
      const t = state.tasks.find((x) => x.id === tid);
      if (!t) throw new OpError('Aufgabe nicht gefunden – evtl. wurde sie gerade gelöscht.');
      return t;
    };
    const findMember = (mid) => {
      const m = state.members.find((x) => x.id === mid);
      if (!m) throw new OpError('Person nicht gefunden.');
      return m;
    };
    const editable = ['title', 'category', 'area', 'assignee', 'priority', 'dueDate', 'recurrence', 'interval', 'duration', 'notes'];
    let text = null;

    switch (op.type) {
      case 'task.add': {
        if (state.tasks.length >= LIMITS.tasks) throw new OpError('Zu viele Aufgaben.');
        const t = sanitizeTask({ ...op.task, createdAt: date, createdBy: by, done: false }, date);
        if (state.tasks.some((x) => x.id === t.id)) throw new OpError('Aufgabe existiert bereits.');
        state.tasks.push(t);
        text = `hat „${t.title}“ angelegt`;
        break;
      }
      case 'task.update': {
        const t = findTask(op.id);
        const patch = {};
        for (const k of editable) if (op.fields && k in op.fields) patch[k] = op.fields[k];
        Object.assign(t, sanitizeTask({ ...t, ...patch }, t.dueDate));
        text = `hat „${t.title}“ bearbeitet`;
        break;
      }
      case 'task.delete': {
        const idx = state.tasks.findIndex((x) => x.id === op.id);
        if (idx < 0) throw new OpError('Aufgabe nicht gefunden.');
        const [t] = state.tasks.splice(idx, 1);
        text = `hat „${t.title}“ gelöscht`;
        break;
      }
      case 'task.restore': {
        const t = sanitizeTask(op.task || {}, date);
        if (state.tasks.some((x) => x.id === t.id)) throw new OpError('Aufgabe existiert bereits.');
        state.tasks.splice(num(op.index, 0, state.tasks.length, state.tasks.length), 0, t);
        text = `hat „${t.title}“ wiederhergestellt`;
        break;
      }
      case 'task.complete': {
        const t = findTask(op.id);
        if (t.done) throw new OpError(`„${t.title}“ ist schon erledigt.`);
        const entry = sanitizeLog({
          id: op.logId, taskId: t.id, title: t.title, category: t.category, assignee: t.assignee,
          by, date, prevDue: t.dueDate, duration: t.duration,
        });
        if (state.log.some((l) => l.id === entry.id)) throw new OpError('Schon eingetragen.');
        state.log.push(entry);
        if (state.log.length > LIMITS.log) state.log.splice(0, state.log.length - LIMITS.log);
        if (t.recurrence === 'none') {
          t.done = true;
          t.doneAt = date;
        } else {
          // Ab dem späteren von Fälligkeit und heute neu planen
          t.dueDate = nextDue(t, t.dueDate > date ? t.dueDate : date);
        }
        text = `hat „${t.title}“ erledigt ✓`;
        break;
      }
      case 'task.uncomplete': {
        const idx = state.log.findIndex((l) => l.id === op.logId);
        if (idx < 0) throw new OpError('Eintrag nicht gefunden.');
        const [entry] = state.log.splice(idx, 1);
        const t = state.tasks.find((x) => x.id === entry.taskId);
        if (t) {
          if (entry.prevDue) t.dueDate = entry.prevDue;
          t.done = false;
          t.doneAt = null;
        }
        text = `hat „${entry.title}“ wieder geöffnet`;
        break;
      }
      case 'task.reopen': {
        const t = findTask(op.id);
        t.done = false;
        t.doneAt = null;
        text = `hat „${t.title}“ wieder geöffnet`;
        break;
      }
      case 'task.postpone': {
        const t = findTask(op.id);
        const days = num(op.days, -365, 365, 1);
        t.dueDate = addDays(days > 0 && t.dueDate < date ? date : t.dueDate, days);
        text = days > 0 ? `hat „${t.title}“ verschoben` : null;
        break;
      }
      case 'member.add': {
        if (state.members.length >= LIMITS.members) throw new OpError('Zu viele Personen.');
        const m = sanitizeMember(op.member || {});
        if (state.members.some((x) => x.id === m.id)) throw new OpError('Person existiert bereits.');
        state.members.push(m);
        text = by === m.id ? 'ist dazugekommen 👋' : `hat ${m.name} hinzugefügt`;
        break;
      }
      case 'member.update': {
        const m = findMember(op.id);
        const old = m.name;
        Object.assign(m, sanitizeMember({ ...m, ...(op.fields || {}), id: m.id }));
        text = old !== m.name ? `hat ${old} in ${m.name} umbenannt` : null;
        break;
      }
      case 'member.remove': {
        const m = findMember(op.id);
        state.members = state.members.filter((x) => x.id !== m.id);
        state.tasks.forEach((t) => { if (t.assignee === m.id) t.assignee = null; });
        text = `hat ${m.name} entfernt`;
        break;
      }
      case 'state.import': {
        const s = sanitizeState(op.data);
        Object.assign(state, { members: s.members, tasks: s.tasks, log: s.log });
        text = 'hat Daten importiert';
        break;
      }
      case 'state.reset': {
        const s = defaultState();
        Object.assign(state, { members: s.members, tasks: s.tasks, log: [], activity: [] });
        text = 'hat alles zurückgesetzt';
        break;
      }
      default:
        throw new OpError('Unbekannte Aktion.');
    }

    state.version = (state.version || 0) + 1;
    if (text) {
      state.activity.push({ id: uid(), at: now || new Date().toISOString(), by, text });
      if (state.activity.length > LIMITS.activity) state.activity.splice(0, state.activity.length - LIMITS.activity);
    }
    return text;
  }

  const api = {
    CATEGORIES, RECURRENCES, LIMITS,
    toISO, fromISO, today, isISODate, addDays, addMonths, diffDays, nextDue,
    uid, sanitizeState, sanitizeTask, sanitizeMember, defaultState, applyOp, OpError,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HP = api;
})(typeof self !== 'undefined' ? self : this);
