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
  const ORG_ID        = process.env.ZOHO_ORG_ID || '20108471590';

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

  // gemeinsame Header
  const zHeaders = () => {
    const h = { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' };
    if (ORG_ID) h['X-com-zoho-invoice-organizationid'] = ORG_ID;
    return h;
  };
  const BASE = 'https://invoice.zoho.eu/api/v3';

  // ── Offene Rechnungen abrufen (Legacy, weiter genutzt) ──
  if (action === 'invoices') {
    if (!accessToken) return res.status(400).json({ error: 'Kein accessToken übergeben' });
    try {
      const r = await fetch(
        `${BASE}/invoices?status=unpaid&per_page=50&sort_column=due_date&sort_order=A`,
        { headers: zHeaders() }
      );
      const d = await r.json();
      return res.status(r.status).json(d);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Cockpit-Metriken: maximale Aggregation, defensiv ──
  // Holt Invoices/Payments/Estimates/Recurring/Contacts (soweit Scopes es erlauben)
  // und aggregiert server-seitig zu fertigen Zahlen + 12-Monats-Serien.
  if (action === 'metrics') {
    if (!accessToken) return res.status(400).json({ error: 'Kein accessToken übergeben' });

    const errors = [];
    const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const monthKey = s => { const d = new Date(s); return isNaN(d) ? null : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

    // paginiert eine Ressource (max. 3 Seiten × 200), tolerant gegen Fehler/Scope
    async function pull(resource, key) {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        let r;
        try {
          r = await fetch(`${BASE}/${resource}?per_page=200&page=${page}`, { headers: zHeaders() });
        } catch (e) { errors.push(`${resource}: ${e.message}`); break; }
        if (!r.ok) { errors.push(`${resource}: HTTP ${r.status}`); break; }
        let d; try { d = await r.json(); } catch { break; }
        const arr = d[key] || [];
        out.push(...arr);
        if (!d.page_context || !d.page_context.has_more_page) break;
      }
      return out;
    }

    try {
      const [invoices, payments, estimates, recurring, contacts] = await Promise.all([
        pull('invoices', 'invoices'),
        pull('customerpayments', 'customerpayments'),
        pull('estimates', 'estimates'),
        pull('recurringinvoices', 'recurring_invoices'),
        pull('contacts', 'contacts'),
      ]);

      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      const ymCur  = y + '-' + String(m + 1).padStart(2, '0');
      const ymPrev = (m === 0 ? y - 1 : y) + '-' + String(m === 0 ? 12 : m).padStart(2, '0');

      // 12-Monats-Achse
      const months = [];
      for (let i = 11; i >= 0; i--) { const d = new Date(y, m - i, 1); months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
      const cashByMonth = Object.fromEntries(months.map(k => [k, 0]));
      const invByMonth  = Object.fromEntries(months.map(k => [k, 0]));

      // Zahlungen → Cash received
      let revenueYTD = 0, cashCur = 0, cashPrev = 0;
      const custRevenue = {};
      payments.forEach(p => {
        const amt = num(p.amount); const mk = monthKey(p.date);
        if (mk && mk in cashByMonth) cashByMonth[mk] += amt;
        if (mk && mk.startsWith(String(y))) revenueYTD += amt;
        if (mk === ymCur) cashCur += amt;
        if (mk === ymPrev) cashPrev += amt;
        const c = p.customer_name || p.customer_id || '—';
        custRevenue[c] = (custRevenue[c] || 0) + amt;
      });

      // Invoices → invoiced-Serie, Outstanding, Aging, Status, Zahlungsdauer
      let outstanding = 0;
      const aging = { d15: 0, d30: 0, d30p: 0 };
      const statusCount = {};
      let payDaysSum = 0, payDaysN = 0;
      invoices.forEach(inv => {
        const mk = monthKey(inv.date);
        if (mk && mk in invByMonth) invByMonth[mk] += num(inv.total);
        const st = (inv.status || '').toLowerCase();
        statusCount[st] = (statusCount[st] || 0) + 1;
        const bal = num(inv.balance);
        if (['sent', 'overdue', 'partially_paid', 'viewed', 'unpaid'].includes(st)) outstanding += bal;
        if (st === 'overdue' && inv.due_date) {
          const age = Math.floor((now - new Date(inv.due_date)) / 86400000);
          if (age <= 15) aging.d15 += bal; else if (age <= 30) aging.d30 += bal; else aging.d30p += bal;
        }
        if (st === 'paid' && inv.date && (inv.last_payment_date || inv.last_modified_time)) {
          const pd = new Date(inv.last_payment_date || inv.last_modified_time);
          const days = Math.floor((pd - new Date(inv.date)) / 86400000);
          if (days >= 0 && days < 365) { payDaysSum += days; payDaysN++; }
        }
      });

      // Recurring → MRR (auf Monat normalisiert)
      const freqMonthly = { weeks: 4.33, week: 4.33, months: 1, month: 1, days: 30, years: 1 / 12 };
      let mrr = 0;
      recurring.forEach(rc => {
        if ((rc.status || '').toLowerCase() !== 'active') return;
        const f = (rc.recurrence_frequency || rc.repeat_every_unit || 'months').toLowerCase();
        const per = num(rc.total);
        mrr += per * (freqMonthly[f] != null ? freqMonthly[f] : 1);
      });

      // Estimates → offene Pipeline
      let openEstimates = 0, openEstimatesCount = 0;
      estimates.forEach(e => {
        const st = (e.status || '').toLowerCase();
        if (['sent', 'draft', 'viewed', 'accepted'].includes(st)) { openEstimates += num(e.total); openEstimatesCount++; }
      });

      // Neue Kunden
      let newCustMonth = 0, newCustYear = 0;
      contacts.forEach(c => {
        const ct = c.created_time || c.created_date;
        const mk = ct ? monthKey(ct) : null;
        if (!mk) return;
        if (mk.startsWith(String(y))) newCustYear++;
        if (mk === ymCur) newCustMonth++;
      });

      const topCustomers = Object.entries(custRevenue)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, val]) => ({ name, value: Math.round(val) }));

      return res.status(200).json({
        ok: true,
        months,
        cashSeries:  months.map(k => Math.round(cashByMonth[k])),
        invSeries:   months.map(k => Math.round(invByMonth[k])),
        revenueYTD:  Math.round(revenueYTD),
        cashThisMonth: Math.round(cashCur),
        cashLastMonth: Math.round(cashPrev),
        outstanding: Math.round(outstanding),
        aging:       { d15: Math.round(aging.d15), d30: Math.round(aging.d30), d30p: Math.round(aging.d30p) },
        avgDaysToPay: payDaysN ? Math.round(payDaysSum / payDaysN) : null,
        statusCount,
        topCustomers,
        newCustomersMonth: newCustMonth,
        newCustomersYear:  newCustYear,
        mrr: Math.round(mrr),
        openEstimates: Math.round(openEstimates),
        openEstimatesCount,
        counts: { invoices: invoices.length, payments: payments.length, estimates: estimates.length, recurring: recurring.length, contacts: contacts.length },
        errors,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message, errors });
    }
  }

  return res.status(400).json({ error: 'Unbekannte action. Nutze: refresh | invoices | metrics' });
};
