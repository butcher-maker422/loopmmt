# loopcontact

**Your contacts, in one file you run yourself — with a way out built in.**

Loop Contact is a people registry that runs on your own machine. One JavaScript file, Node.js and nothing else: no
`npm install`, no account, no server you rent. It keeps your contacts in a SQLite database under your home directory,
answers a small HTTP API on `127.0.0.1`, and reads and writes vCards, so the address book you put in is an address book
you can take back out.

```
$ node loopcontact.js add "Marco Reyes" --email marco@example.org --organization "Reyes Photography"
$ node loopcontact.js import seed.vcf
$ node loopcontact.js search reyes
$ node loopcontact.js export --all --file contacts.vcf
$ node loopcontact.js                     # start the daemon on 127.0.0.1:1328
$ curl -s http://127.0.0.1:1328/status
```

## What it does

- **Contacts with structure.** Names, several emails, phones and addresses per person (each with a label and a
  primary), organization, title, notes, custom fields, stars, and a status (`active`, `inactive`, `merged`,
  `deceased`).
- **Search.** Full-text search over names, organizations and notes (SQLite FTS5).
- **Duplicates, merged carefully.** `suggest-merges` surfaces likely duplicates; `merge` folds one contact into
  another, keeps the history of the merge, and redirects links that pointed at the one that went away.
- **Links between people.** `link <id1> <id2> --relationship <name>` records who knows whom.
- **vCard in and out.** `import <file.vcf>` and `export` (one contact, starred, or all) on the command line, and
  `POST /api/contacts/import` / `GET /api/contacts/export` over HTTP.
- **An append-only record.** Every change writes an entry to a `proof_chain` table that SQLite triggers refuse to
  update or delete; `verify` checks the chain.

## Where your data lives

The database defaults to `~/.loop/data/contact.db`. Pass `--database <path>` to put it elsewhere, or `--config <path>`
to point at a config file. Nothing is written to the directory you start it from.

## How you leave

Run `node loopcontact.js export --all --file contacts.vcf`. You get standard vCard 3.0 that any address book reads.
Importing that file into a fresh copy and exporting again gives the same contacts back; that round trip was checked,
with the seed in `seed.vcf` (three fictional people, `example.org` addresses), before this copy was published.

## Running it

- **Node.js 22.5 or newer** (it uses the built-in `node:sqlite`; Node prints an "experimental" warning, which is
  expected).
- `node loopcontact.js help` lists every command and option.
- `node --test test_loopcontact.js` runs its tests.

## The edge

It listens on `127.0.0.1` and makes no network calls of its own. `discover` reads other Loop tools' databases on the
same machine, read-only, if you have registered any under `~/.loop/tools/`; otherwise it finds nothing. The HTTP API
has no login: anything that can reach `127.0.0.1:1328` on your machine can read and change your contacts, so do not
expose that port. It is one person's address book, not a shared CRM.

## License

MIT. See `LICENSE`.
