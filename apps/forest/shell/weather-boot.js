/* Shea's Forest — the App Shell · shell/weather-boot.js
   THE WEATHER READER. The only file in the shell that talks to weather.gov.

   Deliberately a SEPARATE file from weather.js, and the split is the design: weather.js is a pure
   fold + an idempotent render + a total read(), all of which are provable OFFLINE. This file is
   the impure half — the timer, the mount lookup, the boot hook — and it is small enough to read
   in one sitting. Every honesty law lives in the tested half; this half only decides WHEN.

   Sibling of runtime-version.js in every respect: fetch late, stamp in place, and if the fetch
   never lands, leave the UI exactly as it was. It is NOT allowed to be the reason the shell has
   a bad day — read() is total (never rejects), setWeather(null) removes the element, and a
   missing module anywhere in the chain is a silent no-op.

   REFRESH. Every 15 minutes, and once on a tab regaining focus after being away — an hourly
   forecast that is 40 minutes stale is not wrong, but a person who leaves the tab open overnight
   and comes back to yesterday's temperature has been lied to by a stale cache, and the whole
   point of this element is that it does not lie. The refresh is cheap (one GET) and it stops
   when the tab is hidden, so it costs nothing while nobody is looking. */
(function () {
  "use strict";

  var REFRESH_MS = 15 * 60 * 1000;   // 15 minutes; NWS hourly data does not move faster than this
  var STALE_MS   = 20 * 60 * 1000;   // a reading older than this on a re-focus is re-read

  function shell() { return window.ForestShell; }

  function mountEl() {
    return document.querySelector ? document.querySelector("[data-app-actions]") : null;
  }

  var lastAt = 0;
  var timer = null;

  function pull() {
    var s = shell();
    if (!s || !s.weather || !s.tabstripActions || !s.tabstripActions.setWeather) return;
    s.weather.read().then(function (reading) {
      // read() is TOTAL: it resolves null on every failure path. So a null here means exactly one
      // thing — we do not have a reading — and setWeather(null) makes the element go away rather
      // than freeze on an old number. Silence is the honest output. (weather.js L1.)
      lastAt = reading ? Date.now() : 0;
      s.tabstripActions.setWeather(reading, mountEl());
    });
  }

  function start() {
    if (!shell() || !shell().weather) return;   // cold-safe: no module -> this file does nothing
    pull();
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      // Don't burn a request on a tab nobody is looking at; the focus handler below catches up.
      if (document.hidden) return;
      pull();
    }, REFRESH_MS);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      if (!lastAt || (Date.now() - lastAt) > STALE_MS) pull();   // came back to a stale number -> re-read
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
