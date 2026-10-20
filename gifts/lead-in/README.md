<!-- SPDX-License-Identifier: MIT -->
# The Lead-In

Read a piece of text into a list of **kinds** you declare, and see the exact words that led there.

You write a small vocabulary (a JSON file): each kind has a plain sentence, the **lead-in cues** that point to it, examples it must read, and counterexamples it must not. The Lead-In reads any text against it and answers which kinds the text is about, with every cue and its position as evidence. A vocabulary that cannot read its own examples **does not load** — the file is its own test.

**Printed edge.** It reads words, not meaning: a text that names its subject in words no vocabulary lists reads as no kind. Measured honestly: on an independent 20-request test set it read 5 exactly, with 2 false hits — precise on the words it knows, blind to the ones it doesn't.

## Use

```
python3 lead_in.py read toy-money.json "what does it cost to rent the hall"
python3 lead_in.py read toy-money.json "what does it cost to rent the hall" --json
python3 lead_in.py check toy-money.json
python3 lead_in.py list toy-money.json
python3 lead_in.py stray toy-money.json --kind money --cue "rent" --log strays.jsonl --proposer my-session "the rent went up again this spring"
python3 lead_in.py fold toy-money.json --log strays.jsonl
```

- `read` prints one line naming each kind and the cues that led there (`[read toy-money: money (cost*)]`); add `--json` for the full reading — the verdict, each kind's score and evidence as `[cue, position]`, and the advisory: a reading informs, it never gates.
- `check` loads the vocabulary and reports its self-test: examples read, counterexamples refused, cues exercised, collisions.
- `stray` records "this text is kind K, and cue C should have led there" — a proposal; it changes nothing.
- `fold` shows which proposals are eligible: a cue joins only when two sessions, on two different texts, have seen it lead to the same kind. `fold --write --decided <id> --events <dir>` applies them, refusing any change that would make an example or counterexample read wrong.

## Write your own vocabulary

Copy `toy-money.json`, rename the kinds, write a plain sentence for each, list the cues that lead to it, and give it examples and counterexamples. Run `check` until it loads.

## Stack

Python 3 standard library only. Offline. Deterministic: the same text and vocabulary give byte-identical output every run.

MIT licensed. Made by the Department of FWWC.
