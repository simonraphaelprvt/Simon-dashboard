// Vercel Serverless Function — Notion API Proxy
// Umgeht CORS-Beschränkungen der Notion API

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'NOTION_TOKEN nicht konfiguriert' });
  }

  const { endpoint } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Fehlender endpoint Parameter' });
  }

  // Sicherheit: nur Notion-Ressourcen erlauben
  if (!/^(databases|pages|blocks)\//.test(endpoint)) {
    return res.status(403).json({ error: 'Nicht erlaubter Endpoint' });
  }

  try {
    const isPost = req.method === 'POST';
    const notionRes = await fetch(`https://api.notion.com/v1/${endpoint}`, {
      method: isPost ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: isPost && req.body ? JSON.stringify(req.body) : undefined,
    });

    const data = await notionRes.json();
    return res.status(notionRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Proxy-Fehler', message: err.message });
  }
};
