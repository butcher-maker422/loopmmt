#!/usr/bin/env node
/* wuphf.js — say one thing once, see it shaped for every channel at once.

   WHY THIS EXISTS. You write an announcement and then you retype it: once for
   email, once for the group text, once for Slack, once for the post. Each
   channel has its own shape and its own rules — a text is capped at 160
   characters before it splits into billed segments, a tweet dies at 280, a
   voicemail has to be *spoken* and land in under half a minute, a fax wants a
   cover sheet. Nobody remembers all those rules, so the same message goes out
   mangled in one place and truncated in another, and you don't find out until
   later. WUPHF refuses that. You type the message ONCE; it renders that exact
   message for every channel you declared, side by side, and — this is the whole
   point — it shows you the COST each channel imposes: the segment count, the
   character count against the cap, where the text will be cut, how long the
   voicemail takes to read aloud. You copy each one and send it yourself.

   THE JOKE, PLAYED STRAIGHT. WUPHF is Ryan's startup from *The Office* — text
   one thing and it blasts to fax, email, and phone at once. On the show it's a
   disaster precisely because it HIDES the mismatch between the channels. This
   gift is the honest inversion: it makes the mismatch visible. Same idea, one
   message to every channel; opposite ethic, the cost is never hidden.

   THE ONE DISCIPLINE (the whole reason to trust it). WUPHF renders and counts;
   it does NOT send. There is no network call, no credential, no mailto that
   fires on its own. Every channel is a declared, closed member of a fixed set —
   an unknown channel is a non-zero exit with the channel named, never a silent
   default. Each render is a PURE function of (message, channel): same message +
   same channel set -> byte-identical output, every run, every machine. It counts
   the cost each channel imposes; it does not judge whether your words are good.

   It is the TYPED member of the fanout family (the parallel-independent compose,
   the ⊗ product): `fanout` splits one payload into N identical labeled copies;
   WUPHF splits one message into N channel-SHAPED renders. Same jig, typed branches.

   USAGE
     node wuphf.js "your message"                       # all channels
     node wuphf.js --channels sms,social "your message" # a chosen subset
     echo -n "your message" | node wuphf.js             # message from stdin (exact bytes)
     node wuphf.js --json "your message"                # machine-readable JSONL
     node wuphf.js --list                               # the declared channels
     node wuphf.js --help

   OUTPUT (text mode): one card per channel, in declared order — the render plus
   its honest cost line. With --json: one JSONL record per channel:
     {"channel":"sms","render":"…","cost":{…},"seq":0,"of":6}

   Released under MIT. Its edge is printed in the README: WUPHF shows your message
   shaped for every channel at once and counts the cost each imposes; it does not
   send anything, connect to any service, or judge whether the words are good.
*/

"use strict";

/* ------------------------------------------------------------------ *
 * The declared, CLOSED channel set. Adding a channel is a new entry
 * here (config, not code) — never an inferred or default branch.
 * Order in this array is the canonical, declared render order.
 * ------------------------------------------------------------------ */
var CHANNELS = ["sms", "email", "voicemail", "fax", "chat", "social"];

// A structured refusal. The CLI turns this into a non-zero exit; require()
// callers get a thrown Error they can catch.
function WuphfError(message) {
  var e = new Error(message);
  e.name = "WuphfError";
  return e;
}

/* ---- helpers: all pure, no clock, no randomness -------------------- */

// Collapse runs of whitespace to single spaces and trim — the shared
// "one line of speech" normalization used where a channel is single-line.
function oneLine(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

// GSM-7 basic + extension coverage test. Characters outside GSM-7 force the
// whole SMS into UCS-2 encoding (70-char segments instead of 160). This is the
// real rule carriers use; it is decidable and testable.
var GSM7_BASIC =
  "@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5" +
  "\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u00c6\u00e6\u00df\u00c9" +
  " !\"#\u00a4%&'()*+,-./0123456789:;<=>?" +
  "\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7" +
  "\u00bfabcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0";
// Characters that are GSM-7 but cost TWO septets (the extension table).
var GSM7_EXT = "\f^{}\\[~]|\u20ac";

function isGsm7(str) {
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i);
    if (GSM7_BASIC.indexOf(ch) === -1 && GSM7_EXT.indexOf(ch) === -1) return false;
  }
  return true;
}

// Count SMS septets: extension-table chars cost 2. (Only meaningful in GSM-7.)
function gsm7Septets(str) {
  var n = 0;
  for (var i = 0; i < str.length; i++) {
    n += (GSM7_EXT.indexOf(str.charAt(i)) !== -1) ? 2 : 1;
  }
  return n;
}

// UTF-16 code-UNIT length is what UCS-2 SMS segmentation actually counts.
function ucs2Units(str) {
  return str.length;
}

/* ---- the SMS cost model (decidable, tested) ------------------------ *
 * Returns { encoding, units, cap_single, cap_multi, segments }.
 * Single-segment caps: 160 (GSM-7) / 70 (UCS-2).
 * Multi-segment caps (UDH concatenation overhead): 153 / 67.
 * ------------------------------------------------------------------ */
function smsCost(message) {
  var gsm = isGsm7(message);
  var units = gsm ? gsm7Septets(message) : ucs2Units(message);
  var capSingle = gsm ? 160 : 70;
  var capMulti = gsm ? 153 : 67;
  var segments = (units <= capSingle) ? 1 : Math.ceil(units / capMulti);
  if (units === 0) segments = 1; // an empty message is one (empty) segment
  return {
    encoding: gsm ? "GSM-7" : "UCS-2",
    units: units,
    cap_single: capSingle,
    cap_multi: capMulti,
    segments: segments
  };
}

/* ---- per-channel renderers ----------------------------------------- *
 * Each returns { render: string, cost: {...} }. All pure.
 * The `cost` object is channel-specific and always includes a `label`
 * — a one-line human summary of the honest cost.
 * ------------------------------------------------------------------ */

function renderSms(message) {
  var body = oneLine(message);
  var c = smsCost(body);
  var overNote = c.segments > 1
    ? c.segments + " segments (" + c.units + " " +
      (c.encoding === "GSM-7" ? "septets" : "UTF-16 units") + ", " +
      c.encoding + ") — this text will be BILLED and DELIVERED as " +
      c.segments + " parts"
    : "1 segment (" + c.units + "/" + c.cap_single + " " +
      (c.encoding === "GSM-7" ? "septets" : "UTF-16 units") + ", " + c.encoding + ")";
  return {
    render: body,
    cost: {
      encoding: c.encoding,
      units: c.units,
      cap_single: c.cap_single,
      cap_multi: c.cap_multi,
      segments: c.segments,
      label: overNote
    }
  };
}

// Email: derive a subject from the first sentence/line (capped), body is the rest.
// If the message is a single short line, subject == that line and body is empty.
function renderEmail(message) {
  var norm = String(message).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var firstBreak = norm.search(/[\n.!?]/);
  var subject, body;
  if (firstBreak === -1) {
    subject = oneLine(norm);
    body = "";
  } else {
    // subject = text up to (and excluding) the first break char; keep terminal punct off.
    subject = oneLine(norm.slice(0, firstBreak));
    body = norm.slice(firstBreak).replace(/^[\n.!?\s]+/, "");
  }
  var SUBJECT_CAP = 78; // RFC 2822 recommended max subject line before folding
  var subjTrimmed = subject.length > SUBJECT_CAP;
  if (subjTrimmed) subject = subject.slice(0, SUBJECT_CAP - 1).replace(/\s+\S*$/, "") + "\u2026";
  var render = "Subject: " + subject + "\n\n" + (body.length ? body : "(no additional body)");
  return {
    render: render,
    cost: {
      subject_chars: subject.length,
      subject_cap: SUBJECT_CAP,
      subject_trimmed: subjTrimmed,
      body_chars: body.length,
      label: "subject " + subject.length + "/" + SUBJECT_CAP +
        (subjTrimmed ? " (trimmed)" : "") + " \u00b7 body " + body.length + " chars"
    }
  };
}

// Voicemail: a spoken script + an honest read-aloud estimate.
// 150 words/minute is the standard careful-speech rate; we report seconds.
function renderVoicemail(message) {
  var spoken = oneLine(message);
  var words = spoken.length ? spoken.split(" ").length : 0;
  var seconds = Math.round((words / 150) * 60);
  var WPM = 150;
  var TARGET = 30; // a voicemail that reads over ~30s is too long
  var over = seconds > TARGET;
  var script = spoken.length
    ? "\u201c" + spoken + "\u201d"
    : "(nothing to say)";
  return {
    render: script,
    cost: {
      words: words,
      seconds: seconds,
      target_seconds: TARGET,
      wpm: WPM,
      over: over,
      label: words + " words \u2248 " + seconds + "s aloud (@" + WPM + " wpm)" +
        (over ? " \u2014 over the ~" + TARGET + "s a voicemail should stay under" : "")
    }
  };
}

// Fax: a cover-sheet header (To/From/Re/Date left blank for the sender to fill)
// followed by the message body. Date is deliberately a placeholder, NOT the
// system clock — a gift is a pure fold with no clock (determinism).
function renderFax(message) {
  var body = String(message).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  var render =
    "\u2014\u2014\u2014 FAX COVER \u2014\u2014\u2014\n" +
    "TO:   ____________________\n" +
    "FROM: ____________________\n" +
    "DATE: ____________________\n" +
    "RE:   ____________________\n" +
    "\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\n\n" +
    (body.length ? body : "(no message)");
  var lines = body.length ? body.split("\n").length : 0;
  return {
    render: render,
    cost: {
      body_chars: body.length,
      body_lines: lines,
      label: "cover sheet + " + body.length + " chars (" + lines + " line" +
        (lines === 1 ? "" : "s") + ") \u2014 fill in To/From/Date/Re before sending"
    }
  };
}

// Chat (Slack/Discord-style): plain single block, no cap enforced but char count reported.
function renderChat(message) {
  var body = String(message).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return {
    render: body.length ? body : "(empty)",
    cost: {
      chars: body.length,
      label: body.length + " chars \u2014 no hard cap, but keep it scannable"
    }
  };
}

// Social: 280-char cap (X/Bluesky/Mastodon-common), honest over-count + truncation point.
function renderSocial(message) {
  var CAP = 280;
  var body = oneLine(message);
  var over = body.length > CAP;
  var shown = over ? body.slice(0, CAP - 1) + "\u2026" : body;
  return {
    render: shown,
    cost: {
      chars: body.length,
      cap: CAP,
      over: over,
      truncated_at: over ? CAP - 1 : null,
      label: body.length + "/" + CAP + " chars" +
        (over ? " \u2014 OVER by " + (body.length - CAP) + "; shown truncated at " + (CAP - 1) : " \u2014 fits")
    }
  };
}

var RENDERERS = {
  sms: renderSms,
  email: renderEmail,
  voicemail: renderVoicemail,
  fax: renderFax,
  chat: renderChat,
  social: renderSocial
};

/* ---- channel parsing (fails closed, declared-order preserved) ------ */
function parseChannels(spec) {
  // spec: undefined -> all channels in declared order; else array of tokens.
  if (spec === undefined || spec === null) return CHANNELS.slice();
  if (!Array.isArray(spec)) {
    throw WuphfError("channels: expected a list of channel names");
  }
  var picked = [];
  var seen = Object.create(null);
  for (var i = 0; i < spec.length; i++) {
    var name = (typeof spec[i] === "string") ? spec[i].trim().toLowerCase()
                                             : String(spec[i]).trim().toLowerCase();
    if (name.length === 0) {
      throw WuphfError("channels: empty channel name at position " + i +
        " (WUPHF has no default channel \u2014 declare a real one)");
    }
    if (!RENDERERS[name]) {
      throw WuphfError("channels: unknown channel " + JSON.stringify(name) +
        " (declared channels: " + CHANNELS.join(", ") + ")");
    }
    if (seen[name]) {
      throw WuphfError("channels: duplicate channel " + JSON.stringify(name));
    }
    seen[name] = true;
    picked.push(name);
  }
  if (picked.length === 0) {
    throw WuphfError("channels: none declared (pass one of: " + CHANNELS.join(", ") + ")");
  }
  // Emit in CANONICAL declared order, not the order the caller listed them,
  // so output is stable regardless of how the subset was typed.
  return CHANNELS.filter(function (c) { return seen[c]; });
}

/* ---- the atom: one message -> N channel renders -------------------- *
 * wuphf(message, channels?) -> array of { channel, render, cost, seq, of }
 * Pure: no I/O, no clock, no randomness. `message` coerced via String().
 * ------------------------------------------------------------------ */
function wuphf(message, channels) {
  var chans = parseChannels(channels);
  var msg = (typeof message === "string") ? message : String(message);
  var of = chans.length;
  var out = [];
  for (var i = 0; i < of; i++) {
    var c = chans[i];
    var r = RENDERERS[c](msg);
    out.push({ channel: c, render: r.render, cost: r.cost, seq: i, of: of });
  }
  return out;
}

/* wuphfJSONL — canonical serialized form: one JSON object per line, fixed key
   order (channel,render,cost,seq,of), declared order, single trailing newline.
   Same message + same channels -> byte-identical text every run. */
function wuphfJSONL(message, channels) {
  var recs = wuphf(message, channels);
  var lines = [];
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    lines.push(
      "{" +
        "\"channel\":" + JSON.stringify(r.channel) + "," +
        "\"render\":" + JSON.stringify(r.render) + "," +
        "\"cost\":" + JSON.stringify(r.cost) + "," +
        "\"seq\":" + r.seq + "," +
        "\"of\":" + r.of +
      "}"
    );
  }
  return lines.join("\n") + "\n";
}

/* wuphfText — the human card view: one titled card per channel with its render
   and its honest cost line. Pure (no color, no clock). */
function wuphfText(message, channels) {
  var recs = wuphf(message, channels);
  var blocks = [];
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var title = r.channel.toUpperCase();
    var head = "\u2500\u2500 " + title + " " +
               new Array(Math.max(2, 40 - title.length)).join("\u2500");
    blocks.push(
      head + "\n" +
      r.render + "\n" +
      "  \u2192 " + r.cost.label
    );
  }
  return blocks.join("\n\n") + "\n";
}

// Browser: attach to a namespace. Node/require: export. CLI: run below.
if (typeof window !== "undefined") {
  window.ForestGifts = window.ForestGifts || {};
  window.ForestGifts.wuphf = wuphf;
  window.ForestGifts.wuphfJSONL = wuphfJSONL;
  window.ForestGifts.wuphfText = wuphfText;
  window.ForestGifts.WUPHF_CHANNELS = CHANNELS.slice();
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    wuphf: wuphf,
    wuphfJSONL: wuphfJSONL,
    wuphfText: wuphfText,
    parseChannels: parseChannels,
    smsCost: smsCost,
    CHANNELS: CHANNELS.slice()
  };
}

// ---- CLI (runs only when invoked directly, never on require) ----------------
function readChannelsArg(args) {
  var i = args.indexOf("--channels");
  if (i === -1) return undefined; // -> all channels
  var csv = args[i + 1];
  if (csv === undefined) throw WuphfError("--channels needs a comma-separated value");
  return csv.split(",");
}

function positionalMessage(args) {
  var flagsWithValue = { "--channels": true };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a.charAt(0) === "-") { if (flagsWithValue[a]) i++; continue; }
    return a;
  }
  return null;
}

function main(argv) {
  var args = argv.slice(2);

  if (args.indexOf("--help") !== -1 || args.indexOf("-h") !== -1) {
    process.stdout.write(
      "wuphf.js \u2014 say one thing once, see it shaped for every channel at once.\n\n" +
      "  node wuphf.js \"your message\"                        all channels\n" +
      "  node wuphf.js --channels sms,social \"your message\"  a chosen subset\n" +
      "  echo -n \"your message\" | node wuphf.js               message from stdin (exact bytes)\n" +
      "  node wuphf.js --json \"your message\"                  machine-readable JSONL\n" +
      "  node wuphf.js --list                                 the declared channels\n" +
      "  node wuphf.js --help\n\n" +
      "Renders your ONE message for every declared channel and shows the cost each\n" +
      "imposes (SMS segments, char caps, read-aloud seconds, truncation). Fails closed\n" +
      "(non-zero exit, channel named) on an unknown, empty, or duplicate channel.\n\n" +
      "Edge: WUPHF renders and counts \u2014 it does NOT send anything, connect to any\n" +
      "service, or judge whether the words are good. You copy each and send it yourself.\n"
    );
    return 0;
  }

  if (args.indexOf("--list") !== -1) {
    process.stdout.write(CHANNELS.join("\n") + "\n");
    return 0;
  }

  var asJson = args.indexOf("--json") !== -1;

  var channelSpec;
  try {
    channelSpec = readChannelsArg(args);
  } catch (e) {
    process.stderr.write("wuphf: " + e.message + "\n");
    return 2;
  }

  var message = positionalMessage(args);

  function emit(msg) {
    try {
      process.stdout.write(asJson ? wuphfJSONL(msg, channelSpec)
                                  : wuphfText(msg, channelSpec));
      return 0;
    } catch (e) {
      process.stderr.write("wuphf: " + e.message + "\n");
      return 2;
    }
  }

  if (message !== null) return emit(message);

  // stdin: exact bytes.
  var chunks = [];
  process.stdin.on("data", function (d) { chunks.push(d); });
  process.stdin.on("end", function () {
    var buf = Buffer.concat(chunks);
    process.exitCode = emit(buf.toString("utf8"));
  });
  return 0;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv);
}
