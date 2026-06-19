# Simon's iPad Dashboard

Wand-iPad-Dashboard (Querformat, iPad Air) für Simon (Videograf/Solo-Content-Business).
Zwei Vollbild-Screens, umschaltbar: **Business** (dunkles Cockpit) + **Privat** (warmes Leinen-Beige).

## Stack
- **Single-file `index.html`** (~4000 Zeilen, HTML+CSS+JS, plain, KEIN Framework/Build/Bundler).
- Serverless unter `api/`: `notion.js` (Notion-Proxy), `zoho.js` (Zoho-Invoice-Proxy, action `refresh|invoices|metrics`), `todos.js` (Todo-Store, GET/POST).
- `morningReport.css` / `morningReport.js` = Voice-Morning-Report-Overlay (separat geladen).
- Fonts: Plus Jakarta Sans + DM Sans (Google Fonts), Playfair Display (Privat), `ui-monospace` (Radar/Lampen).

## Daten/State
- **Notion** via `/api/notion?endpoint=blocks/{tableBlockId}/children` (simple-table-Blöcke, Zeile 1 = Header). Table-Block-IDs in `const TABLE`: `pipeline`, `fokus`, `cashflow` (Monat/Einnahmen/Ausgaben/Ziel), `kunden` (Aktive Kunden → MRR, derzeit ungenutzt im Cockpit).
- **Zoho** via `/api/zoho` (action `metrics` aggregiert Invoices/Payments/Estimates/Contacts server-seitig). Refresh-Token steht in `index.html` (`const ZOHO_REFRESH_TOKEN`); Client-ID/Secret/Org NUR als Vercel-Env.
- **Google (Gmail + Kalender-API)**: client-seitig via Google Identity Services OAuth, Token in `localStorage` (`gmail_token`), stiller Refresh. Scope = `gmail.readonly calendar.readonly`.
- **Wetter**: OpenWeather (Key im Code). **Kein eigenes Backend/DB** — alles aus den o.g. Quellen oder `localStorage`.
- Pipeline-Werte-Anzeige-Toggle = nur In-Memory (`_pipeShowValues`).

## Vercel
- Projekt **simon-dashboard**, live: **https://simon-dashboard-omega.vercel.app**, Repo `github.com/simonraphaelprvt/simon-dashboard`.
- **Deploy = `git push` auf `main`** (GitHub-Integration, Auto-Deploy). KEIN `vercel` CLI installiert, KEINE `.vercel/`-Config. Vercel-MCP kann NUR lesen/deployen, **keine Env-Vars setzen**.
- `vercel.json`: Funktions-Limits (notion 128MB/10s, zoho 256MB/30s).
- **Env-Vars (in Vercel-Dashboard zu setzen):** `NOTION_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, optional `ZOHO_ORG_ID` (Fallback `20108471590` hart in `zoho.js`). `GMAIL_CLIENT_ID` steht im Code.

## Aktueller Stand (läuft)
- **Business-Cockpit** (Bento-Grid `.cockpit`): Akquise (Gmail-Gauges) · Revenue-Chart · Finanzen (Zoho-Gauges) · Zeit (Wochenlast + Kalender-Embed + nächster Dreh) · Pipeline-Radar · Annunciator-Lampen.
- **Gauges** = `renderInstrument()` (270°-Tacho mit Ticks/Zeiger/Lünette, zustandsbasierte gedämpfte Farben + leichter Glow). Alle Akquise-/Finanz-Kennzahlen sind solche Dials, KEINE Text-Kästen ([[feedback-cockpit-instruments]]).
- **Revenue-Chart**: 3 Serien — Cash (lila) + Fakturiert (gelb) dauerhaft, Ausgaben (rot) per Toggle. Quelle Zoho live, sonst Notion-Fallback (`setZohoRev`/`setNotionRev` → `renderRevenueChart`). Kurven geclampt (`smoothPath(pts, loY, hiY)`) → liegen auf 0-Linie auf.
- **Pipeline-Radar**: konzentrische Stufen (außen kalt → innen aktiv), rotierender Sweep (helle Kante vorn), Knoten farbig nach Status (`classifyLead`), JMV per Name-Override = aktiv/grün. €-Wert-Toggle (Standard aus).
- **Kalender**: läuft über **öffentlichen web.de-Embed** (dunkel invertiert), NICHT die API.
- **Privat-Screen**: Habits, Italienisch-Heatmap, Lebenswochen, Mini-Kalender — unverändert seit längerem, funktioniert.
- **Akquise-Feld ⇄ Todos**: `.cl-acq` blendet alle 5 Min (`ACQ_SWITCH_MS`) per Crossfade zwischen Gauges und Todo-Liste (Aviation-Style, monospace/LED) um. Indikator-Punkte im Header, Titel wechselt Akquise/Aufgaben. Todos live aus `/api/todos`. Steuer-JS: `acqSetView`/`acqToggleView`/`fetchTodos`. Speicher = Notion-DB „Dashboard Todos" unter der Pipeline-Seite (auto-angelegt). Schreib-Key per Header `x-api-key` (Fallback im Code, optional `TODO_API_KEY` als Env). Für Siri/Shortcuts: POST `{"task":"…"}`. Manueller Umschalt-Button unten rechts (`acq-toggle-btn`/`acqManualToggle`, setzt den Takt zurück).
- **Todo-Toggle + Mitternachts-Reset**: Zeilen antippbar → PATCH `{id,status}` mit `x-ui-key` (UI-Key `TODO_UI_KEY`, kann nur umschalten, nicht anlegen). Erledigte bleiben sichtbar, grün markiert (LED + „ERLEDIGT"-Tag), kein Durchstreichen, offene zuerst. Reset = **Cleanup-on-GET** (kein Cron): GET archiviert erledigte mit `last_edited_time` < heute (Europe/Berlin); UI feuert `scheduleMidnightCleanup` um 00:00 lokal. DST-sicher (Intl timeZone).

## Offene nächste Schritte
1. **Zoho aktivieren**: Simon muss `ZOHO_CLIENT_ID` (`1000.ITJCFIQHY59PVL0LB1WPJ8TI87XEVG`) + `ZOHO_CLIENT_SECRET` in Vercel-Env setzen + redeployen. Bis dahin: `/api/zoho refresh` → `invalid_client`, Finanz-Gauges = 0/„Token erweitern", Chart auf Notion-Fallback.
2. **Phase B — Instagram** (Meta Graph API): Follower/Reach/Profilaufrufe. Reichweite-Cluster war reserviert, ist aktuell aus dem Grid entfernt — wieder einplanen.

## Gotchas (sonst nicht wissbar)
- **Umschalter `#view-toggle` fix bei `top:20 right:184 w:132 h:96` — darf sich NIE bewegen** (wiederholtes Feedback). Beide Screens richten Layout danach aus.
- **MRR aus Zoho = 0**: Scope `recurringinvoices.READ` wurde beim Token nicht genehmigt + Konto hat eh keine Recurring-Invoices. Ehrlich 0.
- **Kalender-API geht nicht** auf dem iPad: stiller Token-Refresh holt keine neuen Scopes, Consent-Popup im Standalone oft blockiert, und Events liegen im web.de-Kalender (API-unlesbar). Darum Embed. Der kleine **„G"-Button** (Akquise-Header) ist NUR für Gmail-Login (grün = verbunden).
- **Lokale Vorschau unmöglich**: Preview-Sandbox sperrt Dateizugriff auf Desktop UND `~/Downloads` (http.server 404/PermissionError). Verifikation nur per `node --check` der `<script>`-Blöcke + Vercel-Deploy.
- Notion-Tabelle inspizieren: `curl "https://simon-dashboard-omega.vercel.app/api/notion?endpoint=blocks/{id}/children"` (Proxy, Token serverseitig).
- Projekt liegt in `~/Desktop/Claude Workspace/dashboard/` (NICHT im Session-cwd `~/Downloads`).
- Nach jedem Commit Co-Author-Zeile setzen; pushen = deployen.
