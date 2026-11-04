/* =========================================================
   story.js - scroll, sprites, step -> state mapping.
   Only talks to the chart through window.LeaderChart.
   Needs: d3 (via chart.js), scrollama, chart.js loaded first.
   ========================================================= */
(function () {
  "use strict";

  // ---------- CONFIG (tweak here) ----------
  const rep = (v, c) => Array(c).fill(v);   // rep(0, 3) -> [0, 0, 0]
  const CONFIG = {
    // Step order = storyboard order. Steps 1A..4B map to static/1..8.webp in the same order.
    stepOrder: ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B", "5A", "5AA", "5AAA", "5AAAA", "5AB", "5B", "5BB"],
    tallStep: "6",                 // the scroll-linked unfold step
    scrollamaOffset: 0.5,          // when a step counts as active (0..1 of viewport)
    // Each step change plays only in the middle of the gap between two steps.
    // 0.2 = 20% hold at each end, 60% transition. 0 = constantly moving.
    holdFraction: 0.2,

    // Step 6 and flicker mode (in viewport heights)
    unfold: { step6Vh: 3 },        // height of step 6; the unfold is spread over it
    flicker: { vhPerRow: 0.15,     // scroll distance per leader
               zoomVh: 1 },        // scroll distance of the zoom from overview to full size

    // One value per step in stepOrder (15 values each).
    // Dates: "start" = birthdate of the youngest leader (left edge of the intro window),
    // or an ISO date. Opacities: 0..1.
    keys: {
      //             1A 1B   2A  2B   3A  3B   4A  4B   5A 5AA 5AAA 5AAAA 5AB 5B 5BB
      topDate:    ["start", "start", "2022-01-01", "2022-01-01", ...rep("2026-03-01", 11)],
      bottomDate: ["start", "start", "start", "2022-01-01", "2022-01-01", ...rep("2026-03-01", 10)],
      topPerson:    [1, 0.15, 1, 0.15, 1, 0.15, 1, 0.15, 1, 0.2, 0.2, 0.2, 0.2, 1, 1],
      bottomPerson: [0, 1, 0.15, 1, 0.15, 1, 0.15, 1, 1, 0.2, 0.2, 0.2, 0.2, 1, 1],
      topBar:    [1, 0.25, 1, 0.25, 1, 0.25, 1, 0.25, ...rep(1, 4), 0.2, 1, 1],
      bottomBar: [0, 1, 0.4, 1, 0.4, 1, 0.4, 1, ...rep(1, 4), 0.2, 1, 1],
      domainT:   [...rep(0, 8), ...rep(1, 7)],

      // Opacity of the birth line, the lifespan bar and the tenure part of the bars
      birthPart: [...rep(1, 9), 1,   0, 0.1, 1, 1, 1],
      lifePart:  [...rep(1, 9), 0.1, 1, 0.1, 1, 1, 1],
      nowPart:   [...rep(1, 9), 0.05, 0, 1,   1, 1, 1],

      // Biya's row slot (1 = directly under Balen)
      bottomSlot: [...rep(1, 12), 3, 3, 4],

      // Vertical shift of all intro bars (and persons, years, names). 0 = current position.
      // Intro steps 1A-4B (first 8 values): "auto" = centre the persons vertically in the stage,
      // on any screen. Use a number (stage units) to override. 5A onwards stays 0.
      shiftY: [...rep("auto", 8), ...rep(0, 7)]
    },
    colouredFromStep: 13,           // bars get their regime colour from 5B (index 13)

    // Intro timeline: each tick fades in at its step and hides at its hide step.
    // date: "start" = birth of the youngest leader (left edge), or an ISO date.
    introTicks: [
      { label: "1990", date: "start",      step: "1A",  hide: "5A" },
      { label: "2022", date: "2022-01-01", step: "2A",  hide: "5A" },
      { label: "2026", date: "2026-03-01", step: "3A",  hide: "5A" } // adjust the exact date to taste
    ],
    // Extra leaders shown in the intro. match = part of the leader's name in the CSV (lowercase).
    // from = the step they walk in from. slot / opacity = one value per step in stepOrder.
    extras: [
      { name: "putin",     match: "putin",     from: "5AAAA",
        slot: [...rep(1, 14), 2], opacity: [...rep(0, 12), 1, 1, 1],
        label: "Vladimir Putin", labelOpacity: [...rep(0, 12), 1, 1, 1] },
      { name: "trump",     match: "trump",     from: "5AAAA",
        slot: [...rep(2, 14), 3], opacity: [...rep(0, 12), 1, 1, 1],
        label: "Donald Trump",   labelOpacity: [...rep(0, 12), 1, 1, 1] },
      { name: "doumbouya", match: "doumbouya", from: "5B",
        slot: rep(1, 15),         opacity: [...rep(0, 14), 1],
        label: "Mamady Doumbouya", labelOpacity: [...rep(0, 14), 1] }
    ],
    // Names written in the top and bottom bar. row: "first" = top bar, "last" = bottom bar.
    labels: [
      { row: "first", label: "Balendra Shah", opacity: [...rep(0, 8), ...rep(1, 7)] },
      { row: "last",  label: "Paul Biya",     opacity: [...rep(0, 8), ...rep(1, 7)] }
    ],
    // Persons (sprite sheets, 6 cols x 3 rows, frame 400x600)
    persons: {
      widthPct: 20,                // width in % of stage width
      feetGap: 2,                  // stage units between feet and top of bar
      offsetRight: 24,             // how far right of the bar end the persons stand from 5A on
      zigGap: 15,                  // stage units: extra shift to the right for every second row
      exitU: 0.2,                  // step 6: persons are gone after this part of the unfold (0..1)
      exitDistance: 500,           // step 6: how far (stage units) they walk to the right while fading
      walkStartGap: 90,            // extras start this far left of their bar's start when walking in
      flipX: false,
      flipWhenReversing: false,
      cols: 6, rows: 3,
      fps: { idle: 5, walk: 12 },
      walkSettleMs: 150,
      smallScale: 0.5,             // size of the persons from 5A on (1 = same as before)
      top: {
        src: "static/balen_V2.png",
        rows: 4,
        idle:    { row: 0, frames: 4 },   // young static
        walk:    { row: 3, frames: 6 },   // young walking
        oldIdle: { row: 1, frames: 4 },   // old static
        oldWalk: { row: 2, frames: 6 },   // old walking
        oldFrom: 1.5,                     // old Balen starts fading in here (1.5 = halfway 1B -> 2A)
        oldFadeLen: 0.2                   // fade length, in steps
      },
      bottom:    { src: "static/biya_V2.png",      idle: { row: 0, frames: 4 }, walk: { row: 1, frames: 6 } },
      putin:     { src: "static/putin_V2.png",     idle: { row: 0, frames: 4 }, walk: { row: 1, frames: 6 } },
      trump:     { src: "static/trump_V2.png",     idle: { row: 0, frames: 4 }, walk: { row: 1, frames: 6 } },
      doumbouya: { src: "static/doumbouya_V2.png", idle: { row: 0, frames: 4 }, walk: { row: 1, frames: 6 } }
    }
  };

  // ---------- Setup ----------
  const LC = window.LeaderChart;
  const $ = s => document.querySelector(s);
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dvhOK = !!(window.CSS && CSS.supports && CSS.supports("height", "1dvh"));
  const UNIT = dvhOK ? "dvh" : "vh";
  const N = CONFIG.stepOrder.length;
  const _d = new Date();
  const TODAY_MS = Date.UTC(_d.getFullYear(), _d.getMonth(), _d.getDate());

  const stage = $("#stage");
  const errBox = $("#load-error");
  const live = $("#info-live");
  const track = $("#flicker-track");
  const root = document.documentElement;

  let leaders = [], n = 0;
  let keys = null;                  // resolved keys (dates in ms)
  let frameEls = [], stepEls = [], persons = {};
  let vh = window.innerHeight, centers = [], T6 = 0, H6 = 0, Tf = 0;
  let scroller = null;

  // What was last applied, so work is only done when something changed
  const last = {
    y: -1, force: true, phase: null, introKey: null, unfoldKey: null,
    idx: -1, cam: 0, zoom: 0, frameOps: []
  };

  function showError(msg) {
    console.error("[story]", msg);
    errBox.textContent = "Sorry, the story could not be loaded. " + msg;
    errBox.hidden = false;
  }

  // ---------- Init ----------
  async function init() {
    if (!LC) { showError("chart.js did not load."); return; }
    try {
      await LC.loadData();
      fitView();
      LC.drawChart("#chart-svg");
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
      return;
    }
    leaders = LC.getLeadersSorted();
    n = leaders.length;

    resolveKeys();
    setupFrames();
    setupPersons();
    setupSearch();
    setupScrollama();
    layout();

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.addEventListener("load", layout);

    requestAnimationFrame(update);
  }

  // Turn "start" / ISO strings in CONFIG.keys into ms
  function resolveKeys() {
    const startMs = leaders[0].birthMs;
    const conv = arr => arr.map(v => {
      if (v === "start") return startMs;
      const d = Date.parse(v + "T00:00:00Z");
      if (isNaN(d)) { console.warn("[story] Bad date in CONFIG.keys:", v); return startMs; }
      return d;
    });
    keys = {
      topDate: conv(CONFIG.keys.topDate),
      bottomDate: conv(CONFIG.keys.bottomDate)
    };
    ["topPerson", "bottomPerson", "topBar", "bottomBar", "domainT",
     "birthPart", "lifePart", "nowPart", "bottomSlot", "shiftY"].forEach(k => {
      keys[k] = CONFIG.keys[k];
      if (keys[k].length !== N) console.warn("[story] CONFIG.keys." + k + " should have " + N + " values");
    });
    // "auto" shift: the stage is always 1920 units high (width varies), so centring in
    // stage units is the same as centring in the viewport, on mobile and desktop.
    const autoShift = introCentreShift();
    keys.shiftY = keys.shiftY.map(v => v === "auto" ? autoShift : v);
    keys.introTicks = CONFIG.introTicks.map(t => ({
      label: t.label,
      idx: CONFIG.stepOrder.indexOf(t.step),
      hideIdx: t.hide ? CONFIG.stepOrder.indexOf(t.hide) : Infinity,
      ms: t.date === "start" ? startMs : Date.parse(t.date + "T00:00:00Z")
    }));
    keys.extras = CONFIG.extras.map(e => {
      const index = leaders.findIndex(l => l.leader.toLowerCase().includes(e.match));
      if (index < 0) console.warn("[story] No leader found for extra '" + e.name + "' (match: " + e.match + ")");
      if (e.slot.length !== N || e.opacity.length !== N) console.warn("[story] extra '" + e.name + "' needs " + N + " values");
      return { name: e.name, index, slot: e.slot, opacity: e.opacity, walkFrom: CONFIG.stepOrder.indexOf(e.from),
               label: e.label || "", labelOpacity: e.labelOpacity || rep(0, N) };
    });
    keys.labels = CONFIG.labels.map(l => ({
      index: l.row === "first" ? 0 : n - 1,
      label: l.label,
      labelOpacity: l.opacity
    }));
  }

  // Vertical shift that puts the group of intro persons (Balen's head down to Biya's feet)
  // in the middle of the stage. Person height = width * 3/2 (sprite frame is 400x600).
  function introCentreShift() {
    const VC = LC.CONFIG.view, I = LC.CONFIG.intro, P = CONFIG.persons;
    const personH = P.widthPct / 100 * VC.w * 1.5;
    const top = I.topY - P.feetGap - personH;       // top of Balen
    const bottom = I.bottomY - P.feetGap;            // Biya's feet
    return Math.round(VC.h / 2 - (top + bottom) / 2);
  }

  function setupFrames() {
    frameEls = Array.from(document.querySelectorAll("#frames img"));
    frameEls.forEach(img => { img.style.opacity = 0; });
  }

  function setupPersons() {
    stage.style.setProperty("--person-w", CONFIG.persons.widthPct);
    const base = CONFIG.persons.flipX ? -1 : 1;
    ["top", "bottom", "putin", "trump", "doumbouya"].forEach(name => {
      const el = $("#person-" + name);
      if (!el) { console.warn("[story] #person-" + name + " missing in index.html"); return; }
      const sprite = el.querySelector(".person__sprite");
      sprite.style.backgroundImage = 'url("' + CONFIG.persons[name].src + '")';
      const cfgP = CONFIG.persons[name];
      sprite.style.backgroundSize = "600% " + ((cfgP.rows || CONFIG.persons.rows) * 100) + "%";
      let sprite2 = null;
      if (cfgP.oldIdle) {                                   // second layer for the old version
        sprite2 = sprite.cloneNode(false);
        sprite2.style.position = "absolute";
        sprite2.style.left = "0";
        sprite2.style.top = "0";
        sprite2.style.opacity = 0;
        el.appendChild(sprite2);
      }
      el.style.transition = "none";      // opacity is scroll-linked
      el.style.opacity = 0;
      persons[name] = {
        name, el, sprite, sprite2, oldMix: 0, cfg: CONFIG.persons[name], base,
        x: null, lastMove: -1e9, dir: 1, key: "", flip: null, op: -1, vx: "", vy: ""
      };
    });
  }

  function setupScrollama() {
    stepEls = Array.from(document.querySelectorAll(".step"));
    if (stepEls[0]) stepEls[0].classList.add("is-active");
    if (typeof scrollama !== "function") {
      console.warn("[story] scrollama not loaded; text highlight disabled");
      stepEls.forEach(s => s.classList.add("is-active"));
      return;
    }
    scroller = scrollama();
    scroller
      .setup({ step: ".step", offset: CONFIG.scrollamaOffset })
      .onStepEnter(r => {
        stepEls.forEach(s => s.classList.toggle("is-active", s === r.element));
      });
  }

  // Stage aspect ratio -> chart width in SVG units (1080 on mobile, wider on desktop)
  function fitView() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w > 0 && h > 0) LC.setViewWidth(LC.CONFIG.view.h * w / h);
  }

  // ---------- Layout measuring (only on load / resize) ----------
  function layout() {
    fitView();
    positionSearch();
    vh = window.innerHeight;
    root.style.setProperty("--step6-h", CONFIG.unfold.step6Vh * 100 + UNIT);
    // +100 so the last leader also gets a full pace before the stage is released
    track.style.height = (CONFIG.flicker.zoomVh * 100 + n * CONFIG.flicker.vhPerRow * 100 + 100) + UNIT;

    const sy = window.scrollY || window.pageYOffset;
    centers = CONFIG.stepOrder.map(id => {
      const e = document.querySelector('.step[data-step="' + id + '"]');
      if (!e) return 0;
      const r = e.getBoundingClientRect();
      return r.top + sy + r.height / 2;
    });
    const e6 = document.querySelector('.step[data-step="' + CONFIG.tallStep + '"]');
    const r6 = e6.getBoundingClientRect();
    T6 = r6.top + sy;
    H6 = r6.height;
    Tf = track.getBoundingClientRect().top + sy;
    last.force = true;
  }

  let resizeQueued = false;
  function onResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      layout();
      if (scroller) scroller.resize();
    });
  }

  // ---------- Scroll position -> fractional step ----------
  function fractionalStep(y) {
    const yy = y + vh / 2;
    if (yy <= centers[0]) return 0;
    for (let i = 0; i < N - 1; i++) {
      if (yy < centers[i + 1]) return i + (yy - centers[i]) / Math.max(1, centers[i + 1] - centers[i]);
    }
    return N - 1;
  }

  // Hold at each step, transition in the middle of the gap (smoothstep)
  function effective(f) {
    const i = Math.floor(f);
    if (i >= N - 1) return N - 1;
    const a = CONFIG.holdFraction;
    let t = clamp01((f - i - a) / (1 - 2 * a));
    t = t * t * (3 - 2 * t);
    return i + t;
  }

  function lerpKey(arr, f) {
    const i = Math.min(Math.floor(f), arr.length - 2);
    const t = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }

  // ---------- Phase handling ----------
  function enterPhase(phase) {
    if (last.phase === phase) return;
    const prev = last.phase;
    last.phase = phase;
    stage.dataset.mode = phase;

    if (phase === "intro") {
      last.cam = 0;
      last.zoom = 0;
      last.unfoldKey = null;
    } else {
      last.introKey = null;
      hideFrames();
    }
    if (phase !== "flicker" && prev === "flicker") clearFlicker();
  }

  function hideFrames() {
    frameEls.forEach((img, i) => { img.style.opacity = 0; last.frameOps[i] = 0; });
  }

  function clearFlicker() {
    if (last.idx !== -1) {
      LC.clearHighlight();
      last.idx = -1;
      live.textContent = "";
    }
  }

  // ---------- Main loop (one rAF; work only when something changed) ----------
  function update(now) {
    requestAnimationFrame(update);
    const y = window.scrollY || window.pageYOffset;
    const changed = y !== last.y || last.force;
    last.y = y;
    last.force = false;

    if (y < T6 - 1) {
      // ----- Intro: steps 1A..5BB -----
      enterPhase("intro");
      setSearchVisible(0);
      const fEff = effective(fractionalStep(y));
      if (changed) applyIntro(fEff);
      updatePersons(fEff, now);
      return;
    }

    // ----- Step 6 + flicker mode -----
    const inFlicker = y >= Tf;
    enterPhase(inFlicker ? "flicker" : "chart");

    const u = clamp01((y - T6) / Math.max(1, H6 - vh));
    exitPersons(u, now);

    const cf = LC.CONFIG.chromeFadeStart;
    setSearchVisible(inFlicker ? 1 : clamp01((u - cf) / (1 - cf)));
    const uKey = u.toFixed(4);
    if (uKey !== last.unfoldKey) {
      last.unfoldKey = uKey;
      LC.setUnfold(u);
    }

    if (inFlicker) {
      // Part 1: zoom from the overview to full-size bars, names fade in. No highlight yet.
      const zoomPx = Math.max(1, CONFIG.flicker.zoomVh * vh);
      const zRaw = clamp01((y - Tf) / zoomPx);
      const z = zRaw * zRaw * (3 - 2 * zRaw);
      if (z !== last.zoom) { last.zoom = z; LC.setZoom(z); }

      if (zRaw < 1) {
        clearFlicker();
        if (last.cam !== 0) { last.cam = 0; LC.setCamera(0); }
      } else {
        // Part 2: the highlight walks down from the first row. Once it reaches 1/3 of the
        // screen, the chart scrolls instead. The camera stops when the oldest leader
        // reaches the bottom; the highlight then continues to the last row.
        const p = (y - Tf - zoomPx) / Math.max(1, CONFIG.flicker.vhPerRow * vh);
        const pc = Math.max(0, Math.min(n - 1, p));
        const idx = Math.floor(pc), fr = pc - idx;

        const ci = LC.getCameraInfo();
        let s = 0;
        if (fr > 0.4) { const t = (fr - 0.4) / 0.6; s = t * t * (3 - 2 * t); }
        const cam = Math.min(ci.max, Math.max(0, (idx + s - ci.anchor) * ci.pitch));
        if (cam !== last.cam) { last.cam = cam; LC.setCamera(cam); }

        if (idx !== last.idx) {
          last.idx = idx;
          live.textContent = LC.highlight(leaders[idx].id);
        }
      }
    } else {
      clearFlicker();
      if (last.cam !== 0) { last.cam = 0; LC.setCamera(0); }
      if (last.zoom !== 0) { last.zoom = 0; LC.setZoom(0); }
    }
  }

  // ---------- Intro state (bars + frames) ----------
  function applyIntro(f) {
    // Bars / chart view
    const domainT = lerpKey(keys.domainT, f);
    const topBar = lerpKey(keys.topBar, f);
    const bottomBar = lerpKey(keys.bottomBar, f);
    const coloured = f >= CONFIG.colouredFromStep - 0.5;
    // Bars grow up to each person's date; from 4B to 5A they open fully to today
    const rv = clamp01(f - 7);
    const revealTop = lerpKey(keys.topDate, f) + (TODAY_MS - lerpKey(keys.topDate, f)) * rv;
    const revealBottom = lerpKey(keys.bottomDate, f) + (TODAY_MS - lerpKey(keys.bottomDate, f)) * rv;

    // Intro timeline years: fade in at their step, fade out at their hide step
    const tickOps = keys.introTicks.map(t =>
      +(clamp01(f - t.idx + 1) * clamp01(t.hideIdx - f)).toFixed(3));

    // Opacity of the birth line, lifespan bar and tenure part
    const birthP = +lerpKey(keys.birthPart, f).toFixed(3);
    const lifeP  = +lerpKey(keys.lifePart, f).toFixed(3);
    const nowP   = +lerpKey(keys.nowPart, f).toFixed(3);
    const shiftY = +lerpKey(keys.shiftY, f).toFixed(1);

    // Biya's row slides down as rows are added; extras get slot + opacity
    const I = LC.CONFIG.intro;
    const bottomY = I.topY + lerpKey(keys.bottomSlot, f) * (I.bottomY - I.topY);
    const extraRows = keys.extras.filter(e => e.index >= 0).map(e => ({
      index: e.index,
      slot: +lerpKey(e.slot, f).toFixed(3),
      opacity: +clamp01(lerpKey(e.opacity, f)).toFixed(3),
      label: e.label,
      labelOpacity: +clamp01(lerpKey(e.labelOpacity, f)).toFixed(3)
    }));

    // Names in the top and bottom bar (same label layer as Putin and Trump)
    keys.labels.forEach(l => extraRows.push({
      index: l.index,
      label: l.label,
      labelOpacity: +clamp01(lerpKey(l.labelOpacity, f)).toFixed(3)
    }));

    // Only redraw when something changed
    const key = [domainT.toFixed(3), topBar.toFixed(3), bottomBar.toFixed(3), coloured,
      Math.round(revealTop / 864e5), Math.round(revealBottom / 864e5), tickOps.join(","), birthP, lifeP, nowP,
      bottomY.toFixed(1), shiftY,
      extraRows.map(e => e.slot + ":" + e.opacity + ":" + e.labelOpacity).join(",")].join("|");
    if (key !== last.introKey) {
      last.introKey = key;
      LC.setIntroTicks(keys.introTicks.map((t, i) => ({ label: t.label, ms: t.ms, opacity: tickOps[i] })));
      LC.setIntroState({
        domainT, coloured, topOpacity: topBar, bottomOpacity: bottomBar, legendOpacity: 0,
        revealTop, revealBottom,
        birthOpacity: birthP, lifeOpacity: lifeP, nowOpacity: nowP,
        bottomY, extraRows, shiftY
      });
    }

    // Artwork crossfade: frame i is fully visible at step i
    for (let i = 0; i < frameEls.length; i++) {
      const op = +clamp01(1 - Math.abs(f - i)).toFixed(3);
      if (op !== last.frameOps[i]) {
        last.frameOps[i] = op;
        frameEls[i].style.opacity = op;
      }
    }
  }

  // ---------- Persons ----------
  function updatePersons(f, now) {
    const P = CONFIG.persons;
    const t = clamp01(f - 7);                                   // 0 until 4B, 1 from 5A on
    const off = t * P.offsetRight;
    const wPct = P.widthPct * (1 - t * (1 - P.smallScale));
    // 0 for even slots, zigGap for odd slots, smooth in between
    const zig = s => (1 - Math.abs(1 - (((s % 2) + 2) % 2))) * P.zigGap;

    if (persons.top){
      const T = persons.top.cfg;
      persons.top.oldMix = clamp01((f - T.oldFrom) / T.oldFadeLen);
    }
    placePerson(persons.top, 0, lerpKey(keys.topDate, f), lerpKey(keys.topPerson, f), now,
      off + zig(0), null, wPct);
    placePerson(persons.bottom, n - 1, lerpKey(keys.bottomDate, f), lerpKey(keys.bottomPerson, f), now,
      off + zig(lerpKey(keys.bottomSlot, f)), null, wPct);
    keys.extras.forEach(e => {
      const p = persons[e.name];
      if (!p || e.index < 0) return;
      placePerson(p, e.index, lerpKey(keys.topDate, f), lerpKey(e.opacity, f), now,
        off + zig(lerpKey(e.slot, f)), clamp01(f - e.walkFrom), wPct);
    });
  }

  // Step 6: persons keep their last intro position, walk right and fade out
  function exitPersons(u, now) {
    if (persons.top) persons.top.oldMix = 1;   // safe if the page is entered past 2A (e.g. search jump)
    const P = CONFIG.persons;
    const tt = clamp01(u / P.exitU);
    const wPct = P.widthPct * P.smallScale;
    const list = [[persons.top, lerpKey(keys.topPerson, N - 1)],
                  [persons.bottom, lerpKey(keys.bottomPerson, N - 1)]];
    keys.extras.forEach(e => list.push([persons[e.name], lerpKey(e.opacity, N - 1)]));
    list.forEach(([p, base]) => {
      if (p) placePerson(p, 0, 0, base * (1 - tt), now, 0, null, wPct, tt);
    });
  }

  // walk: null = no walking, 0 = left of the bar ... 1 = resting place
  // exit: null = intro placement, 0..1 = step 6 exit progress
  function placePerson(p, rowIndex, dateMs, op, now, dx, walk, wPct, exit) {
    op = +op.toFixed(3);
    if (op <= 0.003) {
      if (p.op !== 0) { p.el.style.opacity = 0; p.op = 0; }
      return;
    }
    const k = 100 / LC.VIEW.w;                       // stage units -> cqw
    let xs, ys;
    if (exit == null) {
      const geo = LC.getBarGeometry(rowIndex);
      if (!geo) return;
      xs = geo.xAt(dateMs) + (dx || 0);              // resting place, right of the bar
      if (walk != null) {
        const x0 = geo.xBirth - CONFIG.persons.walkStartGap;
        xs = x0 + (xs - x0) * walk;
      }
      ys = geo.cy - CONFIG.persons.feetGap;
      p.restX = xs; p.restY = ys;                    // remembered for the step 6 exit
    } else {
      if (p.restX == null) return;
      xs = p.restX + exit * CONFIG.persons.exitDistance;
      ys = p.restY;
    }
    const x = xs * k;
    const y = ys * k;

    const ws = ((wPct || CONFIG.persons.widthPct) * LC.CONFIG.view.w / LC.VIEW.w).toFixed(3);
    if (ws !== p.w) { p.el.style.width = ws + "cqw"; p.w = ws; }

    // Movement detection (drives walk / idle)
    if (p.x !== null) {
      const moved = x - p.x;
      if (Math.abs(moved) > 0.02) { p.lastMove = now; p.dir = moved > 0 ? 1 : -1; }
    }
    p.x = x;

    const vx = x.toFixed(3), vy = y.toFixed(3);
    if (vx !== p.vx) { p.el.style.setProperty("--x", vx); p.vx = vx; }
    if (vy !== p.vy) { p.el.style.setProperty("--y", vy); p.vy = vy; }
    if (op !== p.op) { p.el.style.opacity = op; p.op = op; }

// Sprite state
const c = CONFIG.persons;
const moving = !reduced && (now - p.lastMove) < c.walkSettleMs;
const rows = p.cfg.rows || c.rows;
const fps = moving ? c.fps.walk : c.fps.idle;
const yS = moving ? p.cfg.walk : p.cfg.idle;
const oS = p.sprite2 ? (moving ? p.cfg.oldWalk : p.cfg.oldIdle) : null;
const mix = p.sprite2 ? +p.oldMix.toFixed(3) : 0;
const frame = reduced ? 0 : Math.floor(now / 1000 * fps) % yS.frames;
const key = (moving ? "w" : "i") + frame + "|" + mix;
if (key !== p.key) {
  p.key = key;
  const px = (frame / (c.cols - 1)) * 100;
  p.sprite.style.backgroundPosition = px + "% " + ((yS.row / (rows - 1)) * 100) + "%";
  if (oS) {
    p.sprite2.style.backgroundPosition = px + "% " + ((oS.row / (rows - 1)) * 100) + "%";
    p.sprite2.style.opacity = mix;
    p.sprite.style.opacity = mix >= 1 ? 0 : 1;   // young stays solid under the fade, no dip
  }
}

    // Facing
    const flip = (c.flipWhenReversing && moving && p.dir < 0) ? -p.base : p.base;
    if (flip !== p.flip) { p.el.style.setProperty("--flip", flip); p.flip = flip; }
  }

  // ---------- Search ----------
  const searchEl = $("#search"), searchInput = $("#search-input"), searchList = $("#search-list");
  let searchIndex = [], searchHits = [], searchActive = -1, searchVis = -1;

  const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  function setupSearch() {
    if (!searchEl) return;
    searchIndex = leaders.map((l, i) => ({
      i, country: l.country, leader: l.leader, c: norm(l.country), n: norm(l.leader)
    }));

    searchInput.addEventListener("input", () => {
      searchHits = findLeaders(searchInput.value);
      searchActive = searchHits.length ? 0 : -1;
      renderSearchList();
    });
    searchInput.addEventListener("focus", () => {
      if (searchInput.value) searchInput.dispatchEvent(new Event("input"));
    });
    searchInput.addEventListener("keydown", e => {
      const len = searchHits.length;
      if (e.key === "ArrowDown" && len) { e.preventDefault(); setActive((searchActive + 1) % len); }
      else if (e.key === "ArrowUp" && len) { e.preventDefault(); setActive((searchActive - 1 + len) % len); }
      else if (e.key === "Enter" && len) { e.preventDefault(); chooseHit(Math.max(0, searchActive)); }
      else if (e.key === "Escape") {
        if (!searchList.hidden) closeSearchList();
        else searchInput.value = "";
      }
    });
    document.addEventListener("pointerdown", e => {
      if (!searchEl.contains(e.target)) closeSearchList();
    });
  }

  // Every word you type must appear in "country leader"; matches at the start rank first
  function findLeaders(raw) {
    const q = norm(raw);
    if (!q) return [];
    const toks = q.split(/\s+/);
    return searchIndex.map(f => {
      const hay = f.c + " " + f.n;
      if (!toks.every(t => hay.includes(t))) return null;
      let s = 1;
      if (f.c.startsWith(q) || f.n.startsWith(q)) s = 3;
      else if (toks.every(t => hay.startsWith(t) || hay.includes(" " + t))) s = 2;
      return { f, s };
    }).filter(Boolean)
      .sort((a, b) => b.s - a.s || a.f.c.localeCompare(b.f.c))
      .slice(0, 40)
      .map(x => x.f);
  }

  function renderSearchList() {
    searchList.textContent = "";
    searchHits.forEach((f, j) => {
      const li = document.createElement("li");
      li.className = "search__opt";
      li.id = "search-opt-" + j;
      li.setAttribute("role", "option");
      const a = document.createElement("span"); a.textContent = f.country;
      const b = document.createElement("small"); b.textContent = f.leader;
      li.append(a, b);
      li.addEventListener("mousedown", e => e.preventDefault());   // keep focus until click
      li.addEventListener("click", () => chooseHit(j));
      searchList.appendChild(li);
    });
    const hasQuery = norm(searchInput.value) !== "";
    if (hasQuery && !searchHits.length) {
      const li = document.createElement("li");
      li.className = "search__none";
      li.textContent = "No match";
      searchList.appendChild(li);
    }
    searchList.hidden = !hasQuery;
    searchInput.setAttribute("aria-expanded", hasQuery ? "true" : "false");
    setActive(searchActive);
  }

  function setActive(j) {
    searchActive = j;
    Array.from(searchList.querySelectorAll(".search__opt")).forEach((li, k) => {
      li.setAttribute("aria-selected", k === j ? "true" : "false");
      if (k === j) li.scrollIntoView({ block: "nearest" });
    });
    if (j >= 0) searchInput.setAttribute("aria-activedescendant", "search-opt-" + j);
    else searchInput.removeAttribute("aria-activedescendant");
  }

  function closeSearchList() {
    searchList.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }

  function chooseHit(j) {
    const f = searchHits[j];
    if (!f) return;
    searchInput.value = f.country;
    closeSearchList();
    searchInput.blur();                 // closes the keyboard on mobile
    goToLeader(f.i);
  }

  // Scroll to the spot where the highlight sits on this leader's row
  function goToLeader(idx) {
    const rowPx = Math.max(1, CONFIG.flicker.vhPerRow * vh);
    const target = Tf + CONFIG.flicker.zoomVh * vh + (idx + 0.02) * rowPx;
    window.scrollTo({ top: Math.round(target), behavior: reduced ? "auto" : "smooth" });
  }

  // Below the legend, aligned with its left edge (stage units -> cqw)
  function positionSearch() {
    if (!searchEl) return;
    const k = 100 / LC.VIEW.w, L = LC.CONFIG.legend;
    searchEl.style.left = (LC.CONFIG.x.left * k) + "cqw";
    searchEl.style.top = ((L.y + L.swatch + 18) * k) + "cqw";
  }

  // v = 0..1, same fade as the legend
  function setSearchVisible(v) {
    if (!searchEl) return;
    v = +v.toFixed(2);
    if (v === searchVis) return;
    searchVis = v;
    searchEl.style.opacity = v;
    searchEl.style.visibility = v > 0.01 ? "visible" : "hidden";
    searchEl.style.pointerEvents = v > 0.6 ? "auto" : "none";
    if (v <= 0.01) closeSearchList();
  }

  // ---------- Go ----------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();