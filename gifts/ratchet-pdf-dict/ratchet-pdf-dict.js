#!/usr/bin/env node
/* ratchet-pdf-dict.js — a pure, dependency-free, STRICT extractor of the text a
   PDF carries in its OBJECT DICTIONARIES rather than its content streams: the
   AcroForm field values (/V) and annotation notes (/Contents) that a content-
   stream extractor deliberately skips. The companion to ratchet-pdf-text. Runs
   identically in a browser and in Node (no DOM, no dependencies).

   WHY THIS EXISTS. ratchet-pdf-text pulls the text a PDF *draws* — the operands
   of Tj/TJ operators inside content streams. But a PDF also carries text that is
   never drawn into a stream: the value a user typed into a form field lives in
   that field's /V entry, and the note behind a sticky annotation lives in that
   annotation's /Contents entry. Those are dictionary entries on indirect objects
   that are NOT stream-adjacent, so ratchet's stream scan never sees them. This
   tool walks the indirect objects and pulls exactly those two text surfaces.
   Together the two tools cover every text surface in a PDF, honestly.

   WHAT "RATCHET" MEANS HERE (the same posture as the twin, at the RIGHT scale).
   ratchet-pdf-text extracts ONE content stream as a whole, so any malformed byte
   is a thrown Error — correct for a single-shot read. This tool walks MANY
   indirect objects, so it splits the contract across two levels, deliberately:
     • DOCUMENT level  — throws. Input that is not a Uint8Array/ArrayBuffer, or a
       buffer with no `%PDF-` header, is a thrown Error. If it isn't a PDF at all,
       you get told, not a guess.
     • OBJECT level    — records, does not throw. A single malformed value (an
       unterminated string, a bad hex byte) does not abort the walk and lose the
       200 good fields after it. It is emitted as an explicit `{ malformed:true,
       reason }` record and the walk continues. This KEEPS ratchet's real vow —
       "never hand back a guess as if it were clean text" — because a malformed
       value is STAMPED malformed, never returned as clean. The string tokenizer
       itself still throws on an unterminable token (you genuinely cannot know
       where it ends); the walk catches that at the object boundary and records it.

   THE /Contents DISAMBIGUATION (the load-bearing correctness choice). The key
   `/Contents` names TWO unrelated things: an annotation's text (a string) AND a
   page's content-stream pointer (an indirect reference, `12 0 R`). This tool
   pulls `/Contents` ONLY when its value is a string, and skips it when the value
   is a reference — so a page's content pointer is never mistaken for annotation
   text. The disambiguation is by VALUE TYPE, not by trying to classify the object.

   WHAT IT EXTRACTS (the whole contract — a parser that hides its scope lies):
     • Field values — a /V entry whose value is a string (literal `( )` with
       escapes or hex `< >`), paired with the field's /T partial name as the
       record `name`. A /V given as an indirect reference to a string object is
       resolved one level and reported with encoding "ref".
     • Annotation text — a /Contents entry whose value is a string.
     • Field labels — a /TU (user-facing) entry, ONLY when you pass
       `{ labels:true }`. Off by default: the covenant is field values + notes;
       labels are an opt-in surface, named here so their absence isn't a surprise.
     • Records carry their provenance so nothing is hidden:
         { obj:"<num> <gen>", kind:"field"|"annotation"|"label",
           key:"V"|"Contents"|"TU", name:<string|null>, text:<string>,
           encoding:"literal"|"hex"|"ref" }
       Malformed values are surfaced separately:
         { obj, key, malformed:true, reason:<string> }

   WHAT IT DOES NOT DO (stated on purpose — see the README's "edge"):
     It does not decrypt encrypted PDFs, decode object streams (/ObjStm) or
     compressed cross-reference streams, or resolve field hierarchies through
     /Kids (it reads /V where it sits, not inherited values). It reads the
     top-level dictionary of each indirect object — a /V or /Contents buried in a
     nested sub-dictionary is an honest edge, not a target. It does not map
     character codes through /Encoding or /ToUnicode CMaps — it returns the string
     as written, correct for the common WinAnsi case and honestly wrong for a
     subsetted CID font. It does not repair a broken file.

   API
     parsePdfDict(bytes[, options]) -> { records: Array<Record>, text: string,
                                         malformed: Array<Record> }
       `bytes`          a Uint8Array (a Node Buffer is one) or an ArrayBuffer.
       `options.labels` optional bool; when true, also pull /TU field labels.
       `.records`  the clean text records, in object order (possibly empty).
       `.text`     `.records` texts joined with "\n" — the quick "give me the
                   dictionary text" answer.
       `.malformed` the per-object malformed records (possibly empty).
       THROWS an Error only on document-level failure (bad input type, no header).

   Pure function of its input. Same code in a browser
   (window.LoopGifts.parsePdfDict) or Node (this CLI / require()).

   USAGE
     node ratchet-pdf-dict.js form.pdf            # prints the dictionary text
     node ratchet-pdf-dict.js --records form.pdf  # one provenance line per record
     node ratchet-pdf-dict.js --labels form.pdf   # also include /TU labels
     node ratchet-pdf-dict.js --help
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") {
    window.LoopGifts = window.LoopGifts || {};
    window.LoopGifts.parsePdfDict = api.parsePdfDict;
  }
  root.__ratchetPdfDict = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---- byte helpers (shared posture with ratchet-pdf-text) ----------------
  function toU8(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (bytes && bytes.buffer instanceof ArrayBuffer)
      return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
    throw new Error("ratchet-pdf-dict: input must be a Uint8Array or ArrayBuffer");
  }
  function latin1(u8, start, end) {
    var s = "";
    for (var i = start; i < end; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
  function isWS(c) {
    return c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
  }

  // ---- string tokenizer (copied verbatim from ratchet-pdf-text; the reuse
  //      core the RCR named — literal `( )` with escapes/octal, hex `< >`) -----
  function decodeLiteral(s, i) {
    // s[i] === '(' has already been consumed by the caller; parse from i.
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
        } else if (nx === "\n") { i++; }
        else if (nx === "\r") { i++; if (s[i + 1] === "\n") i++; }
        else { out += nx; i++; }
      } else if (c === "(") { depth++; out += c; }
      else if (c === ")") {
        if (depth === 0) return [out, i + 1];
        depth--; out += c;
      } else out += c;
    }
    throw new Error("ratchet-pdf-dict: unterminated literal string");
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
      else throw new Error("ratchet-pdf-dict: bad character in hex string");
    }
    throw new Error("ratchet-pdf-dict: unterminated hex string");
  }

  // ---- indirect-object scan (structure-tolerant, xref-free) ---------------
  // Scan for `N M obj ... endobj` blocks. We do NOT trust the xref table; we
  // read each object's top-level dictionary directly. This is the new surface
  // ratchet-pdf-text never walks (it only reads the dict that precedes a stream).
  var OBJ_HEAD = /(\d+)\s+(\d+)\s+obj\b/g;
  function collectObjects(u8) {
    var full = latin1(u8, 0, u8.length);
    var objs = [], map = {}, m;
    OBJ_HEAD.lastIndex = 0;
    while ((m = OBJ_HEAD.exec(full)) !== null) {
      var num = m[1], gen = m[2];
      var bodyStart = m.index + m[0].length;
      var endIdx = full.indexOf("endobj", bodyStart);
      var bodyEnd = endIdx < 0 ? full.length : endIdx; // tolerate a missing endobj
      var body = full.slice(bodyStart, bodyEnd);
      var rec = { num: num, gen: gen, id: num + " " + gen, body: body };
      objs.push(rec);
      map[rec.id] = rec; // last-wins on a duplicated object number (updated PDFs)
      if (endIdx >= 0) OBJ_HEAD.lastIndex = endIdx + 6;
    }
    return { objs: objs, map: map };
  }

  // The top-level dictionary region of an object body: the first depth-matched
  // `<< ... >>`. Restricting to this avoids matching a `/V (...)` that appears
  // inside a stream's binary content or as ASCII noise after `endobj`.
  function dictRegion(body) {
    var start = body.indexOf("<<");
    if (start < 0) return body; // some indirect objects are a bare value (e.g. a string)
    var depth = 0, i = start;
    for (; i < body.length - 1; i++) {
      if (body[i] === "<" && body[i + 1] === "<") { depth++; i++; }
      else if (body[i] === ">" && body[i + 1] === ">") { depth--; i++; if (depth === 0) return body.slice(start, i + 1); }
    }
    return body.slice(start); // unbalanced dict — hand back what we have; the value read is bounded
  }

  // Find the value token that follows `/<name>` at the TOP level of `region`.
  // Returns { kind:"string"|"hex"|"ref"|"name"|"other"|"none", value, ... }.
  function readKeyValue(region, key) {
    // Match the key as a full token (not a prefix of a longer key like /VE).
    var re = new RegExp("/" + key + "(?![A-Za-z0-9])");
    var km = re.exec(region);
    if (!km) return { kind: "none" };
    var i = km.index + km[0].length;
    var N = region.length;
    while (i < N && isWS(region[i])) i++;
    if (i >= N) return { kind: "none" };
    var c = region[i];
    if (c === "(") {
      var lit = decodeLiteral(region, i + 1); // may throw -> caught by caller (object level)
      return { kind: "string", value: lit[0], encoding: "literal" };
    }
    if (c === "<" && region[i + 1] !== "<") {
      var hx = decodeHex(region, i);          // may throw -> caught by caller
      return { kind: "string", value: hx[0], encoding: "hex" };
    }
    if (c === "<" && region[i + 1] === "<") return { kind: "other" }; // value is a sub-dict
    if (c === "/") return { kind: "name" };
    if (c === "[") return { kind: "other" };
    // number, or an indirect reference `N M R`
    var rest = region.slice(i);
    var refM = /^(\d+)\s+(\d+)\s+R\b/.exec(rest);
    if (refM) return { kind: "ref", value: refM[1] + " " + refM[2] };
    if (/^-?\d/.test(rest)) return { kind: "other" }; // a plain number
    return { kind: "other" };
  }

  // Resolve one level: given a ref id "N M", find that object and, if its body is
  // (or begins with) a bare string, decode it. Returns { value, encoding } or null.
  function resolveRefString(map, id) {
    var target = map[id];
    if (!target) return null;
    var body = target.body;
    var i = 0, N = body.length;
    while (i < N && isWS(body[i])) i++;
    if (body[i] === "(") { var lit = decodeLiteral(body, i + 1); return { value: lit[0], encoding: "ref" }; }
    if (body[i] === "<" && body[i + 1] !== "<") { var hx = decodeHex(body, i); return { value: hx[0], encoding: "ref" }; }
    return null; // referenced object is not a bare string — out of one-level scope
  }

  // ---- top-level ----------------------------------------------------------
  function parsePdfDict(bytes, options) {
    options = options || {};
    var u8 = toU8(bytes); // throws on bad input type (document level)
    if (u8.length < 5 || latin1(u8, 0, 5) !== "%PDF-")
      throw new Error("ratchet-pdf-dict: not a PDF (missing %PDF- header)");

    var scan = collectObjects(u8);
    var records = [], malformed = [], texts = [];

    for (var o = 0; o < scan.objs.length; o++) {
      var obj = scan.objs[o];
      var region = dictRegion(obj.body);

      // The field's partial name (/T) — the record key for a /V value.
      var name = null;
      try {
        var t = readKeyValue(region, "T");
        if (t.kind === "string") name = t.value;
      } catch (e) { /* a malformed /T is not itself a text surface — leave name null */ }

      // /V — field value.
      pullTextKey(region, obj, "V", "field", name, scan.map, records, texts, malformed);
      // /Contents — annotation text ONLY when the value is a string (a ref is a
      // page's content-stream pointer; skipped by the value-type disambiguation).
      pullTextKey(region, obj, "Contents", "annotation", null, scan.map, records, texts, malformed);
      // /TU — field label, opt-in only.
      if (options.labels)
        pullTextKey(region, obj, "TU", "label", name, scan.map, records, texts, malformed);
    }

    return { records: records, text: texts.join("\n"), malformed: malformed };
  }

  function pullTextKey(region, obj, key, kind, name, map, records, texts, malformed) {
    var kv;
    try {
      kv = readKeyValue(region, key);
    } catch (e) {
      malformed.push({ obj: obj.id, key: key, malformed: true, reason: e.message });
      return;
    }
    if (kv.kind === "string") {
      records.push({ obj: obj.id, kind: kind, key: key, name: name, text: kv.value, encoding: kv.encoding });
      if (kv.value) texts.push(kv.value);
    } else if (kv.kind === "ref") {
      // Only /V resolves a ref to a string. A /Contents ref is a page content
      // pointer — the disambiguation says skip it.
      if (key !== "V") return;
      var r;
      try { r = resolveRefString(map, kv.value); }
      catch (e) { malformed.push({ obj: obj.id, key: key, malformed: true, reason: e.message }); return; }
      if (r) {
        records.push({ obj: obj.id, kind: kind, key: key, name: name, text: r.value, encoding: r.encoding });
        if (r.value) texts.push(r.value);
      }
    }
    // name / other / none -> not a text surface; nothing recorded.
  }

  return { parsePdfDict: parsePdfDict };
});

// ---- CLI (Node only) ------------------------------------------------------
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  var api = (typeof globalThis !== "undefined" ? globalThis : this).__ratchetPdfDict;
  var args = process.argv.slice(2);
  if (!args.length || args.indexOf("--help") !== -1) {
    process.stdout.write(
      "ratchet-pdf-dict — strict, zero-dep PDF dictionary-text extractor (/V + annotation /Contents)\n" +
      "  node ratchet-pdf-dict.js form.pdf            print the dictionary text\n" +
      "  node ratchet-pdf-dict.js --records form.pdf  one provenance line per record\n" +
      "  node ratchet-pdf-dict.js --labels form.pdf   also include /TU field labels\n" +
      "  node ratchet-pdf-dict.js --help\n"
    );
    process.exit(0);
  }
  var recordsMode = false, labels = false, file = null;
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--records") recordsMode = true;
    else if (args[i] === "--labels") labels = true;
    else file = args[i];
  }
  try {
    if (!file) throw new Error("no input file");
    var fs = require("fs");
    var buf = fs.readFileSync(file);
    var res = api.parsePdfDict(buf, { labels: labels });
    if (recordsMode) {
      res.records.forEach(function (r) {
        process.stdout.write(
          "obj " + r.obj + "\tkind=" + r.kind + "\tkey=/" + r.key +
          "\tname=" + (r.name === null ? "-" : JSON.stringify(r.name)) +
          "\tenc=" + r.encoding + "\ttextLen=" + r.text.length + "\n"
        );
      });
      res.malformed.forEach(function (r) {
        process.stderr.write("obj " + r.obj + "\tkey=/" + r.key + "\tMALFORMED — " + r.reason + "\n");
      });
    } else {
      process.stdout.write(res.text + (res.text ? "\n" : ""));
    }
    process.exit(0);
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (msg.indexOf("ratchet-pdf-dict:") !== 0) msg = "ratchet-pdf-dict: " + msg;
    process.stderr.write(msg + "\n");
    process.exit(1);
  }
}
