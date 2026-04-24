/* ══════════════════════════════════════════════════════════════
   Morning Report — Fullscreen Slideshow mit TTS-Synchronisation
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Google TTS Interface ──────────────────────────────────────
  // Gibt ein Audio-Element zurück, das via .play() abgespielt werden kann.
  // Nutzt window.GOOGLE_TTS_KEY (muss in dashboard.js gesetzt sein).
  if (!window.googleTTS) {
    window.googleTTS = async function (text) {
      const key = window.GOOGLE_TTS_KEY;
      if (!key) throw new Error('GOOGLE_TTS_KEY nicht gesetzt (window.GOOGLE_TTS_KEY)');
      const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input:       { text },
            voice:       { languageCode: 'de-DE', name: 'de-DE-Wavenet-F' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95, pitch: 0 },
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `TTS HTTP ${res.status}`);
      }
      const { audioContent } = await res.json();
      if (!audioContent) throw new Error('Keine Audio-Daten erhalten');
      return new Audio('data:audio/mpeg;base64,' + audioContent);
    };
  }

  // ── Utilities ────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Haupt-Funktion ───────────────────────────────────────────
  window.startMorningReportOverlay = async function (data) {
    // Doppelstart verhindern
    document.querySelectorAll('.mr-overlay').forEach(n => n.remove());

    // Overlay erstellen
    const overlay = document.createElement('div');
    overlay.className = 'mr-overlay';
    overlay.innerHTML = `<div class="mr-hint">Tippen zum Schließen</div>`;
    document.body.appendChild(overlay);

    // ── State ──
    let aborted = false;
    let currentAudio = null;
    let currentTimer = null;

    const cleanup = () => {
      if (aborted) return;
      aborted = true;
      if (currentAudio) {
        try { currentAudio.pause(); currentAudio.src = ''; } catch {}
        currentAudio = null;
      }
      if (currentTimer) { clearTimeout(currentTimer); currentTimer = null; }
      if (window.spotifyDuck) { try { window.spotifyDuck(false); } catch {} }
      overlay.classList.add('closing');
      const remove = () => overlay.remove();
      overlay.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 600);
    };
    overlay.addEventListener('click', cleanup);

    // Fade-in
    requestAnimationFrame(() => overlay.classList.add('visible'));

    // ── Slide-Runner ──
    // Zeigt Slide (mit White-Flash zwischen Slides), spielt TTS, wartet bis Audio endet
    async function runSlide(renderFn, narration) {
      if (aborted) return;

      // Neuen Slide vorbereiten
      const slide = document.createElement('div');
      slide.className = 'mr-slide';
      overlay.appendChild(slide);
      renderFn(slide);

      // Vorherigen Slide rausanimieren
      const prev = overlay.querySelector('.mr-slide.active');
      if (prev) {
        prev.classList.remove('active');
        prev.classList.add('leaving');
        setTimeout(() => prev.remove(), 420);
      }

      // White-Flash Pause (380ms für nachfolgende, 60ms für ersten Slide)
      await sleep(prev ? 380 : 60);
      if (aborted) { slide.remove(); return; }

      // Slide einfaden
      slide.classList.add('active');
      if (typeof slide._animate === 'function') slide._animate();

      // TTS starten + warten
      try {
        const audio = await window.googleTTS(narration);
        if (aborted) return;
        currentAudio = audio;

        // Spotify auf 10% ducken
        if (window.spotifyDuck) { try { window.spotifyDuck(true); } catch {} }

        await new Promise((resolve) => {
          audio.addEventListener('ended', resolve, { once: true });
          audio.addEventListener('error', resolve, { once: true });
          audio.play().catch(resolve);
          // Sicherheits-Timer: falls onended nicht feuert
          currentTimer = setTimeout(resolve, 45_000);
        });

        if (currentTimer) { clearTimeout(currentTimer); currentTimer = null; }
        currentAudio = null;
      } catch (e) {
        console.warn('[Morning Report] TTS-Fehler:', e);
        if (aborted) return;
        // Fallback: Slide 3,5 Sekunden zeigen und weiter
        await sleep(3500);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // SLIDE 1 — ZEIT & DATUM
    // ═══════════════════════════════════════════════════════════
    const [hh, mm] = (data.time || '00:00').split(':').map(n => parseInt(n, 10) || 0);

    await runSlide((slide) => {
      slide.innerHTML = `
        <div class="mr-emoji lg">⏰</div>
        <div class="mr-time" data-target-hh="${hh}" data-target-mm="${mm}">00:00</div>
        <div class="mr-date">${esc(data.weekday || '')}${data.weekday ? ', ' : ''}${esc(data.date || '')}</div>
      `;
      slide._animate = () => {
        const el = slide.querySelector('.mr-time');
        if (!el) return;
        const targetMinutes = hh * 60 + mm;
        const duration = 800;
        const start = performance.now();
        const tick = (now) => {
          if (aborted) return;
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          const v = Math.round(targetMinutes * eased);
          const h = Math.floor(v / 60);
          const m = v % 60;
          el.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
          if (t < 1) requestAnimationFrame(tick);
          else el.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
        };
        // Erst nach kurzer Slide-Entry-Pause starten (Emoji/Time kommt in ~200ms)
        setTimeout(() => requestAnimationFrame(tick), 220);
      };
    }, `Es ist ${data.time} Uhr. ${data.weekday || ''}${data.weekday ? ', ' : ''}${data.date || ''}.`);

    if (aborted) return;

    // ═══════════════════════════════════════════════════════════
    // SLIDE 2 — TERMINE HEUTE
    // ═══════════════════════════════════════════════════════════
    const events = Array.isArray(data.events) ? data.events : [];
    const visibleEvents = events.slice(0, 6);
    const eventsHTML = visibleEvents.length
      ? visibleEvents.map(ev => `
          <div class="mr-event-item">
            <span class="mr-event-time">${esc(ev.time || '')}</span>
            <span class="mr-event-title">${esc(ev.title || '')}</span>
          </div>`).join('')
      : `<div class="mr-event-item" style="justify-content:center;color:#8e8e93;">
           <span class="mr-event-title">Keine Termine heute — freier Kopf.</span>
         </div>`;

    const firstThree = events.slice(0, 3).map(e => `${e.time} Uhr ${e.title}`).join('. ');
    const eventsNarration = events.length === 0
      ? 'Du hast heute keine Termine. Freier Kopf — nutze ihn.'
      : `Du hast ${events.length} ${events.length === 1 ? 'Termin' : 'Termine'} heute. ${firstThree}.`;

    await runSlide((slide) => {
      slide.innerHTML = `
        <div class="mr-emoji">📅</div>
        <div class="mr-eyebrow">Heute</div>
        <div class="mr-events">${eventsHTML}</div>
      `;
      slide._animate = () => {
        slide.querySelectorAll('.mr-event-item').forEach((el, i) => {
          setTimeout(() => el.classList.add('in'), 280 + i * 150);
        });
      };
    }, eventsNarration);

    if (aborted) return;

    // ═══════════════════════════════════════════════════════════
    // SLIDE 3 — PIPELINE
    // ═══════════════════════════════════════════════════════════
    const leads = Array.isArray(data.leads) ? data.leads : [];
    const shownLeads = leads.slice(0, 4);
    const pipelineHTML = shownLeads.length
      ? shownLeads.map(l => {
          const status = (l.status || 'KALT').toUpperCase();
          const cls = status === 'HOT'  ? 'mr-badge-hot'
                    : status === 'WARM' ? 'mr-badge-warm'
                    :                     'mr-badge-kalt';
          return `
            <div class="mr-pipeline-card">
              <span class="mr-badge ${cls}">${esc(status)}</span>
              <div class="mr-lead-name">${esc(l.name || '—')}</div>
              <div class="mr-lead-detail">${esc(l.detail || '')}</div>
            </div>`;
        }).join('')
      : `<div class="mr-pipeline-card" style="grid-column:1/-1;align-items:center;color:#8e8e93;text-align:center;">
           <div class="mr-lead-name" style="color:#8e8e93;">Pipeline ist leer</div>
           <div class="mr-lead-detail">Zeit neue Leads zu generieren.</div>
         </div>`;

    // Narration bauen
    const hot  = leads.filter(l => (l.status || '').toUpperCase() === 'HOT');
    const warm = leads.filter(l => (l.status || '').toUpperCase() === 'WARM');
    let pipelineNarration;
    if (!leads.length) {
      pipelineNarration = 'Deine Pipeline ist aktuell leer.';
    } else {
      const segs = ['Deine Pipeline.'];
      if (hot.length) {
        segs.push(hot.length === 1
          ? `Heiß: ${hot[0].name}${hot[0].detail ? ' — ' + hot[0].detail : ''}.`
          : `Heiße Leads: ${hot.map(l => l.name).join(', ')}.`);
      }
      if (warm.length) {
        const names = warm.slice(0, 3).map(l => l.name).join(', ');
        segs.push(`Warm: ${names}.`);
      }
      pipelineNarration = segs.join(' ');
    }

    await runSlide((slide) => {
      slide.innerHTML = `
        <div class="mr-emoji">🚀</div>
        <div class="mr-eyebrow">Pipeline</div>
        <div class="mr-pipeline-grid">${pipelineHTML}</div>
      `;
      slide._animate = () => {
        slide.querySelectorAll('.mr-pipeline-card').forEach((el, i) => {
          setTimeout(() => el.classList.add('in'), 300 + i * 200);
        });
      };
    }, pipelineNarration);

    if (aborted) return;

    // ═══════════════════════════════════════════════════════════
    // SLIDE 4 — FOKUS HEUTE
    // ═══════════════════════════════════════════════════════════
    const focusText = (data.focus || '').trim() || 'Kein Fokus gesetzt';
    const words = focusText.split(/\s+/);
    const wordsHTML = words
      .map(w => `<span class="mr-focus-word">${esc(w)}</span>`)
      .join(' ');

    await runSlide((slide) => {
      slide.innerHTML = `
        <div class="mr-emoji lg">🎯</div>
        <div class="mr-focus">${wordsHTML}</div>
        <div class="mr-focus-sub">Viel Erfolg, Simon 👊</div>
      `;
      slide._animate = () => {
        const wordEls = slide.querySelectorAll('.mr-focus-word');
        wordEls.forEach((el, i) => {
          setTimeout(() => el.classList.add('in'), 320 + i * 80);
        });
        const subDelay = 320 + words.length * 80 + 400;
        setTimeout(() => slide.querySelector('.mr-focus-sub')?.classList.add('in'), subDelay);
      };
    }, `Dein Fokus für heute: ${focusText}. Mach es. Viel Erfolg.`);

    if (aborted) return;

    // ── Ende: sanft ausfaden ──
    await sleep(900);
    cleanup();
  };
})();
