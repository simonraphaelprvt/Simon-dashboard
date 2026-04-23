// Vercel Serverless Function — Zoho Invoice API Proxy
// Schützt ZOHO_CLIENT_SECRET (darf nie im Browser landen)
//
// Env Vars in Vercel setzen:
//   ZOHO_CLIENT_ID     → aus Zoho Developer Console
//   ZOHO_CLIENT_SECRET → aus Zoho Developer Console
//   ZOHO_ORG_ID        → Zoho Organisation-ID (optional, für Multi-Org)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).end();

  const CLIENT_ID     = process.env.ZOHO_CLIENT_ID;
  const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
  const ORG_ID        = process.env.ZOHO_ORG_ID || '';

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET nicht konfiguriert' });
  }

  const { action, refreshToken, accessToken } = req.body || {};

  // ── Access Token via Refresh Token holen ──
  if (action === 'refresh') {
    if (!refreshToken) return res.status(400).json({ error: 'Kein refreshToken übergeben' });
    try {
      const r = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: refreshToken,
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      });
      const d = await r.json();
      return res.status(r.status).json(d);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Offene Rechnungen abrufen ──
  if (action === 'invoices') {
    if (!accessToken) return res.status(400).json({ error: 'Kein accessToken übergeben' });
    try {
      const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      };
      if (ORG_ID) headers['X-com-zoho-invoice-organizationid'] = ORG_ID;

      const r = await fetch(
        'https://invoice.zoho.eu/api/v3/invoices?status=unpaid&per_page=50&sort_column=due_date&sort_order=A',
        { headers }
      );
      const d = await r.json();
      return res.status(r.status).json(d);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unbekannte action. Nutze: refresh | invoices' });
};
