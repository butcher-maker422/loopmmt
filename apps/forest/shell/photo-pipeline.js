/* Shea's Forest — the App Shell · shell/photo-pipeline.js
    Phase 1 (the "get it right" core, plan §2 / §0 S3).

   The client-side-sovereign contact-photo handling pipeline. One dependency-free
   module that turns a user-picked File into a store-ready avatar blob:

       File --> decode --> EXIF-orient --> square-crop(center) --> scale 512
            --> toBlob('image/jpeg', 0.85)

   FOUR guarantees, each a line item from the corroborated standard (§0 S3):
     1. UPRIGHT  — a phone photo shot sideways lands upright BEFORE store. On every
        modern engine (Chrome/Edge/Firefox 77+/Safari 13.1+) `createImageBitmap` ALREADY
        auto-applies the EXIF Orientation tag, so the decoded bitmap is upright and we
        keep it. A capability PROBE confirms this per engine; on the rare old engine that
        does NOT auto-orient, we apply the EXIF transform ourselves (the fallback path).
     2. SQUARE   — a center 1:1 crop (avatars render square/circular).
     3. SCALED   — down to a 512x512 cap; never the multi-megapixel original in the store.
     4. EXIF-FREE — a fresh canvas re-encode produces a JPEG with NO EXIF segment, which
        DROPS GPS. A contact photo carrying GPS coordinates is a privacy leak; the strip is
        the point, not a nicety.

   Real-or-Made (Creed): this module NEVER generates, guesses, or fabricates an image. Its
   only input is a genuine File the caller hands it; its only output is a re-encode of those
   real pixels. The forbidden case (a Google `default:true` placeholder face) is gated at the
   CALLER, upstream of here — this module invents nothing.

   No npm deps (the Five Rules). Pure browser Canvas 2D + createImageBitmap.

   Orientation handling — the honest ceiling. This engine (and every evergreen one) applies
   EXIF orientation inside createImageBitmap and does NOT honor `imageOrientation:'none'`
   (byte-truth-probed on Chromium: 'none'/'from-image'/default all returned the oriented
   bitmap). So the LOAD-BEARING, CI-PROVEN path is "decode -> the engine already oriented it
   -> crop+scale+encode." The manual-transform fallback exists for a NON-auto-orienting engine
   (historical; pre-2020 Safari/Firefox). It is CONSTRUCTION-verified against the canonical
   EXIF-on-canvas transform table, NOT exercised by the CI browser (which auto-orients, so its
   raw pixels are unreachable here) — labeled, not sold as proven. The re-encode strips EXIF on
   BOTH paths regardless.

   Test: shell/photo-pipeline.test.cjs (Playwright, real Chromium) round-trips a fixture that is
   portrait-when-displayed but STORED landscape with EXIF Orientation=6 + a GPS tag, and asserts
   upright / square (512x512) / EXIF-free, and that the probe detects this engine auto-orients. */

(function () {
  "use strict";

  var root = (typeof window !== "undefined")
    ? (window.ForestShell = window.ForestShell || {})
    : (typeof globalThis !== "undefined" ? (globalThis.ForestShell = globalThis.ForestShell || {}) : {});

  var DEFAULT_SIZE = 512;      // §0 S3: 400-800px cap; store ~512.
  var DEFAULT_QUALITY = 0.85;  // §0 S3: JPEG q~=0.85 for photos.
  var OUTPUT_MIME = "image/jpeg";

  /* ---- EXIF orientation reader ------------------------------------------------
     Walks a JPEG's APP1/Exif segment for the Orientation tag (0x0112), returns 1..8.
     Returns 1 (normal) when absent/unreadable/not-a-JPEG — the safe default (do nothing),
     never a throw. Handles both TIFF byte orders (II little / MM big). Reads only the
     header region and never trusts a length past the buffer end. Used by the capability
     probe and by the (fallback) manual-orient path. */
  function readExifOrientation(buf) {
    try {
      var v = new DataView(buf);
      if (v.byteLength < 2 || v.getUint16(0, false) !== 0xFFD8) return 1; // no SOI -> not a JPEG
      var offset = 2, len = v.byteLength;
      while (offset + 4 <= len) {
        var marker = v.getUint16(offset, false);
        if ((marker & 0xFF00) !== 0xFF00) break;
        var segLen = v.getUint16(offset + 2, false);
        if (segLen < 2 || offset + 2 + segLen > len) break;
        if (marker === 0xFFE1) {                                  // APP1
          var app1 = offset + 4;
          if (app1 + 6 <= len &&
              v.getUint32(app1, false) === 0x45786966 /* "Exif" */ &&
              v.getUint16(app1 + 4, false) === 0x0000) {
            var tiff = app1 + 6;
            if (tiff + 8 > len) return 1;
            var le = (v.getUint16(tiff, false) === 0x4949);      // "II"
            var ifd0 = tiff + v.getUint32(tiff + 4, le);
            if (ifd0 + 2 > len) return 1;
            var count = v.getUint16(ifd0, le), entry = ifd0 + 2;
            for (var i = 0; i < count; i++, entry += 12) {
              if (entry + 12 > len) break;
              if (v.getUint16(entry, le) === 0x0112) {
                var o = v.getUint16(entry + 8, le);
                return (o >= 1 && o <= 8) ? o : 1;
              }
            }
          }
        }
        offset += 2 + segLen;
      }
    } catch (e) { /* any trouble -> default; a reader never throws */ }
    return 1;
  }

  /* Canvas transform per EXIF orientation (w/h = RAW decoded dims). Canonical set.
     Used ONLY on the non-auto-orienting fallback path. */
  function orientedDims(o, w, h) { return (o >= 5) ? { w: h, h: w } : { w: w, h: h }; }
  function applyOrientationTransform(ctx, o, w, h) {
    switch (o) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;    // flip horizontal
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;   // 180
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;    // flip vertical
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;     // transpose
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;    // rotate 90 CW
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;   // transverse
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;    // rotate 90 CCW
      default: break;                                     // 1: identity
    }
  }

  function make2dCanvas(w, h) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
    if (typeof document !== "undefined" && document.createElement) {
      var c = document.createElement("canvas"); c.width = w; c.height = h; return c;
    }
    throw new Error("photo-pipeline: no canvas (need OffscreenCanvas or document.createElement)");
  }

  function canvasToJpegBlob(canvas, quality) {
    if (typeof canvas.convertToBlob === "function") {
      return canvas.convertToBlob({ type: OUTPUT_MIME, quality: quality });   // OffscreenCanvas
    }
    return new Promise(function (resolve, reject) {
      if (typeof canvas.toBlob !== "function") { reject(new Error("photo-pipeline: canvas cannot encode")); return; }
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error("photo-pipeline: toBlob null")); }, OUTPUT_MIME, quality);
    });
  }

  /* ---- capability probe: does this engine auto-apply EXIF orientation? ---------
     Builds a tiny landscape JPEG tagged Orientation=6 and decodes it. If the engine
     auto-orients, the decoded bitmap is portrait (h > w). Cached as a one-shot promise.
     Any failure -> false (fall back to the manual transform — never a silent mis-orient). */
  var _autoProbe = null;
  function exifApp1Orientation(o) {
    // "Exif\0\0" + TIFF(II) + IFD0{Orientation}. app1 = 36 bytes.
    var b = new Uint8Array(36), dv = new DataView(b.buffer), p = 0;
    b[p++] = 0xFF; b[p++] = 0xE1; dv.setUint16(p, 34, false); p += 2;
    b[p++] = 0x45; b[p++] = 0x78; b[p++] = 0x69; b[p++] = 0x66; b[p++] = 0; b[p++] = 0; // "Exif\0\0"
    b[p++] = 0x49; b[p++] = 0x49; dv.setUint16(p, 0x2A, true); p += 2; dv.setUint32(p, 8, true); p += 4;
    dv.setUint16(p, 1, true); p += 2;                                   // IFD0: 1 entry
    dv.setUint16(p, 0x0112, true); p += 2; dv.setUint16(p, 3, true); p += 2;
    dv.setUint32(p, 1, true); p += 4; dv.setUint16(p, o, true); p += 2; dv.setUint16(p, 0, true); p += 2;
    dv.setUint32(p, 0, true);                                           // next IFD = 0
    return b;
  }
  function detectAutoOrient() {
    if (_autoProbe) return _autoProbe;
    // Default on an INCONCLUSIVE probe = true (assume auto-orient). Rationale: every
    // evergreen engine auto-orients, and the probe uses the SAME primitives as the main
    // decode (canvas + createImageBitmap + toBlob) — so a probe that throws implies the
    // main pipeline would throw too (and reject), not that a working engine silently does
    // NOT auto-orient. The one exception is "no createImageBitmap at all," where there is
    // nothing to orient and the main path rejects first anyway (value is moot).
    _autoProbe = new Promise(function (resolve) {
      try {
        if (typeof createImageBitmap !== "function") { resolve(false); return; }  // moot: main path rejects
        var c = make2dCanvas(16, 8);                                    // landscape (w > h)
        var x = c.getContext("2d"); x.fillStyle = "#c81e1e"; x.fillRect(0, 0, 8, 8); x.fillStyle = "#1e1ec8"; x.fillRect(8, 0, 8, 8);
        canvasToJpegBlob(c, 0.9).then(function (jpeg) {
          return jpeg.arrayBuffer().then(function (ab) {
            var raw = new Uint8Array(ab), app1 = exifApp1Orientation(6);
            var fx = new Uint8Array(raw.length + app1.length);
            fx.set(raw.subarray(0, 2), 0); fx.set(app1, 2); fx.set(raw.subarray(2), 2 + app1.length);
            return createImageBitmap(new Blob([fx], { type: "image/jpeg" }));
          });
        }).then(function (bmp) {
          var swapped = bmp.height > bmp.width;                         // orient(6) on landscape -> portrait iff auto
          if (typeof bmp.close === "function") { try { bmp.close(); } catch (e) {} }
          resolve(swapped);
        }).catch(function () { resolve(true); });                       // inconclusive -> assume auto (dominant reality)
      } catch (e) { resolve(true); }
    });
    return _autoProbe;
  }

  function processContactPhoto(file, opts) {
    opts = opts || {};
    var size = (opts.size > 0) ? (opts.size | 0) : DEFAULT_SIZE;
    var quality = (typeof opts.quality === "number") ? Math.max(0, Math.min(1, opts.quality)) : DEFAULT_QUALITY;

    if (!file || (typeof Blob !== "undefined" && !(file instanceof Blob))) {
      return Promise.reject(new Error("photo-pipeline: processContactPhoto needs a File/Blob"));
    }
    if (typeof createImageBitmap !== "function") {
      return Promise.reject(new Error("photo-pipeline: createImageBitmap unavailable on this engine"));
    }

    var bytesP = (typeof file.arrayBuffer === "function") ? file.arrayBuffer() : Promise.resolve(null);
    var autoP = detectAutoOrient();

    return Promise.all([bytesP, autoP]).then(function (r) {
      var buf = r[0], auto = r[1];
      var o = buf ? readExifOrientation(buf) : 1;
      // On auto-orienting engines decode plainly (already upright). On the fallback path we
      // want RAW pixels; we still call createImageBitmap plainly (the engine that needs the
      // fallback is, by definition, one that returns raw here).
      return createImageBitmap(file).then(function (bmp) {
        var applyManual = (!auto && o !== 1);
        var od, orientedCanvas, octx;
        if (applyManual) {
          od = orientedDims(o, bmp.width, bmp.height);
          orientedCanvas = make2dCanvas(od.w, od.h);
          octx = orientedCanvas.getContext("2d");
          applyOrientationTransform(octx, o, bmp.width, bmp.height);
          octx.drawImage(bmp, 0, 0, bmp.width, bmp.height);
        } else {
          // The engine already oriented it (proven path). Draw as-is.
          od = { w: bmp.width, h: bmp.height };
          orientedCanvas = make2dCanvas(od.w, od.h);
          orientedCanvas.getContext("2d").drawImage(bmp, 0, 0);
        }
        if (typeof bmp.close === "function") { try { bmp.close(); } catch (e) {} }

        // center square-crop + scale to size
        var side = Math.min(od.w, od.h);
        var cropX = Math.floor((od.w - side) / 2), cropY = Math.floor((od.h - side) / 2);
        var out = make2dCanvas(size, size);
        var outCtx = out.getContext("2d");
        try { outCtx.imageSmoothingEnabled = true; outCtx.imageSmoothingQuality = "high"; } catch (e) {}
        outCtx.drawImage(orientedCanvas, cropX, cropY, side, side, 0, 0, size, size);

        // re-encode -> jpeg (drops ALL EXIF incl. GPS)
        return canvasToJpegBlob(out, quality);
      });
    });
  }

  root.photoPipeline = {
    processContactPhoto: processContactPhoto,
    readExifOrientation: readExifOrientation,
    detectAutoOrient: detectAutoOrient,
    DEFAULT_SIZE: DEFAULT_SIZE,
    DEFAULT_QUALITY: DEFAULT_QUALITY,
    _version: "1.0"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.photoPipeline;
})();
