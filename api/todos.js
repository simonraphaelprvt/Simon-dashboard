// Vercel Serverless Function — Todos (per Siri/Shortcuts + Dashboard-UI)
// Node 18+ erforderlich (natives fetch)
//
// Speicherung: Notion-Datenbank "Dashboard Todos" unter der Pipeline-Seite.
// Die DB wird beim ersten Aufruf automatisch angelegt (kein manuelles Setup).
//
// GET  /api/todos               → Liste aller Todos (offen, ohne Key, für UI + Test)
// POST /api/todos {"task":"…"}  → neuer Todo (geschützt per Header x-api-key)

const NOTION_TOKEN  = process.env.NOTION_TOKEN;
const NOTION_VER    = '2022-06-28';

// Eltern-Seite, auf die die Notion-Integration bereits Zugriff hat (Pipeline-Seite).
const PARENT_PAGE_ID = process.env.NOTION_TODOS_PARENT || '34b5f290ef7181d68ab4e00967e47bde';
const DB_TITLE       = 'Dashboard Todos';

// Schreib-Key (Erstellen via Siri/Shortcuts). Per Env überschreibbar; Fallback
// fest im Code (wie ZOHO-Token), damit es sofort nach dem Deploy funktioniert.
const API_KEY = process.env.TODO_API_KEY || 'dsh_8f64c0cd0acdc8245c52422646b91029c5c8b4ef1f2644c9';

// UI-Key (nur zum Umschalten offen/erledigt aus dem Dashboard). Bewusst getrennt
// vom Schreib-Key: liegt im Frontend, kann also keine neuen Todos anlegen.
const UI_KEY = process.env.TODO_UI_KEY || 'dshui_6eed2b413f983489868084853c9847ef';

// Lokales Datum (Europe/Berlin) als YYYY-MM-DD — für den Mitternachts-Cleanup.
function berlinDate(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

// DB-ID innerhalb einer warmen Instanz cachen (spart den Find-Aufruf).
let _cachedDbId = process.env.NOTION_TODOS_DB_ID || null;

function notion(path, { method = 'GET', body } = {}) {
  return fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization:    `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VER,
      'Content-Type':   'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Sucht die Todos-DB unter der Eltern-Seite; legt sie an, falls nicht vorhanden.
async function ensureDb() {
  if (_cachedDbId) return _cachedDbId;

  // 1) Vorhandene child_database mit passendem Titel suchen
  const listRes = await notion(`blocks/${PARENT_PAGE_ID}/children?page_size=100`);
  const list    = await listRes.json();
  if (!listRes.ok) throw new Error(`Notion (Suche): ${list.message || listRes.status}`);

  const found = (list.results || []).find(
    b => b.type === 'child_database' && b.child_database?.title === DB_TITLE
  );
  if (found) { _cachedDbId = found.id; return _cachedDbId; }

  // 2) Nicht vorhanden → anlegen
  const createRes = await notion('databases', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
      title:  [{ type: 'text', text: { content: DB_TITLE } }],
      properties: {
        Aufgabe: { title: {} },
        Status:  { select: { options: [
          { name: 'offen',    color: 'yellow' },
          { name: 'erledigt', color: 'green'  },
        ] } },
      },
    },
  });
  const created = await createRes.json();
  if (!createRes.ok) throw new Error(`Notion (DB anlegen): ${created.message || createRes.status}`);

  _cachedDbId = created.id;
  return _cachedDbId;
}

function mapPage(p) {
  const title = p.properties?.Aufgabe?.title || [];
  return {
    id:        p.id,
    text:      title.map(t => t.plain_text).join('').trim(),
    status:    p.properties?.Status?.select?.name || 'offen',
    createdAt: p.created_time,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-ui-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!NOTION_TOKEN) {
    return res.status(500).json({ error: 'NOTION_TOKEN nicht konfiguriert' });
  }

  try {
    const dbId = await ensureDb();

    // ── GET: Todos auflisten + Mitternachts-Cleanup (kein Key, auch für UI) ──
    if (req.method === 'GET') {
      const qRes = await notion(`databases/${dbId}/query`, {
        method: 'POST',
        body: { sorts: [{ timestamp: 'created_time', direction: 'descending' }], page_size: 50 },
      });
      const q = await qRes.json();
      if (!qRes.ok) throw new Error(`Notion (Query): ${q.message || qRes.status}`);

      // Selbstheilender Reset: erledigte Todos von einem früheren Tag (Berlin)
      // werden archiviert → verschwinden ab Mitternacht. Offene bleiben immer.
      const today = berlinDate(Date.now());
      const keep = [], stale = [];
      for (const p of q.results || []) {
        const status = p.properties?.Status?.select?.name || 'offen';
        if (status === 'erledigt' && berlinDate(p.last_edited_time) < today) stale.push(p.id);
        else keep.push(p);
      }
      if (stale.length) {
        await Promise.all(stale.map(id =>
          notion(`pages/${id}`, { method: 'PATCH', body: { archived: true } }).catch(() => {})));
      }

      const todos = keep.map(mapPage);
      return res.status(200).json({ ok: true, count: todos.length, cleaned: stale.length, todos });
    }

    // ── PATCH: Status umschalten offen ⇄ erledigt (UI-Key) ──
    if (req.method === 'PATCH') {
      const key = req.headers['x-ui-key'];
      if (!key || key !== UI_KEY) {
        return res.status(401).json({ error: 'Ungültiger oder fehlender UI-Key (Header x-ui-key)' });
      }

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};

      const id = String(body.id ?? '').trim();
      const status = String(body.status ?? '').trim();
      if (!id) return res.status(400).json({ error: 'Feld "id" fehlt' });
      if (status !== 'offen' && status !== 'erledigt') {
        return res.status(400).json({ error: 'Feld "status" muss "offen" oder "erledigt" sein' });
      }

      const upd = await notion(`pages/${id}`, {
        method: 'PATCH',
        body: { properties: { Status: { select: { name: status } } } },
      });
      const page = await upd.json();
      if (!upd.ok) throw new Error(`Notion (Status setzen): ${page.message || upd.status}`);

      return res.status(200).json({ ok: true, todo: mapPage(page) });
    }

    // ── POST: neuen Todo anlegen (geschützt) ──
    if (req.method === 'POST') {
      const key = req.headers['x-api-key'];
      if (!key || key !== API_KEY) {
        return res.status(401).json({ error: 'Ungültiger oder fehlender API-Key (Header x-api-key)' });
      }

      // Body kann Objekt oder String sein
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};

      const task = String(body.task ?? body.text ?? '').trim();
      if (!task) {
        return res.status(400).json({ error: 'Feld "task" fehlt oder ist leer' });
      }

      const createRes = await notion('pages', {
        method: 'POST',
        body: {
          parent: { database_id: dbId },
          properties: {
            Aufgabe: { title: [{ type: 'text', text: { content: task } }] },
            Status:  { select: { name: 'offen' } },
          },
        },
      });
      const page = await createRes.json();
      if (!createRes.ok) throw new Error(`Notion (Todo anlegen): ${page.message || createRes.status}`);

      return res.status(201).json({ ok: true, todo: mapPage(page) });
    }

    return res.status(405).json({ error: 'Methode nicht erlaubt' });

  } catch (err) {
    console.error('[todos]', err.message);
    return res.status(500).json({ error: 'Serverfehler', message: err.message });
  }
};
