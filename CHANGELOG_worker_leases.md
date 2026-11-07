# SQLite queue claims and worker leases

- Added transactional `claim_next()` so independent worker processes cannot claim the same queued job.
- Added lease renewal and ownership-checked completion (`renew_lease`, `finish_claim`).
- Added expiry recovery so a job claimed by a crashed worker can return to the queue.
- Added schema migration for lease columns without discarding existing SQLite job data.
- Added concurrent-claim, expired-lease, and stale-worker-commit tests.

Scope: this hardens the persistence/queue primitives. The HTTP server still launches in-process render threads; a separately supervised worker process has not yet been wired into the request/status lifecycle.
