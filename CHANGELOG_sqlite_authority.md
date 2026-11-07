# SQLite authority and concurrent snapshot safety

- SQLite is now the authoritative job registry after its first successful import; the legacy JSON file is only a migration source for an empty database.
- Startup recovers expired leases and does not reset a job still leased by a live worker, preventing duplicate execution when only the HTTP server restarts.
- Snapshot persistence no longer deletes rows that were not present in the caller's in-memory snapshot, avoiding accidental deletion of jobs inserted by another process.
- Snapshot writes preserve lease owner/expiry columns while updating the JSON payload.
- Added regression tests for concurrent insertion survival and lease preservation.

Validation: `python3 -m pytest -q` — 155 passed; Python compilation and `node --check static/app.js` passed.
