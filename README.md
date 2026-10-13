# UA Electronics — Neon PostgreSQL patch

This is a staged code patch based on the uploaded `server.js`, `email.js`,
`email-queue.js`, and `package.json`.

## What changes

- Application orders, users, products, payment intents, email queue, and email
  logs use `ua_json_records` in Neon, with transaction-scoped advisory locks for
  collection mutations.
- Receipt PDFs are stored in a dedicated `ua_receipts` table as `BYTEA` and
  are served from Neon if the local cache is missing.
- The existing order/payment routes, admin-session mechanism, request limits,
  and legacy password-hash verification path are retained.
- JSON source files remain available for recovery; the patch does not delete them.
- `DATABASE_URL` must be present before starting the service. The server checks
  the schema before opening its HTTP port.

## Critical safety requirement

Do not test this version against the live production branch by placing test
orders or editing products. Create a separate Neon test branch from the current
production branch and use that branch's connection string for local testing.
Only point Render to the production database after you have validated the code
against the test branch.

The earlier import placed existing rows in `ua_json_records`; it did not connect
the website to the database. `scripts/prepare-neon-runtime.js` adds order metadata
and the receipt table, after comparing local JSON records against the imported
rows. It optionally imports existing files named `*-receipt.pdf` found under
`Orders/`.

## Files to install locally

Copy these files into your project, preserving your original files as backups:

- `server.js`
- `db.js` (new)
- `email.js`
- `email-queue.js`
- `package.json`
- `scripts/prepare-neon-runtime.js` (new)

Your existing `package-lock.json` was updated when you installed `pg`. If it is
not available in this patch, keep the version from your working project.

## Recommended sequence

1. Back up current source files (not only the `data` folder).
2. Install the code files locally.
3. Run `node --check server.js`, `node --check email.js`,
   `node --check email-queue.js`, and `node --check db.js`.
4. In the local project, configure `DATABASE_URL` with the test branch's URL.
5. Run `node scripts/prepare-neon-runtime.js` to validate local JSON structure.
6. Run `node scripts/prepare-neon-runtime.js --apply` against the test branch.
   It verifies each imported record before updating `sort_order`, creates
   `ua_receipts`, and can import receipt PDFs. Do not run against production as a
   casual test: this command alters schema metadata and may add receipt data.
7. Start the service locally against the test branch and test product loading,
   login, COD checkout, admin status updates, order tracking, PDF generation,
   receipt download after removing only the *local test cache*, and email queue
   status/retry behavior.
8. Review Neon counts and logs before connecting Render to the production branch.

## Important limitations and follow-up

- `ua_json_records` stores each record's original shape as JSONB. It is a
  migration-friendly persistence layer, not a fully normalized relational
  schema; indexing and performance should be reviewed as order volume grows.
- Storing PDFs in PostgreSQL is convenient for the current small deployment,
  but increases database storage. For larger receipt archives, move PDFs to
  S3-compatible object storage and keep only their object keys in PostgreSQL.
- Gmail API failures such as `access_not_configured` are not repaired by this
  migration. The Google Cloud project and Gmail API/OAuth setup must be checked
  separately.
- Do not run `npm audit fix --force`; review the reported vulnerabilities in a
  separate, tested dependency-update change.
