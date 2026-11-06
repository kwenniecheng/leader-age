/* =========================================================
   chart.js - data + drawing. Exposes window.LeaderChart.
   Knows nothing about scroll, sprites or text steps.
   Needs d3 v7 loaded first (see index.html).
   ========================================================= */
(function () {
  "use strict";

  // ---------- CONFIG (tweak here) ----------
  const CONFIG = {
    // File paths (relative, GitHub Pages safe)
    paths: {
      leaders: "data/leaders_230926.csv",
      previous: "data/previous_230926.csv"
    },

    // Regime colours (faded and solid parts share the same colour)
    colours: {
      autocracy: "#f38094",
      electoral_autocracy: "#f9ed43",
      electoral_democracy: "#70727c",
      liberal_democracy: "#70727c",
      unknown: "#e4eced"
    },
    fallbackColour: "#e4eced",   // unrecognised vdem value (+ console warning)
    neutralColour: "#121315",    // bars before they are colour-coded (steps 1A-5A)

    // Legend entries: label + key into colours
    legendItems: [
      { label: "Autocracy", key: "autocracy" },
      { label: "Electoral autocracy", key: "electoral_autocracy" },
      { label: "Democracy", key: "electoral_democracy" },
      { label: "Unknown", key: "unknown" }
    ],
    legend: { y: 52, swatch: 22, fontSize: 22 },

    // Stage coordinate system (same as the 1080x1920 artwork)
    view: { w: 1080, h: 1920 },

    // Horizontal extent of all bars (today sits at x.right)
    x: { left: 60, right: 960 },

    // Shared time window in the final chart
    domainStart: "1930-01-01",
    axisTicks: [1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020],

    // Intro bars: y = bar centre in the 1080x1920 space, barHeight in SVG units
    intro: { topY: 900, bottomY: 960, barHeight: 48 },

    // Final chart area (margins in SVG units). Row pitch is computed from row count.
    chart: { top: 240, bottom: 130 },
    barFraction: 10 / 12,        // bar height / row pitch (old Python: 10px in 12px)

    // Bar look
    lifespanOpacity: 0.2,
    restOpacity: 0.2,            // whole-row opacity of non-active rows in flicker mode
    birthLineWidth: 4,           // SVG units
    minBarWidth: 1.5,            // so very short tenures stay visible

    // Reveal/unfold: how much of the last part of the unfold fades in axis + legend
    chromeFadeStart: 0.55,

    // Axis
    axis: { labelOffset: 46, introGap: 30, introGridLen: 60 },

    // Intro timeline (only a few dates, shown during steps 1A-5B)
    introAxis: { y: 990 }
  };

  // ---------- Constants ----------
  const NS = "http://www.w3.org/2000/svg";
  const MS_YEAR = 365.2425 * 86400000;

  const parseISO = d3.utcParse("%Y-%m-%d");
  const fmtISO = d3.utcFormat("%Y-%m-%d");

  // "Today" as UTC midnight of the local date
  const _now = new Date();
  const TODAY_MS = Date.UTC(_now.getFullYear(), _now.getMonth(), _now.getDate());
  const DOMAIN_MS = +parseISO(CONFIG.domainStart);
  const BASE_W = CONFIG.view.w;
  let VW = BASE_W;                       // stage width in SVG units; wider than BASE_W on desktop
  const VH = CONFIG.view.h;
  const VIEW = { w: VW, h: VH };
  const X0 = CONFIG.x.left, X1 = CONFIG.x.right;

  // ---------- Internal state ----------
  const S = {
    ready: false,
    leaders: [],
    rows: [],
    rowById: new Map(),
    n: 0, B: 0, P: 0,
    topBig: 0, chartTop: 0, chartBottom: 0,
    youngestBirth: 0,
    // view state
    domainT: 0,          // 0 = window starts at youngest birth, 1 = 1930
    domainStart: null,
    xStamp: 0, cStamp: 0,
    coloured: false, colouredApplied: null,
    topOpacity: 1, bottomOpacity: 0,
    legendOpacity: 0,
    unfold: 0,
    dimmed: false, activeId: null,
    // transform of the rows group
    ty: null, ky: null,
    // chrome opacity cache
    chromeCache: {},
    introMap: {}, bottomY: 0, introPitch: 50,
    // opacity multipliers for the parts of every bar
    partB: 1, partL: 1, partN: 1, pStamp: 0,
    shiftY: 0
  };

  // ---------- Small helpers ----------
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function toMs(d) {
    if (d instanceof Date) return +d;
    if (typeof d === "number") return d;
    const p = parseISO(String(d));
    return p ? +p : NaN;
  }

  function el(parent, tag, attrs) {
    const node = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function setOpacityOnce(key, node, value) {
    if (S.chromeCache[key] === value) return;
    S.chromeCache[key] = value;
    node.setAttribute("opacity", value);
  }

  // ---------- Data loading + checks ----------
  function fetchCsv(path) {
    return d3.csv(path).catch(err => {
      throw new Error("Could not load " + path + " (" + (err && err.message ? err.message : err) + ")");
    });
  }

  // Trim keys/values, strip BOM, lowercase keys
  function cleanRows(rows) {
    return rows.map(r => {
      const o = {};
      Object.keys(r).forEach(k => {
        o[k.replace(/^\ufeff/, "").trim().toLowerCase()] = (r[k] == null ? "" : String(r[k])).trim();
      });
      return o;
    });
  }

  function needColumns(rows, cols, name) {
    const missing = cols.filter(c => !(c in rows[0]));
    if (missing.length) throw new Error(name + " is missing column(s): " + missing.join(", "));
  }

  // Strict ISO date (also rejects 2020-02-30). Returns Date or null.
  function parseDate(str, field, ctx) {
    const d = parseISO(str);
    if (!d || fmtISO(d) !== str) {
      console.warn("[data] Invalid date \"" + str + "\" in " + field + " (" + ctx + ")");
      return null;
    }
    return d;
  }

  async function loadData() {
    const [rawL, rawP] = await Promise.all([
      fetchCsv(CONFIG.paths.leaders),
      fetchCsv(CONFIG.paths.previous)
    ]);
    const L = cleanRows(rawL);
    const P = cleanRows(rawP);
    if (!L.length) throw new Error(CONFIG.paths.leaders + " has no rows");
    needColumns(L, ["id", "country", "current_leader", "birthdate", "in_power_since", "vdem"], CONFIG.paths.leaders);
    if (P.length) needColumns(P, ["id", "start", "end"], CONFIG.paths.previous);

    const byId = new Map();
    const leaders = [];

    // -- leaders
    L.forEach((r, i) => {
      const ctx = "leaders row " + (i + 2) + ", id " + r.id;
      if (!r.id) { console.warn("[data] Missing id, row skipped (" + ctx + ")"); return; }
      if (byId.has(r.id)) { console.warn("[data] Duplicate id \"" + r.id + "\", later row skipped (" + ctx + ")"); return; }

      const birth = parseDate(r.birthdate, "birthdate", ctx);
      const start = parseDate(r.in_power_since, "in_power_since", ctx);
      if (!birth || !start) { console.warn("[data] Row skipped because of invalid date (" + ctx + ")"); return; }

      const key = r.vdem.toLowerCase();
      let colour = CONFIG.colours[key];
      if (!colour) {
        console.warn("[data] Unknown vdem value \"" + r.vdem + "\" (" + ctx + "), using fallback colour");
        colour = CONFIG.fallbackColour;
      }
      if (+start < +birth) console.warn("[data] Current tenure starts before birthdate (" + ctx + ")");

      const ld = {
        id: r.id, country: r.country, leader: r.current_leader,
        birth, birthMs: +birth, start, startMs: +start,
        vdem: key, colour, prev: []
      };
      byId.set(ld.id, ld);
      leaders.push(ld);
    });

    // -- previous tenures
    P.forEach((r, i) => {
      const ctx = "previous row " + (i + 2) + ", id " + r.id;
      const ld = byId.get(r.id);
      if (!ld) { console.warn("[data] previous.id not found in leaders (" + ctx + ")"); return; }
      const s = parseDate(r.start, "start", ctx);
      const e = parseDate(r.end, "end", ctx);
      if (!s || !e) return;
      if (+e < +s) { console.warn("[data] Tenure end before start, skipped (" + ctx + ")"); return; }
      if (+s < ld.birthMs) console.warn("[data] Previous tenure starts before birthdate (" + ctx + ")");
      ld.prev.push({ start: s, end: e, startMs: +s, endMs: +e });
    });

    // -- overlap checks
    leaders.forEach(ld => {
      ld.prev.sort((a, b) => a.startMs - b.startMs);
      ld.prev.forEach((p, j) => {
        if (j > 0 && p.startMs < ld.prev[j - 1].endMs) {
          console.warn("[data] Overlapping previous tenures for id " + ld.id);
        }
        if (p.endMs >= ld.startMs) {
          console.warn("[data] Previous tenure touches/overlaps the current one for id " + ld.id);
        }
      });
    });

    if (!leaders.length) throw new Error("No valid leader rows in " + CONFIG.paths.leaders);

    // Youngest (latest birth) first = top of the chart
    leaders.sort((a, b) => (b.birthMs - a.birthMs) || (a.id < b.id ? -1 : 1));
    leaders.forEach((ld, i) => { ld.index = i; });

    S.leaders = leaders;
    return leaders;
  }

  // ---------- Text helpers ----------
  function wholeYears(fromMs, toMs_) {
    const a = new Date(fromMs), b = new Date(toMs_);
    let y = b.getUTCFullYear() - a.getUTCFullYear();
    if (b.getUTCMonth() < a.getUTCMonth() ||
        (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
    return Math.max(0, y);
  }

  function yearsText(n) {
    if (n < 1) return "less than a year";
    return n + (n === 1 ? " year" : " years");
  }

  // Sentence read out by the screen-reader live region in flicker mode
  function infoText(ld) {
    const cur = wholeYears(ld.startMs, TODAY_MS);
    let s = ld.leader + ", " + ld.country +
      ", currently " + yearsText(cur) + " in power";
    if (ld.prev.length) {
      let ms = TODAY_MS - ld.startMs;
      ld.prev.forEach(p => { ms += p.endMs - p.startMs; });
      const total = Math.max(cur, Math.floor(ms / MS_YEAR));
      s += " (" + yearsText(total) + " in total)";
    }
    return s;
  }

  function nameText(ld) {
    return ld.leader + " (" + wholeYears(ld.birthMs, TODAY_MS) + "), " + ld.country;
  }

  // ---------- Drawing ----------
  function drawChart(svgSelector) {
    const sel = d3.select(svgSelector);
    if (sel.empty()) throw new Error("SVG not found: " + svgSelector);
    if (!S.leaders.length) throw new Error("drawChart() called before loadData()");
    const svg = sel.node();
    sel.selectAll("*").remove();
    svg.setAttribute("viewBox", "0 0 " + VW + " " + VH);

    const n = S.leaders.length;
    S.n = n;
    S.B = CONFIG.intro.barHeight;
    S.P = S.B / CONFIG.barFraction;
    S.topBig = CONFIG.intro.topY;
    S.chartTop = CONFIG.chart.top;
    S.chartBottom = VH - CONFIG.chart.bottom;
    S.youngestBirth = S.leaders[0].birthMs;
    S.rows = [];
    S.rowById = new Map();
    S.chromeCache = {};
    S.introTicks = [];
    S.introEls = [];
    S.ty = null; S.ky = null;
    S.xStamp = 0; S.cStamp = 0;
    S.pStamp = 0; S.partB = 1; S.partL = 1; S.partN = 1;
    S.colouredApplied = null;
    S.domainStart = null;
    S.introMap = {};
    S.shiftY = 0;
    S.barLabels = {};
    S.cam = 0;
    S.zoom = 0;   // 0 = whole chart fitted on screen, 1 = bars at full size
    S.xl = -1; S.xr = -1;   // current left/right edge of the bars (set in render)
    S.gridEls = [];
    S.bottomY = CONFIG.intro.bottomY;
    S.introPitch = CONFIG.intro.bottomY - CONFIG.intro.topY;

    // Layers, back to front
    const gGrid = el(svg, "g", { class: "axis axis--grid", opacity: 0 });
    const gClipWrap = el(svg, "g", { "clip-path": "url(#clip-chart)" });
    const gRoot = el(gClipWrap, "g", { class: "chart-root" });
    const gAxis = el(svg, "g", { class: "axis", opacity: 0 });
    const gIntro = el(svg, "g", { class: "axis axis--intro", opacity: 1 });
    const gLabels = el(svg, "g", { class: "axis axis--labels", "clip-path": "url(#clip-chart)" });
    const gLegend = el(svg, "g", { class: "legend", opacity: 0 });
    S.gIntro = gIntro; S.gLabels = gLabels;
    S.gGrid = gGrid; S.gRoot = gRoot; S.gAxis = gAxis; S.gLegend = gLegend;

    // Grid + axis on the final (1930 -> today) scale
    CONFIG.axisTicks.forEach(year => {
      const gl = el(gGrid, "line", { y1: S.chartTop - 16, y2: S.chartBottom + 10 });
      const tl = el(gAxis, "line", { y1: S.chartBottom + 10, y2: S.chartBottom + 20 });
      const t = el(gAxis, "text", { y: S.chartBottom + CONFIG.axis.labelOffset, "text-anchor": "middle" });
      t.textContent = year;
      S.gridEls.push({ ms: Date.UTC(year, 0, 1), gl, tl, t });
    });

    // Rows
    const B = S.B;
    S.leaders.forEach((ld, i) => {
      const g = el(gRoot, "g", { class: "row", "data-id": ld.id, display: "none", opacity: 0 });
      const life = el(g, "rect", { class: "bar bar--life", y: -B / 2, height: B, "fill-opacity": CONFIG.lifespanOpacity });
      const prevEls = ld.prev.map(() => el(g, "rect", { class: "bar bar--prev", y: -B / 2, height: B }));
      const nowEl = el(g, "rect", { class: "bar bar--now", y: -B / 2, height: B });
      const birthEl = el(g, "rect", { class: "bar bar--birth", y: -B / 2, height: B });

      const row = {
        ld, g, life, prevEls, nowEl, birthEl,
        yBig: S.topBig + Math.min(i, n - 1) * S.P,    // current y (moves during intro/unfold)
        yNorm: S.topBig + Math.min(i, n - 1) * S.P,   // final y
        lastOp: -1, lastY: null, xStamp: -1, cStamp: -1, pStamp: -1,
        vis: 0, dimF: 1
      };
      // Static y for all rows except the last (which moves in render())
      if (i < n - 1) {
        row.lastY = row.yBig;
        g.setAttribute("transform", "translate(0 " + row.yBig.toFixed(2) + ")");
      }
      S.rows.push(row);
      S.rowById.set(ld.id, row);
    });

    // Reveal clips for the top and bottom intro bars (grow left to right)
    const defs = el(svg, "defs");
    S.clipChartRect = el(el(defs, "clipPath", { id: "clip-chart", clipPathUnits: "userSpaceOnUse" }), "rect",
      { x: 0, y: S.chartTop - 30, width: VW, height: S.chartBottom - S.chartTop + 36 });
    const mkClip = id => {
      const cp = el(defs, "clipPath", { id, clipPathUnits: "userSpaceOnUse" });
      return el(cp, "rect", { x: 0, y: -B, width: VW, height: 2 * B });
    };
    S.clipTopRect = mkClip("clip-top");
    S.clipBottomRect = mkClip("clip-bottom");
    S.clipOn = {};
    S.revealTop = S.youngestBirth;      // start with zero length
    S.revealBottom = S.youngestBirth;

    // Legend (stage coordinates)
    buildLegend(gLegend);

    // Initial state
    S.domainT = 0;
    S.coloured = false;
    S.topOpacity = 1; S.bottomOpacity = 0;
    S.legendOpacity = 0;
    S.unfold = 0; S.dimmed = false; S.activeId = null;
    S.ready = true;
    render();
  }

  // ---------- Intro timeline ----------
  function renderIntroTicks() {
    if (!S.gIntro) return;
    const ds = S.domainStart;
    const k = (S.xr - S.xl) / (TODAY_MS - ds);
    const y = CONFIG.introAxis.y + S.shiftY;
    // fades out during the first part of the unfold, before the real axis fades in
    const fade = 1 - clamp01(S.unfold / CONFIG.chromeFadeStart);

    S.introTicks.forEach((t, i) => {
      let n = S.introEls[i];
      if (!n) {
        const g = el(S.gIntro, "g", { display: "none" });
        n = S.introEls[i] = {
          g,
          line: el(g, "line"),
          text: el(g, "text", { "text-anchor": "middle" })
        };
      }
      const op = +(t.opacity * fade).toFixed(3);
      if (op <= 0.003) { n.g.setAttribute("display", "none"); return; }
      const x = (S.xl + (t.ms - ds) * k).toFixed(2);
      n.g.setAttribute("display", "inline");
      n.g.setAttribute("opacity", op);
      n.line.setAttribute("x1", x);
      n.line.setAttribute("x2", x);
      n.line.setAttribute("y1", y);
      n.line.setAttribute("y2", y + 12);
      n.text.setAttribute("x", x);
      n.text.setAttribute("y", y + CONFIG.axis.labelOffset - 12);
      if (n.text.textContent !== t.label) n.text.textContent = t.label;
    });
  }

  // Name label for every row: "Name (age), Country"
  // Intro names fade out as the unfold starts; all names fade in while zooming to full size.
  function renderBarLabels() {
    if (!S.gLabels) return;
    const ds = S.domainStart, k = (S.xr - S.xl) / (TODAY_MS - ds);
    const exK = 1 - clamp01(S.unfold / 0.05);
    const fin = clamp01((S.zoom - 0.3) / 0.7);
    S.rows.forEach((r, i) => {
      const e = S.introMap[i];
      const introOp = e && e.label ? (e.labelOpacity || 0) * exK : 0;
      const y = S.ty + S.ky * r.yBig;
      let op = r.lastOp > 0 ? r.dimF * Math.max(introOp, fin * r.vis) : 0;
      if (y < S.chartTop - 40 || y > S.chartBottom + 40) op = 0;   // off screen
      op = +op.toFixed(3);
      let t = S.barLabels[i];
      if (op <= 0.003) {
        if (t && t._on) { t.setAttribute("display", "none"); t._on = false; }
        return;
      }
      if (!t) {
        t = S.barLabels[i] = el(S.gLabels, "text", { "dominant-baseline": "central" });
        t.textContent = nameText(r.ld);
        t._w = 0;
        try { t._w = t.getComputedTextLength(); } catch (err) { /* ignore */ }
      }
      const x = Math.min(Math.max(S.xl, S.xl + (r.ld.birthMs - ds) * k) + 12, VW - 8 - t._w);
      const key = x.toFixed(1) + "|" + y.toFixed(1) + "|" + op;
      if (t._k !== key) {
        t._k = key;
        t.setAttribute("x", x.toFixed(1));
        t.setAttribute("y", y.toFixed(1));
        t.setAttribute("opacity", op);
      }
      if (!t._on) { t.setAttribute("display", "inline"); t._on = true; }
    });
  }

  function setIntroTicks(ticks) {
    S.introTicks = ticks || [];   // drawn on the next render()
  }

  function buildLegend(g) {
    const L = CONFIG.legend;
    const measure = (t, label) => {
      let w = 0;
      try { w = t.getComputedTextLength(); } catch (e) { /* ignore */ }
      return w || label.length * (L.fontSize * 0.56);
    };

    let x = X0;
    CONFIG.legendItems.forEach(item => {
      el(g, "rect", { x, y: L.y, width: L.swatch, height: L.swatch, rx: 3, fill: CONFIG.colours[item.key] });
      const t = el(g, "text", { x: x + L.swatch + 8, y: L.y + L.swatch / 2, "dominant-baseline": "central" });
      t.textContent = item.label;
      x += L.swatch + 8 + measure(t, item.label) + 30;
    });
  }

  // Positions the year lines and labels on the current x range
  function placeAxis() {
    const k = (S.xr - S.xl) / (TODAY_MS - DOMAIN_MS);
    S.gridEls.forEach(g => {
      const x = (S.xl + (g.ms - DOMAIN_MS) * k).toFixed(2);
      g.gl.setAttribute("x1", x); g.gl.setAttribute("x2", x);
      g.tl.setAttribute("x1", x); g.tl.setAttribute("x2", x);
      g.t.setAttribute("x", x);
    });
  }

  // ---------- Per-row geometry (x, colour) ----------
  function setRect(node, x, w) {
    node.setAttribute("x", x.toFixed(2));
    node.setAttribute("width", Math.max(0, w).toFixed(2));
  }

  function layoutX(r) {
    const ds = S.domainStart;
    const xl = S.xl, xr = S.xr;
    const k = (xr - xl) / (TODAY_MS - ds);
    const cx = t => Math.min(xr, Math.max(xl, xl + (t - ds) * k)); // crop at the left edge
    const ld = r.ld;

    // Faded lifespan bar
    const xb = cx(ld.birthMs);
    setRect(r.life, xb, xr - xb);

    // Previous tenures
    ld.prev.forEach((p, j) => {
      const a = cx(p.startMs), b = cx(p.endMs);
      setRect(r.prevEls[j], a, b > a ? Math.max(b - a, CONFIG.minBarWidth) : 0);
    });

    // Current tenure
    const xs = Math.min(cx(ld.startMs), xr - CONFIG.minBarWidth);
    setRect(r.nowEl, xs, xr - xs);

    // Birth line (hidden when the birthdate is left of the window)
    const bx = xl + (ld.birthMs - ds) * k;
    if (ld.birthMs >= ds) setRect(r.birthEl, bx - CONFIG.birthLineWidth / 2, CONFIG.birthLineWidth);
    else setRect(r.birthEl, xl, 0);

    r.xStamp = S.xStamp;
  }

  function applyColour(r) {
    r.g.setAttribute("fill", S.coloured ? r.ld.colour : CONFIG.neutralColour);
    r.cStamp = S.cStamp;
  }

  function applyParts(r) {
    r.life.setAttribute("opacity", S.partL);
    r.prevEls.forEach(p => p.setAttribute("opacity", S.partN));
    r.nowEl.setAttribute("opacity", S.partN);
    r.birthEl.setAttribute("opacity", S.partB);
    r.pStamp = S.pStamp;
  }

  function setParts(b, l, n) {
    if (b === S.partB && l === S.partL && n === S.partN) return;
    S.partB = b; S.partL = l; S.partN = n;
    S.pStamp++;
  }

  // Clip the top/bottom rows at the reveal date (null = no clip)
  function applyReveal() {
    const ds = S.domainStart, k = (S.xr - S.xl) / (TODAY_MS - ds);
    [[0, S.revealTop, S.clipTopRect, "clip-top"],
     [S.n - 1, S.revealBottom, S.clipBottomRect, "clip-bottom"]].forEach(([i, ms, rect, id]) => {
      const g = S.rows[i].g;
      if (ms == null) {
        if (S.clipOn[id] !== false) { g.removeAttribute("clip-path"); S.clipOn[id] = false; }
        return;
      }
      const x = Math.max(0, Math.min(VW, S.xl + (ms - ds) * k));
      rect.setAttribute("width", x.toFixed(2));
      if (S.clipOn[id] !== true) { g.setAttribute("clip-path", "url(#" + id + ")"); S.clipOn[id] = true; }
    });
  }

  // ---------- Render (cheap: only touches what changed) ----------
  function render() {
    if (!S.ready) return;
    const n = S.n, u = S.unfold;

    // Horizontal extent: centred 9:16 column in the intro, full stage width after the unfold
    const off = (VW - BASE_W) / 2;
    const xl = lerp(X0 + off, X0, u);
    const xr = lerp(X1 + off, X1 + off * 2, u);
    if (xl !== S.xl || xr !== S.xr) { S.xl = xl; S.xr = xr; S.xStamp++; placeAxis(); }

    // Time window
    const dom = lerp(S.youngestBirth, DOMAIN_MS, S.domainT);
    if (dom !== S.domainStart) { S.domainStart = dom; S.xStamp++; }
    if (S.colouredApplied !== S.coloured) { S.colouredApplied = S.coloured; S.cStamp++; }

    // Rows keep full size (ky = 1). S.cam scrolls the chart in flicker mode.
    const P = S.P;
    const finalBottomBig = S.topBig + (n - 1) * P;
    const bottomBig = n > 1 ? lerp(S.bottomY, finalBottomBig, u) : S.topBig;
    const topC = lerp(CONFIG.intro.topY, S.chartTop, u);
    // ky: all rows squeezed to fit (overview), growing to 1 (full size) with S.zoom
    const span = bottomBig - S.topBig;
    const kyFit = span > 0 ? Math.min(1, (S.chartBottom - topC) / span) : 1;
    const ky = lerp(kyFit, 1, S.zoom);
    const ty = topC - ky * S.topBig + S.shiftY - S.cam;
    if (ty !== S.ty || ky !== S.ky) {
      S.ty = ty; S.ky = ky;
      S.gRoot.setAttribute("transform", "translate(0 " + ty.toFixed(3) + ") scale(1 " + ky.toFixed(5) + ")");
    }
    // Timeline: stays right below the oldest bar while it moves; fixed once the unfold is done
    const tyFit = topC - kyFit * S.topBig + S.shiftY;
    const axisDy = tyFit + kyFit * bottomBig - S.chartBottom + (1 - u) * CONFIG.axis.introGap;
    S.gAxis.setAttribute("transform", "translate(0 " + axisDy.toFixed(2) + ")");

    const gridFull = (S.chartBottom + 10) - (S.chartTop - 16);
    const gridLen = lerp(CONFIG.axis.introGridLen, gridFull, u);
    const gs = gridLen / gridFull;
    const gridDy = (S.chartBottom + 10 + axisDy) - gs * (S.chartBottom + 10);
    S.gGrid.setAttribute("transform", "translate(0 " + gridDy.toFixed(2) + ") scale(1 " + gs.toFixed(5) + ")");

    // Fixed rows: Balen (first), Biya (last) and the intro extras (Doumbouya, Putin, Trump).
    // Every other row is spread evenly between its two neighbouring fixed rows, and only
    // fades in once the gap is wide enough not to touch the bars next to it.
    const anchors = [{ i: 0, y: S.topBig, vis: S.topOpacity }];
    if (n > 1) {
      Object.keys(S.introMap).map(Number).sort((a, b) => a - b).forEach(idx => {
        const ex = S.introMap[idx];
        if (!ex || ex.slot === undefined || idx <= 0 || idx >= n - 1) return;
        const yN = S.rows[idx].yNorm;
        anchors.push({
          i: idx,
          y: u >= 1 ? yN : lerp(S.topBig + ex.slot * S.introPitch, yN, u),
          vis: ex.opacity
        });
      });
      anchors.push({ i: n - 1, y: bottomBig, vis: S.bottomOpacity });
    }
    const anchorAt = {};
    anchors.forEach((a, k) => { anchorAt[a.i] = k; });
    let seg = 0;

    for (let i = 0; i < n; i++) {
      const r = S.rows[i];
      let vis, y;
      if (anchorAt[i] !== undefined) {
        seg = anchorAt[i];
        y = anchors[seg].y;
        vis = anchors[seg].vis;
      } else {
        const a = anchors[seg], b = anchors[seg + 1];
        const k = i - a.i;                               // 1 = first row below the upper fixed row
        if (u >= 1) { y = r.yNorm; vis = 1; }
        else {
          y = a.y + k * P;                               // full row spacing, stacked from the top of the gap
          const room = (b.y - a.y) / P;                  // gap size, measured in rows
          vis = clamp01((room - k - 0.85) / 0.15);       // fades in as soon as it fits above the lower fixed row
        }
      }
      r.yBig = y;
      const dimF = S.dimmed ? (r.ld.id === S.activeId ? 1 : CONFIG.restOpacity) : 1;
      r.vis = vis; r.dimF = dimF;

      let op = vis * dimF;
      if (op < 0.003) op = 0;

      if (op !== r.lastOp) {
        if (op === 0) r.g.setAttribute("display", "none");
        else {
          if (r.lastOp <= 0) r.g.setAttribute("display", "inline");
          r.g.setAttribute("opacity", +op.toFixed(3));
        }
        r.lastOp = op;
      }
      if (op === 0) continue;

      if (r.yBig !== r.lastY) {
        r.lastY = r.yBig;
        r.g.setAttribute("transform", "translate(0 " + r.yBig.toFixed(2) + ")");
      }
      if (r.cStamp !== S.cStamp) applyColour(r);
      if (r.pStamp !== S.pStamp) applyParts(r);
      if (r.xStamp !== S.xStamp) layoutX(r);
    }

    applyReveal();
    renderIntroTicks();
    renderBarLabels();

    // Axis, grid and legend fade in over the last part of the unfold
    const fade = clamp01((u - CONFIG.chromeFadeStart) / (1 - CONFIG.chromeFadeStart));
    setOpacityOnce("axis", S.gAxis, +Math.max(fade, S.domainT).toFixed(3));
    setOpacityOnce("grid", S.gGrid, +Math.max(fade * 0.9, S.domainT * 0.5).toFixed(3));
    setOpacityOnce("legend", S.gLegend, +Math.max(S.legendOpacity, fade).toFixed(3));
  }

  // ---------- Public state setters ----------
  // Intro / pre-unfold state. Resets unfold and highlight.
  // opts: domainT (0..1), coloured (bool), topOpacity, bottomOpacity, legendOpacity (0..1),
  //       revealTop / revealBottom (ms), birthOpacity / lifeOpacity / nowOpacity,
  //       bottomY, extraRows, shiftY
  function setIntroState(opts) {
    const o = opts || {};
    S.unfold = 0;
    S.activeId = null;
    S.dimmed = false;
    if (o.domainT !== undefined) S.domainT = clamp01(o.domainT);
    if (o.revealTop !== undefined) S.revealTop = o.revealTop;
    if (o.revealBottom !== undefined) S.revealBottom = o.revealBottom;
    if (o.coloured !== undefined) S.coloured = !!o.coloured;
    if (o.topOpacity !== undefined) S.topOpacity = clamp01(o.topOpacity);
    if (o.bottomOpacity !== undefined) S.bottomOpacity = clamp01(o.bottomOpacity);
    if (o.legendOpacity !== undefined) S.legendOpacity = clamp01(o.legendOpacity);

    setParts(
      o.birthOpacity !== undefined ? clamp01(o.birthOpacity) : 1,
      o.lifeOpacity  !== undefined ? clamp01(o.lifeOpacity)  : 1,
      o.nowOpacity   !== undefined ? clamp01(o.nowOpacity)   : 1
    );
    if (o.bottomY !== undefined) S.bottomY = o.bottomY;
    S.introMap = {};
    (o.extraRows || []).forEach(e => { S.introMap[e.index] = e; });
    S.shiftY = o.shiftY !== undefined ? o.shiftY : 0;
    S.cam = 0;
    S.zoom = 0;
    render();
  }

  // Step 6: u = 0 (same as 5B) ... 1 (all rows unfolded, scaled to fit). Scroll-linked.
  function setUnfold(u) {
    S.unfold = clamp01(u);
    S.revealTop = null;
    S.revealBottom = null;
    S.domainT = 1;
    S.coloured = true;
    S.topOpacity = 1;
    S.bottomOpacity = 1;
    S.shiftY = 0;
    setParts(1, 1, 1);
    render();
  }

  // Flicker mode: dim all rows, show one at full opacity.
  // Returns the info text (for the aria-live region).
  function highlight(id) {
    const r = S.rowById.get(String(id));
    if (!r) return "";
    S.activeId = r.ld.id;
    S.dimmed = true;
    render();
    return infoText(r.ld);
  }

  // Back to the plain final infographic (all rows full opacity)
  function clearHighlight() {
    S.activeId = null;
    S.dimmed = false;
    render();
  }

  // ---------- Public getters ----------
  function getLeadersSorted() {
    return S.leaders.map(ld => Object.assign({}, ld, { info: infoText(ld) }));
  }

  // Geometry of one row in stage units (1080x1920), for the CURRENT view state.
  // xAt(date) maps a Date | ms | "YYYY-MM-DD" to a stage x (not clamped).
  function getBarGeometry(index) {
    const r = S.rows[index];
    if (!r || !S.ready) return null;
    const ds = S.domainStart;
    const k = (S.xr - S.xl) / (TODAY_MS - ds);
    const xAt = d => S.xl + (toMs(d) - ds) * k;
    const cy = S.ty + S.ky * r.yBig;
    const h = S.B * S.ky;
    return {
      index, id: r.ld.id,
      cy, top: cy - h / 2, bottom: cy + h / 2, height: h,
      xLeft: S.xl, xRight: S.xr,
      xBirth: xAt(r.ld.birthMs), xPower: xAt(r.ld.startMs),
      xAt, viewW: VW, viewH: VH
    };
  }

  // Zoom from the overview (0) to full-size bars (1)
  function setZoom(z) {
    z = clamp01(z || 0);
    if (z === S.zoom) return;
    S.zoom = z;
    render();
  }

  // Scrolls the chart up by c stage units (only used at zoom = 1)
  function setCamera(c) {
    c = Math.max(0, c || 0);
    if (c === S.cam) return;
    S.cam = c;
    render();
  }

  // pitch = distance between rows
  // max = camera offset at which the last bar touches the bottom
  // anchor = row index (fractional) that sits at 1/3 of the screen height
  function getCameraInfo() {
    return {
      pitch: S.P,
      max: Math.max(0, S.chartTop + (S.n - 1) * S.P + S.B / 2 - S.chartBottom),
      anchor: (VH / 3 - S.chartTop) / S.P
    };
  }

  // Called by story.js with the stage's real aspect ratio (1080 on mobile, wider on desktop)
  function setViewWidth(w) {
    w = Math.max(BASE_W, Math.round(w || BASE_W));
    if (w === VW) return;
    VW = w; VIEW.w = w;
    if (!S.ready) return;
    S.gRoot.ownerSVGElement.setAttribute("viewBox", "0 0 " + VW + " " + VH);
    S.clipChartRect.setAttribute("width", VW);
    render();
  }

  // ---------- Export ----------
  window.LeaderChart = {
    CONFIG,
    VIEW,
    setViewWidth,
    loadData,
    drawChart,
    setIntroState,
    setIntroTicks,
    setUnfold,
    highlight,
    clearHighlight,
    getLeadersSorted,
    getBarGeometry,
    setZoom,
    setCamera,
    getCameraInfo
  };
})();