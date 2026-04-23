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
  // Zeigt ob Token gesetzt ist, ohne ihn zu leaken
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
