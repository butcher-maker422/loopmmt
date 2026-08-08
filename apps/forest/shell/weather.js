/* Shea's Forest — the App Shell · shell/weather.js
   THE WEATHER ELEMENT — top-bar, immediately LEFT of the version stamp (operator,).

   WHAT THIS REPLACES. There was a "Weather" in this shell and it did nothing. Not "did
   something small" — NOTHING: badges.js `weatherFor()` returns `{}` (verified by running it),
   the tab badges are off by default, and no data source was ever built behind them. It was a
   dead affordance and the operator called it: *"how about we change it to make it useful."*
   So the word stops being a promise and starts being a reading.

   THE SOURCE IS THE NATIONAL WEATHER SERVICE. api.weather.gov. Public, free, no key, no
   tracking, `Access-Control-Allow-Origin: *` (verified from the box's own origin before a line
   of this was written). It is the government service Shea's taxes already paid for.

   *** IT IS NEVER ACCUWEATHER, AND NOT BY POLICY — BY CONSTRUCTION. ***
   Operator directive, : never AccuWeather or any predatory weather service. The way to
   honor that is NOT a config key defaulted to NWS, because a default is a thing someone changes.
   There is no provider setting in this file. There is no provider parameter. The host is a
   frozen constant and the link is a frozen constant, and swapping either one is a source edit
   that shows up in a diff and has to be argued for. A rule you can flip in a settings pane is a
   rule that will get flipped; a rule that isn't expressible isn't a rule, it's the shape of the
   code. (Same reasoning as the mail K1 no-auto-trash guard: the NEVER is a shape, not a note.)

   THE THREE LAWS (inherited verbatim in spirit from the 1.34 connector alarm, which is the same
   class of thing — a surface that reports a fact it did not compute):

     L1  A READING WE DO NOT HAVE RENDERS NOTHING. No "--°". No last-known value dressed as
         current. No zero. A failed fetch, an offline box, a 500 from NWS: the element is simply
         ABSENT, exactly as if this file did not exist. A temperature that guesses is worse than
         no temperature — it is /health returning 200 on a dead Forest, one layer up, and this
         codebase has now been bitten by that shape five times.

     L2  THE CONDITION TEXT IS THE SERVICE'S, VERBATIM. `shortForecast` is rendered as NWS wrote
         it ("Partly Sunny", "Chance Showers And Thunderstorms"). We map it to a GLYPH, and the
         glyph is a lossy summary — so the exact words ride the tooltip and the accessible name,
         where they cannot be wrong. We never paraphrase a forecast. We are not a forecaster.

     L3  THE GLYPH FAILS SOFT AND SAYS SO. An unrecognised shortForecast does not throw and does
         not pick a cheerful sun — it falls back to a neutral cloud, and the VERBATIM text is
         still right there in the tooltip telling the truth the glyph could not carry. The
         mapping is a convenience; the words are the record.

   STRUCTURE — three layers, and the network is only in the third:
     weatherModel(reading)          -> plain-data model        (THE FOLD — pure, no DOM, no net)
     render(container, model)       -> idempotent DOM          (THE INK — no net)
     read(fetchImpl) -> Promise     -> a reading, or null      (THE READ — the only network)

   The fold is testable without a browser AND without a network, which is the whole point: every
   honesty law above is a property of the FOLD, so every one of them is provable offline.

   Plain script (no ES module) — attaches to window.ForestShell.weather.
   Depends on window.ForestShell.block (the shared el() atom). */
(function () {
  "use strict";

  var root = (window.ForestShell = window.ForestShell || {});

  /* ---- THE PLACE ------------------------------------------------------------ *
   * New Gloucester, Maine — the Grove. Town coordinates, not the dooryard: NWS
   * grids are ~2.5km squares, so a street address buys no accuracy and leaks a
   * home address into a served file for nothing. The forecast is identical.       */
  var LAT = 43.9648;
  var LON = -70.2839;

  /* ---- THE SOURCE — frozen. Not configurable. See the header. ---------------- */
  var NWS_API = "https://api.weather.gov";
  // The human forecast page — where the element LINKS. NWS's own public forecast, and it is the
  // only URL this file can produce. There is no provider table to add a row to.
  var NWS_FORECAST_URL = "https://forecast.weather.gov/MapClick.php?lat=" + LAT + "&lon=" + LON;
  // Resolved gridpoint for the coordinates above (GYX = Gray/Portland ME office). Held as a FAST
  // PATH only — `read()` still walks /points when it is absent or stale, so a re-grid by NWS
  // costs one extra hop, never a wrong reading. Re-derive: GET /points/<lat>,<lon> -> properties.forecastHourly
  var HOURLY_HINT = NWS_API + "/gridpoints/GYX/69,72/forecast/hourly";

  /* ---- THE GLYPHS — inline SVG, currentColor, same vocabulary as tabstrip-actions ICON.
   * Stroke-only line work: the Forest's mark language (the wordmark is a stroke-only loop).
   * Higgins: each one has to read as its weather with the temperature beside it and no label. */
  var S = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
          'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var GLYPH = {
    sun:   S + '<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.3M12 19.1v2.3M4.3 4.3l1.7 1.7M18 18l1.7 1.7M2.6 12h2.3M19.1 12h2.3M4.3 19.7l1.7-1.7M18 6l1.7-1.7"/></svg>',
    moon:  S + '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/></svg>',
    // sun/moon peeking from behind a cloud — "partly"
    partly:      S + '<circle cx="8" cy="8" r="3"/><path d="M8 2.4v1.6M2.4 8h1.6M4.1 4.1l1.1 1.1M11.9 4.1l-1.1 1.1"/><path d="M7.5 19h9.8a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.7-1.3A3.6 3.6 0 0 0 7.5 19z"/></svg>',
    partlyNight: S + '<path d="M12.5 7.6A4.6 4.6 0 0 1 7.9 3a4.7 4.7 0 1 0 5.7 5.7"/><path d="M7.5 19h9.8a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.7-1.3A3.6 3.6 0 0 0 7.5 19z"/></svg>',
    cloud: S + '<path d="M6.8 19h10.4a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.3-1.4A3.8 3.8 0 0 0 6.8 19z"/></svg>',
    rain:  S + '<path d="M6.8 15.6h10.4a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.3-1.4 3.8 3.8 0 0 0-1.4 8.2z"/><path d="M9 18.6l-.9 2.3M13 18.6l-.9 2.3M17 18.6l-.9 2.3"/></svg>',
    storm: S + '<path d="M6.8 15.2h10.4a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.3-1.4 3.8 3.8 0 0 0-1.4 8.2z"/><path d="M13.2 17.2l-2.6 3.2h2.7l-1.1 2.4"/></svg>',
    snow:  S + '<path d="M6.8 15.6h10.4a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.3-1.4 3.8 3.8 0 0 0-1.4 8.2z"/><path d="M9 19.6v1.8M8.1 20.5h1.8M15 19.6v1.8M14.1 20.5h1.8M12 18.4v1.8M11.1 19.3h1.8"/></svg>',
    fog:   S + '<path d="M7 13.4h10.4a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.3-1.4A3.8 3.8 0 0 0 7 13.4z"/><path d="M4.5 17h15M7 20.4h11"/></svg>',
    wind:  S + '<path d="M3 8.6h11a2.6 2.6 0 1 0-2.6-2.6"/><path d="M3 13h15.4a2.8 2.8 0 1 1-2.8 2.8"/><path d="M3 17.6h7.6"/></svg>'
  };

  /* ---- THE FOLD — shortForecast -> glyph. LOSSY BY ADMISSION (law L3). -------- *
   * Order matters: the specific idioms are tested before the general ones, because NWS writes
   * things like "Chance Rain Showers And Patchy Fog" and "Mostly Cloudy then Slight Chance
   * Showers And Thunderstorms". First match wins, sharpest first: a thunderstorm is a
   * thunderstorm even when the sentence also says cloudy.                                     */
  function glyphFor(shortForecast, isDaytime) {
    var s = String(shortForecast == null ? "" : shortForecast).toLowerCase();
    var day = isDaytime !== false;
    if (/thunder|t-storm|tstm/.test(s))                          return "storm";
    if (/snow|flurr|sleet|ice|wintry|blizzard|freezing/.test(s)) return "snow";
    if (/rain|shower|drizzle|precip/.test(s))                    return "rain";
    if (/fog|haze|smoke|mist/.test(s))                           return "fog";
    if (/wind|breez|blustery|gust/.test(s))                      return "wind";
    // "Partly Sunny" / "Mostly Sunny" / "Partly Cloudy" / "Mostly Clear" — the mixed sky.
    if (/partly|mostly|scattered|few clouds/.test(s))            return day ? "partly" : "partlyNight";
    if (/cloud|overcast/.test(s))                                return "cloud";
    if (/sunny|clear|fair/.test(s))                              return day ? "sun" : "moon";
    // L3: unrecognised -> a NEUTRAL cloud, never a cheerful sun. The verbatim words still ride
    // the tooltip, so the element is still telling the truth even when the glyph cannot.
    return "cloud";
  }

  /* weatherModel(reading) -> the plain-data element, or NULL.
   *   reading : { tempF, unit, shortForecast, isDaytime } | null | anything malformed
   *
   * L1 LIVES HERE, and it lives here on purpose: a null model is the ONLY way this element can
   * be absent, and it is a pure function of the reading. There is no branch anywhere else in the
   * file that can paint a temperature nobody measured. */
  function weatherModel(reading) {
    if (!reading || typeof reading !== "object") return null;
    var t = reading.tempF;
    // A temperature must be a real, finite number. `null`, undefined, "", NaN, "n/a" -> no element.
    // (Note `0` is a perfectly good Maine temperature and must NOT be falsy-rejected.)
    if (typeof t !== "number" || !isFinite(t)) return null;
    var text = (typeof reading.shortForecast === "string" && reading.shortForecast) ? reading.shortForecast : "";
    var g = glyphFor(text, reading.isDaytime);
    // The accessible name and the tooltip carry BOTH numbers and BOTH words — the reading and its
    // provenance. A person should never have to guess who is telling them this.
    var label = Math.round(t) + "\u00B0F" + (text ? " \u00B7 " + text : "") +
                " \u00B7 New Gloucester, Maine \u00B7 National Weather Service (opens the NWS forecast)";
    return {
      tempF: Math.round(t),
      text: text,                       // L2: NWS's own words, unedited
      glyph: g,
      label: label,
      href: NWS_FORECAST_URL            // frozen; there is no other value this can take
    };
  }

  function signature(model) {
    if (!model) return "none";          // the absent element has a signature too, so it re-paints INTO existence
    return model.tempF + "|" + model.glyph + "|" + model.text;
  }

  /* ---- THE INK -------------------------------------------------------------- */
  // render(container, model) -> the element (or null). Idempotent: the same model folds to the
  // same DOM and a second render is a no-op. A NULL model REMOVES the element — so a reading that
  // goes away takes its number with it, rather than leaving a stale one on screen (L1 again, at
  // the render boundary: the failure mode is a blank top bar, never a lying one).
  function render(container, model) {
    if (!container || !container.ownerDocument) return null;
    var el = root.block && root.block.el;
    if (!el) return null;                                   // cold-safe: no atom -> no element
    var doc = container.ownerDocument;
    var sig = signature(model);
    if (container.__forestWxSig === sig) return container.__forestWx || null;   // folds-twice-identical

    if (container.__forestWx && container.__forestWx.parentNode === container) {
      container.removeChild(container.__forestWx);
    }
    container.__forestWx = null;
    container.__forestWxSig = sig;
    if (!model) return null;                                // L1: nothing to say -> say nothing

    // An anchor, not a button: it goes somewhere, and it should behave like it (middle-click,
    // copy link, open in a new tab — all free, all expected). rel=noopener because target=_blank
    // without it hands the opened page a handle on ours.
    var a = el(doc, "a", "tsa-wx", {
      href: model.href,
      target: "_blank",
      rel: "noopener noreferrer",
      title: model.label,
      "aria-label": model.label,
      "data-weather": "1"
    });
    var ic = el(doc, "span", "tsa-wx__icon", { "aria-hidden": "true" });
    ic.innerHTML = GLYPH[model.glyph] || GLYPH.cloud;       // static, code-owned SVG (no user data)
    a.appendChild(ic);
    var t = el(doc, "span", "tsa-wx__temp", { "aria-hidden": "true" });
    t.textContent = model.tempF + "\u00B0";
    a.appendChild(t);

    container.appendChild(a);
    container.__forestWx = a;
    return a;
  }

  /* ---- THE READ — the only place a network exists ---------------------------- *
   * read(fetchImpl) -> Promise<reading|null>. NEVER rejects and NEVER throws: every failure path
   * resolves to null, and null means "render nothing" (L1). A weather widget must not be able to
   * take the shell down, so the contract is total.
   *
   * Two hops, and the second is the one that matters:
   *   /points/<lat>,<lon>  -> properties.forecastHourly   (skipped when HOURLY_HINT still works)
   *   <forecastHourly>     -> properties.periods[0]       (the current hour)
   * We try the HINT first (one hop, the common case). If it fails for ANY reason we walk /points
   * and try again — so an NWS re-grid degrades to slower, never to wrong. */
  function read(fetchImpl) {
    var f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.resolve(null);                   // cold-safe: no fetch -> no reading

    function getJSON(url) {
      // Promise.resolve(f(...)) is NOT total: if f throws SYNCHRONOUSLY the throw escapes before
      // the chain exists, and read() rejects at the caller. (fetch does exactly this on a malformed
      // URL, and on a CSP block in some engines.) Deferring the call INTO the chain turns every
      // synchronous throw into a rejection the .catch below can actually see. Found by the suite;
      // it would have shipped, and the ONE guarantee this module makes is that it cannot take the
      // shell down.
      return Promise.resolve()
        .then(function () { return f(url, { headers: { "Accept": "application/geo+json" } }); })
        .then(function (r) { return (r && r.ok) ? r.json() : null; })
        .catch(function () { return null; });               // total: any failure is a null, never a throw
    }
    function periodToReading(j) {
      var p = j && j.properties && j.properties.periods && j.properties.periods[0];
      if (!p) return null;
      // NWS can serve Celsius on some grids. Convert rather than mislabel — the model rounds, and
      // a wrong UNIT is a lying number, which is exactly what L1 exists to prevent.
      var t = p.temperature;
      if (typeof t !== "number" || !isFinite(t)) return null;
      if (String(p.temperatureUnit).toUpperCase() === "C") t = (t * 9 / 5) + 32;
      return { tempF: t, shortForecast: p.shortForecast, isDaytime: p.isDaytime !== false };
    }

    return getJSON(HOURLY_HINT)
      .then(function (j) {
        var r = periodToReading(j);
        if (r) return r;
        // The hint is stale or NWS re-gridded — walk /points and resolve the real URL.
        return getJSON(NWS_API + "/points/" + LAT + "," + LON).then(function (pts) {
          var url = pts && pts.properties && pts.properties.forecastHourly;
          if (!url) return null;
          return getJSON(url).then(periodToReading);
        });
      })
      .catch(function () { return null; });
  }

  /* ---- export -------------------------------------------------------------- */
  root.weather = {
    weatherModel: weatherModel,
    glyphFor: glyphFor,
    signature: signature,
    render: render,
    read: read,
    FORECAST_URL: NWS_FORECAST_URL,
    _version: "1.0"
  };
})();
