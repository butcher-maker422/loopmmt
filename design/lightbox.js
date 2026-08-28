/* lightbox.js — shared clean lightbox for content photos.
 * Project: system-image-display-loopmmt-website (v1, clean lightbox).
 * Zero deps. Injected via the shared shell so every managed page inherits it.
 *
 * Behavior: a content photo in a page body expands into a centered, dimmed-backdrop
 * overlay; dismiss by Esc, backdrop click, or the close control; caption from alt;
 * keyboard-operable (focus to close on open, restore to trigger on close); JS-off
 * leaves images as plain inline images (graceful).
 *
 * The eligibility predicate is PURE and exported for a node test
 * (verify-lightbox-eligibility.cjs) — the DOM layer is skipped when required in node.
 */
(function () {
  'use strict';

  /* Pure eligibility predicate — testable without a DOM.
   * desc = { tag, src, inMain }:
   *   tag    — element tagName
   *   src    — the raw src attribute
   *   inMain — true iff the element is inside the page body content region (<main>)
   * Eligible = an <img> with a raster (jpg/png/webp) src inside <main>. Chrome
   * SVGs (wordmark, nav mark, icons) fail the raster test; header/nav/footer
   * images fail the inMain test. Both exclusions are load-bearing. webp was
   * added (NOTE-27.1935-5) so raster webp images pop like jpg/png — the resume
   * b&w closing image is .webp and must Lightbox in parity with the .jpg. */
  function isEligibleLightboxImage(desc) {
    if (!desc) return false;
    if (String(desc.tag).toLowerCase() !== 'img') return false;
    if (!desc.inMain) return false;
    var src = String(desc.src || '');
    return /\.(jpe?g|png|webp)(\?|#|$)/i.test(src);
  }

  /* Pure predicate — a CONTENT-PLATE ANCHOR (NOTE-28.0949-1).
   * desc = { href, inMain, wrapsEligibleImg }:
   *   href            — the <a>'s href attribute
   *   inMain          — true iff the <a> is inside <main>
   *   wrapsEligibleImg— true iff the <a>'s only meaningful child is an
   *                     isEligibleLightboxImage <img>
   * Eligible = an <a> inside <main> whose href is a raster image (jpg/png/webp)
   * AND that wraps an eligible content <img>. This is the structural shape of a
   * <figure class="plate"><a href="…hires.webp"><img></a> content plate — it is
   * NOT keyed on the aria-label prose (which can drift), only on structure.
   *
   * WHY it exists: lightbox.js otherwise yields to ANY <a> (a linked image keeps
   * its link — load-bearing for real navigational links). A content-plate anchor
   * is the ONE anchor class that should fire the lightbox instead of navigating:
   * its href is not a destination, it is the hi-res of the same photo. When JS is
   * present we intercept and lightbox the HI-RES href; JS-off still navigates to
   * it (progressive enhancement — the no-JS/keyboard fallback is preserved). */
  function isContentPlateAnchor(desc) {
    if (!desc) return false;
    if (!desc.inMain) return false;
    if (!desc.wrapsEligibleImg) return false;
    var href = String(desc.href || '');
    return /\.(jpe?g|png|webp)(\?|#|$)/i.test(href);
  }

  /* ---- DOM layer (skipped entirely when this file is require()'d in node) ---- */
  if (typeof document !== 'undefined') {
    var overlay = null;
    var lastTrigger = null;

    function descOf(el) {
      return {
        tag: el.tagName,
        src: el.getAttribute('src'),
        inMain: !!(el.closest && el.closest('main'))
      };
    }

    function descOfAnchor(a) {
      var innerImg = a.querySelector ? a.querySelector('img') : null;
      return {
        href: a.getAttribute('href'),
        inMain: !!(a.closest && a.closest('main')),
        wrapsEligibleImg: !!(innerImg && isEligibleLightboxImage(descOf(innerImg)))
      };
    }

    function buildOverlay() {
      var o = document.createElement('div');
      o.id = 'img-lightbox';
      o.setAttribute('role', 'dialog');
      o.setAttribute('aria-modal', 'true');
      o.setAttribute('aria-label', 'Enlarged image');
      o.innerHTML =
        '<button type="button" class="img-lightbox-close" aria-label="Close">\u00d7</button>' +
        '<figure class="img-lightbox-fig">' +
        '<img class="img-lightbox-img" alt="">' +
        '<figcaption class="img-lightbox-cap"></figcaption>' +
        '</figure>';
      o.addEventListener('click', function (e) {
        if (e.target === o || e.target.classList.contains('img-lightbox-close')) close();
      });
      // minimal focus trap: the dialog has one interactive control (close), so
      // keep Tab on it while open — focus never escapes behind the overlay.
      o.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          o.querySelector('.img-lightbox-close').focus();
        }
      });
      document.body.appendChild(o);
      return o;
    }

    function open(img, hiresSrc) {
      if (!overlay) overlay = buildOverlay();
      var big = overlay.querySelector('.img-lightbox-img');
      var cap = overlay.querySelector('.img-lightbox-cap');
      // A content-plate anchor passes its hi-res href so the lightbox shows the
      // FULL-resolution image (the whole reason the anchor existed), not the
      // smaller inline <img>. A bare eligible <img> passes no override.
      big.src = hiresSrc || img.currentSrc || img.src;
      var caption = img.getAttribute('alt') || '';
      big.alt = caption;
      cap.textContent = caption;
      cap.style.display = caption ? '' : 'none';
      lastTrigger = img;
      // reveal the overlay — the CSS gates visibility on [data-open="true"]
      // (shell.css: #img-lightbox is display:none until this is set), and the
      // Esc / backdrop close paths key off the same attribute. Without it the
      // click locks scroll behind an overlay that never shows. (was: /*MUT*/)
      overlay.setAttribute('data-open', 'true');
      // fixed overlay → no layout shift; lock scroll behind it.
      document.documentElement.style.overflow = 'hidden';
      overlay.querySelector('.img-lightbox-close').focus();
    }

    function close() {
      if (!overlay) return;
      overlay.removeAttribute('data-open');
      document.documentElement.style.overflow = '';
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        lastTrigger.focus();
      }
      lastTrigger = null;
    }

    // one delegated listener — no per-image wiring, works for pages built later too.
    document.addEventListener('click', function (e) {
      var img = e.target && e.target.closest ? e.target.closest('img') : null;
      if (!img) return;
      var a = img.closest('a');
      if (a) {
        // A content-plate anchor (<a href="…hires"><img></a>) fires the lightbox
        // on the HI-RES href instead of navigating (NOTE-28.0949-1). Any OTHER
        // linked image keeps its link — that exclusion is still load-bearing.
        if (isContentPlateAnchor(descOfAnchor(a))) {
          e.preventDefault();
          open(img, a.getAttribute('href'));
        }
        return;
      }
      if (!isEligibleLightboxImage(descOf(img))) return;
      e.preventDefault();
      open(img);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && overlay.getAttribute('data-open') === 'true') {
        close();
        return;
      }
      // Enter / Space on a focused eligible content image opens it (keyboard parity
      // with click). Ignored while the overlay is open — the overlay owns its keys.
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (overlay && overlay.getAttribute('data-open') === 'true') return;
      var el = document.activeElement;
      if (!el) return;
      // A focused content-plate anchor opens its hi-res in the lightbox — keyboard
      // parity with click (NOTE-28.0949-1). The anchor is natively focusable, so
      // it (not its inner img) is the active element.
      if (String(el.tagName).toLowerCase() === 'a') {
        if (!isContentPlateAnchor(descOfAnchor(el))) return;
        e.preventDefault();
        open(el.querySelector('img'), el.getAttribute('href'));
        return;
      }
      if (String(el.tagName).toLowerCase() !== 'img') return;
      if (el.closest('a')) return;
      if (!isEligibleLightboxImage(descOf(el))) return;
      e.preventDefault();
      open(el);
    });

    // affordance: mark eligible images so CSS can show a zoom cursor, and make
    // them keyboard-operable — focusable (so focus can RETURN here on close) and
    // reachable by Tab + Enter/Space. JS-off = no mark, no tabindex = plain image.
    document.addEventListener('DOMContentLoaded', function () {
      var imgs = document.querySelectorAll('main img');
      Array.prototype.forEach.call(imgs, function (img) {
        if (!img.closest('a') && isEligibleLightboxImage(descOf(img))) {
          img.setAttribute('data-lb', '');
          img.setAttribute('tabindex', '0');
          img.setAttribute('role', 'button');
          img.setAttribute('aria-label', (img.getAttribute('alt') || 'Image') + ' \u2014 enlarge');
        }
      });
      // Content-plate anchors get the zoom affordance on the anchor itself. It
      // stays a real <a> (focusable, no-JS navigable) — only a cursor hint is
      // added, no tabindex/role override. NOTE-28.0949-1.
      var anchors = document.querySelectorAll('main a');
      Array.prototype.forEach.call(anchors, function (a) {
        if (isContentPlateAnchor(descOfAnchor(a))) {
          a.setAttribute('data-lb-anchor', '');
        }
      });
    });
  }

  /* export for the node eligibility test */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isEligibleLightboxImage: isEligibleLightboxImage,
      isContentPlateAnchor: isContentPlateAnchor
    };
  }
})();
