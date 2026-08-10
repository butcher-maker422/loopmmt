/* ═══════════════════════════════════════════════════════════════════════════
   app-page-play.js — the shared Play-modal behaviour for app pages.
   Loop MMT™ · app-pages Slice 2 (plan 17-the-app-pages-design-v1.md).

   Lifted from the app-page template's inline script (S10.0019) so
   every app page shares ONE modal implementation. Reads play{} from the page's
   inlined per-app manifest (<script type="application/json" id="app-manifest">,
   the D2 shape), right-sizes a sandboxed <iframe> modal, and wires open/close/
   escape/backdrop + an "open in a full tab" escape.

   Contract (what the page must provide):
     #app-manifest   — JSON: { play: { ready, url, width, height }, ... }
     #play-open      — the button that opens the modal
     #play-modal     — the fixed overlay (CSS in shell.css .app-page/#play-modal)
       #modal-card, #modal-frame, #modal-close, #modal-fulltab within it.

   Sandbox is the enforced control (Nyx): sandbox="allow-scripts allow-same-origin"
   is authored on the iframe in markup, tuned per app — not granted here.
   Load with `defer` (or at end of body) so the DOM exists when it runs.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var manifestEl = document.getElementById('app-manifest');
  if (!manifestEl) return;

  var manifest = {};
  try { manifest = JSON.parse(manifestEl.textContent); } catch (e) { return; }
  var play = (manifest && manifest.play) || {};

  var modal   = document.getElementById('play-modal');
  var card    = document.getElementById('modal-card');
  var frame   = document.getElementById('modal-frame');
  var openB   = document.getElementById('play-open');
  var closeB  = document.getElementById('modal-close');
  var fulltab = document.getElementById('modal-fulltab');
  if (!modal || !card || !frame || !openB) return;

  // right-size the card from the manifest, clamped to the viewport
  if (play.width)  card.style.width  = 'min(' + play.width  + 'px, 96vw)';
  if (play.height) card.style.height = 'min(' + play.height + 'px, 88vh)';
  if (play.url && fulltab) fulltab.setAttribute('href', play.url);

  function open() {
    if (play.ready === false) return;
    // lazy: only attach the src on first open, so the app isn't fetched on page load
    if (play.url && !frame.getAttribute('src')) frame.setAttribute('src', play.url);
    modal.setAttribute('data-open', 'true');
    modal.setAttribute('aria-hidden', 'false');
    if (closeB) closeB.focus();
  }
  function close() {
    modal.setAttribute('data-open', 'false');
    modal.setAttribute('aria-hidden', 'true');
    openB.focus();
  }

  openB.addEventListener('click', open);
  if (closeB) closeB.addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // honest not-ready state — the reason is app-specific (a public Node app that
  // runs locally is a different message from an app that isn't public yet)
  if (play.ready === false) {
    openB.setAttribute('disabled', 'disabled');
    openB.textContent = play.reason || 'Coming with the open-source release';
  }
})();
