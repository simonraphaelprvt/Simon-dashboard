// Vercel Serverless Function — Notion API Proxy
// Node 18+ erforderlich (natives fetch)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── Test-Endpoint: /api/notion?ping=1 ──
  if (req.query.ping) {
    const t = process.env.NOTION_TOKEN || '';
    return res.status(200).json({
      ok:          true,
      tokenSet:    t.length > 0,
      tokenPrefix: t.length > 4 ? t.slice(0, 8) + '…' : '(leer)',
      nodeVersion: process.version,
      fetchAvail:  typeof fetch !== 'undefined',
    });
  }

  // ── Debug: /api/notion?debug=pipeline|fokus|cashflow ──
  // Findet die echten Datenbank-IDs innerhalb der Seiten
  if (req.query.debug) {
    const token = process.env.NOTION_TOKEN;
    if (!token) return res.status(500).json({ error: 'NOTION_TOKEN nicht gesetzt' });
    const pageMap = {
      pipeline: '34b5f290ef7181d68ab4e00967e47bde',
      fokus:    '34b5f290ef718101a4baf1eb95eadee6',
      cashflow: '34b5f290ef718187a3bfc8e17c2cb06e',
    };
    const pageId = pageMap[req.query.debug];
    if (!pageId) return res.status(400).json({ error: 'Nutze: pipeline|fokus|cashflow' });
    try {
      const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=10`, {
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
      });
      const data = await r.json();
      const dbs = (data.results || [])
        .filter(b => b.type === 'child_database')
        .map(b => ({ id: b.id, idClean: b.id.replace(/-/g,''), title: b.child_database?.title }));
      return res.status(r.status).json({ httpStatus: r.status, databases_found: dbs, raw_blocks: data.results?.map(b => ({ id: b.id, type: b.type })) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'NOTION_TOKEN nicht konfiguriert' });
  }

  const { endpoint } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Fehlender endpoint Parameter' });
  }

  // Sicherheit: nur erlaubte Notion-Ressourcen
  if (!/^(databases|pages|blocks)\//.test(endpoint)) {
    return res.status(403).json({ error: 'Nicht erlaubter Endpoint' });
  }

  try {
    const isPost = req.method === 'POST';

    // req.body kann object (geparst), string oder undefined sein
    let bodyStr;
    if (isPost) {
      if (!req.body || Object.keys(req.body).length === 0) {
        bodyStr = '{}';
      } else if (typeof req.body === 'string') {
        bodyStr = req.body;
      } else {
        bodyStr = JSON.stringify(req.body);
      }
    }

    const notionRes = await fetch(`https://api.notion.com/v1/${endpoint}`, {
      method:  isPost ? 'POST' : 'GET',
      headers: {
        Authorization:   `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':  'application/json',
      },
      body: isPost ? bodyStr : undefined,
    });

    const data = await notionRes.json();
    return res.status(notionRes.status).json(data);

  } catch (err) {
    console.error('[notion-proxy]', err.message);
    return res.status(500).json({
      error:   'Proxy-Fehler',
      message: err.message,
    });
  }
};
