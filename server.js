#!/usr/bin/env node
'use strict';

/* ============================================================
 * HausPlan-Server – gemeinsame Daten für den ganzen Haushalt
 * Keine externen Abhängigkeiten, nur Node.js (>= 18).
 *
 * Umgebungsvariablen:
 *   PORT           Port (Standard 3000)
 *   HOST           Adresse (Standard 0.0.0.0 = im Heimnetz erreichbar)
 *   HAUSPLAN_CODE  Haushalts-Code, den alle zum Anmelden brauchen.
 *                  Ohne Code ist die App für jeden im Netz offen.
 *   DATA_DIR       Speicherort der Daten (Standard ./data)
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HP = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CODE = process.env.HAUSPLAN_CODE || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'hausplan.json');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 180;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- Speicher ---------- */

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file); // atomar: nie halb geschriebene Datei
}

let state;
try {
  state = fs.existsSync(DATA_FILE) ? HP.sanitizeState(readJSON(DATA_FILE, null)) : HP.defaultState();
} catch (e) {
  console.error(`Datei ${DATA_FILE} ist beschädigt – bitte prüfen oder löschen.`);
  process.exit(1);
}
writeJSON(DATA_FILE, state);

// Sitzungen: token-hash -> Ablaufdatum (ms)
const sessions = new Map(Object.entries(readJSON(SESSION_FILE, {})));
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
function saveSessions() {
  const now = Date.now();
  for (const [k, exp] of sessions) if (exp < now) sessions.delete(k);
  writeJSON(SESSION_FILE, Object.fromEntries(sessions));
}

/* ---------- Live-Updates (Server-Sent Events) ---------- */

const clients = new Set();
function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

/* ---------- Hilfen ---------- */

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function isAuthed(req) {
  if (!CODE) return true;
  const token = getCookie(req, 'hp_session');
  if (!token) return false;
  const exp = sessions.get(hashToken(token));
  return Boolean(exp && exp > Date.now());
}

function codeMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(CODE).digest();
  return crypto.timingSafeEqual(a, b);
}

// Einfache Bremse gegen Durchprobieren des Codes
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

/* ---------- Routen ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (!p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, p);
    }

    if (p === '/api/session' && req.method === 'GET') {
      return send(res, 200, { authRequired: Boolean(CODE), authenticated: isAuthed(req) });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress;
      if (tooManyAttempts(ip)) return send(res, 429, { error: 'Zu viele Versuche – bitte in 10 Minuten erneut probieren.' });
      const body = await readBody(req, 10 * 1024);
      if (!CODE || codeMatches(body.code || '')) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(hashToken(token), Date.now() + SESSION_DAYS * 86400000);
        saveSessions();
        const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        return send(res, 200, { ok: true }, {
          'Set-Cookie': `hp_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`,
        });
      }
      attempts.get(ip).push(Date.now());
      return send(res, 401, { error: 'Falscher Haushalts-Code.' });
    }

    if (!isAuthed(req)) return send(res, 401, { error: 'Bitte anmelden.' });

    if (p === '/api/logout' && req.method === 'POST') {
      const token = getCookie(req, 'hp_session');
      if (token) { sessions.delete(hashToken(token)); saveSessions(); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'hp_session=; Path=/; Max-Age=0' });
    }

    if (p === '/api/state' && req.method === 'GET') {
      return send(res, 200, state);
    }

    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ state })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p === '/api/ops' && req.method === 'POST') {
      const op = await readBody(req);
      // Auf einer Kopie arbeiten: schlägt etwas fehl, bleibt der Stand unverändert
      const next = structuredClone(state);
      let text;
      try {
        text = HP.applyOp(next, op, new Date().toISOString());
      } catch (e) {
        if (e instanceof HP.OpError) return send(res, 409, { error: e.message, state });
        throw e;
      }
      state = next;
      writeJSON(DATA_FILE, state);
      broadcast({ state, event: text ? { by: op.by || null, text, clientId: String(op.clientId || '') } : null });
      return send(res, 200, { state });
    }

    return send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    if (e.message === 'too large') return send(res, 413, { error: 'Daten zu groß.' });
    if (e.message === 'bad json') return send(res, 400, { error: 'Ungültige Anfrage.' });
    console.error(e);
    return send(res, 500, { error: 'Serverfehler.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`🏠 HausPlan läuft auf http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   Im Heimnetz: http://${n.address}:${PORT}`);
    }
  }
  console.log(CODE ? '   Zugang geschützt mit HAUSPLAN_CODE.' : '   ⚠️  Kein HAUSPLAN_CODE gesetzt – jede Person im Netz hat Zugriff.');
  console.log(`   Daten: ${DATA_FILE}`);
});
