/* Shea's Forest — the Front Door · BLOCK B1 (the Door) + B2 (the gated read)
   The Door (set-password / sign-in) gates the page: app.js probes the runtime, and if
   there is no live session it shows the Door overlay; sign-in is POST /session and the
   session is carried as the runtime's HttpOnly `forest_session` cookie (the page stores
   NOTHING). Once in, the Canopy/Soil read the LIVE gated projection (GET /projection/
   forest-state, credentials:include) — the build-time snapshot is demoted to an honest
   fallback (state-model §3/§8). READ-ONLY: the page only fetches + renders; it never acts.
   The boundary itself is enforced server-side (the runtime 401s without a session); this
   overlay is the visible half. */
(function () {
  "use strict";

  /* ---------- strata-nav active highlight (carried from B1) ---------- */
  (function () {
    var nav = document.querySelector(".strata-nav");
    if (!nav || !("IntersectionObserver" in window)) return;
    var links = {};
    nav.querySelectorAll("a[href^='#']").forEach(function (a) {
      links[a.getAttribute("href").slice(1)] = a;
    });
    function setActive(id) {
      Object.keys(links).forEach(function (k) {
        var on = k === id;
        links[k].style.color = on ? "var(--floor)" : "";
        links[k].style.borderColor = on ? "var(--line-gold)" : "";
        if (on) links[k].setAttribute("aria-current", "true");
        else links[k].removeAttribute("aria-current");
      });
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && links[e.target.id]) setActive(e.target.id);
      });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    Object.keys(links).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  })();

  /* ---------- B2: render the Forest from the state snapshot ---------- */

  // presentation-only display names (data is unchanged; this just reads nicely)
  var DISPLAY = {
    "gc": "GC",
    "retirement-college": "Retirement & College",
    "health-admin": "Health Admin",
    "founder-equity": "Founder Equity",
    "burning-man": "Burning Man"
  };
  function titleize(slug) {
    if (DISPLAY[slug]) return DISPLAY[slug];
    return String(slug || "").split("-").map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function treeCard(t) {
    var seams = [];
    if (t.gate) seams.push('<span class="seam-chip seam-chip--gate">gate</span>');
    if (t.edge) seams.push('<span class="seam-chip seam-chip--edge">edge</span>');
    if (t.feed_to) seams.push('<span class="seam-chip seam-chip--feed">feeds ' + esc(t.feed_to) + '</span>');
    var pace = (t.pace || []).map(function (p) {
      return '<span class="pace-chip">' + esc(p) + '</span>';
    }).join("");
    return '<article class="tree">'
      + '<div>'
      + '<div class="tree__name">' + esc(titleize(t.tree)) + '</div>'
      + '<div class="tree__what">' + esc(t.trunk) + '</div>'
      + (pace ? '<div class="tree__pace">' + pace + '</div>' : '')
      + '</div>'
      + '<div class="tree__foot">'
      + '<span class="tree__weather">' + esc(t.weight) + '</span>'
      + '<span class="tree__seams">' + seams.join("") + '</span>'
      + '</div>'
      + '</article>';
  }

  function renderCanopy(data) {
    deriveAssignable((data && data.canopy) || {});   // cache feed-bearing (assignable) ids for the curate picker
    var mount = document.getElementById("canopy-mount");
    if (!mount) return;
    var canopy = data.canopy || {};
    var groves = canopy.groves || [];
    if (!groves.length) {
      mount.innerHTML = '<p class="state-error">No trees in the snapshot yet.</p>';
      return;
    }
    mount.innerHTML = groves.map(function (g) {
      return '<div class="grove-group">'
        + '<div class="grove-group__label">' + esc(g.label)
        + ' <span class="grove-group__count">' + (g.trees || []).length + '</span></div>'
        + '<div class="grove-floor">' + (g.trees || []).map(treeCard).join("") + '</div>'
        + '</div>';
    }).join("");

    var gloss = document.getElementById("canopy-gloss");
    if (gloss) {
      var m = data._meta || {};
      gloss.textContent = (canopy.tree_count || 0) + " trees from the executor\u2019s specs \u00b7 read-only"
        + (m.source_commit ? " \u00b7 snapshot " + m.source_commit : "");
    }
  }

  function renderSoil(data) {
    var mount = document.getElementById("soil-mount");
    if (!mount) return;
    var soil = data.soil || {};
    var live = !!soil.live;
    var nodes = soil.nodes || [];
    mount.innerHTML = nodes.map(function (n) {
      return '<div class="soil-item">'
        + '<div class="soil-item__name">' + esc(n.name) + '</div>'
        + '<div class="soil-item__role">' + esc(n.role) + '</div>'
        + '<div class="soil-item__state"><span class="pending">' + (live ? "live" : "not live") + '</span></div>'
        + '</div>';
    }).join("");
    var gloss = document.getElementById("soil-gloss");
    if (gloss && soil.note) gloss.textContent = soil.note;
  }

  /* ---------- B3: the Horizontals — queries over the (dummy) edge set ----------
     Each Horizontal is a QUERY OVER THE EDGE SET, never a vertex (heartwood §2/§6).
     The edge set is the union of the rows the canopy's trees publish (feed seams).
     V1 reads a clearly-labeled DUMMY edge set (state/forest-edges.dummy.json) so the
     surfaces are exercisable ahead of real ingestion (BLOCK D, V2) — the data is
     stand-in, never presented as Shea's real life. Expiry Radar is wired here; the
     Flow / Calendar of People / Body Clock / Workbench follow the same query shape
     (select edges whose `to` names the horizontal, then render the published rows). */

  function horizonSlot(name) {
    var a = document.querySelector('article.horizon[data-horizon="' + name + '"]');
    return a ? a.querySelector(".horizon__state") : null;
  }
  function rowDate(row) {
    // the earliest ISO date in a published row — the obligation's due/deadline
    var best = null;
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && (best === null || v < best)) best = v;
    });
    return best;
  }
  function rowLabel(row) {
    var keys = Object.keys(row);
    var pref = keys.filter(function (k) {
      return /obligation|task|event|account|entity|filing|review|merge|practice|screening/.test(k);
    });
    var k = pref[0] || keys.filter(function (j) { return typeof row[j] === "string"; })[0];
    return cleanLabel(k ? row[k] : "(item)");
  }
  // Display-clean a row label: collapse whitespace/newlines and strip literal JSON-escape
  // artifacts (\uXXXX, \", \n, ...) so a leaked content blob renders as ONE tidy line instead
  // of a vertical word-stack, then clamp length. Defends every horizon surface from a long/raw label.
  function cleanLabel(s) {
    s = String(s == null ? "" : s)
      .replace(/\\u[0-9a-fA-F]{4}/g, " ")
      .replace(/\\[ntrbf"'\\\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (s.length > 72) s = s.slice(0, 71).replace(/\s+\S*$/, "").trim() + "\u2026";
    return s || "(item)";
  }
  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  // The honest provenance tag for an edge-set surface: 'live' when the loaded set
  // is the real derived edge set (_meta.provenance === "live"), else the labeled
  // 'dummy data' tag. The same edge-query render is reused for both; only the tag
  // changes, so a surface never silently presents dummy rows as real.
  function provTag(edgeData) {
    var live = edgeData && edgeData._meta && edgeData._meta.provenance === "live";
    return live ? '<span class="live-tag">live</span>'
                : '<span class="dummy-tag">dummy data</span>';
  }

  function renderExpiryRadar(edgeData, todayIso) {
    var slot = horizonSlot("Expiry Radar");
    if (!slot) return;
    var edges = (edgeData.edges || []).filter(function (e) {
      return (e.to || []).indexOf("Expiry Radar") !== -1 && rowDate(e.row);
    });
    edges.sort(function (a, b) { return rowDate(a.row) < rowDate(b.row) ? -1 : 1; });
    if (!edges.length) { slot.innerHTML = '<span class="pending">no dated obligations</span>'; return; }
    var rows = edges.slice(0, 8).map(function (e) {
      var dt = rowDate(e.row), overdue = dt < todayIso;
      var amt = (typeof e.row.amount === "number") ? e.row.amount
              : (typeof e.row.est_amount === "number") ? e.row.est_amount : null;
      return '<li class="radar-row' + (overdue ? " radar-row--overdue" : "") + '">'
        + '<span class="radar-row__when">' + esc(fmtDate(dt)) + (overdue ? " \u00b7 overdue" : "") + '</span>'
        + '<span class="radar-row__what">' + esc(rowLabel(e.row)) + '</span>'
        + '<span class="radar-row__src">' + esc(titleize(e.source_tree)) + '</span>'
        + (amt != null ? '<span class="radar-row__amt">$' + esc(amt.toFixed(0)) + '</span>' : "")
        + '</li>';
    }).join("");
    slot.innerHTML = '<ul class="radar">' + rows + '</ul>'
      + '<div class="horizon__tag">' + edges.length + ' dated \u00b7 ' + provTag(edgeData) + '</div>';
  }

  // ---- shared edge-query helper: edges feeding a named horizontal, date-sorted ----
  function edgesFor(edgeData, name, needDate) {
    var edges = (edgeData.edges || []).filter(function (e) {
      if ((e.to || []).indexOf(name) === -1) return false;
      return needDate ? !!rowDate(e.row) : true;
    });
    edges.sort(function (a, b) {
      var da = rowDate(a.row), db = rowDate(b.row);
      if (da && db) return da < db ? -1 : 1;
      return da ? -1 : (db ? 1 : 0);
    });
    return edges;
  }

  // The Flow — money in / out + runway. Rows carrying an amount; dummy obligations are
  // outflows, shown negative, with the upcoming total as the runway signal.
  function renderFlow(edgeData) {
    var slot = horizonSlot("the Flow");
    if (!slot) return;
    var edges = edgesFor(edgeData, "the Flow", false).filter(function (e) {
      return typeof e.row.amount === "number" || typeof e.row.est_amount === "number" || typeof e.row.balance === "number";
    });
    if (!edges.length) { slot.innerHTML = '<span class="pending">no money rows</span>'; return; }
    var total = 0;
    edges.forEach(function (e) {
      var a = (typeof e.row.amount === "number") ? e.row.amount
            : (typeof e.row.est_amount === "number") ? e.row.est_amount : 0;
      total += a;
    });
    var rows = edges.slice(0, 8).map(function (e) {
      var dt = rowDate(e.row);
      var amt = (typeof e.row.amount === "number") ? e.row.amount
              : (typeof e.row.est_amount === "number") ? e.row.est_amount
              : (typeof e.row.balance === "number") ? e.row.balance : null;
      return '<li class="radar-row">'
        + '<span class="radar-row__when">' + (dt ? esc(fmtDate(dt)) : "\u2014") + '</span>'
        + '<span class="radar-row__what">' + esc(rowLabel(e.row)) + '</span>'
        + '<span class="radar-row__src">' + esc(titleize(e.source_tree)) + '</span>'
        + (amt != null ? '<span class="radar-row__amt radar-row__amt--out">\u2212$' + esc(amt.toFixed(0)) + '</span>' : "")
        + '</li>';
    }).join("");
    slot.innerHTML = '<ul class="radar">' + rows + '</ul>'
      + '<div class="horizon__tag">' + edges.length + ' rows \u00b7 \u2212$' + esc(total.toFixed(0))
      + ' upcoming \u00b7 ' + provTag(edgeData) + '</div>';
  }

  // Calendar of People — dates & relationships ONLY. The Law of People: map no one.
  // We render the dated obligation + its source context, and DELIBERATELY never surface
  // an identity field (member_state and any person-shaped value is not rendered). rowLabel
  // only picks the obligation/event string, never the object-typed person descriptor.
  function renderCalendar(edgeData) {
    var slot = horizonSlot("the Calendar");
    if (!slot) return;
    var edges = edgesFor(edgeData, "the Calendar", false);
    if (!edges.length) { slot.innerHTML = '<span class="pending">no dated relationships</span>'; return; }
    var rows = edges.slice(0, 8).map(function (e) {
      var dt = rowDate(e.row);
      return '<li class="radar-row">'
        + '<span class="radar-row__when">' + (dt ? esc(fmtDate(dt)) : "\u2014") + '</span>'
        + '<span class="radar-row__what">' + esc(rowLabel(e.row)) + '</span>'
        + '<span class="radar-row__src">' + esc(titleize(e.source_tree)) + '</span>'
        + '</li>';
    }).join("");
    slot.innerHTML = '<ul class="radar">' + rows + '</ul>'
      + '<div class="horizon__tag">' + edges.length + ' dated \u00b7 maps no one \u00b7 ' + provTag(edgeData) + '</div>';
  }

  // The Body Clock — screenings + household medical + practice. Dated items with status,
  // overdue flagged like the Radar.
  function renderBodyClock(edgeData) {
    var slot = horizonSlot("the Body Clock");
    if (!slot) return;
    var edges = edgesFor(edgeData, "the Body Clock", false);
    if (!edges.length) { slot.innerHTML = '<span class="pending">no screenings or practice</span>'; return; }
    var today = new Date().toISOString().slice(0, 10);
    var rows = edges.slice(0, 8).map(function (e) {
      var dt = rowDate(e.row);
      var status = (typeof e.row.status === "string") ? e.row.status
                 : (typeof e.row.type === "string") ? e.row.type : null;
      var overdue = dt && dt < today;
      return '<li class="radar-row' + (overdue ? " radar-row--overdue" : "") + '">'
        + '<span class="radar-row__when">' + (dt ? esc(fmtDate(dt)) + (overdue ? " \u00b7 overdue" : "") : "\u2014") + '</span>'
        + '<span class="radar-row__what">' + esc(rowLabel(e.row)) + '</span>'
        + '<span class="radar-row__src">' + esc(titleize(e.source_tree)) + '</span>'
        + (status ? '<span class="radar-row__amt">' + esc(status) + '</span>' : "")
        + '</li>';
    }).join("");
    slot.innerHTML = '<ul class="radar">' + rows + '</ul>'
      + '<div class="horizon__tag">' + edges.length + ' items \u00b7 ' + provTag(edgeData) + '</div>';
  }

  // The Workbench — "the work in your hands now." NOT a feed target: no tree's `to` names
  // it (anatomy contract). It is a query over the CANOPY — tree pace + weight + open work
  // (the trunk/branches) — surfacing the trees most in-hand now (fast + load-bearing first).
  // It reads the REAL canopy snapshot, not the dummy edge set, so it is honestly not
  // dummy-tagged.
  function renderWorkbench(stateData) {
    var slot = horizonSlot("the Workbench");
    if (!slot) return;
    var canopy = (stateData && stateData.canopy) || {};
    var groves = canopy.groves || [];
    var trees = [];
    groves.forEach(function (g) { (g.trees || []).forEach(function (t) { trees.push(t); }); });
    if (!trees.length) { slot.innerHTML = '<span class="pending">no trees in the canopy</span>'; return; }
    function paceRank(t) {
      var p = (t.pace || []).join(" ");
      if (/fast/.test(p)) return 0;
      if (/steady|medium/.test(p)) return 1;
      if (/slow|seasonal/.test(p)) return 2;
      return 1.5;
    }
    function weightRank(t) { return /load-bearing/.test(t.weight || "") ? 0 : (/nice-to-have/.test(t.weight || "") ? 2 : 1); }
    trees.sort(function (a, b) {
      var pa = paceRank(a), pb = paceRank(b);
      if (pa !== pb) return pa - pb;
      return weightRank(a) - weightRank(b);
    });
    var rows = trees.slice(0, 8).map(function (t) {
      var pace = (t.pace || []).join(", ");
      var openWork = (t.branches || [])[0] || t.trunk || "";
      return '<li class="bench-row">'
        + '<span class="bench-row__tree">' + esc(titleize(t.tree)) + '</span>'
        + '<span class="bench-row__work">' + esc(openWork) + '</span>'
        + (pace ? '<span class="pace-chip">' + esc(pace) + '</span>' : "")
        + (t.weight ? '<span class="bench-row__weight' + (/load-bearing/.test(t.weight) ? ' bench-row__weight--load' : '') + '">' + esc(t.weight) + '</span>' : "")
        + '</li>';
    }).join("");
    slot.innerHTML = '<ul class="radar bench">' + rows + '</ul>'
      + '<div class="horizon__tag">' + trees.length + ' trees \u00b7 by pace + weight \u00b7 <span class="live-tag">canopy read</span></div>';
  }

  function loadHorizons(stateData) {
    var today = new Date().toISOString().slice(0, 10);
    // The Workbench reads the real canopy (no edges) — render it from the loaded state.
    renderWorkbench(stateData);
    // The other four horizontals are queries over the edge set. Prefer the LIVE set
    // (state/forest-edges.json, derived from real ingested Soil) when it is present
    // AND non-empty; otherwise fall back to the clearly-labeled DUMMY set. The render
    // tags each surface from the loaded set's provenance (provTag), so live and dummy
    // are never confused.
    function paint(data) {
      renderExpiryRadar(data, today);
      renderFlow(data);
      renderCalendar(data);
      renderBodyClock(data);
    }
    function loadDummy() {
      fetch("state/forest-edges.dummy.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(paint)
        .catch(function () { /* dummy set absent -> leave the B3 placeholders untouched */ });
    }
    fetch("state/forest-edges.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        // live-when-present-AND-non-empty; an empty live set is honest but not useful
        // here, so we show the labeled dummy rather than four empty surfaces.
        if (data && Array.isArray(data.edges) && data.edges.length > 0) { paint(data); }
        else { loadDummy(); }
      })
      .catch(loadDummy);   // no live file yet -> the dummy set, as before
  }

  function fail(id, msg) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<p class="state-error">' + esc(msg) + '</p>';
  }

  /* ---------- B1: the Door (set-password / sign-in) gates the live read ----------
     Session transport is the runtime's HttpOnly `forest_session` cookie (same-origin;
     the page stores nothing). The runtime is the one front the app talks to (state-model
     §1); a cross-origin deploy fronts both behind one origin (C1). Override the base for a
     dev runtime on another port via window.FOREST_RUNTIME. */
  var RT = (typeof window !== "undefined" && window.FOREST_RUNTIME) || "";

  function loadForest() {
    var mount = document.getElementById("canopy-mount");
    var src = (mount && mount.getAttribute("data-src")) || (RT + "/projection/forest-state");
    var fallback = (mount && mount.getAttribute("data-fallback")) || "state/forest-state.json";
    fetch((src.charAt(0) === "/" ? RT + src : src), { cache: "no-store", credentials: "include" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { renderCanopy(data); renderSoil(data); revealGate(); loadAuthority(); loadHorizons(data); loadCuration(); loadConnectors(); loadLinkPanel(); })
      .catch(function () {
        // honest fallback (state-model §3/§8): the live projection is the read; if the
        // runtime is unreachable, fall back to the build-time snapshot so the shell still
        // shows the grove rather than lying that it is live.
        fetch(fallback, { cache: "no-store" })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (data) { renderCanopy(data); renderSoil(data); loadHorizons(data); })
          .catch(function (e) {
            fail("canopy-mount", "The grove\u2019s state didn\u2019t load (" + e.message + "). The shell is here; sign in with the runtime up to read the live grove.");
            fail("soil-mount", "Substrate state didn\u2019t load (" + e.message + ").");
          });
      });
  }

  /* ---------- B4: the Gate console — authority, the one clean choice ----------
     The page never writes a store. A payment is STATED (POST /intent/pay) and HALTS for the
     operator (202 = the §6 HALTED state) carrying the S3 surface {diff, blast_radius,
     grant_statement}; the ONLY path past a HALT is POST /authority/resolve (BLESS|DENY), and a
     BLESS is what lands the real Ledger write behind the Warrant. Grant key = payee (1:1) so the
     console reads in plain terms. Same-origin, HttpOnly cookie session, credentials:include. */
  var GATE_PENDING = null;   // the grant key (payee) of the HALT awaiting a decision

  function gateRoot() { return document.querySelector("[data-gate]"); }
  function gateEl(sel) { var g = gateRoot(); return g ? g.querySelector(sel) : null; }
  function revealGate() { var g = gateRoot(); if (g) g.hidden = false; }
  function setGateMsg(sel, t) { var el = gateEl(sel); if (el) el.textContent = t || ""; }

  function money(n) { var v = Number(n); return "$" + (isFinite(v) ? v.toFixed(2) : "0.00"); }
  function blastText(br) {
    if (br == null) return "";
    if (typeof br === "string") return br;                 // a string blast_radius (deny paths)
    var bits = [];                                         // the Warrant's object: { amount, biller, scope }
    if (br.amount != null) bits.push(money(br.amount));
    if (br.biller) bits.push("to " + br.biller);
    if (br.scope) bits.push("\u00b7 " + br.scope);
    return bits.join(" ");
  }

  function clearSurface() {
    var s = gateEl("[data-gate-surface]");
    if (s) { s.hidden = true; s.innerHTML = ""; }
    GATE_PENDING = null;
  }

  // POST helper — same-origin, cookie session, JSON in/out; resolves { status, body }.
  function gatePost(path, payload) {
    return fetch(RT + path, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(
        function (b) { return { status: r.status, body: b }; },
        function () { return { status: r.status, body: {} }; });
    });
  }

  // S4 — the standing authority, made visible: the live grants (scope · cap) each with a Revoke,
  // read from GET /authority/grants (the runtime's K1-safe projection — never a secret). This is what
  // makes a grant's scope/expiry/revocation SHOWN, not only enforced (Warrant S4). Revoke = POST
  // /authority/revoke {grant} (bare: it kills FUTURE reach and keeps the already-ingested data). The
  // grove never lists a secret; it lists what authority you've handed out, and lets you take it back.
  function renderActiveAuthority(grants) {
    var box = gateEl("[data-gate-active]");
    var list = gateEl("[data-active-list]");
    if (!box || !list) return;
    var live = (grants || []).filter(function (g) { return !g.revoked; });
    box.hidden = false;
    if (!live.length) {
      list.innerHTML = '<p class="active__empty">No standing authority \u2014 every payment is denied at the gate. The grove stays read-only until you authorize a payee.</p>';
      return;
    }
    list.innerHTML = live.map(function (g) {
      var scope = (Array.isArray(g.billers) && g.billers.length) ? g.billers.join(", ") : g.key;
      return '<div class="active__row" role="group" aria-label="standing authority for ' + esc(g.key) + '">'
        + '<div class="active__what"><b class="active__key">' + esc(g.key) + '</b>'
        + '<span class="active__scope">up to ' + esc(money(g.cap)) + ' / payment \u00b7 ' + esc(scope) + '</span></div>'
        + '<button class="gate__btn gate__btn--revoke" type="button" data-revoke="' + esc(g.key) + '">Revoke</button>'
        + '</div>';
    }).join("");
    var btns = list.querySelectorAll("[data-revoke]");
    for (var i = 0; i < btns.length; i++) {
      (function (b) { b.addEventListener("click", function () { revokeGrant(b.getAttribute("data-revoke"), b); }); })(btns[i]);
    }
  }

  function renderCompositionBanner(aggregate) {
    var box = gateEl("[data-gate-active]");
    if (!box) return;
    var banner = box.querySelector("[data-composition]");
    if (!banner) {
      // inject once, ABOVE the active-grants list, so the composition state sits over the grants it sums
      banner = document.createElement("div");
      banner.setAttribute("data-composition", "");
      var list = gateEl("[data-active-list]");
      if (list && list.parentNode === box) box.insertBefore(banner, list); else box.appendChild(banner);
    }
    if (aggregate && aggregate.halted) {
      // S6 — the aggregate composed past the blast-radius threshold: the WHOLE is halted for fresh
      // consent, independent of any one grant. The grove says plainly that no payment will pass.
      var composing = (Array.isArray(aggregate.grants) ? aggregate.grants : []).map(esc).join(", ");
      banner.className = "active__composition active__composition--halt";
      banner.innerHTML =
        '<b class="active__composition-title">\u26a0 Composition halt \u2014 the whole exceeds its blast radius.</b>'
        + '<span class="active__composition-body">Your live grants compose to <b>' + esc(money(aggregate.composed))
        + '</b>, past the <b>' + esc(money(aggregate.threshold)) + '</b> blast-radius line. The aggregate itself is '
        + 'halted for fresh whole consent: <b>no payment will pass</b> until you bring the composition back under '
        + 'the line. Revoke a grant to proceed.</span>'
        + '<span class="active__composition-grants">composing: ' + composing + '</span>';
      banner.hidden = false;
    } else {
      // calm state — the aggregate gate is clear (numbers only surface on halt, by design)
      banner.className = "active__composition active__composition--safe";
      banner.textContent = "Composition within the blast radius \u2014 the aggregate gate is clear.";
      banner.hidden = false;
    }
  }

  function loadAuthority() {
    var box = gateEl("[data-gate-active]");
    if (!box) return;
    fetch(RT + "/authority/grants", { cache: "no-store", credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.grants)) renderActiveAuthority(data.grants);
        if (data) renderCompositionBanner(data.aggregate);   // S6 — the composition state, shown over the grants
      })
      .catch(function () { /* runtime down -> the panel stays dormant, like the rest of the console */ });
  }

  function revokeGrant(key, btn) {
    if (!key) return;
    if (btn) { btn.disabled = true; btn.textContent = "Revoking\u2026"; }
    gatePost("/authority/revoke", { grant: key })
      .then(function (res) {
        if (res.status === 200 && res.body && res.body.revoked) { loadAuthority(); return; }
        if (btn) { btn.disabled = false; btn.textContent = "Revoke"; }
      })
      .catch(function () { if (btn) { btn.disabled = false; btn.textContent = "Revoke"; } });
  }

  function renderHaltSurface(payee, amount, obs) {
    var s = gateEl("[data-gate-surface]");
    if (!s) return;
    GATE_PENDING = payee;
    obs = obs || {};
    s.innerHTML =
      '<div class="surface__card surface__card--halt" role="group" aria-label="authority required">'
      + '<div class="surface__mark" aria-hidden="true">&#9208;</div>'
      + '<div class="surface__head">'
      +   '<div class="surface__kicker">Authority required &middot; the grove halted</div>'
      +   '<div class="surface__claim">Pay <b>' + esc(money(amount)) + '</b> to <b>' + esc(payee) + '</b></div>'
      + '</div>'
      + '<dl class="surface__fields">'
      +   '<div class="surface__row"><dt>The change</dt><dd>' + esc(obs.diff) + '</dd></div>'
      +   '<div class="surface__row"><dt>Blast radius</dt><dd>' + esc(blastText(obs.blast_radius)) + '</dd></div>'
      +   '<div class="surface__row"><dt>What you&rsquo;re granting</dt><dd>' + esc(obs.grant_statement) + '</dd></div>'
      + '</dl>'
      + '<div class="surface__choice">'
      +   '<button class="gate__btn gate__btn--bless" data-bless type="button">Bless this payment</button>'
      +   '<button class="gate__btn gate__btn--decline" data-decline type="button">Decline</button>'
      + '</div>'
      + '<p class="surface__msg" data-surface-msg role="status" aria-live="polite"></p>'
      + '</div>';
    s.hidden = false;
    var bless = s.querySelector("[data-bless]");
    var decline = s.querySelector("[data-decline]");
    if (bless) bless.addEventListener("click", function () { resolvePending("BLESS"); });
    if (decline) decline.addEventListener("click", function () { resolvePending("DENY"); });
    if (s.scrollIntoView) s.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderDenied(obs, headline) {
    var s = gateEl("[data-gate-surface]");
    if (!s) return;
    GATE_PENDING = null;
    s.innerHTML =
      '<div class="surface__card surface__card--denied" role="group" aria-label="denied at the gate">'
      + '<div class="surface__mark" aria-hidden="true">&#8709;</div>'
      + '<div class="surface__head">'
      +   '<div class="surface__kicker">Denied at the gate</div>'
      +   '<div class="surface__claim">' + esc(headline || "No authority covers this.") + '</div>'
      + '</div>'
      + (obs ? ('<dl class="surface__fields">'
      +   '<div class="surface__row"><dt>Why</dt><dd>' + esc(obs.grant_statement || "") + '</dd></div>'
      +   '<div class="surface__row"><dt>Blast radius</dt><dd>' + esc(blastText(obs.blast_radius)) + '</dd></div>'
      + '</dl>') : '')
      + '<p class="surface__note">Nothing changed. Authorize the payee, then request the payment again.</p>'
      + '</div>';
    s.hidden = false;
  }

  function renderResolved(blessed, text) {
    var s = gateEl("[data-gate-surface]");
    if (!s) return;
    GATE_PENDING = null;
    s.innerHTML =
      '<div class="surface__card surface__card--' + (blessed ? "done" : "declined") + '" role="status">'
      + '<div class="surface__mark" aria-hidden="true">' + (blessed ? "&#10003;" : "&#8212;") + '</div>'
      + '<div class="surface__head"><div class="surface__claim">' + esc(text) + '</div></div>'
      + '</div>';
    s.hidden = false;
    if (blessed) loadForest();        // the soil counts may have moved — refresh the live read (best-effort)
  }

  function requestPayment(payee, amount) {
    setGateMsg("[data-pay-msg]", "\u2026");
    gatePost("/intent/pay", { grant: payee, biller: payee, amount: amount })
      .then(function (res) {
        setGateMsg("[data-pay-msg]", "");
        if (res.status === 202) { renderHaltSurface(payee, amount, res.body.observation); return; }
        if (res.status === 403) { renderDenied(res.body.observation, "The gate refused this payment."); return; }
        if (res.status === 401) { setGateMsg("[data-pay-msg]", "Your session expired \u2014 sign in again."); return; }
        setGateMsg("[data-pay-msg]", (res.body && res.body.error) ? res.body.error : ("Couldn\u2019t request the payment (HTTP " + res.status + ")."));
      })
      .catch(function () { setGateMsg("[data-pay-msg]", "Can\u2019t reach the Forest runtime \u2014 is it up?"); });
  }

  function resolvePending(decision) {
    if (!GATE_PENDING) return;
    var grant = GATE_PENDING;
    var s = gateEl("[data-gate-surface]");
    var smsg = s ? s.querySelector("[data-surface-msg]") : null;
    var btns = s ? s.querySelectorAll("button") : [];
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
    if (smsg) smsg.textContent = (decision === "BLESS") ? "Blessing \u2014 posting to the Ledger\u2026" : "Declining\u2026";
    gatePost("/authority/resolve", { grant: grant, decision: decision })
      .then(function (res) {
        if (res.status === 200 && res.body.decision === "bless") {
          var led = (res.body.applied && res.body.applied.ledger) || {};
          var hash8 = led.transaction_hash ? String(led.transaction_hash).slice(0, 8) : "";
          var paid = led.amount_cents != null ? "$" + (led.amount_cents / 100).toFixed(2) : "";
          renderResolved(true, "Paid " + paid + " to " + grant + " \u2014 posted to the Ledger" + (hash8 ? " (proof " + hash8 + "\u2026)" : "") + ".");
          return;
        }
        if (res.status === 200 && res.body.decision === "deny") { renderResolved(false, "Declined \u2014 nothing was paid."); return; }
        if (smsg) smsg.textContent = (res.body && res.body.error) ? res.body.error : ("Couldn\u2019t resolve (HTTP " + res.status + ").");
        for (var j = 0; j < btns.length; j++) btns[j].disabled = false;
      })
      .catch(function () {
        if (smsg) smsg.textContent = "Can\u2019t reach the Forest runtime \u2014 is it up?";
        for (var k = 0; k < btns.length; k++) btns[k].disabled = false;
      });
  }

  /* ---------- B2 slice A: Sort the soil — owner curation (recategorize) ----------
     The C durable layer (operator decision). The uncategorized (null-bucket) items are read
     from GET /projection/soil (K1-safe provenance, never content) and surfaced so the owner places each
     onto a tree. An assignment is POST /soil/recategorize — the OWNER-DATA write class (no Warrant grant:
     it widens no scope, reads no source, pays nothing). The page never writes a store; the runtime
     mediates the write through the Catch. Assignments feed the trees on the next box-side rebuild
     (rebuild-edges-on-box.sh); the page does not fake a rebuild it cannot perform (Real-or-Made).
     Same-origin, HttpOnly cookie session, credentials:include. */

  // Phase 2 — the assignable picker is DERIVED from the live kit. renderCanopy caches the feed-bearing
  // tree ids into ASSIGNABLE_TREES (see deriveAssignable), so any structured tree added to
  // golden/kit/trees/ becomes pickable with no hardcode edit. The list below is kept ONLY as a defensive
  // fallback — used if the canopy projection yields no feed-bearing trees (a malformed/empty read),
  // never as the source of truth. (interpret_soil/build_forest_edges accept exactly this set.)
  var TREE_CATEGORIES = [
    "bills", "tax", "fitness", "health-admin", "gc", "estate", "homestead",
    "retirement-college", "marriage", "entities", "founder-equity", "burning-man"
  ];
  var ASSIGNABLE_TREES = [];   // derived from the canopy on load (feed-bearing tree ids)
  var ALL_TREES = [];          // the full canopy tree list (id+trunk+branches+grove) — for the New tree form

  // The Hollow — the residual tree (plan §3c / §5.2). Deliberately NOT in TREE_CATEGORIES and
  // NOT in the categorize rule: it is a curation ESCAPE, reached only by the owner's explicit
  // "Keep in drawer", never auto-sorted into. recategorize takes a free-text category (the-catch.js
  // has no allowlist), so the id is all the front-end needs; the box-side rebuild maps it to the
  // planted holding-pen anatomy. null = pending sort (nags); the Hollow = sorted-to-nowhere (resolved).
  var HOLLOW_ID = "the-hollow";

  // Phase 4 (the warm path, plan §3d/§3b.1): the Hollow watches its own population
  // and offers to grow a tree from a cluster. All advisory — never an auto-grow
  // (V4, the Witness Ceiling: the system surfaces, the operator decides).
  var HOLLOW_FULL_THRESHOLD = 5;   // overpopulation nudge fires at/above this count
  var lastHeld = [];               // most-recent Hollow membership (for the on-demand cluster run)
  var hollowSuggestWired = false;  // the "look for trees" button is wired once
  var ntPendingDrain = null;       // {items:[..]} captured by a "grow a tree for these" action

  function curateRoot() { return document.querySelector("[data-curate]"); }
  function curateEl(sel) { var r = curateRoot(); return r ? r.querySelector(sel) : null; }
  function setCurateMsg(t) { var el = curateEl("[data-curate-msg]"); if (el) el.textContent = t || ""; }
  function itemLabel(it) {
    var name = (it && it.name != null) ? String(it.name).trim() : "";
    if (name) return name;                                   // the human-readable filename/title, when carried
    var id = String(it.itemId == null ? "" : it.itemId);     // fallback: the source id (opaque for Drive)
    return id || "(unnamed item)";
  }

  // Phase 2: derive the assignable picker set from the live kit. The canopy carries every tree with its
  // seam flags; a tree is a curate target iff it publishes a feed (feed_to) — exactly the set
  // interpret_soil/build_forest_edges accept. Feedless nodes (bench, desk, the Hollow) are not curate
  // targets and are excluded. Schema-driven: a new feed-bearing anatomy becomes pickable with no edit.
  function deriveAssignable(canopy) {
    var all = (canopy && Array.isArray(canopy.trees)) ? canopy.trees.slice() : [];
    if (!all.length && canopy && Array.isArray(canopy.groves)) {
      canopy.groves.forEach(function (g) { (g.trees || []).forEach(function (t) { all.push(t); }); });
    }
    ALL_TREES = all.slice();   // full set (with trunk/branches/grove) for the New tree form's Prior-Art Gate
    var ids = all.filter(function (t) { return t && t.feed_to; }).map(function (t) { return t.tree; });
    ids.sort();
    ASSIGNABLE_TREES = ids;
    // ①c "Send to Forest" — publish the SAME feed-bearing set the curate picker uses, in the
    // mail-renderer's { category, label } shape, on the window.FOREST_* channel the renderer reads
    // (beside FOREST_MAIL_ACCOUNT / FOREST_SEND_GRANT). Reuses `ids` + titleize — no second tree list
    // (the FOR-MY-SUCCESSOR steer). Re-runs on every canopy load, so the row picker grows with the
    // canopy. Empty canopy -> [] -> renderer's trees.length gate stays dark (flag-don't-fake).
    if (typeof window !== "undefined") {
      window.FOREST_MAIL_TREES = ids.map(function (id) { return { category: id, label: titleize(id) }; });
    }
    wireNewTree();   // (re)populate the New tree form's grove list + arm it once the canopy is known
  }

  function categorySelect(it) {
    var cats = (ASSIGNABLE_TREES && ASSIGNABLE_TREES.length) ? ASSIGNABLE_TREES : TREE_CATEGORIES;
    var opts = ['<option value="" selected disabled>place on a tree\u2026</option>'];
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      opts.push('<option value="' + esc(c) + '">' + esc(titleize(c)) + '</option>');
    }
    return '<select class="curate-row__select" aria-label="category for ' + esc(itemLabel(it)) + '">' + opts.join("") + '</select>';
  }

  function renderCuration(data) {
    var list = curateEl("[data-curate-list]");
    var gloss = curateEl("[data-curate-gloss]");
    if (!list) return;
    var items = (data && Array.isArray(data.items)) ? data.items : [];
    renderHollow(items);   // the holding pen always reflects current Hollow membership, even when the null list is empty
    var uncategorized = items.filter(function (it) { return it.category == null; });
    var sorted = items.length - uncategorized.length;

    if (gloss) {
      gloss.textContent = sorted + " sorted \u00b7 " + uncategorized.length
        + " still unsorted \u00b7 assignments feed the trees on the next rebuild";
    }

    if (!uncategorized.length) {
      list.innerHTML = '<p class="curate-empty"><span class="curate-empty__mark" aria-hidden="true">\u2713</span> '
        + (items.length ? "Everything\u2019s sorted \u2014 nothing waiting here."
                        : "No ingested soil yet \u2014 sync a source first.")
        + '</p>';
      return;
    }

    list.innerHTML = uncategorized.map(function (it) {
      var src = esc(String(it.source || "") + (it.account ? " \u00b7 " + it.account : ""));
      return '<div class="curate-row" role="group" aria-label="' + esc(itemLabel(it)) + '">'
        + '<div class="curate-row__what"><span class="curate-row__id">' + esc(itemLabel(it)) + '</span>'
        + '<span class="curate-row__src">' + src + '</span></div>'
        + '<div class="curate-row__act">' + categorySelect(it)
        + '<button class="gate__btn curate-row__btn" type="button">Assign</button>'
        + '<button class="curate-row__keep" type="button" title="Keep this \u2014 it fits no tree. It moves to the Hollow and stops nagging.">Keep in drawer</button></div>'
        + '</div>';
    }).join("");

    // wire each row — Assign posts the selected category; Keep in drawer posts the Hollow id
    var rows = list.querySelectorAll(".curate-row");
    for (var i = 0; i < rows.length; i++) {
      (function (rowEl, it) {
        var sel = rowEl.querySelector(".curate-row__select");
        var btn = rowEl.querySelector(".curate-row__btn");
        var keep = rowEl.querySelector(".curate-row__keep");
        if (btn) btn.addEventListener("click", function () {
          var category = sel ? sel.value : "";
          if (!category) { setCurateMsg("Pick a tree for \u201c" + itemLabel(it) + "\u201d first."); return; }
          assignCategory(it, category, rowEl, btn);
        });
        if (keep) keep.addEventListener("click", function () { keepInHollow(it, rowEl, keep); });
      })(rows[i], uncategorized[i]);
    }
  }

  function assignCategory(it, category, rowEl, btn, copy) {
    copy = copy || {
      progress: "Placing \u201c" + itemLabel(it) + "\u201d on " + titleize(category) + "\u2026",
      ok: "\u2713 " + itemLabel(it) + " placed on " + titleize(category) + ".",
    };
    if (btn) btn.disabled = true;
    setCurateMsg(copy.progress);
    gatePost("/soil/recategorize", { source: it.source, account: it.account, itemId: it.itemId, category: category })
      .then(function (res) {
        if (res.status === 200 && (res.body.state === "APPLIED" || res.body.decision === "applied")) {
          if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
          setCurateMsg(copy.ok);
          loadCuration();   // re-read: keeps counts true, refreshes the Hollow, shows the calm state when the last is sorted
          return;
        }
        if (res.status === 401) { setCurateMsg("Your session expired \u2014 sign in again."); if (btn) btn.disabled = false; return; }
        if (res.status === 404) { setCurateMsg("That item is no longer in the soil (it may have been purged)."); if (btn) btn.disabled = false; return; }
        setCurateMsg((res.body && res.body.error) ? res.body.error : ("Couldn\u2019t place it (HTTP " + res.status + ")."));
        if (btn) btn.disabled = false;
      })
      .catch(function () { setCurateMsg("Can\u2019t reach the Forest runtime \u2014 is it up?"); if (btn) btn.disabled = false; });
  }

  // "Keep in drawer" \u2014 the curation escape. Recategorize the item onto the Hollow (free-text category;
  // the same OWNER-DATA write as Assign), with holding-pen copy. The row leaves the null list and reappears
  // under "Kept in the Hollow" on the loadCuration re-read (Ink Law: held + visible, never discarded).
  function keepInHollow(it, rowEl, btn) {
    assignCategory(it, HOLLOW_ID, rowEl, btn, {
      progress: "Keeping \u201c" + itemLabel(it) + "\u201d in the Hollow\u2026",
      ok: "\u2713 " + itemLabel(it) + " kept in the Hollow \u2014 it\u2019ll stop nagging.",
    });
  }

  // The holding pen \u2014 items the owner kept that fit no tree. Read-only in Phase 1: shown, held, never
  // auto-removed (Ink Law). The pen hides itself when empty so it never nags the way the null list does.
  function renderHollow(items) {
    var pen = curateEl("[data-hollow]");
    var list = curateEl("[data-hollow-list]");
    var gloss = curateEl("[data-hollow-gloss]");
    if (!pen || !list) return;
    var held = (items || []).filter(function (it) { return it.category === HOLLOW_ID; });
    lastHeld = held.slice();
    if (!held.length) {
      pen.hidden = true; list.innerHTML = ""; if (gloss) gloss.textContent = "";
      renderHollowSuggest(held);   // keep the suggest region in sync (hides it)
      return;
    }
    pen.hidden = false;
    if (gloss) gloss.textContent = held.length + (held.length === 1 ? " thing" : " things") + " kept here \u2014 held, never discarded";
    list.innerHTML = held.map(function (it) {
      var src = esc(String(it.source || "") + (it.account ? " \u00b7 " + it.account : ""));
      return '<div class="hollow-row" role="group" aria-label="' + esc(itemLabel(it)) + ' (kept in the Hollow)">'
        + '<span class="hollow-row__id">' + esc(itemLabel(it)) + '</span>'
        + '<span class="hollow-row__src">' + src + '</span>'
        + '</div>';
    }).join("");
    renderHollowSuggest(held);   // Phase 4: the self-monitor (overpopulation nudge + cluster suggest)
  }

  /* ---------- Phase 4: the self-monitoring Hollow (plan §3d/§3b.1/§4) ----------
     The drawer watches its own population. Two advisory signals, never auto-acted:
     an overpopulation NUDGE (a louder banner past a threshold) and CLUSTER
     DETECTION (run on demand — "look for trees hiding here"). A cluster offers a
     "grow a tree for these" action that PRE-FILLS the New-tree form (reusing the
     Phase-3 emit engine) and, after emit, DRAINS the cluster onto the new tree.
     All logic lives in tree-cluster.js (TreeCluster) + tree-author.js (TreeAuthor);
     this is the DOM driver. Inert (region hidden) if TreeCluster failed to load. */

  // Render/refresh the suggest region for the current Hollow membership. The
  // cluster output is NOT computed eagerly — the pen stays calm until the operator
  // asks (the "look" button); only the overpopulation nudge fires automatically.
  function renderHollowSuggest(held) {
    var box = curateEl("[data-hollow-suggest]");
    var full = curateEl("[data-hollow-full]");
    var look = curateEl("[data-hollow-look]");
    var out = curateEl("[data-hollow-clusters]");
    if (!box) return;
    var TC = window.TreeCluster;
    if (!TC || held.length < 2) { box.hidden = true; if (out) out.innerHTML = ""; return; }
    box.hidden = false;
    if (full) {
      if (held.length >= HOLLOW_FULL_THRESHOLD) {
        full.hidden = false;
        full.textContent = "Your Hollow is getting full (" + held.length + " kept) \u2014 there may be trees hiding in it.";
      } else { full.hidden = true; full.textContent = ""; }
    }
    if (look && !hollowSuggestWired) { hollowSuggestWired = true; look.addEventListener("click", runHollowSuggest); }
    if (out) out.innerHTML = "";   // membership changed — clear any stale cluster render
  }

  // On demand: cluster the current Hollow and render each cluster with a "grow" CTA.
  function runHollowSuggest() {
    var TC = window.TreeCluster;
    var out = curateEl("[data-hollow-clusters]");
    if (!TC || !out) return;
    var r = TC.clusterHollow(lastHeld);
    if (!r.clusters.length) {
      out.innerHTML = '<p class="hollow-suggest__none">Nothing clusters yet \u2014 these items don\u2019t share an obvious shape. Keep them, or place them by hand.</p>';
      return;
    }
    out.innerHTML = r.clusters.map(function (c, i) {
      var names = c.items.map(function (it) { return esc(itemLabel(it)); }).join(", ");
      var toks = (c.tokens || []).slice(0, 4).map(esc).join(" \u00b7 ");
      return '<div class="hollow-cluster" role="group" aria-label="cluster of ' + c.size + ' items">'
        + '<div class="hollow-cluster__head"><b class="hollow-cluster__count">' + c.size + ' items</b>'
        + (toks ? '<span class="hollow-cluster__toks">' + toks + '</span>' : '') + '</div>'
        + '<div class="hollow-cluster__items">' + names + '</div>'
        + '<button type="button" class="gate__btn hollow-cluster__grow" data-cluster-grow="' + i + '">Grow a tree for these ' + c.size + '</button>'
        + '</div>';
    }).join("");
    var btns = out.querySelectorAll("[data-cluster-grow]");
    for (var i = 0; i < btns.length; i++) {
      (function (idx) {
        var b = out.querySelector('[data-cluster-grow="' + idx + '"]');
        if (b) b.addEventListener("click", function () { growTreeFromCluster(r.clusters[idx]); });
      })(i);
    }
  }

  // "Grow a tree for these" — pre-fill the New-tree form from the cluster (a
  // suggestion the operator edits) and remember the items for the post-emit drain.
  function growTreeFromCluster(cluster) {
    var TC = window.TreeCluster;
    if (!TC) return;
    var s = TC.suggestFields(cluster);
    ntPrefill(s);
    ntPendingDrain = { items: (cluster.items || []).slice() };
    var details = ntRoot();
    if (details) { details.open = true; if (details.scrollIntoView) { try { details.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { details.scrollIntoView(); } } }
    ntSet("[data-nt-msg]", "Pre-filled from " + cluster.size + " Hollow items \u2014 review, pick a grove, then emit. After emitting you can move them onto the new tree.");
  }

  // Set the New-tree form's DOM values from a suggestion (no submit — the operator
  // reviews and emits). Mirrors ntCollect's hooks in reverse.
  function ntPrefill(s) {
    function setVal(sel, v) { var el = ntEl(sel); if (el) el.value = v == null ? "" : v; }
    setVal("[data-nt-name]", s.name);
    var idEl = ntEl("[data-nt-id]");
    if (idEl) idEl.textContent = (window.TreeAuthor ? window.TreeAuthor.slugify(s.name) : s.id) || "\u2014";
    setVal("[data-nt-trunk]", s.trunk);
    setVal("[data-nt-grove]", s.grove || "");
    var br = ntEl("[data-nt-branches]"); if (br) br.value = (s.branches || []).join("\n");
    var boxes = ntRoot() ? ntRoot().querySelectorAll("[data-nt-pace] input") : [];
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = (s.pace || []).indexOf(boxes[i].value) !== -1;
    var holding = ntRoot() ? ntRoot().querySelector('[data-nt-kind] input[value="holding"]') : null;
    if (holding) holding.checked = true;
    var structured = ntEl("[data-nt-structured]"); if (structured) structured.hidden = true;
  }

  // After a successful emit, offer to drain the pending cluster onto the new tree.
  // This is an OWNER-DATA write (recategorize, the §2 write-class split), triggered
  // by the operator (V4 witness). Honest about ordering: the items point at the new
  // tree id and sort there on the next rebuild, after the anatomy is committed.
  function ntRenderDrain(treeId) {
    var emitted = ntEl("[data-nt-emitted]");
    if (!emitted) return;
    var prior = emitted.querySelector("[data-nt-drain]");
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
    if (!ntPendingDrain || !ntPendingDrain.items || !ntPendingDrain.items.length) return;
    var n = ntPendingDrain.items.length;
    var wrap = document.createElement("div");
    wrap.className = "newtree__drain";
    wrap.setAttribute("data-nt-drain", "");
    wrap.innerHTML = '<p class="newtree__drain-note">Move the ' + n + ' clustered item' + (n === 1 ? "" : "s")
      + ' onto <code>' + esc(treeId) + '</code>. They\u2019ll land there on the next rebuild, after you commit the anatomy above.</p>'
      + '<button type="button" class="gate__btn newtree__drain-btn" data-nt-drain-btn>Move ' + n + ' item' + (n === 1 ? "" : "s") + ' onto ' + esc(titleize(treeId)) + '</button>';
    emitted.appendChild(wrap);
    var btn = wrap.querySelector("[data-nt-drain-btn]");
    if (btn) btn.addEventListener("click", function () { drainCluster(ntPendingDrain.items.slice(), treeId, btn); });
  }

  // Recategorize each clustered item onto the new tree (the loop closing). Reuses
  // the /soil/recategorize owner-data write; refreshes the Hollow on completion.
  function drainCluster(items, treeId, btn) {
    if (btn) btn.disabled = true;
    setCurateMsg("Moving " + items.length + " item" + (items.length === 1 ? "" : "s") + " onto " + titleize(treeId) + "\u2026");
    var posts = items.map(function (it) {
      return gatePost("/soil/recategorize", { source: it.source, account: it.account, itemId: it.itemId, category: treeId });
    });
    Promise.all(posts).then(function (results) {
      if (results.some(function (r) { return r.status === 401; })) { setCurateMsg("Your session expired \u2014 sign in again."); if (btn) btn.disabled = false; return; }
      var ok = results.filter(function (r) { return r.status === 200 && (r.body.state === "APPLIED" || r.body.decision === "applied"); }).length;
      var fail = results.length - ok;
      setCurateMsg("\u2713 Moved " + ok + " item" + (ok === 1 ? "" : "s") + " onto " + titleize(treeId)
        + (fail ? " (" + fail + " couldn\u2019t move)" : "") + " \u2014 they\u2019ll sort on the next rebuild, once you commit the anatomy.");
      ntPendingDrain = null;
      loadCuration();   // re-read: the Hollow shrinks, counts stay true
    }).catch(function () { setCurateMsg("Can\u2019t reach the Forest runtime \u2014 is it up?"); if (btn) btn.disabled = false; });
  }

  function loadCuration() {
    var root = curateRoot();
    if (root) root.hidden = false;            // a live session reached this read — reveal the surface
    fetch(RT + "/projection/soil", { cache: "no-store", credentials: "include" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(renderCuration)
      .catch(function (e) {
        var list = curateEl("[data-curate-list]");
        if (list) list.innerHTML = '<p class="state-error">Couldn\u2019t read the soil (' + esc(e.message) + ').</p>';
      });
  }

  /* ---------- Phase 3: New tree — propose-from-scratch (plan §3b.2 / §4) ----------
     §5.1 = A (deploy-time emit): the form EMITS a valid anatomy JSON the owner commits to
     golden/kit/trees/<id>.anatomy.json. No runtime write, no call to the kit. The Prior-Art
     Gate (View Test) runs client-side against the loaded canopy (which carries every tree's
     trunk + branches) before the emit. All logic lives in tree-author.js (TreeAuthor); this is
     the DOM driver. The form is inert if TreeAuthor failed to load (graceful degradation). */

  var ntWired = false;     // DOM listeners attached once; the grove list refreshes on every load
  var ntOverride = false;  // operator chose "Create anyway" past a near-dup prior-art warning

  function ntRoot() { return document.querySelector("[data-newtree]"); }
  function ntEl(sel) { var r = ntRoot(); return r ? r.querySelector(sel) : null; }
  function ntSet(sel, t) { var el = ntEl(sel); if (el) el.textContent = t || ""; }

  function ntGroves() {
    var seen = {}, out = [];
    ALL_TREES.forEach(function (t) { var g = t && t.grove; if (g && !seen[g]) { seen[g] = 1; out.push(g); } });
    out.sort();
    return out;
  }

  function ntCollect() {
    var TA = window.TreeAuthor;
    var name = (ntEl("[data-nt-name]") || {}).value || "";
    var branches = String((ntEl("[data-nt-branches]") || {}).value || "")
      .split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
    var pace = [];
    var boxes = ntRoot() ? ntRoot().querySelectorAll("[data-nt-pace] input:checked") : [];
    for (var i = 0; i < boxes.length; i++) pace.push(boxes[i].value);
    var kindEl = ntRoot() ? ntRoot().querySelector("[data-nt-kind] input:checked") : null;
    var kind = kindEl ? kindEl.value : "holding";
    var publishes = {};
    var rows = ntRoot() ? ntRoot().querySelectorAll("[data-nt-fields] .newtree__fieldrow") : [];
    for (var j = 0; j < rows.length; j++) {
      var fn = (rows[j].querySelector("[data-nt-fname]") || {}).value || "";
      var ft = (rows[j].querySelector("[data-nt-ftype]") || {}).value || "";
      if (fn.trim() && ft.trim()) publishes[fn.trim()] = ft.trim();
    }
    return {
      id: TA ? TA.slugify(name) : name,
      trunk: (ntEl("[data-nt-trunk]") || {}).value || "",
      grove: (ntEl("[data-nt-grove]") || {}).value || "",
      branches: branches,
      pace: pace,
      kind: kind,
      publishes: publishes,
      feedTo: (ntEl("[data-nt-feedto]") || {}).value || ""
    };
  }

  function ntRenderEmit(fields) {
    var TA = window.TreeAuthor;
    var id = TA.slugify(fields.id);
    var json = TA.emitJSON(fields);
    var result = ntEl("[data-nt-result]");
    var emitted = ntEl("[data-nt-emitted]");
    var pre = ntEl("[data-nt-json]");
    var pathEl = ntEl("[data-nt-path]");
    var dl = ntEl("[data-nt-download]");
    if (pre) pre.textContent = json;
    if (pathEl) pathEl.textContent = "golden/kit/trees/" + id + ".anatomy.json";
    if (dl) {
      dl.setAttribute("href", "data:application/json;charset=utf-8," + encodeURIComponent(json + "\n"));
      dl.setAttribute("download", id + ".anatomy.json");
    }
    if (result) result.hidden = false;
    if (emitted) emitted.hidden = false;
    ntSet("[data-nt-msg]", "\u2713 Emitted a valid anatomy for \u201c" + id + "\u201d \u2014 review and commit it.");
    ntRenderDrain(id);   // Phase 4: if this emit came from a cluster, offer to drain it onto the tree
  }

  function ntRenderPriorArt(pa, fields) {
    var box = ntEl("[data-nt-priorart]");
    var result = ntEl("[data-nt-result]");
    var emitted = ntEl("[data-nt-emitted]");
    if (emitted) emitted.hidden = true;
    if (!box) return;
    var names = pa.matches.map(function (m) { return titleize(m.tree); });
    var lead = pa.matches.length === 1
      ? ("This looks a lot like <strong>" + esc(names[0]) + "</strong>.")
      : ("This overlaps existing trees: <strong>" + esc(names.join(", ")) + "</strong>.");
    box.innerHTML = '<p class="newtree__pa-lead">' + lead
      + ' Consider adding it as a <em>branch</em> there instead of growing a near-duplicate tree.</p>'
      + '<button type="button" class="newtree__anyway" data-nt-anyway>Create anyway</button>';
    box.hidden = false;
    if (result) result.hidden = false;
    var anyway = box.querySelector("[data-nt-anyway]");
    if (anyway) anyway.addEventListener("click", function () { ntOverride = true; ntSubmit(); });
    ntSet("[data-nt-msg]", "Prior art found \u2014 review below.");
  }

  function ntSubmit() {
    var TA = window.TreeAuthor;
    if (!TA) { ntSet("[data-nt-msg]", "Tree author isn\u2019t loaded \u2014 reload the page."); return; }
    var box = ntEl("[data-nt-priorart]"); if (box) { box.hidden = true; box.innerHTML = ""; }
    var emitted = ntEl("[data-nt-emitted]"); if (emitted) emitted.hidden = true;

    var fields = ntCollect();
    var v = TA.validateFields(fields, ALL_TREES.map(function (t) { return t.tree; }));
    if (!v.ok) {
      ntOverride = false;
      ntSet("[data-nt-msg]", v.errors[0]);   // surface the first blocker; fix-and-resubmit
      return;
    }
    var pa = TA.priorArt(fields, ALL_TREES);
    if (pa.idCollision) { ntSet("[data-nt-msg]", "A tree with that id already exists \u2014 pick another name."); return; }
    if (pa.verdict === "near-dup" && !ntOverride) { ntRenderPriorArt(pa, fields); return; }
    ntRenderEmit(fields);
  }

  function wireNewTree() {
    var root = ntRoot();
    if (!root) return;

    // refresh the grove suggestions every load (the canopy may have grown)
    var dl = ntEl("[data-nt-groves]");
    if (dl) dl.innerHTML = ntGroves().map(function (g) { return '<option value="' + esc(g) + '"></option>'; }).join("");

    if (ntWired) return;   // attach listeners once
    ntWired = true;

    // Phase 4: closing the New-tree form is a "done here" signal — drop any pending
    // cluster drain so a later, unrelated emit can't offer to drain stale items.
    // (A re-grow supersedes it; a successful drain clears it too.)
    if (root.addEventListener) root.addEventListener("toggle", function () {
      if (!root.open) ntPendingDrain = null;
    });

    var nameEl = ntEl("[data-nt-name]");
    if (nameEl) nameEl.addEventListener("input", function () {
      var idEl = ntEl("[data-nt-id]");
      var id = window.TreeAuthor ? window.TreeAuthor.slugify(nameEl.value) : "";
      if (idEl) idEl.textContent = id || "\u2014";
    });

    var kindEls = root.querySelectorAll("[data-nt-kind] input");
    for (var i = 0; i < kindEls.length; i++) kindEls[i].addEventListener("change", function () {
      var s = ntEl("[data-nt-structured]");
      var kindEl = root.querySelector("[data-nt-kind] input:checked");
      if (s) s.hidden = !(kindEl && kindEl.value === "structured");
    });

    var add = ntEl("[data-nt-addfield]");
    if (add) add.addEventListener("click", function () {
      var fields = ntEl("[data-nt-fields]");
      if (!fields) return;
      var row = document.createElement("div");
      row.className = "newtree__fieldrow";
      row.innerHTML = '<input type="text" class="newtree__input newtree__half" data-nt-fname placeholder="field" autocomplete="off">'
        + '<input type="text" class="newtree__input newtree__half" data-nt-ftype placeholder="string" autocomplete="off">';
      fields.appendChild(row);
    });

    var form = ntEl("[data-newtree-form]");
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); ntOverride = false; ntSubmit(); });

    // any edit after a result invalidates the override (re-checks prior art on next submit)
    root.addEventListener("input", function (e) {
      if (e.target && e.target.hasAttribute && (e.target.hasAttribute("data-nt-anyway"))) return;
      ntOverride = false;
    });

    var copy = ntEl("[data-nt-copy]");
    if (copy) copy.addEventListener("click", function () {
      var pre = ntEl("[data-nt-json]");
      var text = pre ? pre.textContent : "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { ntSet("[data-nt-msg]", "\u2713 Copied."); }, function () {});
      }
    });
  }

  /* ---------- B4 slice B: Linked sources — connector panel (GET /connectors + Sync + Unlink) ----------
     The connector-lifecycle surface (runtime 0.9): the owner's active source grants made visible, with
     a Sync (read-side ingest re-run) and an Unlink (revoke + erasure cascade) action per row.
     Mirrors renderActiveAuthority + the gatePost/loadCuration idiom. The link→resolve flow (adding a
     new source) is explicitly OUT of scope here — it is a separate later WO. */

  function connRoot() { return document.querySelector("[data-connectors]"); }
  function connEl(sel) { var r = connRoot(); return r ? r.querySelector(sel) : null; }
  function setConnMsg(t) { var el = connEl("[data-conn-msg]"); if (el) el.textContent = t || ""; }

  /* THE RECEIPT STORE (— the vanishing-receipt defect).
   *
   * A sync's receipt ("✓ Synced · 248 ingested · 248 changed") is the ONLY observable evidence of
   * what an ingest actually DID. It was written straight into the row's status <p> — and then, on
   * the very next line, loadConnectors() re-rendered the whole list from scratch and painted that
   * <p> EMPTY again. The receipt survived about half a second.
   *
   * That is not a cosmetic bug. It is an OBSERVABILITY bug, and it cost real debugging: the
   * question "did the contacts backfill actually fire?" is answered by exactly one number — the
   * receipt's `changed` count — and the UI destroyed that number before the operator could read it.
   * Three attempts to diagnose a data bug ran blind because the instrument wiped itself.
   *
   * Fix: a receipt is STATE, not a transient paint. Keep it keyed by grant and have
   * renderConnectors paint it back on every render, so a refresh can no longer erase it. It
   * persists until the next action on that grant.
   *
   * Deliberately IN-MEMORY only (no browser storage): the receipt is a diagnostic, not a durable
   * record, and Forest does not park ingest facts about the owner's contacts in localStorage. A
   * page reload legitimately clears it — the clock stamp below is what makes that unambiguous.
   */
  var connReceipts = {};                       // "provider|account" -> { text, at }
  function connKey(provider, account) { return String(provider) + "|" + String(account); }

  function connReceiptText(provider, account) {
    var r = connReceipts[connKey(provider, account)];
    if (!r) return "";
    return r.text + (r.at ? " · " + r.at : "");
  }

  // Paint a grant's stored receipt into its live row, if that row is currently on screen.
  function paintConnReceipt(provider, account) {
    var key = connKey(provider, account);
    var nodes = document.querySelectorAll(".conn-row__status");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-conn-status") === key) {
        nodes[i].textContent = connReceiptText(provider, account);
      }
    }
  }

  /* Set (or clear, with a falsy text) a grant's receipt, then paint it.
   * `terminal` marks a finished outcome — it gets a clock stamp, so a receipt left on screen from
   * an earlier sync can never be misread as the result of the one you just ran. In-flight states
   * ("Syncing…") are stored too, so a re-render mid-flight doesn't blank the row, but carry no stamp. */
  function setConnReceipt(provider, account, text, terminal) {
    var key = connKey(provider, account);
    if (!text) delete connReceipts[key];
    else connReceipts[key] = { text: text, at: terminal ? new Date().toLocaleTimeString() : "" };
    paintConnReceipt(provider, account);
  }

  /* LEG 4 — THE FRESHNESS READ, and the surface that finally paints it.
   *
   * Legs 2+3 taught the runtime to tell five states apart and serve them, typed, at
   * GET /connectors/freshness. NOTHING RENDERED IT — so the app went on showing 248
   * contacts frozen for thirteen days in exactly the confident silence the campaign
   * exists to end. This is that surface.
   *
   * The fold + every honesty law lives in shell/connector-freshness.js (a failed read
   * is `unknown`, NEVER `fresh`; the action sentences are the SERVER's, rendered
   * verbatim, never a second copy). Here we only PAINT it.
   *
   * COLD-SAFE: absent the module, `connFresh` stays null and every row renders exactly
   * as it did before this leg — the freshness block simply does not appear. The alarm
   * line never mounts. No throw reaches the boot.                                    */
  function cfMod() {
    return (window.ForestShell && window.ForestShell.connectorFreshness) || null;
  }
  var connFresh = null;             // the last freshness SUMMARY (never a raw payload)

  function connFreshRow(provider, account) {
    if (!connFresh || connFresh.read !== "ok") return null;
    var rows = connFresh.sources || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].provider === provider && rows[i].account === account) return rows[i];
    }
    return null;                    // a grant with no verdict — honest-unknown, see below
  }

  /* The per-row freshness block. THE ONE RULE IT EXISTS TO OBEY:
   * a FAILING source is never described by when it last delivered. "last synced 13
   * days ago" is a true sentence that tells the owner to go click Sync — and Sync will
   * not help him, because the source is REFUSING. The action leads; the timestamps are
   * context underneath it, and they are only ever shown when they are real. */
  function connFreshHtml(provider, account) {
    var cf = cfMod();
    if (!cf) return "";                                  // module absent -> pre-leg-4 row, unchanged
    var v = connFreshRow(provider, account);
    // A grant we have no verdict for (the read failed, or it 401'd after a restart) is
    // NOT quietly rendered as fine. It says it could not check. L1, at the row.
    var state = v ? v.state : "unknown";
    var spec  = cf.specFor(state);
    var action = v ? v.action : cf.UNKNOWN_ACTION;

    var when = "";
    if (v && window.ForestShell && typeof window.ForestShell.relativeTime === "function") {
      var rt = window.ForestShell.relativeTime;
      var d = rt(v.lastDeliveryAt);
      var a = rt(v.lastAttemptAt);
      var bits = [];
      // flag-don't-fake: a null stamp gets a WORD, never a guessed time.
      bits.push("last delivered " + (d ? d : "never"));
      if (a) bits.push("last asked " + a);
      when = bits.join(" \u00b7 ");
    }

    return '<div class="conn-fresh conn-fresh--' + esc(spec.tone) + '"'
      +      ' data-conn-fresh="' + esc(connKey(provider, account)) + '"'
      +      ' data-state="' + esc(spec.state) + '">'
      +   '<span class="conn-fresh__chip" aria-label="source state: ' + esc(spec.state) + '">'
      +     esc(spec.word) + '</span>'
      +   '<span class="conn-fresh__action">' + esc(action) + '</span>'
      +   (when ? '<span class="conn-fresh__when">' + esc(when) + '</span>' : "")
      + '</div>';
  }

  /* THE ALARM LINE — the loud half, and the reason this leg is not garnish.
   *
   * It lives OUTSIDE Settings, at the top of the app frame, because an alarm behind a
   * gear click is still silence. It renders ONLY when there is something true to say:
   *   · everything fresh   -> nothing. (An alarm that cries on a healthy system is an
   *                           alarm nobody reads on a sick one.)
   *   · anything FAILING   -> the urgent line: names the dead sources, says RE-LINK,
   *                           and says syncing will not fix it.
   *   · stale / never      -> the calm line: sync. (Leg 2 auto-syncs these at the next
   *                           sign-in, so in practice this line is transient — the one
   *                           that PERSISTS is `failing`, which is exactly the one that
   *                           needs a human.)
   *   · the read unknown   -> it says it could not look. Deliberately not silent: an
   *                           alarm that goes quiet precisely when the system is broken
   *                           is not an alarm.
   *
   * ── THE DISMISS CONTROL — A DELIBERATE SUPERSESSION, NOT A REGRESSION ──
   *
   * This module used to say, right here: "There is no dismiss control. A silenceable
   * alarm is the bug." That was a real decision with a real reason, and it is NOT
   * being deleted and quietly forgotten — it is being AMENDED, on the operator's
   * ruling, because what he asked for is not what that rule forbids.
   *
   *   The old rule guards against a SILENCE: a control that kills the alarm, stays
   *   killed, and lets a dead connector sit unreported forever.
   *
   *   What ships here is a SNOOZE, and it is bounded on three axes at once:
   *     1. TIME     — a dismissal expires at the next LOCAL midnight, and the alarm
   *                   comes back on its own. It cannot be permanently killed. There
   *                   is no "never show this again" anywhere in this path.
   *     2. IDENTITY — the dismissal is keyed on the CONTRIBUTING ROWS
   *                   (`provider|account|state`, via the module's keyOf). Dismissing
   *                   the calendar warning cannot mask contacts going bad: different
   *                   rows, different key, new message, it appears. A single alarm
   *                   can never suppress a different failure.
   *     3. LIVENESS — the boundary is a live wake, not just a load-time check. If he
   *                   is still sitting in the app at midnight, it returns then.
   *
   * So the property the old rule was protecting — "a broken source always gets
   * reported, and reported again" — still holds. What changed is that he is no
   * longer forced to look at the same true sentence all evening after he has already
   * read it and decided to fix it tomorrow.
   *
   * If you are reading this because you found a dismiss button on an alarm and it
   * smelled like a regression: it isn't. Check that the three bounds above still
   * hold. If any one of them is gone, THAT is the regression. */

  /* The dismissal store. localStorage, not the runtime: a snooze is ephemeral,
     per-browser UI state, and putting it on the box would add a runtime seam (and a
     deploy dependency) to a thing that is allowed to be forgotten when he clears his
     browser. Shape: { "<key>": <expiry ms> }. Every read PRUNES expired entries, so
     the store self-empties and cannot grow without bound.
     Cold-safe: private mode, a disabled store, or a corrupt body all degrade to "no
     dismissals" — i.e. THE ALARM SHOWS. The failure direction is deliberate: a broken
     store must never be able to silence the alarm. */
  var ALARM_DISMISS_KEY = "forest.alarm.dismissed.v1";

  function alarmDismissals(nowMs) {
    var out = {};
    try {
      var raw = window.localStorage.getItem(ALARM_DISMISS_KEY);
      if (!raw) return out;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return out;
      Object.keys(parsed).forEach(function (k) {
        var until = parsed[k];
        if (typeof until === "number" && isFinite(until) && until > nowMs) out[k] = until;
      });
    } catch (e) { return {}; }   // unreadable store -> nothing dismissed -> alarm shows
    return out;
  }

  function alarmDismiss(key, untilMs) {
    try {
      var live = alarmDismissals(Date.now());
      live[key] = untilMs;
      window.localStorage.setItem(ALARM_DISMISS_KEY, JSON.stringify(live));
    } catch (e) { /* unwritable store -> the dismissal simply does not persist */ }
  }

  /* The live midnight wake. A stored expiry checked only at paint satisfies "it's back
     tomorrow morning" and FAILS "it's back at midnight while he's still sitting here."
     So we schedule a real wake at the boundary — and we do NOT trust a long setTimeout
     alone, because a backgrounded/sleeping tab throttles or defers it. visibilitychange
     re-checks on return, so the worst case is that it repaints the instant he looks at
     the tab again rather than exactly on the stroke. Single-flight: any pending wake is
     cleared before a new one is armed, so repeated paints cannot stack timers. */
  var alarmWakeTimer = null;
  function armAlarmWake(untilMs) {
    if (alarmWakeTimer) { clearTimeout(alarmWakeTimer); alarmWakeTimer = null; }
    var delay = untilMs - Date.now();
    if (!(delay > 0)) return;
    // cap the single sleep so a very long timer can't drift; re-arm on wake
    var slice = Math.min(delay, 60000);
    alarmWakeTimer = setTimeout(function () {
      alarmWakeTimer = null;
      if (Date.now() >= untilMs) paintAlarm();
      else armAlarmWake(untilMs);
    }, slice);
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) paintAlarm();   // a slept tab re-checks the boundary on return
    });
  }

  function paintAlarm() {
    var host = document.querySelector("[data-forest-alarm]");
    if (!host) return;                                   // no mount -> cold-safe no-op
    var cf = cfMod();
    var line = (cf && connFresh) ? cf.alarmSentence(connFresh) : null;

    if (!line) { host.hidden = true; host.innerHTML = ""; return; }

    /* PER-MESSAGE DISMISSAL. The key is the module's, folded from the contributing
       rows — app.js does not invent one, so there is no second identity scheme to
       drift. A message with no key (an older module on a stale cache) is NEVER
       treated as dismissed: unknown identity -> show it. */
    var now = Date.now();
    var dismissedUntil = (line.key ? alarmDismissals(now)[line.key] : 0) || 0;
    if (dismissedUntil > now) {
      host.hidden = true;
      host.innerHTML = "";
      armAlarmWake(dismissedUntil);                      // it comes back on its own
      return;
    }

    host.hidden = false;
    host.className = "app-alarm app-alarm--" + line.tone;
    host.innerHTML =
        '<span class="app-alarm__text">' + esc(line.text) + '</span>'
      + '<button class="app-alarm__act" type="button" data-alarm-settings>'
      +   (line.urgent ? "Re-link" : "Open Settings")
      + '</button>'
      + '<button class="app-alarm__dismiss" type="button" data-alarm-dismiss'
      +   ' aria-label="Dismiss until tomorrow" title="Dismiss until tomorrow">\u00d7</button>';

    var x = host.querySelector("[data-alarm-dismiss]");
    if (x && line.key) x.addEventListener("click", function () {
      var until = cf.nextLocalMidnight(Date.now());
      alarmDismiss(line.key, until);
      host.hidden = true;
      host.innerHTML = "";
      armAlarmWake(until);
    });

    var btn = host.querySelector("[data-alarm-settings]");
    var urgent = !!line.urgent;
    if (btn) btn.addEventListener("click", function () {
      // Dispatch the shell's OPEN seam — do NOT set `pane.hidden` here. Reaching into the
      // pane directly is what made this button a door with no exit: shell-boot used to wire
      // the close control (and Escape) lazily inside its own openSettings(), so a pane opened
      // from HERE had a dead X and a dead Escape (— the operator got stuck in it).
      // shell-boot owns the pane's lifecycle; this module only asks.
      document.dispatchEvent(new CustomEvent("forest:open-settings"));
      // AIM : an URGENT "Re-link" means a grant is REFUSING — the fix is to
      // RE-CONSENT via the "Connect a source" form (its "Connect Google" button re-blesses
      // the dead grant in place), NOT the Sync/Unlink card. Sync won't wake a dead grant and
      // Unlink is destructive + unnecessary (and 502s on a big calendar). So an urgent alarm
      // lands the operator on the link form and focuses its account field — one path, no circle.
      // A non-urgent nudge still lands at the connectors overview. Deferred a tick so the
      // pane-open lands first and doesn't scroll us back to the top.
      var targetSel = urgent ? "[data-link-source]" : "[data-connectors]";
      setTimeout(function () {
        var block = document.querySelector(targetSel);
        if (block && block.scrollIntoView) { try { block.scrollIntoView({ block: "nearest" }); } catch (x) {} }
        if (urgent && block) {
          var acct = block.querySelector ? block.querySelector("[data-link-account]") : null;
          if (acct && acct.focus) { try { acct.focus(); } catch (x2) {} }
        }
      }, 0);
    });
  }

  function renderConnectors(data) {
    var list = connEl("[data-conn-list]");
    if (!list) return;
    var grants = (data && Array.isArray(data.grants)) ? data.grants : [];

    if (!grants.length) {
      list.innerHTML = '<p class="conn-empty">No linked sources yet — nothing synced here.</p>';
      return;
    }

    list.innerHTML = grants.map(function (g) {
      var scope = Array.isArray(g.scope) ? g.scope.join(", ") : (g.scope || "");
      var detail = scope + (g.mode ? " · " + g.mode : "");
      return '<div class="conn-row" role="group" aria-label="linked source ' + esc(g.provider) + ' / ' + esc(g.account) + '">'
        + '<div class="conn-row__what">'
        +   '<b class="conn-row__provider">' + esc(g.provider) + '</b>'
        +   '<span class="conn-row__account">' + esc(g.account) + '</span>'
        +   '<span class="conn-row__scope">' + esc(detail) + '</span>'
        + '</div>'
        + connFreshHtml(g.provider, g.account)
        + '<div class="conn-row__act">'
        +   '<button class="gate__btn conn-row__btn" type="button"'
        +     ' data-provider="' + esc(g.provider) + '" data-account="' + esc(g.account) + '" data-action="sync">Sync</button>'
        +   '<button class="gate__btn gate__btn--revoke conn-row__btn" type="button"'
        +     ' data-provider="' + esc(g.provider) + '" data-account="' + esc(g.account) + '" data-action="unlink">Unlink</button>'
        + '</div>'
        // The status <p> is now painted FROM the receipt store, not left empty — this single change
        // is what stops loadConnectors() from erasing the receipt it was just handed.
        + '<p class="conn-row__status" role="status" aria-live="polite"'
        +   ' data-conn-status="' + esc(connKey(g.provider, g.account)) + '">'
        +   esc(connReceiptText(g.provider, g.account))
        + '</p>'
        + '</div>';
    }).join("");

    var btns = list.querySelectorAll(".conn-row__btn");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        var prov = btn.getAttribute("data-provider");
        var acct = btn.getAttribute("data-account");
        var action = btn.getAttribute("data-action");
        btn.addEventListener("click", function () {
          if (action === "sync") syncGrant(prov, acct, btn);
          else if (action === "unlink") unlinkGrant(prov, acct, btn);
        });
      })(btns[i]);
    }
  }

  function syncGrant(provider, account, btn) {
    if (!provider || !account) return;
    var rowBtns = btn && btn.parentNode ? btn.parentNode.querySelectorAll("button") : [];
    for (var i = 0; i < rowBtns.length; i++) rowBtns[i].disabled = true;
    setConnReceipt(provider, account, "Syncing…", false);
    gatePost("/connectors/sync", { provider: provider, account: account })
      .then(function (res) {
        if (res.status === 200 && res.body && res.body.decision === "synced") {
          var r = res.body.receipt || {};
          var msg = "✓ Synced";
          // K1: only ingested/changed counts are surfaced — never receipt.cred or a token
          if (r.ingested != null) msg += " · " + r.ingested + " ingested";
          if (r.changed != null) msg += " · " + r.changed + " changed";
          // Store BEFORE loadConnectors(): the re-render repaints from the store, so the receipt
          // now survives the very refresh that used to erase it.
          setConnReceipt(provider, account, msg, true);
          for (var i = 0; i < rowBtns.length; i++) rowBtns[i].disabled = false;
          loadConnectors();
          return;
        }
        if (res.status === 401) {
          setConnReceipt(provider, account, "", false);
          var door = document.getElementById("door");
          if (door) { door.hidden = false; var pw = door.querySelector("[data-door-pw]"); if (pw) pw.focus(); }
          for (var j = 0; j < rowBtns.length; j++) rowBtns[j].disabled = false;
          return;
        }
        if (res.status === 409) {
          // A dead grant does not heal by being asked again, and Unlink is destructive +
          // unnecessary (a re-consent re-blesses in place). Point at the working re-link path.
          var isGoogle409 = (provider === "gmail" || provider === "calendar" || provider === "contacts" || provider === "drive");
          var msg409 = isGoogle409
            ? "Grant expired — re-link with the “Connect Google” button below. No need to unlink first."
            : "Grant no longer active — re-link this source below (no need to unlink first).";
          setConnReceipt(provider, account, msg409, true);
          for (var k = 0; k < rowBtns.length; k++) rowBtns[k].disabled = false;
          return;
        }
        if (res.status === 502) {
          var detail502 = (res.body && res.body.error) ? res.body.error : "Source unreachable — try again later.";
          setConnReceipt(provider, account, detail502, true);
          for (var l = 0; l < rowBtns.length; l++) rowBtns[l].disabled = false;
          return;
        }
        var errMsg = (res.body && res.body.error) ? res.body.error : ("Couldn’t sync (HTTP " + res.status + ").");
        setConnReceipt(provider, account, errMsg, true);
        for (var m = 0; m < rowBtns.length; m++) rowBtns[m].disabled = false;
      })
      .catch(function () {
        setConnReceipt(provider, account, "Can’t reach the Forest runtime — is it up?", true);
        for (var n = 0; n < rowBtns.length; n++) rowBtns[n].disabled = false;
      });
  }

  function unlinkGrant(provider, account, btn) {
    if (!provider || !account) return;
    var confirmed = window.confirm(
      "Unlink “" + provider + " / " + account + "”?\n\n"
      + "This revokes the grant AND permanently deletes all data imported from this source. "
      + "The deletion cannot be undone.\n\nAre you sure?"
    );
    if (!confirmed) return;
    var rowBtns = btn && btn.parentNode ? btn.parentNode.querySelectorAll("button") : [];
    for (var i = 0; i < rowBtns.length; i++) rowBtns[i].disabled = true;
    setConnReceipt(provider, account, "Unlinking…", false);
    gatePost("/connectors/unlink", { provider: provider, account: account })
      .then(function (res) {
        if (res.status === 200 && res.body && res.body.decision === "unlinked") {
          // The row itself disappears on success, so drop the receipt with it — a stale receipt for
          // a grant that no longer exists would be a lie waiting to be re-linked into.
          setConnReceipt(provider, account, "", false);
          loadConnectors();
          return;
        }
        var errMsg = (res.body && res.body.error) ? res.body.error : ("Couldn’t unlink (HTTP " + res.status + ").");
        setConnReceipt(provider, account, errMsg, true);
        for (var j = 0; j < rowBtns.length; j++) rowBtns[j].disabled = false;
      })
      .catch(function () {
        setConnReceipt(provider, account, "Can’t reach the Forest runtime — is it up?", true);
        for (var k = 0; k < rowBtns.length; k++) rowBtns[k].disabled = false;
      });
  }

  /* LEG 4 — read the FRESHNESS alongside the grants, then paint both.
   *
   * Two reads, one render. The grant list says WHICH sources exist; the freshness read
   * says WHETHER EACH ONE IS ACTUALLY WORKING. They are separate routes on purpose (a
   * verdict carries no credential, so /connectors/freshness is session-gated and NOT
   * owner-key-gated — it stays readable in the signed-in-but-keyless state after a
   * restart, which is precisely the state in which an owner most needs to be told his
   * data is frozen).
   *
   * The freshness read is ALLOWED TO FAIL and the grant list still renders: the fold
   * degrades to `unknown` and every row says "couldn't check" — never a silent pass as
   * fine. A failed alarm must look like a failed alarm. */
  function loadFreshness() {
    var cf = cfMod();
    if (!cf) return Promise.resolve(null);            // module absent -> pre-leg-4 behaviour
    return cf.fetchFreshness(
      function (u, o) { return fetch(u, o); }, RT
    ).then(function (summary) {
      connFresh = summary;
      // The one thing the server can get wrong that we can catch: a needs_attention
      // count that contradicts the rows it was folded from. The rows win (they are what
      // we render); the disagreement is surfaced rather than absorbed.
      if (summary && summary.read === "ok" && summary.agrees === false && window.console && console.warn) {
        console.warn("[forest] /connectors/freshness needs_attention disagrees with its own sources[] — rendering the rows.");
      }
      paintAlarm();
      return summary;
    });
  }

  function loadConnectors() {
    var root = connRoot();
    if (root) root.hidden = false;
    // Freshness first so the grant rows can carry their verdicts on the very first paint
    // (a second pass would flash every row as "unchecked" then correct itself — the app
    // would be briefly lying, and a briefly-lying alarm is still a lying alarm).
    loadFreshness()
      .catch(function () { connFresh = null; })       // belt and braces: the fold never rejects
      .then(function () {
        return fetch(RT + "/connectors", { cache: "no-store", credentials: "include" })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(renderConnectors)
          .catch(function (e) {
            var list = connEl("[data-conn-list]");
            if (list) list.innerHTML = '<p class="state-error">Couldn’t load linked sources (' + esc(e.message) + ').</p>';
          });
      });
  }

  /* ---------- B4 slice D: Link a new source — local-FS + LIVE OAuth (Drive/Dropbox) ----------
     The link flow for local-FS (WO-26.2021-1b-SC) AND the live OAuth dance for Drive/Dropbox
     (WO-26.2100-1-OC, runtime 1.0). The owner picks a source type in the picker:
       · local-FS: POST /connectors/link {provider:'local-fs'} → HALT + S3 surface → owner BLESSes with
         the directory path (POST /connectors/link/resolve {halt_id, decision:'BLESS', token:<dir-path>})
         or DENYs. On BLESS (state:'active') re-read GET /connectors so the grant appears in the panel.
       · Drive/Dropbox: POST /connectors/oauth/start {provider, account} → HALT + S3 surface + an
         authorize_url → owner reviews the surface and clicks "Authorize at <provider>", which navigates
         to the provider. The provider redirects to the SERVER callback, which exchanges the code
         server-side and blesses; the browser returns here with ?oauth_result=… (handled on load).
     K1 (hard): the OAuth token + the client secret NEVER touch this page — the authorize_url carries only
     the public client_id, and the callback returns a result STATUS only. Never render credToken, the
     #cred handle, a token, or the directory path in any success display. */

  function linkRoot() { return document.querySelector("[data-link-source]"); }
  function linkEl(sel) { var r = linkRoot(); return r ? r.querySelector(sel) : null; }
  function setLinkMsg(t) { var el = linkEl("[data-link-msg]"); if (el) el.textContent = t || ""; }
  function providerLabel(p) {
    if (p === "google") return "Google (Gmail · Calendar · Contacts · Drive)";
    if (p === "drive") return "Google Drive";
    if (p === "dropbox") return "Dropbox";
    if (p === "gmail") return "Gmail";
    if (p === "calendar") return "Google Calendar";
    if (p === "contacts") return "Google Contacts";
    if (p === "local-fs") return "local folder";
    if (p === "mbox") return "mbox archive";
    return p || "the source";
  }

  var LINK_PENDING_HALT_ID = null;
  // The pending FILE-source provider (local-fs = a directory, mbox = a single .mbox file). Set by the
  // file-source link starters; read by renderLinkHalt/resolveLink so the blessed-path field labels itself
  // honestly (a directory path for local-fs; the .mbox archive file path for mbox). Null for OAuth sources
  // (they never render this path field — the token is acquired at the provider, never typed).
  var LINK_PENDING_PROVIDER = null;
  // The blessed-path field copy, per file-source provider. A directory for local-fs; a file for mbox.
  function linkPathField() {
    if (LINK_PENDING_PROVIDER === "mbox") {
      return { label: "Path to the .mbox archive file", placeholder: "/home/shea/mail-export.mbox", aria: "mbox archive file path" };
    }
    return { label: "Directory path to link", placeholder: "/home/shea/documents", aria: "directory path" };
  }
  function linkPathPrompt() {
    return LINK_PENDING_PROVIDER === "mbox"
      ? "Enter the path to the .mbox archive file."
      : "Enter the directory path to link.";
  }

  function renderLinkHalt(halt) {
    var haltSection = linkEl("[data-link-halt]");
    if (!haltSection) return;
    LINK_PENDING_HALT_ID = halt.haltId || halt.halt_id || null;
    var obs = halt.observation_surface || {};

    haltSection.innerHTML =
      '<div class="surface__card surface__card--halt" role="group" aria-label="link halt — review before blessing">'
      + '<div class="surface__mark" aria-hidden="true">&#9208;</div>'
      + '<div class="surface__head">'
      +   '<div class="surface__kicker">Review before linking · nothing stored yet</div>'
      +   '<div class="surface__claim">' + esc(halt.pending_action || "Link pending") + '</div>'
      + '</div>'
      + '<dl class="surface__fields">'
      +   '<div class="surface__row"><dt>What this covers</dt><dd>' + esc(obs.diff || obs.statement || "") + '</dd></div>'
      +   '<div class="surface__row"><dt>Blast radius</dt><dd>' + esc(blastText(obs.blast_radius)) + '</dd></div>'
      +   '<div class="surface__row"><dt>Grant statement</dt><dd>' + esc(obs.statement || "") + '</dd></div>'
      + '</dl>'
      + '<div class="link-bless-form">'
      +   '<label class="gate__field">'
      +     '<span class="gate__flabel">' + esc(linkPathField().label) + '</span>'
      +     '<input class="gate__input" data-link-dir type="text" autocomplete="off"'
      +     ' placeholder="' + esc(linkPathField().placeholder) + '" aria-label="' + esc(linkPathField().aria) + '">'
      +   '</label>'
      +   '<div class="surface__choice">'
      +     '<button class="gate__btn gate__btn--bless" data-link-bless type="button">Bless — link this source</button>'
      +     '<button class="gate__btn gate__btn--revoke" data-link-deny type="button">Deny</button>'
      +   '</div>'
      + '</div>'
      + '<p class="surface__msg" data-link-resolve-msg role="status" aria-live="polite"></p>'
      + '</div>';

    haltSection.hidden = false;

    var blessBtn = haltSection.querySelector("[data-link-bless]");
    var denyBtn = haltSection.querySelector("[data-link-deny]");
    if (blessBtn) blessBtn.addEventListener("click", function () { resolveLink("BLESS"); });
    if (denyBtn) denyBtn.addEventListener("click", function () { resolveLink("DENY"); });
    if (haltSection.scrollIntoView) haltSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderLinkResolved(cssState, text) {
    var haltSection = linkEl("[data-link-halt]");
    if (!haltSection) return;
    LINK_PENDING_HALT_ID = null;
    haltSection.innerHTML =
      '<div class="surface__card surface__card--' + esc(cssState) + '" role="status">'
      + '<div class="surface__mark" aria-hidden="true">'
      + (cssState === "done" ? "&#10003;" : (cssState === "halt" ? "&#9208;" : "&#8212;"))
      + '</div>'
      + '<div class="surface__head"><div class="surface__claim">' + esc(text) + '</div></div>'
      + '</div>';
    haltSection.hidden = false;
  }

  function resolveLink(decision) {
    if (!LINK_PENDING_HALT_ID) return;
    var haltId = LINK_PENDING_HALT_ID;
    var haltSection = linkEl("[data-link-halt]");
    var resolveMsgEl = haltSection ? haltSection.querySelector("[data-link-resolve-msg]") : null;
    var btns = haltSection ? haltSection.querySelectorAll("button") : [];

    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;

    var dirInput = linkEl("[data-link-dir]");
    var dirPath = dirInput ? (dirInput.value || "").trim() : "";

    if (decision === "BLESS" && !dirPath) {
      if (resolveMsgEl) resolveMsgEl.textContent = linkPathPrompt();
      for (var j = 0; j < btns.length; j++) btns[j].disabled = false;
      return;
    }

    if (resolveMsgEl) resolveMsgEl.textContent = decision === "BLESS" ? "Blessing…" : "Denying…";

    var body = { halt_id: haltId, decision: decision };
    if (decision === "BLESS") body.token = dirPath;

    gatePost("/connectors/link/resolve", body)
      .then(function (res) {
        if (res.status === 200 && res.body && res.body.state === "active") {
          // K1: never render credToken or the directory path — grant.account label is safe
          var account = res.body.grant && res.body.grant.observation_surface
            ? (res.body.grant.observation_surface.account || "")
            : (res.body.grant && res.body.grant.account ? res.body.grant.account : "");
          renderLinkResolved("done", "✓ Linked"
            + (account ? " · " + esc(account) : "")
            + " — the source is now active.");
          loadConnectors();
          return;
        }
        if (res.status === 200 && res.body && res.body.state === "composition-halt") {
          // S6 passthrough — surface and flag; blessComposition is out of scope (separate endpoint)
          renderLinkResolved("halt",
            "⚠ Composition halt — your linked sources together would exceed the blast-radius "
            + "threshold. Unlink an existing source first, then re-link this one.");
          return;
        }
        if (res.status === 200 && res.body && res.body.state === "denied") {
          renderLinkResolved("declined", "Denied — the source was not linked. Nothing was stored.");
          return;
        }
        if (res.status === 401) {
          if (resolveMsgEl) resolveMsgEl.textContent = "Your session expired — sign in again.";
          var door = document.getElementById("door");
          if (door) { door.hidden = false; var pw = door.querySelector("[data-door-pw]"); if (pw) pw.focus(); }
          for (var k = 0; k < btns.length; k++) btns[k].disabled = false;
          return;
        }
        if (res.status === 404) {
          if (resolveMsgEl) resolveMsgEl.textContent = "The halt has expired or is no longer pending (E_NO_SUCH_HALT). Initiate a new link.";
          LINK_PENDING_HALT_ID = null;
          for (var l = 0; l < btns.length; l++) btns[l].disabled = false;
          return;
        }
        var errMsg = (res.body && res.body.error) ? res.body.error : ("Couldn’t resolve (HTTP " + res.status + ").");
        if (resolveMsgEl) resolveMsgEl.textContent = errMsg;
        for (var m = 0; m < btns.length; m++) btns[m].disabled = false;
      })
      .catch(function () {
        if (resolveMsgEl) resolveMsgEl.textContent = "Can’t reach the Forest runtime — is it up?";
        for (var n = 0; n < btns.length; n++) btns[n].disabled = false;
      });
  }

  // Render the OAuth S2 halt + S3 observation surface, with an "Authorize at <provider>" button that
  // navigates the browser to the provider (no directory-path input — the token is acquired at the provider,
  // exchanged server-side, never typed). K1: authorize_url carries only the public client_id + redirect +
  // scope + state; there is no token to render at this stage and none ever reaches this page.
  function renderOAuthHalt(start) {
    var haltSection = linkEl("[data-link-halt]");
    if (!haltSection) return;
    var obs = start.observation_surface || {};
    var label = providerLabel(start.provider);
    var authorizeUrl = start.authorize_url;
    LINK_PENDING_HALT_ID = null;   // an OAuth halt is resolved by the server callback, not by resolveLink

    haltSection.innerHTML =
      '<div class="surface__card surface__card--halt" role="group" aria-label="connect ' + esc(label) + ' — review before authorizing">'
      + '<div class="surface__mark" aria-hidden="true">&#9208;</div>'
      + '<div class="surface__head">'
      +   '<div class="surface__kicker">Review before connecting · nothing stored until you authorize</div>'
      +   '<div class="surface__claim">' + esc(start.pending_action || ("Connect " + label)) + '</div>'
      + '</div>'
      + '<dl class="surface__fields">'
      +   '<div class="surface__row"><dt>What this covers</dt><dd>' + esc(obs.diff || obs.statement || "") + '</dd></div>'
      +   '<div class="surface__row"><dt>Blast radius</dt><dd>' + esc(blastText(obs.blast_radius)) + '</dd></div>'
      +   '<div class="surface__row"><dt>Grant statement</dt><dd>' + esc(obs.statement || "") + '</dd></div>'
      + '</dl>'
      + '<p class="surface__note">You’ll be sent to ' + esc(label) + ' to sign in and grant read-only access. Your access token is exchanged on the server and stored in Sanctum — it never touches this page.</p>'
      + '<div class="surface__choice">'
      +   '<button class="gate__btn gate__btn--bless" data-oauth-authorize type="button">Authorize at ' + esc(label) + '</button>'
      +   '<button class="gate__btn gate__btn--revoke" data-oauth-cancel type="button">Cancel</button>'
      + '</div>'
      + '<p class="surface__msg" data-link-resolve-msg role="status" aria-live="polite"></p>'
      + '</div>';

    haltSection.hidden = false;

    var authBtn = haltSection.querySelector("[data-oauth-authorize]");
    var cancelBtn = haltSection.querySelector("[data-oauth-cancel]");
    if (authBtn) authBtn.addEventListener("click", function () {
      authBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      var m = haltSection.querySelector("[data-link-resolve-msg]");
      if (m) m.textContent = "Redirecting to " + label + "…";
      if (authorizeUrl) window.location.assign(authorizeUrl);
    });
    if (cancelBtn) cancelBtn.addEventListener("click", function () {
      haltSection.hidden = true; haltSection.innerHTML = "";
      setLinkMsg("Cancelled — nothing was connected.");
    });
    if (haltSection.scrollIntoView) haltSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // On load, surface the result of an OAuth round-trip when the server callback has redirected the browser
  // back here (?oauth_result=linked|denied|composition_halt|error). The URL carries a STATUS only — never a
  // token (K1) — and is cleaned from the address bar so a refresh doesn't re-trigger the banner.
  function handleOAuthRedirect() {
    if (typeof window === "undefined" || !window.location) return;
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (_) { return; }
    var result = params.get("oauth_result");
    if (!result) return;
    var provider = params.get("provider") || "";
    var account = params.get("account") || "";
    var label = providerLabel(provider);
    // clean the URL (no token was ever in it; this just stops a refresh re-showing the banner)
    try { window.history.replaceState({}, document.title, window.location.pathname + window.location.hash); } catch (_) {}

    var banner = linkEl("[data-oauth-result]");
    if (!banner) { if (result === "linked") loadConnectors(); return; }

    var cssState = "declined", text;
    if (result === "linked") {
      cssState = "done";
      text = "✓ Connected " + label + (account ? " · " + account : "") + " — the source is now active. Sync it from “Your connected data sources”.";
    } else if (result === "denied") {
      text = "Connection cancelled — you didn’t grant access at " + label + ". Nothing was stored.";
    } else if (result === "composition_halt") {
      cssState = "halt";
      text = "⚠ Composition halt — your linked sources together would exceed the blast-radius threshold. Unlink an existing source first, then re-connect " + label + ".";
    } else {
      var reason = (params.get("reason") || "").replace(/_/g, " ");
      text = "Couldn’t connect " + label + (reason ? " (" + reason + ")" : "") + ". Nothing was stored — try again.";
    }

    banner.innerHTML =
      '<div class="surface__card surface__card--' + esc(cssState) + '" role="status">'
      + '<div class="surface__mark" aria-hidden="true">' + (cssState === "done" ? "&#10003;" : (cssState === "halt" ? "&#9208;" : "&#8212;")) + '</div>'
      + '<div class="surface__head"><div class="surface__claim">' + esc(text) + '</div></div>'
      + '</div>';
    banner.hidden = false;
    if (result === "linked") loadConnectors();   // panel-refresh so the new grant appears
  }

  function openDoorOnExpiry() {
    var door = document.getElementById("door");
    if (door) { door.hidden = false; var pw = door.querySelector("[data-door-pw]"); if (pw) pw.focus(); }
  }

  // File-source link initiation (POST /connectors/link → HALT → renderLinkHalt; the owner blesses with the
  // blessed PATH). Covers the two non-OAuth file sources — local-fs (a directory) and mbox (a .mbox file);
  // they share the gate/seam/Catch/erasure plumbing and differ only in the blessed path's shape, which
  // LINK_PENDING_PROVIDER carries to the bless-field copy. No token leaves the gate at this stage.
  function startFileSourceLink(provider, account, scope) {
    LINK_PENDING_PROVIDER = provider;
    gatePost("/connectors/link", { provider: provider, account: account, scope: scope, ttl: 365 * 24 * 3600 })
      .then(function (res) {
        setLinkMsg("");
        if (res.status === 200 && res.body && (res.body.haltId || res.body.halt_id)) {
          renderLinkHalt(res.body);
          return;
        }
        if (res.status === 401) { setLinkMsg("Your session expired — sign in again."); openDoorOnExpiry(); return; }
        if (res.status === 400) {
          var errDetail = (res.body && res.body.error) ? res.body.error : ("Couldn’t initiate link (HTTP " + res.status + ").");
          if (res.body && res.body.code === "E_MALFORMED") errDetail = "Bad request — " + errDetail;
          setLinkMsg(errDetail);
          return;
        }
        setLinkMsg((res.body && res.body.error) ? res.body.error : ("Couldn’t initiate link (HTTP " + res.status + ")."));
      })
      .catch(function () { setLinkMsg("Can’t reach the Forest runtime — is it up?"); });
  }

  // OAuth link initiation (Drive/Dropbox): POST /connectors/oauth/start → HALT + S3 surface + authorize_url
  // → renderOAuthHalt (the owner reviews, then authorizes at the provider). K1: the response carries the
  // authorize_url (public client_id only) — never a token or the client secret.
  function startOAuthLink(provider, account) {
    var label = providerLabel(provider);
    gatePost("/connectors/oauth/start", { provider: provider, account: account })
      .then(function (res) {
        setLinkMsg("");
        if (res.status === 200 && res.body && res.body.authorize_url) {
          renderOAuthHalt(res.body);
          return;
        }
        if (res.status === 401) { setLinkMsg("Your session expired — sign in again."); openDoorOnExpiry(); return; }
        if (res.status === 503 && res.body && res.body.code === "E_OAUTH_NOT_CONFIGURED") {
          setLinkMsg("This grove isn’t set up to connect " + label + " yet — the owner configures the OAuth client on the box.");
          return;
        }
        setLinkMsg((res.body && res.body.error) ? res.body.error : ("Couldn’t start the " + label + " connection (HTTP " + res.status + ")."));
      })
      .catch(function () { setLinkMsg("Can’t reach the Forest runtime — is it up?"); });
  }

  // COMBINED "Connect Google" (Choice B, S15): POST /connectors/oauth/google/start → ONE consent, FOUR
  // grants. One click links Gmail, Calendar, Contacts, and Drive together instead of four separate
  // sign-ins. Reuses renderOAuthHalt (the server returns a combined S3 surface + pending_action) and the
  // same redirect-return path (?oauth_result, provider=google). K1: response carries only the public
  // authorize_url — never a token or the client secret.
  function startGoogleConnect(account) {
    gatePost("/connectors/oauth/google/start", { account: account })
      .then(function (res) {
        setLinkMsg("");
        if (res.status === 200 && res.body && res.body.authorize_url) {
          renderOAuthHalt(res.body);
          return;
        }
        if (res.status === 401) { setLinkMsg("Your session expired — sign in again."); openDoorOnExpiry(); return; }
        if (res.status === 503 && res.body && res.body.code === "E_OAUTH_NOT_CONFIGURED") {
          setLinkMsg("This grove isn’t set up to connect Google yet — the owner configures the shared Google OAuth client on the box.");
          return;
        }
        if (res.status === 503 && res.body && res.body.code === "E_OAUTH_CLIENT_MISMATCH") {
          setLinkMsg("The four Google connectors are set up with different OAuth clients — one shared client is needed for a single sign-in.");
          return;
        }
        setLinkMsg((res.body && res.body.error) ? res.body.error : ("Couldn’t start the Google connection (HTTP " + res.status + ")."));
      })
      .catch(function () { setLinkMsg("Can’t reach the Forest runtime — is it up?"); });
  }

  function initLinkPanel() {
    var form = linkEl("[data-link-form]");
    if (!form) return;

    // The combined "Connect Google" button — one consent for all four Google sources. It reads the same
    // account-label field the per-source form uses (a Google account label), so the grants key on the
    // resolved identity. Present only when the button exists in the markup (cold-safe).
    var gbtn = linkEl("[data-connect-google]");
    if (gbtn) gbtn.addEventListener("click", function (e) {
      e.preventDefault();
      var accountInput = form.querySelector("[data-link-account]");
      var account = accountInput ? (accountInput.value || "").trim() : "";
      if (!account) { setLinkMsg("Enter your Google account label (e.g. you@gmail.com) above, then Connect Google."); if (accountInput && accountInput.focus) accountInput.focus(); return; }
      setLinkMsg("…");
      var haltSection = linkEl("[data-link-halt]");
      if (haltSection) { haltSection.hidden = true; haltSection.innerHTML = ""; }
      LINK_PENDING_HALT_ID = null;
      LINK_PENDING_PROVIDER = null;
      startGoogleConnect(account);
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var providerSel = form.querySelector("[data-link-provider]");
      var provider = providerSel ? (providerSel.value || "local-fs") : "local-fs";
      var accountInput = form.querySelector("[data-link-account]");
      var account = accountInput ? (accountInput.value || "").trim() : "";
      if (!account) { setLinkMsg("Enter an account label for this source."); return; }
      setLinkMsg("…");

      var haltSection = linkEl("[data-link-halt]");
      if (haltSection) { haltSection.hidden = true; haltSection.innerHTML = ""; }
      LINK_PENDING_HALT_ID = null;

      if (provider === "local-fs") startFileSourceLink("local-fs", account, ["local-fs:read"]);
      else if (provider === "mbox") startFileSourceLink("mbox", account, ["mbox:read"]);
      else { LINK_PENDING_PROVIDER = null; startOAuthLink(provider, account); }
    });
  }

  function loadLinkPanel() {
    var root = linkRoot();
    if (root) root.hidden = false;
    handleOAuthRedirect();   // surface the result if we just returned from a provider authorize round-trip
  }

  function initGate() {
    var grantForm = document.querySelector("[data-gate-grant]");
    var payForm = document.querySelector("[data-gate-pay]");

    if (grantForm) grantForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var payee = ((grantForm.querySelector("[data-grant-payee]") || {}).value || "").trim();
      var cap = (grantForm.querySelector("[data-grant-cap]") || {}).value;
      var secret = (grantForm.querySelector("[data-grant-secret]") || {}).value;
      if (!payee) { setGateMsg("[data-grant-msg]", "Name the payee."); return; }
      if (!(Number(cap) > 0)) { setGateMsg("[data-grant-msg]", "Set a cap above 0."); return; }
      if (!secret) { setGateMsg("[data-grant-msg]", "A grant needs a vault secret."); return; }
      setGateMsg("[data-grant-msg]", "\u2026");
      gatePost("/grant", { key: payee, scope: { billers: [payee], cap: Number(cap) }, secret: secret })
        .then(function (res) {
          if (res.status === 200 && res.body.decision === "issued") {
            setGateMsg("[data-grant-msg]", "\u2713 " + payee + " authorized \u2014 up to " + money(cap) + " per payment.");
            var sb = grantForm.querySelector("[data-grant-secret]"); if (sb) sb.value = "";
            loadAuthority();
            return;
          }
          if (res.status === 401) { setGateMsg("[data-grant-msg]", "Your session expired \u2014 sign in again."); return; }
          setGateMsg("[data-grant-msg]", (res.body && res.body.error) ? res.body.error : ("Couldn\u2019t authorize (HTTP " + res.status + ")."));
        })
        .catch(function () { setGateMsg("[data-grant-msg]", "Can\u2019t reach the Forest runtime \u2014 is it up?"); });
    });

    if (payForm) payForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var payee = ((payForm.querySelector("[data-pay-payee]") || {}).value || "").trim();
      var amount = (payForm.querySelector("[data-pay-amount]") || {}).value;
      if (!payee) { setGateMsg("[data-pay-msg]", "Name the payee."); return; }
      if (!(Number(amount) > 0)) { setGateMsg("[data-pay-msg]", "Enter an amount above 0."); return; }
      clearSurface();
      requestPayment(payee, Number(amount));
    });
  }

  function initDoor() {
    var door = document.getElementById("door");
    if (!door) { loadForest(); return; }          // no Door in the DOM -> ungated (dev)
    var form = door.querySelector("[data-door-form]");
    var pw = door.querySelector("[data-door-pw]");
    var pw2row = door.querySelector("[data-door-confirm-row]");
    var pw2 = door.querySelector("[data-door-confirm]");
    var sub = door.querySelector("[data-door-subtitle]");
    var btn = door.querySelector("[data-door-submit]");
    var msg = door.querySelector("[data-door-msg]");
    var mode = "signin";

    function setMsg(t) { if (msg) msg.textContent = t || ""; }
    function openDoor() { door.hidden = false; setTimeout(function () { if (pw) pw.focus(); }, 30); }
    function closeDoor() { door.hidden = true; }

    function applyMode(ownerSet) {
      mode = ownerSet ? "signin" : "set";
      if (mode === "set") {
        if (sub) sub.textContent = "First time here \u2014 set a password to seal the Forest. (8+ characters.)";
        if (pw2row) pw2row.hidden = false;
        if (btn) btn.textContent = "Seal the Forest";
      } else {
        if (sub) sub.textContent = "Welcome back. Sign in to enter the grove.";
        if (pw2row) pw2row.hidden = true;
        if (btn) btn.textContent = "Enter";
      }
    }

    function submit() {
      var p = pw ? pw.value : "";
      if (!p) { setMsg("Enter your password."); return; }
      if (mode === "set") {
        if (p.length < 8) { setMsg("That\u2019s a little short \u2014 use at least 8 characters."); return; }
        if (pw2 && pw2.value !== p) { setMsg("The two passwords don\u2019t match."); return; }
      }
      if (btn) btn.disabled = true;
      setMsg("\u2026");
      fetch(RT + "/session", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: p }),
      }).then(function (r) {
        return r.json().then(function (body) { return { status: r.status, body: body }; });
      }).then(function (res) {
        if (res.status === 200) {
          setMsg(""); if (pw) pw.value = ""; if (pw2) pw2.value = "";
          closeDoor(); loadForest(); return;
        }
        if (res.status === 401) setMsg("That password didn\u2019t match.");
        else setMsg((res.body && res.body.error) ? res.body.error : ("Couldn\u2019t sign in (HTTP " + res.status + ")."));
        if (btn) btn.disabled = false;
        if (pw) pw.focus();
      }).catch(function () {
        setMsg("Can\u2019t reach the Forest runtime \u2014 is it up?");
        if (btn) btn.disabled = false;
      });
    }

    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    if (btn) btn.addEventListener("click", function (e) { e.preventDefault(); submit(); });

    // THE IN-TAB HEAL. A session can go KEYLESS under a tab that is already open — the
    // runtime restarts, the cookie does not. The mail poll is usually the first thing to notice,
    // because it is the only thing running unattended. Anything in the app that sees
    // E_NO_SESSION_KEY dispatches `forest:session-keyless`; the Door answers it. Idempotent: a
    // burst of 401s re-opens one Door, and a Door already up is left alone.
    window.addEventListener("forest:session-keyless", function () {
      if (!door.hidden) return;
      applyMode(true);
      openDoor();
      setMsg("The Forest restarted \u2014 sign in again to reconnect your mail.");
    });

    // Probe the SESSION SEAM (GET /session). The Forest keeps session state in TWO stores with two
    // lifetimes: the DURABLE row (authDb + the 12h cookie) and the PROCESS-LIFETIME owner key (the
    // Sanctum passphrase, in memory — rightly so). A restart wipes the key and keeps the row.
    //
    // This probe used to ask GET /projection/forest-state, which is gated on the SESSION ROW ALONE.
    // So after every deploy / crash / reboot it answered 200, the Door stayed shut, the app reported
    // him signed in — and every owner-keyed route (his mailbox, his search, the background refresh)
    // 401'd E_NO_SESSION_KEY with no way back for the life of the cookie. That was the /history 401.
    // The Door must open on the fact that actually matters: the KEY, not the row.
    //
    // COLD-SAFE against an older runtime (a static deploy that lands before its runtime): `key_held`
    // is trusted only when it actually arrives as a boolean. Anything else — a 200 without the field,
    // a 404 from a runtime that predates the seam — falls back to the legacy forest-state probe, so
    // this can never soft-brick the Door into an unclosable loop on a deploy-order slip.
    function legacyProbe() {
      return fetch(RT + "/projection/forest-state", { cache: "no-store", credentials: "include" })
        .then(function (r) {
          if (r.ok) { closeDoor(); loadForest(); return; }
          return doorForNoSession();
        });
    }
    function doorForNoSession() {
      return fetch(RT + "/status", { cache: "no-store" })
        .then(function (s) { return s.ok ? s.json() : { owner_set: true }; })
        .then(function (st) { applyMode(!!st.owner_set); openDoor(); });
    }
    /* THE SESSION PROBE, extracted so it can fire more than once (, owed seq=43).
       It used to run ONLY at page load. An ALREADY-OPEN tab never re-ran it, so after a restart
       it sat in a FALSE-HEALTHY state — cookie and durable row intact, key gone — painting a
       confident mailbox while every owner-keyed route 401'd. Discovery was left to mail's
       POLL_MS=180000, so the app could confidently report a signed-in state it did not hold for
       up to three minutes, and a click in that window ate a silent failure.

       Now it also fires on visibilitychange/focus: coming back to the tab re-asks the one
       question that matters. Deliberately GET /session and `key_held` — NOT any route gated on
       the session ROW alone, which would answer 200 forever and be the /health alarm all over
       again (it read GREEN on a dead Forest,). The endpoint IS the control.

       Cheap and idle: one unkeyed 200 on tab-focus, and it short-circuits the moment the key is
       held, so a healthy tab pays a single small GET and re-paints nothing. */
    function probeSession(opts) {
      var reprobe = !!(opts && opts.reprobe);
      return fetch(RT + "/session", { cache: "no-store", credentials: "include" })
        .then(function (r) {
          if (r.status === 401) return doorForNoSession();
          if (!r.ok) return reprobe ? undefined : legacyProbe();
          return r.json().then(function (s) {
            if (!s || typeof s.key_held !== "boolean") return reprobe ? undefined : legacyProbe();
            if (s.key_held) { if (!reprobe) { closeDoor(); loadForest(); } return; }
            // Signed in, and keyless. Honest about it, and one password away from whole.
            // WHOSE restart this was is the whole point: the old copy ("sign in again to
            // reconnect your mail") reads as Google kicking him out. It was ours. Say so.
            applyMode(true);
            openDoor();
            setMsg("Your Forest restarted \u2014 sign in to unlock it. (This is ours, not Google\u2019s: your data never left your machine.)");
          }, reprobe ? function () {} : legacyProbe);
        })
        .catch(function () {
          if (reprobe) return;   // a transient blip on tab-focus must never slam the Door
          applyMode(true); openDoor(); setMsg("Can\u2019t reach the Forest runtime \u2014 is it up?");
        });
    }

    // The idle-tab close: re-ask on every return to the tab. Guarded so a burst of focus/visibility
    // events (they fire together on most browsers) collapses to one in-flight probe.
    var reprobing = false;
    function reprobe() {
      if (reprobing || document.visibilityState === "hidden") return;
      reprobing = true;
      Promise.resolve(probeSession({ reprobe: true }))
        .catch(function () {})
        .then(function () { reprobing = false; });
    }
    document.addEventListener("visibilitychange", reprobe);
    window.addEventListener("focus", reprobe);

    probeSession();
  }

  /* ---------- SIGN OUT — the Door's exit ----------
     DELETE /session clears the server row + the in-memory key + both cookies (Max-Age=0). Then a full
     reload: the session probe finds nothing and the Door opens in signin mode — no stale grove behind,
     no reaching into initDoor's closure. A 401 back means the session was already gone; still reload. */
  function initSignOut() {
    var btns = document.querySelectorAll("[data-signout]");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          btn.disabled = true;
          var msg = document.querySelector("[data-signout-msg]");
          if (msg) msg.textContent = "Signing out\u2026";
          fetch(RT + "/session", { method: "DELETE", credentials: "include" })
            .then(function (r) {
              if (r.status === 200 || r.status === 401) { window.location.reload(); return; }
              if (msg) msg.textContent = "Couldn\u2019t sign out (HTTP " + r.status + ").";
              btn.disabled = false;
            })
            .catch(function () {
              if (msg) msg.textContent = "Can\u2019t reach the Forest runtime \u2014 is it up?";
              btn.disabled = false;
            });
        });
      })(btns[i]);
    }
  }

  initGate();
  initLinkPanel();
  initDoor();
  initSignOut();
})();

/* ===================== BAND COLLAPSE — minimize sections =====================
   Additive + self-contained: a chevron toggle on each band head collapses the band body,
   state persisted per band in localStorage. The "Sort the soil" (curate) wall — up to
   ~1200+ rows — ships collapsed by default so it never lands as a scroll-wall; other bands
   default open. Idempotent (safe if run twice); bands hidden at load (curate/connectors/
   link-source/gate) are wired too and simply reveal collapsed when the app un-hides them. */
(function () {
  "use strict";
  var LS_KEY = "forest.band.collapsed.v1";
  var DEFAULT_COLLAPSED = { curate: true };   // the uncategorized wall starts folded
  function readState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeState(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function wire() {
    var state = readState();
    var bands = document.querySelectorAll("section.band");
    for (var i = 0; i < bands.length; i++) {
      (function (band, idx) {
        var head = band.querySelector(".band__head");
        if (!head || head.querySelector(".band__toggle")) return;   // idempotent
        var id = band.id || ("band-" + idx);
        var collapsed = (id in state) ? !!state[id] : !!DEFAULT_COLLAPSED[id];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "band__toggle";
        btn.setAttribute("aria-controls", id);
        var chev = document.createElement("span");
        chev.className = "chev";
        chev.setAttribute("aria-hidden", "true");
        chev.textContent = "\u25BE";                                 // down triangle
        btn.appendChild(chev);
        head.appendChild(btn);
        function apply(c) {
          band.classList.toggle("is-collapsed", c);
          btn.setAttribute("aria-expanded", String(!c));
          btn.setAttribute("aria-label", (c ? "Expand" : "Collapse") + " this section");
        }
        apply(collapsed);
        head.addEventListener("click", function (e) {
          e.preventDefault();
          collapsed = !collapsed;
          apply(collapsed);
          var s = readState(); s[id] = collapsed; writeState(s);
        });
      })(bands[i], i);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else { wire(); }
})();
