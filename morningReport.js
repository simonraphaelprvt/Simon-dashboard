/* ══════════════════════════════════════════════════════════════
   Morning Report — Fullscreen 4-Slide Präsentation mit TTS
   Alle Audios werden vorab geladen (iOS-Safari-Autoplay-Fix)
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Google TTS ────────────────────────────────────────────────
  if (!window.googleTTS) {
    window.googleTTS = async function (text) {
      const key = window.GOOGLE_TTS_KEY;
      if (!key) throw new Error('GOOGLE_TTS_KEY nicht gesetzt');
      const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input:       { text },
            voice:       { languageCode: 'de-DE', name: 'de-DE-Wavenet-F' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 0.9, pitch: 0 },
          }),
        }
      );
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const { audioContent } = await res.json();
      if (!audioContent) throw new Error('Keine Audio-Daten');
      return new Audio('data:audio/mpeg;base64,' + audioContent);
    };
  }

  // ── Utils ─────────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── iOS Audio-Unlock ──────────────────────────────────────────
  // Spielt einen stillen Ton sofort bei User-Geste → entsperrt Audio für alle folgenden .play() Calls
  function unlockAudio() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      setTimeout(() => ctx.close(), 500);
    } catch {}
  }

  // ── Narrations bauen ─────────────────────────────────────────
  function buildNarrations(data) {
    const events = Array.isArray(data.events) ? data.events : [];
    const leads  = Array.isArray(data.leads)  ? data.leads  : [];

    // Slide 1 — Zeit
    const n1 = `Es ist ${data.time || '—'} Uhr. ${data.weekday || ''}, ${data.date || ''}.`;

    // Slide 2 — Termine
    const n2 = events.length === 0
      ? 'Du hast heute keine Termine. Freier Kopf — nutze ihn.'
      : `Du hast ${events.length} ${events.length === 1 ? 'Termin' : 'Termine'} heute. `
        + events.slice(0, 3).map(e => `${e.time} Uhr: ${e.title}`).join('. ') + '.';

    // Slide 3 — Pipeline (jeden Lead einzeln nennen)
    let n3;
    if (!leads.length) {
      n3 = 'Deine Pipeline ist aktuell leer.';
    } else {
      const parts = [`Du hast ${leads.length} aktive ${leads.length === 1 ? 'Lead' : 'Leads'}.`];
      leads.slice(0, 4).forEach(l => {
        const status = l.status ? `, Status ${l.status}` : '';
        const detail = l.detail ? `: ${l.detail}` : '';
        parts.push(`${l.name}${status}${detail}.`);
      });
      n3 = parts.join(' ');
    }

    // Slide 4 — Fokus
    const focusText = (data.focus || '').trim() || 'Kein Fokus gesetzt';
    const n4 = `Dein Fokus für heute: ${focusText}. Mach es. Viel Erfolg.`;

    return [n1, n2, n3, n4];
  }

  // ── Render-Funktionen pro Slide ───────────────────────────────
  function renderSlide1(slide, data) {
    const [hh, mm] = (data.time || '00:00').split(':').map(n => parseInt(n, 10) || 0);
    slide.innerHTML = `
      <div class="mr-emoji lg">⏰</div>
      <div class="mr-time">00:00</div>
      <div class="mr-date">${esc(data.weekday || '')}${data.weekday ? ', ' : ''}${esc(data.date || '')}</div>
    `;
    return () => {
      const el = slide.querySelector('.mr-time');
      if (!el) return;
      const target = hh * 60 + mm;
      const dur = 1200;
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        const v = Math.round(target * e);
        el.textContent = `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
      };
      setTimeout(() => requestAnimationFrame(tick), 300);
    };
  }

  function renderSlide2(slide, data) {
    const events = Array.isArray(data.events) ? data.events : [];
    const html = events.length
      ? events.slice(0, 5).map(ev => `
          <div class="mr-event-item">
            <span class="mr-event-time">${esc(ev.time || '')}</span>
            <span class="mr-event-title">${esc(ev.title || '')}</span>
          </div>`).join('')
      : `<div class="mr-event-item" style="justify-content:center;">
           <span class="mr-event-title" style="color:#8e8e93;">Keine Termine heute</span>
         </div>`;
    slide.innerHTML = `
      <div class="mr-emoji">📅</div>
      <div class="mr-eyebrow">Heute</div>
      <div class="mr-events">${html}</div>
    `;
    return () => {
      slide.querySelectorAll('.mr-event-item').forEach((el, i) =>
        setTimeout(() => el.classList.add('in'), 350 + i * 220));
    };
  }

  function renderSlide3(slide, data) {
    const leads = Array.isArray(data.leads) ? data.leads : [];
    const html = leads.slice(0, 4).map(l => {
      const s = (l.status || 'KALT').toUpperCase();
      const cls = s === 'HOT' ? 'hot' : s === 'WARM' ? 'warm' : 'kalt';
      return `
        <div class="mr-pipeline-card">
          <span class="mr-badge mr-badge-${cls}">${esc(s)}</span>
          <div class="mr-lead-name">${esc(l.name || '—')}</div>
          <div class="mr-lead-detail">${esc(l.detail || '')}</div>
        </div>`;
    }).join('') || `<div class="mr-pipeline-card" style="grid-column:1/-1;">
      <div class="mr-lead-name" style="color:#8e8e93;text-align:center;">Keine Leads</div>
    </div>`;
    slide.innerHTML = `
      <div class="mr-emoji">🚀</div>
      <div class="mr-eyebrow">Pipeline</div>
      <div class="mr-pipeline-grid">${html}</div>
    `;
    return () => {
      slide.querySelectorAll('.mr-pipeline-card').forEach((el, i) =>
        setTimeout(() => el.classList.add('in'), 350 + i * 280));
    };
  }

  function renderSlide4(slide, data) {
    const focus = (data.focus || '').trim() || 'Kein Fokus gesetzt';
    const words = focus.split(/\s+/);
    const wordHtml = words.map(w => `<span class="mr-focus-word">${esc(w)}</span>`).join(' ');
    slide.innerHTML = `
      <div class="mr-emoji lg">🎯</div>
      <div class="mr-focus">${wordHtml}</div>
      <div class="mr-focus-sub">Viel Erfolg, Simon 👊</div>
    `;
    return () => {
      slide.querySelectorAll('.mr-focus-word').forEach((el, i) =>
        setTimeout(() => el.classList.add('in'), 350 + i * 110));
      setTimeout(() =>
        slide.querySelector('.mr-focus-sub')?.classList.add('in'),
        350 + words.length * 110 + 500);
    };
  }

  // ── Audio abspielen und warten ────────────────────────────────
  function playAndWait(audio) {
    return new Promise(resolve => {
      if (!audio) { setTimeout(resolve, 3500); return; }
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });
      const fallback = setTimeout(finish, 60_000);
      audio.play()
        .then(() => audio.addEventListener('ended', () => clearTimeout(fallback), { once: true }))
        .catch(() => { clearTimeout(fallback); setTimeout(finish, 3500); });
    });
  }

  // ── Haupt-Funktion ────────────────────────────────────────────
  window.startMorningReportOverlay = async function (data) {
    // Doppelstart verhindern
    document.querySelectorAll('.mr-overlay').forEach(n => n.remove());

    // iOS Audio sofort entsperren (noch in der User-Geste)
    unlockAudio();

    // Overlay + Loading-State zeigen
    const overlay = document.createElement('div');
    overlay.className = 'mr-overlay';
    overlay.innerHTML = `
      <div class="mr-loader">
        <div class="mr-loader-dot"></div>
        <div class="mr-loader-dot"></div>
        <div class="mr-loader-dot"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    let aborted = false;

    // Spotify einmal am Start sanft auf 8% ducken — läuft dann leise im Hintergrund
    if (window._spotifyPlayer) {
      try { window._spotifyPlayer.setVolume(0.08); } catch {}
    }

    const cleanup = () => {
      if (aborted) return;
      aborted = true;
      // Spotify zurück auf Normallautstärke
      if (window._spotifyPlayer) {
        try { window._spotifyPlayer.setVolume(window.SPOTIFY_VOLUME_NORMAL || 0.25); } catch {}
      }
      overlay.classList.add('closing');
      const rm = () => overlay.remove();
      overlay.addEventListener('transitionend', rm, { once: true });
      setTimeout(rm, 700);
    };
    overlay.addEventListener('click', cleanup);

    // ── ALLE 4 TTS-AUDIOS GLEICHZEITIG VORLADEN ──
    // Muss vor dem ersten await-Sprung passieren, damit iOS-Autoplay gilt
    const narrations = buildNarrations(data);
    const audioPromises = narrations.map(n => window.googleTTS(n).catch(e => {
      console.warn('[MR] TTS Fehler:', e); return null;
    }));
    const audios = await Promise.all(audioPromises);

    if (aborted) return;

    // Hint einblenden
    const hint = document.createElement('div');
    hint.className = 'mr-hint';
    hint.textContent = 'Tippen zum Schließen';
    overlay.appendChild(hint);

    // ── Slide-Helfer ──
    const renders = [renderSlide1, renderSlide2, renderSlide3, renderSlide4];

    async function showSlide(index) {
      if (aborted) return;

      const slide = document.createElement('div');
      slide.className = 'mr-slide';
      overlay.appendChild(slide);

      const animate = renders[index](slide, data);

      // Loader oder vorherigen Slide rausanimieren
      const prev = overlay.querySelector('.mr-slide.active, .mr-loader');
      if (prev) {
        prev.classList.remove('active');
        prev.classList.add('leaving');
        setTimeout(() => prev.remove(), 500);
      }

      // White-Flash Pause
      await sleep(index === 0 ? 80 : 420);
      if (aborted) { slide.remove(); return; }

      slide.classList.add('active');
      if (typeof animate === 'function') animate();

      // Vorab-geladenes Audio abspielen (Spotify läuft leise im Hintergrund)
      await playAndWait(audios[index]);
    }

    // ── 4 Slides nacheinander ──
    for (let i = 0; i < 4; i++) {
      await showSlide(i);
      if (aborted) return;
      // Kurze Pause zwischen Slides
      if (i < 3) await sleep(300);
    }

    // Ende: 1 Sekunde warten, dann ausfaden
    if (!aborted) {
      await sleep(1000);
      cleanup();
    }
  };
})();
