# Worker lease fencing and heartbeat consistency

- Added `JobStore.update_claim()` to persist progress only while the caller still owns a non-expired processing lease.
- Progress updates now read the authoritative SQL lease expiry inside the write transaction, preventing a stale in-memory payload from undoing a heartbeat renewal.
- The render subprocess is terminated when ownership is lost; stale workers no longer commit terminal state or delete source/output files belonging to a replacement worker.
- Terminal job payloads no longer retain obsolete `worker_id` or `lease_until` fields.
- Added regression coverage for stale-owner writes, successful owner updates, and heartbeat/progress races.

Validation: 158 pytest tests passed; Python compilation and `node --check static/app.js` passed.
