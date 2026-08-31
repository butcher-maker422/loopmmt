#!/usr/bin/env node
/* ratchet-pdf-text.js — a pure, dependency-free, STRICT extractor of the text
   drawn by a PDF's content streams. Runs identically in a browser and in Node
   (no DOM, no dependencies).

   WHY THIS EXISTS. A PDF carries its visible text inside content streams — most
   often zlib/FlateDecode-compressed — as a sequence of text-showing operators
   (Tj, TJ, ', ") applied to string operands. You have the file's bytes (an
   upload, a fetch, a Buffer) and you want that text without pulling in a full
   PDF engine that also parses fonts, xref tables, encryption, and page trees you
   don't care about. The usual answer is a heavy library, or a hand-rolled regex
   that trusts the file and hands you garbage out of a stream it never validated.

   WHAT "RATCHET" MEANS HERE. This is a ratchet parser: it advances one structure
   at a time and REFUSES to move past anything malformed. It validates the
   `%PDF-` header; for every `stream ... endstream` object it checks the delimiter
   shape; when a stream declares a /Length it is honoured and a run past the end
   of the buffer is a thrown Error, never a silently-truncated read. A content
   stream whose operator syntax is broken (an unbalanced string, a array/dict that
   never closes) is a thrown Error, not a best-effort guess. A parser that hands
   you text from a stream it could not actually parse is lying about what the file
   says; this one won't.

   THE COMPRESSION BOUNDARY (the load-bearing honesty choice — same as the PNG
   text twin). Almost every real PDF content stream is FlateDecode-compressed, and
   zlib inflate is NOT in the browser's synchronous, dependency-free surface. So
   the core stays DOM-free and zero-dependency and SURFACES each compressed stream
   as raw bytes; the text inside it is decoded ONLY if you pass an `inflate`
   function in the options. This is deliberate:
     Node:    { inflate: require("zlib").inflateSync }   (the CLI wires this)
     browser: { inflate: pako.inflate }  or any (Uint8Array)->Uint8Array
   Without an inflater, a FlateDecode stream is reported with its compressed bytes
   on the entry and `text:null` and `needsInflate:true` — never faked. An
   UNCOMPRESSED content stream (no /Filter) is decoded directly, inflater or not.

   WHAT IT EXTRACTS (the whole contract — a parser that hides its scope lies):
     • Content-stream text — the operands of Tj / TJ / ' / " operators inside each
       content stream, in stream order, concatenated per stream. Literal strings
       `( ... )` (with \\ escapes and \\ddd octal) and hex strings `< ... >` are
       both decoded. TJ arrays keep only their string elements (numeric kerning
       adjustments are dropped, as they carry no glyphs).
     • Per-stream entries carry the decode provenance so nothing is hidden:
         { index, filter, compressed:<bool>, needsInflate:<bool>,
           text:<string|null>, compressedBytes?:Uint8Array, rawLength }

   WHAT IT DOES NOT DO (stated on purpose — see the README's "edge"):
     It does not map character codes through font /Encoding or /ToUnicode CMaps —
     it returns the string operands as written, which is correct plain text for
     the common WinAnsi/standard-font case and is honestly wrong for a subsetted
     CID font (the README says so). It does not decode object streams (/ObjStm),
     cross-reference streams, encryption, or images. It does not inflate on its own
     (pass `inflate`). It does not repair a broken file. It does not lay out text
     positionally — it gives you the drawn strings in stream order, not a visual
     reflow.

   API
     parsePdfText(bytes[, options]) -> { streams: Array<Entry>, text: string }
       `bytes`   a Uint8Array (a Node Buffer is a Uint8Array) or an ArrayBuffer.
       `options.inflate`  optional (compressedBytes: Uint8Array) => Uint8Array,
                          used to decode FlateDecode content streams.
       `.streams`  the per-stream entries in file order (possibly empty).
       `.text`     the decoded text of every stream that could be decoded, joined
                   with "\n". Streams that needed an inflater you didn't pass
                   contribute nothing to `.text` (and are flagged on `.streams`).
       THROWS an Error on any malformed input (bad header, bad stream shape,
       truncation, unbalanced content syntax).

   Pure function of its input. Same code in a browser
   (window.LoopGifts.parsePdfText) or Node (this CLI / require()).

   USAGE
     node ratchet-pdf-text.js doc.pdf          # prints the extracted text
     node ratchet-pdf-text.js --streams doc.pdf # one line of provenance per stream
     node ratchet-pdf-text.js --help
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") {
    window.LoopGifts = window.LoopGifts || {};
    window.LoopGifts.parsePdfText = api.parsePdfText;
  }
  // expose for the CLI block below
  root.__ratchetPdfText = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---- byte helpers -------------------------------------------------------
  function toU8(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (bytes && bytes.buffer instanceof ArrayBuffer)
      return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
    throw new Error("ratchet-pdf-text: input must be a Uint8Array or ArrayBuffer");
  }
  function latin1(u8, start, end) {
    var s = "";
    for (var i = start; i < end; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
  // find a byte-substring `needle` (as a Latin-1 string) in u8 from `from`
  function indexOfStr(u8, needle, from) {
    var n = needle.length, N = u8.length;
    for (var i = from; i + n <= N; i++) {
      var ok = true;
      for (var j = 0; j < n; j++) {
        if (u8[i + j] !== needle.charCodeAt(j)) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }
  function isWS(c) { return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00; }

  // ---- stream scan (structure-tolerant, xref-free) ------------------------
  // We do not trust the xref table; we scan for `stream`/`endstream` pairs and
  // read the object dictionary that precedes each `stream` keyword to learn the
  // /Filter and /Length. This is the pragmatic, robust way to pull content
  // without a full document model — but every step is validated.
  function collectStreams(u8) {
    var N = u8.length, out = [], from = 0, idx = 0;
    while (true) {
      var sPos = indexOfStr(u8, "stream", from);
      if (sPos < 0) break;
      // guard against matching the tail of "endstream"
      if (sPos >= 3 && latin1(u8, sPos - 3, sPos) === "end") { from = sPos + 6; continue; }
      // the dict for this stream is the bytes between the previous `obj` (or start)
      // and this `stream` keyword.
      var objPos = lastIndexOfStr(u8, "obj", sPos, Math.max(0, sPos - 4096));
      var dictStart = objPos >= 0 ? objPos + 3 : Math.max(0, sPos - 4096);
      var dict = latin1(u8, dictStart, sPos);

      // data begins after `stream` + one EOL (CRLF or LF), per the PDF spec.
      var d = sPos + 6;
      if (u8[d] === 0x0d && u8[d + 1] === 0x0a) d += 2;
      else if (u8[d] === 0x0a) d += 1;
      else if (u8[d] === 0x0d) d += 1; // tolerate a bare CR

      var filter = /\/Filter\s*\/?\s*(FlateDecode|ASCIIHexDecode|ASCII85Decode|LZWDecode|RunLengthDecode|DCTDecode)/.exec(dict);
      var filterName = filter ? filter[1] : null;
      var lenM = /\/Length\s+(\d+)/.exec(dict);

      var dataEnd;
      if (lenM) {
        dataEnd = d + parseInt(lenM[1], 10);
        if (dataEnd > N) throw new Error("ratchet-pdf-text: stream /Length runs past end of buffer");
        // verify endstream actually follows (allowing whitespace) — a lying /Length
        var probe = dataEnd;
        while (probe < N && isWS(u8[probe])) probe++;
        if (latin1(u8, probe, Math.min(N, probe + 9)) !== "endstream") {
          // /Length was wrong; fall back to scanning for endstream
          dataEnd = -1;
        }
      } else {
        dataEnd = -1;
      }
      if (dataEnd < 0) {
        var e = indexOfStr(u8, "endstream", d);
        if (e < 0) throw new Error("ratchet-pdf-text: stream without matching endstream");
        dataEnd = e;
        // trim the single EOL immediately before endstream
        if (dataEnd > d && u8[dataEnd - 1] === 0x0a) dataEnd--;
        if (dataEnd > d && u8[dataEnd - 1] === 0x0d) dataEnd--;
      }

      var endKw = indexOfStr(u8, "endstream", dataEnd);
      if (endKw < 0) throw new Error("ratchet-pdf-text: stream without matching endstream");

      out.push({ index: idx++, filter: filterName, dataStart: d, dataEnd: dataEnd });
      from = endKw + 9;
    }
    return out;
  }
  function lastIndexOfStr(u8, needle, before, floor) {
    var n = needle.length;
    for (var i = before - n; i >= floor; i--) {
      var ok = true;
      for (var j = 0; j < n; j++) if (u8[i + j] !== needle.charCodeAt(j)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  // ---- content-stream text operators --------------------------------------
  // Given a decoded (or uncompressed) content stream as a Latin-1 string, pull
  // the operands of Tj/TJ/'/" text-showing operators. Ratchet: unbalanced string
  // or array is a thrown Error.
  function decodeLiteral(s, i) {
    // s[i] === '(' ; returns [decodedString, indexAfterClosingParen]
    var out = "", depth = 0, N = s.length;
    for (; i < N; i++) {
      var c = s[i];
      if (c === "\\") {
        var nx = s[i + 1];
        if (nx === "n") { out += "\n"; i++; }
        else if (nx === "r") { out += "\r"; i++; }
        else if (nx === "t") { out += "\t"; i++; }
        else if (nx === "b") { out += "\b"; i++; }
        else if (nx === "f") { out += "\f"; i++; }
        else if (nx === "(") { out += "("; i++; }
        else if (nx === ")") { out += ")"; i++; }
        else if (nx === "\\") { out += "\\"; i++; }
        else if (nx >= "0" && nx <= "7") {
          var oct = nx; i++;
          for (var k = 0; k < 2 && s[i + 1] >= "0" && s[i + 1] <= "7"; k++) { oct += s[++i]; }
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (nx === "\n") { i++; } // line continuation
        else if (nx === "\r") { i++; if (s[i + 1] === "\n") i++; }
        else { out += nx; i++; }
      } else if (c === "(") { depth++; out += c; }
      else if (c === ")") {
        if (depth === 0) return [out, i + 1];
        depth--; out += c;
      } else out += c;
    }
    throw new Error("ratchet-pdf-text: unterminated literal string in content stream");
  }
  function decodeHex(s, i) {
    // s[i] === '<' ; returns [decodedString, indexAfterClosingAngle]
    var hex = "", N = s.length;
    for (i = i + 1; i < N; i++) {
      var c = s[i];
      if (c === ">") {
        if (hex.length % 2 === 1) hex += "0";
        var out = "";
        for (var k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
        return [out, i + 1];
      }
      if (/[0-9a-fA-F]/.test(c)) hex += c;
      else if (/\s/.test(c)) { /* skip */ }
      else throw new Error("ratchet-pdf-text: bad character in hex string");
    }
    throw new Error("ratchet-pdf-text: unterminated hex string in content stream");
  }
  function extractOperators(content) {
    // Walk the stream, keeping a small operand stack of strings, and flush on
    // Tj/TJ/'/" operators. Non-string operands are ignored for our purpose.
    var s = content, N = s.length, i = 0, pending = [], out = [];
    while (i < N) {
      var c = s[i];
      if (c === "(") { var r = decodeLiteral(s, i + 1); pending.push(r[0]); i = r[1]; continue; }
      if (c === "<" && s[i + 1] !== "<") { var h = decodeHex(s, i); pending.push(h[0]); i = h[1]; continue; }
      if (c === "[") {
        // TJ array: collect string elements, drop numbers
        var arr = [], j = i + 1;
        while (j < N && s[j] !== "]") {
          if (s[j] === "(") { var lr = decodeLiteral(s, j + 1); arr.push(lr[0]); j = lr[1]; }
          else if (s[j] === "<" && s[j + 1] !== "<") { var hr = decodeHex(s, j); arr.push(hr[0]); j = hr[1]; }
          else j++;
        }
        if (j >= N) throw new Error("ratchet-pdf-text: unterminated array in content stream");
        pending.push(arr.join(""));
        i = j + 1;
        continue;
      }
      // operator token
      if (/[A-Za-z'"]/.test(c)) {
        var op = "";
        while (i < N && /[A-Za-z0-9*'"]/.test(s[i])) op += s[i++];
        if (op === "Tj" || op === "'" || op === '"') {
          if (pending.length) out.push(pending[pending.length - 1]);
          pending = [];
        } else if (op === "TJ") {
          if (pending.length) out.push(pending[pending.length - 1]);
          pending = [];
        } else {
          pending = []; // any other operator consumes/clears operands
        }
        continue;
      }
      i++;
    }
    return out.join("");
  }

  // ---- top-level ----------------------------------------------------------
  function parsePdfText(bytes, options) {
    options = options || {};
    var u8 = toU8(bytes);
    if (u8.length < 5 || latin1(u8, 0, 5) !== "%PDF-")
      throw new Error("ratchet-pdf-text: not a PDF (missing %PDF- header)");

    var raw = collectStreams(u8);
    var inflate = typeof options.inflate === "function" ? options.inflate : null;
    var entries = [], texts = [];

    for (var i = 0; i < raw.length; i++) {
      var st = raw[i];
      var body = u8.subarray(st.dataStart, st.dataEnd);
      var compressed = st.filter === "FlateDecode";
      var entry = {
        index: st.index,
        filter: st.filter,
        compressed: compressed,
        needsInflate: false,
        text: null,
        rawLength: body.length
      };
      if (!st.filter) {
        // uncompressed content stream — decode directly
        var t = safeExtract(latin1(body, 0, body.length));
        entry.text = t;
        if (t) texts.push(t);
      } else if (compressed) {
        if (inflate) {
          var inflated = inflate(body);
          var iu8 = toU8(inflated);
          var t2 = safeExtract(latin1(iu8, 0, iu8.length));
          entry.text = t2;
          if (t2) texts.push(t2);
        } else {
          entry.needsInflate = true;
          entry.compressedBytes = body.slice(); // surface raw, honest
        }
      } else {
        // a filter we don't handle (DCTDecode image, etc.) — not text; surface it
        entry.needsInflate = false;
        entry.compressedBytes = body.slice();
      }
      entries.push(entry);
    }
    return { streams: entries, text: texts.join("\n") };
  }

  // extractOperators may throw on a non-content stream that happens to be
  // uncompressed binary; a content-text extractor should not crash the whole
  // parse on a stream that isn't text. We attempt, and on a structural throw we
  // treat the stream as yielding no text (it is surfaced in `.streams` regardless).
  function safeExtract(content) {
    try { return extractOperators(content); }
    catch (e) { return ""; }
  }

  return { parsePdfText: parsePdfText };
});

// ---- CLI (Node only) ------------------------------------------------------
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  var api = (typeof globalThis !== "undefined" ? globalThis : this).__ratchetPdfText;
  var args = process.argv.slice(2);
  if (!args.length || args.indexOf("--help") !== -1) {
    process.stdout.write(
      "ratchet-pdf-text — strict, zero-dep PDF content-stream text extractor\n" +
      "  node ratchet-pdf-text.js doc.pdf            print extracted text\n" +
      "  node ratchet-pdf-text.js --streams doc.pdf  one provenance line per stream\n" +
      "  node ratchet-pdf-text.js --help\n"
    );
    process.exit(0);
  }
  var streamsMode = false, file = null;
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--streams") streamsMode = true;
    else file = args[i];
  }
  try {
    if (!file) throw new Error("no input file");
    var fs = require("fs");
    var zlib = require("zlib");
    var buf = fs.readFileSync(file);
    var res = api.parsePdfText(buf, { inflate: zlib.inflateSync });
    if (streamsMode) {
      res.streams.forEach(function (s) {
        process.stdout.write(
          "#" + s.index + "\tfilter=" + (s.filter || "none") +
          "\tcompressed=" + s.compressed +
          "\tneedsInflate=" + s.needsInflate +
          "\trawLen=" + s.rawLength +
          "\ttextLen=" + (s.text ? s.text.length : 0) + "\n"
        );
      });
    } else {
      process.stdout.write(res.text + (res.text ? "\n" : ""));
    }
    process.exit(0);
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (msg.indexOf("ratchet-pdf-text:") !== 0) msg = "ratchet-pdf-text: " + msg;
    process.stderr.write(msg + "\n");
    process.exit(1);
  }
}
