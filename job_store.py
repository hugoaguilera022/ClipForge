"""Durable SQLite-backed job registry for ClipForge.

The JSON file remains a one-time migration source only. SQLite WAL + transactions
prevent torn whole-file rewrites when requests and workers update jobs concurrently.
"""
from __future__ import annotations
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

class JobStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created REAL NOT NULL DEFAULT 0,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                lease_owner TEXT,
                lease_until REAL
            )""")
            columns={row[1] for row in db.execute("PRAGMA table_info(jobs)")}
            if "lease_owner" not in columns: db.execute("ALTER TABLE jobs ADD COLUMN lease_owner TEXT")
            if "lease_until" not in columns: db.execute("ALTER TABLE jobs ADD COLUMN lease_until REAL")
            db.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created DESC)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status,created)")

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=30, isolation_level="IMMEDIATE")
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=30000")
        return db

    def all(self) -> dict[str, dict[str, Any]]:
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT id,payload FROM jobs ORDER BY created").fetchall()
        result = {}
        for row in rows:
            try:
                value = json.loads(row["payload"])
                if isinstance(value, dict): result[row["id"]] = value
            except (TypeError, ValueError):
                continue
        return result

    def save_many(self, jobs: dict[str, dict[str, Any]], limit: int = 1000) -> None:
        # Keep active work and the newest completed history; do not silently discard queued jobs.
        ordered = sorted(jobs.items(), key=lambda item: float(item[1].get("created") or 0), reverse=True)
        active = [(k,v) for k,v in ordered if v.get("status") in {"queued", "processing"}]
        done = [(k,v) for k,v in ordered if v.get("status") not in {"queued", "processing"}]
        selected = active + done[:max(0, limit-len(active))]
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.executemany(
                "INSERT INTO jobs(id,status,created,payload,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status,created=excluded.created,payload=excluded.payload,updated_at=CURRENT_TIMESTAMP",
                [(str(k), str(v.get("status") or "unknown"), float(v.get("created") or 0), json.dumps(v, ensure_ascii=False)) for k,v in selected]
            )
            # Do not delete rows absent from this caller's snapshot. Another
            # process may have inserted them after the snapshot was read.
            # Pruning is intentionally a separate maintenance operation.
            db.commit()

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT payload FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row: return None
        try: return json.loads(row["payload"])
        except (TypeError, ValueError): return None

    def upsert(self, job: dict[str, Any]) -> None:
        """Atomically insert or update one job without replacing other workers' jobs."""
        job_id = str(job.get("id") or "")
        if not job_id: raise ValueError("job id is required")
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT INTO jobs(id,status,created,payload,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status,created=excluded.created,payload=excluded.payload,updated_at=CURRENT_TIMESTAMP",
                (job_id, str(job.get("status") or "unknown"), float(job.get("created") or 0), json.dumps(job, ensure_ascii=False))
            )
            db.commit()

    def claim_next(self, worker_id: str, lease_seconds: int = 900, now: float | None = None) -> dict[str, Any] | None:
        """Atomically claim the oldest queued job; safe across independent processes."""
        import time
        now = time.time() if now is None else float(now)
        if not worker_id: raise ValueError("worker_id is required")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id,payload FROM jobs WHERE status='queued' ORDER BY created,id LIMIT 1").fetchone()
            if row is None:
                db.commit(); return None
            job = json.loads(row["payload"])
            job["status"] = "processing"
            job["worker_id"] = worker_id
            job["lease_until"] = now + max(30, int(lease_seconds))
            db.execute("UPDATE jobs SET status='processing',payload=?,lease_owner=?,lease_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'",
                       (json.dumps(job, ensure_ascii=False), worker_id, job["lease_until"], row["id"]))
            if db.total_changes < 1:
                db.rollback(); return None
            db.commit()
            return job

    def renew_lease(self, job_id: str, worker_id: str, lease_seconds: int = 900, now: float | None = None) -> bool:
        import time
        now = time.time() if now is None else float(now)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT payload FROM jobs WHERE id=? AND status='processing' AND lease_owner=?",(job_id,worker_id)).fetchone()
            if not row: db.rollback(); return False
            job=json.loads(row["payload"]); job["lease_until"]=now+max(30,int(lease_seconds))
            db.execute("UPDATE jobs SET payload=?,lease_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_owner=?",
                       (json.dumps(job,ensure_ascii=False),job["lease_until"],job_id,worker_id))
            db.commit(); return True

    def update_claim(self, job: dict[str, Any], worker_id: str) -> bool:
        """Update progress only if this process still owns the active lease."""
        job_id = str(job.get("id") or "")
        if not job_id: raise ValueError("job id is required")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT lease_until FROM jobs WHERE id=? AND status='processing' AND lease_owner=? AND lease_until>?",
                (job_id, worker_id, __import__('time').time())
            ).fetchone()
            if not row:
                db.rollback()
                return False
            # Heartbeat may have renewed the SQL lease after this worker's local
            # snapshot was created. Preserve that authoritative expiry in payload.
            job["lease_until"] = float(row["lease_until"])
            payload = json.dumps(job, ensure_ascii=False)
            cur = db.execute(
                "UPDATE jobs SET status='processing',created=?,payload=?,updated_at=CURRENT_TIMESTAMP "
                "WHERE id=? AND status='processing' AND lease_owner=? AND lease_until>?",
                (float(job.get("created") or 0), payload, job_id, worker_id, __import__('time').time())
            )
            db.commit()
            return cur.rowcount == 1

    def finish_claim(self, job: dict[str, Any], worker_id: str) -> bool:
        """Persist a worker result only while it still owns the lease."""
        job_id=str(job.get("id") or "")
        if not job_id: raise ValueError("job id is required")
        job.pop("worker_id", None)
        job.pop("lease_until", None)
        payload=json.dumps(job,ensure_ascii=False)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            cur=db.execute("UPDATE jobs SET status=?,created=?,payload=?,lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing' AND lease_owner=?",
                           (str(job.get("status") or "failed"),float(job.get("created") or 0),payload,job_id,worker_id))
            db.commit(); return cur.rowcount == 1

    def recover_expired(self, now: float | None = None) -> int:
        """Requeue jobs whose worker lease expired after a crash."""
        import time
        now=time.time() if now is None else float(now)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows=db.execute("SELECT id,payload FROM jobs WHERE status='processing' AND lease_until IS NOT NULL AND lease_until<=?",(now,)).fetchall()
            for row in rows:
                try: job=json.loads(row["payload"])
                except (TypeError,ValueError): job={"id":row["id"]}
                job["status"]="queued"; job.pop("worker_id",None); job.pop("lease_until",None)
                job["log"]=(str(job.get("log") or "")+"\nTrabajo recuperado: expiró la concesión del worker.").strip()
                db.execute("UPDATE jobs SET status='queued',payload=?,lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                           (json.dumps(job,ensure_ascii=False),row["id"]))
            db.commit(); return len(rows)
