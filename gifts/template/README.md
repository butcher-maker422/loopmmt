# template — fill a prompt template's {{variables}} from a record, and refuse the blank

**template** takes a prompt with `{{variable}}` slots and a data **record**, and returns the
prompt with every slot filled from the record. It is the mail-merge a prompt engineer actually
wants: one base prompt becomes many concrete prompts — and it **won't lie**. If the template
asks for a variable the record does not supply, template does not leave the slot as literal
`{{name}}`, does not blank it, and does not write `undefined`. It **fails closed** — non-zero
exit, every missing variable named — so a broken prompt never slips through looking fine.

Zero dependencies. Pure function of its inputs — same template + same record yields
byte-identical output, every run. Runs in a browser (`window.ForestGifts.template`) or on Node.

## Use

```
node template.js --record '{"name":"Ada","topic":"looms"}' "Hi {{name}}, about {{topic}}."
echo -n "Hi {{name}}." | node template.js --record '{"name":"Ada"}'   # template from stdin
node template.js --record-file rec.json "Hi {{name}}."                 # record from a file
node template.js --list "Hi {{name}}, re {{topic}}."                   # list variables, fill nothing
node template.js --help
```

Output — the filled template (exact bytes):

```
Hi Ada, about looms.
```

A slot is `{{ name }}` — double braces around a variable name of letters, digits, `.` `_` `-`
(whitespace inside the braces is trimmed). A `{{ ... }}` whose inner text is empty or otherwise
not a valid name is left as literal text — it was never a slot.

It **fails closed** — non-zero exit, every missing variable named at once, in declared order —
when the record is missing a variable the template declares. There is no default value. An
inherited property (like `toString`) is **not** a supplied value, so `{{toString}}` with an empty
record refuses rather than silently filling with a built-in. That refusal is the feature: it fills
**only** slots it can prove a value for.

## The edge (what it does NOT do)

> template fills the `{{variables}}` your template declares from the record you give it, and
> refuses (naming the blank) when a required variable is missing; it does **not** judge whether
> the **filled** prompt is correct, meaningful, or safe — only that every declared slot had a
> value. It is not a general template language: there is no logic, no loops, no conditionals,
> and no escape for a literal `{{` that you want left unfilled.

## Test

```
node test_template.js    # GREEN (exit 0) / RED (non-zero): golden corpus + determinism + non-vacuity
```

Released under the MIT License (see `LICENSE`).

<!-- keel: gift -->
