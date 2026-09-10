#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/* quorum.js — ask three, trust the overlap. A consensus fold over N answers.
 *
 * A tiny, dependency-free fold that takes the answers you already collected —
 * one prompt run through several models, or the same model run several times —
 * and decides what they AGREE on. It emits the agreed value (if enough of them
 * concur), the full tally of who said what, and the dissent (who disagreed and
 * with what). Runs identically in Node and in a browser (no DOM, no deps).
 *
 *     [ {label, answer}, ... ] ──▶ quorum(answers, opts) ──▶ {
 *         verdict: "quorum" | "no-quorum" | "tie",
 *         value:   <the agreed answer, or null>,
 *         agree:   [labels that gave the winning value],
 *         dissent: [ {label, answer} that did not ],
 *         tally:   [ {answer, count, labels} ... ] sorted high→low,
 *         n, threshold, needed
 *     }
 *
 * WHAT QUORUM IS, AND THE LINE IT WILL NOT CROSS (the honest ceiling — printed).
 * Quorum is a COUNTING fold, not a truth oracle. It answers one question — "how
 * many of these answers are the same, and is that enough?" — under a normalize
 * rule and a threshold you declare. It does NOT — and this is stated on the tool
 * itself, every run — know whether the agreed answer is CORRECT. N models can
 * agree and all be wrong; a majority can be a shared blind spot. Concordance is
 * not correctness. Quorum tells you where the answers converge and where they
 * split; it never certifies the winner is right. (This is the same honesty the
 * `grain` gift prints as "a smell, not a proof" and `scrub` as "a smoke alarm,
 * not a vault".) Treat a quorum as "N sources independently landed here", and
 * keep your judgment about whether here is correct.
 *
 * WHY THIS EXISTS AS A GIFT — AND WHY IT DOES NOT CALL THE MODELS.
 * The seam it fills is: you ran a prompt through several models (or several
 * times) and now hold a fistful of answers, and the cheap, deterministic,
 * substrate-free thing to do is FOLD them into a consensus. Quorum is that fold.
 * It deliberately does NOT run the models for you — that would make it depend on
 * a network, an API, keys, a substrate, and its output would stop being a pure
 * function of its input. Shipping the "call N models" step would be the exact
 * rot the `weir` gift declines when it budgets in rows-not-tokens: substrate is
 * where a gift goes to die. Quorum ships the SHAPE (the consensus fold), names
 * the want (you wanted it to call the models), and declines it. You bring the
 * answers; Quorum tells you what they agree on. Because the fold is pure, the
 * same answers always yield the same verdict — auditable, replayable, offline.
 *
 * THE NORMALIZE RULE (declared, never guessed). Two answers "agree" iff they are
 * equal AFTER normalization. The default normalize is conservative: trim outer
 * whitespace and collapse internal runs of whitespace to one space — nothing
 * else, because a fold that silently lowercased or stripped punctuation could
 * merge answers that a caller meant to keep distinct. Stronger normalizers are
 * opt-in and declared: `--fold-case` (case-insensitive), `--json` (parse each
 * answer as JSON and compare by a canonical key-sorted re-serialization, so
 * {"a":1,"b":2} and {"b":2,"a":1} agree). A normalize you did not ask for is a
 * silent merge, so Quorum asks for it.
 *
 * THE THRESHOLD (declared, never guessed). A "quorum" is reached when the top
 * answer's count is >= the needed count. The default threshold is a strict
 * majority: needed = floor(n/2) + 1. `--threshold N` sets an absolute count
 * (needed = N). `--unanimous` requires all n. If the top count does not reach
 * needed, the verdict is "no-quorum" (nobody won) — never a quiet plurality
 * passed off as agreement. If two or more answers tie for the top count AND
 * that count reaches needed, the verdict is "tie" and value is null: a tie is
 * not a winner, and Quorum will not pick one for you.
 *
 * STRUCTURAL PROMISES (so the fold cannot betray its own purpose):
 *   1. It is pure and deterministic. quorum(a) === quorum(a): same answers,
 *      same options, same verdict, every run — no clock, no randomness, no I/O
 *      in the core. The tally is sorted by (count desc, then first-appearance
 *      order) so the order is a fixed function of the input, never insertion
 *      -hash-dependent. --selftest proves it.
 *   2. It never invents an answer. `value` is always one of the input answers
 *      verbatim (the first-seen raw form of the winning normalized group), or
 *      null. A consensus fold that emitted a value nobody said would be broken.
 *   3. Every input answer is accounted for. agree ∪ dissent = all labels, with
 *      no label in both. Exhaustiveness: no answer is silently dropped from the
 *      count. (An empty answer is a real answer — it counts.)
 *
 * INPUT FORMS. On the CLI, answers come from a JSONL file / stdin (one
 * {"label":..,"answer":..} per line) OR from repeated --answer "label=text"
 * flags OR from plain lines of a file with --lines (label = 1-based line no.).
 * As a library, pass an array of {label, answer} (or bare strings — the index
 * becomes the label). A missing/blank answer is kept as the empty string, never
 * dropped (promise 3).
 */

'use strict';

/* ---- the normalize rule ---------------------------------------------------
 * Returns the normalized comparison key for an answer under the declared opts.
 * Default: trim + collapse internal whitespace. Opt-in: fold-case, json-canon.
 */
function normalizeKey(answer, opts) {
  opts = opts || {};
  let s = String(answer == null ? '' : answer);
  if (opts.json) {
    // Canonical JSON: parse, sort object keys recursively, re-serialize.
    // A parse failure is NOT silently treated as agreement — it falls back to
    // the raw-string path below, so two unparseable answers agree only if their
    // text agrees. (Declared in the ceiling: --json compares parseable answers
    // by structure; unparseable ones by text.)
    try {
      const parsed = JSON.parse(s);
      s = canonicalJson(parsed);
      return opts.foldCase ? s.toLowerCase() : s;
    } catch (_e) {
      // fall through to text normalize
    }
  }
  s = s.trim().replace(/\s+/g, ' ');
  if (opts.foldCase) s = s.toLowerCase();
  return s;
}

/* Deterministic canonical JSON: object keys sorted, arrays kept in order. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(function (k) {
    return JSON.stringify(k) + ':' + canonicalJson(v[k]);
  }).join(',') + '}';
}

/* ---- the fold -------------------------------------------------------------
 * answers: array of {label, answer} (or bare strings; index becomes label).
 * opts: { foldCase, json, threshold (abs count), unanimous }
 */
function quorum(answers, opts) {
  opts = opts || {};
  const rows = normalizeInput(answers);
  const n = rows.length;

  // Group by normalized key, preserving first-appearance order and raw value.
  const groups = [];            // {key, count, labels[], rawFirst, order}
  const byKey = new Map();
  rows.forEach(function (r, i) {
    const key = normalizeKey(r.answer, opts);
    let g = byKey.get(key);
    if (!g) {
      g = { key: key, count: 0, labels: [], rawFirst: r.answer, order: i };
      byKey.set(key, g);
      groups.push(g);
    }
    g.count += 1;
    g.labels.push(r.label);
  });

  // Sort tally: count desc, then first-appearance order asc (fully determined
  // by the input — no hash/insertion nondeterminism).
  const tally = groups.slice().sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.order - b.order;
  });

  // Needed count (the threshold).
  let needed;
  if (opts.unanimous) needed = n;
  else if (typeof opts.threshold === 'number') needed = opts.threshold;
  else needed = Math.floor(n / 2) + 1;   // default: strict majority

  const top = tally.length ? tally[0] : null;
  const topCount = top ? top.count : 0;
  const topGroups = tally.filter(function (g) { return g.count === topCount; });

  let verdict, value, agreeLabels;
  if (n === 0 || topCount < needed) {
    verdict = 'no-quorum';
    value = null;
    agreeLabels = [];
  } else if (topGroups.length > 1) {
    // Tie for the top count AND it meets needed → tie, no winner.
    verdict = 'tie';
    value = null;
    agreeLabels = [];
  } else {
    verdict = 'quorum';
    value = top.rawFirst;         // promise 2: a real input answer, verbatim
    agreeLabels = top.labels.slice();
  }

  const agreeSet = new Set(agreeLabels);
  const dissent = rows
    .filter(function (r) { return !agreeSet.has(r.label); })
    .map(function (r) { return { label: r.label, answer: r.answer }; });

  return {
    verdict: verdict,
    value: value,
    agree: agreeLabels,
    dissent: dissent,
    tally: tally.map(function (g) {
      return { answer: g.rawFirst, count: g.count, labels: g.labels.slice() };
    }),
    n: n,
    needed: needed,
    threshold: opts.unanimous ? 'unanimous'
      : (typeof opts.threshold === 'number' ? opts.threshold : 'majority')
  };
}

/* Coerce mixed input into [{label, answer}], filling labels from index. */
function normalizeInput(answers) {
  if (!Array.isArray(answers)) return [];
  return answers.map(function (a, i) {
    if (a && typeof a === 'object' && 'answer' in a) {
      return {
        label: (a.label == null ? String(i + 1) : String(a.label)),
        answer: String(a.answer == null ? '' : a.answer)
      };
    }
    // bare string / other scalar
    return { label: String(i + 1), answer: String(a == null ? '' : a) };
  });
}

const CEILING =
  'quorum counts agreement; it does not judge correctness. N sources can ' +
  'agree and all be wrong. A quorum means "this many independently landed ' +
  'here", never "here is right". It does not call the models for you — you ' +
  'bring the answers, it folds them. Concordance, not truth.';

/* ---- selftest (the determinism + promise proof) --------------------------- */
function selftest() {
  const cases = [];
  function check(name, cond) { cases.push({ name: name, ok: !!cond }); }

  // majority default
  let r = quorum([
    { label: 'gpt', answer: '42' },
    { label: 'claude', answer: '42' },
    { label: 'llama', answer: '43' }
  ]);
  check('majority verdict', r.verdict === 'quorum');
  check('majority value', r.value === '42');
  check('majority agree', r.agree.length === 2);
  check('majority dissent', r.dissent.length === 1 && r.dissent[0].label === 'llama');
  check('needed=2 for n=3', r.needed === 2);

  // no-quorum: 3-way split
  r = quorum([{ answer: 'a' }, { answer: 'b' }, { answer: 'c' }]);
  check('no-quorum verdict', r.verdict === 'no-quorum');
  check('no-quorum value null', r.value === null);
  check('no-quorum dissent = all', r.dissent.length === 3);

  // tie: 2 vs 2, needed=3 default majority of 4 → floor(4/2)+1 = 3, top=2 < 3
  r = quorum([{ answer: 'x' }, { answer: 'x' }, { answer: 'y' }, { answer: 'y' }]);
  check('2v2 majority is no-quorum (needs 3)', r.verdict === 'no-quorum');

  // tie that MEETS threshold: threshold=2, 2 vs 2 → tie
  r = quorum([{ answer: 'x' }, { answer: 'x' }, { answer: 'y' }, { answer: 'y' }],
    { threshold: 2 });
  check('2v2 at threshold 2 is a tie', r.verdict === 'tie');
  check('tie value null', r.value === null);

  // unanimous
  r = quorum([{ answer: 'q' }, { answer: 'q' }], { unanimous: true });
  check('unanimous pass', r.verdict === 'quorum' && r.value === 'q');
  r = quorum([{ answer: 'q' }, { answer: 'r' }], { unanimous: true });
  check('unanimous fail', r.verdict === 'no-quorum');

  // whitespace normalize (default)
  r = quorum([{ answer: '  hello   world ' }, { answer: 'hello world' }, { answer: 'x' }]);
  check('whitespace collapses', r.verdict === 'quorum' && r.agree.length === 2);
  // but value is the FIRST raw form (promise 2)
  check('value is first raw form', r.value === '  hello   world ');

  // case fold opt-in
  r = quorum([{ answer: 'Yes' }, { answer: 'yes' }, { answer: 'no' }], { foldCase: true });
  check('fold-case merges', r.verdict === 'quorum' && r.agree.length === 2);
  r = quorum([{ answer: 'Yes' }, { answer: 'yes' }, { answer: 'no' }]);
  check('no fold-case keeps distinct (no-quorum)', r.verdict === 'no-quorum');

  // json canonical opt-in
  r = quorum([
    { answer: '{"a":1,"b":2}' },
    { answer: '{"b":2,"a":1}' },
    { answer: '{"a":9}' }
  ], { json: true });
  check('json key-order agrees', r.verdict === 'quorum' && r.agree.length === 2);

  // determinism: same input twice → identical serialization
  const inp = [{ label: 'A', answer: 'k' }, { label: 'B', answer: 'k' }, { label: 'C', answer: 'm' }];
  const a = JSON.stringify(quorum(inp));
  const b = JSON.stringify(quorum(inp));
  check('deterministic (folds twice identical)', a === b);

  // exhaustiveness: agree ∪ dissent = all labels, disjoint
  r = quorum([{ label: 'p', answer: '1' }, { label: 'q', answer: '1' }, { label: 'r', answer: '2' }]);
  const seen = new Set(r.agree.concat(r.dissent.map(function (d) { return d.label; })));
  check('exhaustive: every label accounted once',
    seen.size === 3 && r.agree.length + r.dissent.length === 3);

  // empty answer counts as a real answer (not dropped)
  r = quorum([{ label: 'a', answer: '' }, { label: 'b', answer: '' }, { label: 'c', answer: 'z' }]);
  check('empty answer counts', r.verdict === 'quorum' && r.value === '' && r.agree.length === 2);

  // n=0 edge
  r = quorum([]);
  check('empty input is no-quorum', r.verdict === 'no-quorum' && r.n === 0);

  const passed = cases.filter(function (c) { return c.ok; }).length;
  return { passed: passed, total: cases.length, cases: cases };
}

/* ---- CLI ------------------------------------------------------------------ */
function parseArgs(argv) {
  const opts = { foldCase: false, json: false, mode: 'fold', lines: false,
    inlineAnswers: [], file: null, out: 'human' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opts.mode = 'selftest';
    else if (a === '--help' || a === '-h') opts.mode = 'help';
    else if (a === '--fold-case') opts.foldCase = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--unanimous') opts.unanimous = true;
    else if (a === '--lines') opts.lines = true;
    else if (a === '--out-json') opts.out = 'json';
    else if (a === '--threshold') { opts.threshold = parseInt(argv[++i], 10); }
    else if (a === '--answer') { opts.inlineAnswers.push(argv[++i]); }
    else if (a[0] !== '-') opts.file = a;
  }
  return opts;
}

function readInput(opts) {
  // Priority: inline --answer flags, else file/stdin.
  if (opts.inlineAnswers.length) {
    return opts.inlineAnswers.map(function (s, i) {
      const eq = s.indexOf('=');
      if (eq === -1) return { label: String(i + 1), answer: s };
      return { label: s.slice(0, eq), answer: s.slice(eq + 1) };
    });
  }
  let text = '';
  if (opts.file) {
    try {
      text = require('fs').readFileSync(opts.file, 'utf8');
    } catch (e) {
      // Fail clean on adversarial input (missing file, dir-as-file, unreadable):
      // a named error to stderr and a nonzero exit — never an uncaught traceback.
      process.stderr.write('quorum: cannot read ' + opts.file + ': ' + e.message + '\n');
      process.exit(2);
    }
  } else if (!process.stdin.isTTY) {
    try {
      text = require('fs').readFileSync(0, 'utf8');
    } catch (e) {
      process.stderr.write('quorum: cannot read stdin: ' + e.message + '\n');
      process.exit(2);
    }
  } else {
    return [];
  }
  const lines = text.split(/\r?\n/).filter(function (l) { return l.length > 0; });
  if (opts.lines) {
    return lines.map(function (l, i) { return { label: String(i + 1), answer: l }; });
  }
  // JSONL: one {label,answer} per line
  return lines.map(function (l, i) {
    try {
      const o = JSON.parse(l);
      return { label: (o.label == null ? String(i + 1) : String(o.label)),
        answer: String(o.answer == null ? '' : o.answer) };
    } catch (_e) {
      // a non-JSON line under JSONL mode: treat the whole line as an answer
      return { label: String(i + 1), answer: l };
    }
  });
}

function renderHuman(r) {
  const out = [];
  out.push('verdict: ' + r.verdict + (r.value !== null ? '  →  ' + JSON.stringify(r.value) : ''));
  out.push('n=' + r.n + '  needed=' + r.needed + ' (' + r.threshold + ')');
  out.push('tally:');
  r.tally.forEach(function (t) {
    out.push('  ' + t.count + '×  ' + JSON.stringify(t.answer) +
      '   [' + t.labels.join(', ') + ']');
  });
  if (r.dissent.length) {
    out.push('dissent:');
    r.dissent.forEach(function (d) {
      out.push('  ' + d.label + ': ' + JSON.stringify(d.answer));
    });
  }
  return out.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'help') {
    process.stderr.write(
      'quorum — ask three, trust the overlap. A consensus fold over N answers.\n\n' +
      'Usage:\n' +
      '  node quorum.js FILE.jsonl                 # {"label":..,"answer":..} per line\n' +
      '  node quorum.js --lines FILE.txt           # each line is an answer (label = line no.)\n' +
      '  node quorum.js --answer a=42 --answer b=42 --answer c=43\n' +
      '  cat answers.jsonl | node quorum.js\n\n' +
      'Options:\n' +
      '  --fold-case      case-insensitive agreement\n' +
      '  --json           compare answers as canonical JSON (key order ignored)\n' +
      '  --threshold N    need N matching answers (default: strict majority)\n' +
      '  --unanimous      need all N to agree\n' +
      '  --out-json       emit the full result object as JSON\n' +
      '  --selftest       run the golden selftest\n\n' +
      'CEILING: ' + CEILING + '\n');
    process.exit(0);
  }
  if (opts.mode === 'selftest') {
    const r = selftest();
    r.cases.forEach(function (c) {
      process.stdout.write((c.ok ? 'ok   ' : 'FAIL ') + c.name + '\n');
    });
    process.stdout.write('\n' + r.passed + '/' + r.total + ' passed\n');
    process.exit(r.passed === r.total ? 0 : 1);
  }
  const answers = readInput(opts);
  const r = quorum(answers, opts);
  if (opts.out === 'json') {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(r) + '\n');
    process.stderr.write('\n(' + CEILING + ')\n');
  }
  // exit code: 0 on a clean quorum, 2 on no-quorum/tie (so it gates in a pipe)
  process.exit(r.verdict === 'quorum' ? 0 : 2);
}

/* ---- exports (browser attach + Node require) ------------------------------ */
const API = { quorum: quorum, normalizeKey: normalizeKey, canonicalJson: canonicalJson,
  selftest: selftest, CEILING: CEILING };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
  if (require.main === module) main();
} else if (typeof window !== 'undefined') {
  window.quorum = API;
}
