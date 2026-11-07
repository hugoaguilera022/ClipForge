#!/usr/bin/env python3
"""Independent durable ClipForge render worker.

The HTTP server only enqueues jobs. This process atomically claims SQLite jobs,
renews its lease while FFmpeg/Whisper run, and commits the final state only while
it still owns that lease.
"""
from __future__ import annotations
import os, socket, threading, time, uuid
import server

LEASE_SECONDS = max(120, int(os.getenv('CLIPFORGE_WORKER_LEASE_SECONDS', '180')))
POLL_SECONDS = max(0.25, float(os.getenv('CLIPFORGE_WORKER_POLL_SECONDS', '1.0')))
WORKER_ID = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"


def execute(job: dict) -> None:
    jid = str(job['id'])
    stop = threading.Event()
    lost = threading.Event()

    def heartbeat() -> None:
        while not stop.wait(max(10, LEASE_SECONDS // 3)):
            try:
                if not server.job_store_for_registry().renew_lease(jid, WORKER_ID, LEASE_SECONDS):
                    lost.set()
                    return
            except Exception as exc:
                print(f'[worker] lease renewal failed for {jid}: {exc}', flush=True)

    pulse = threading.Thread(target=heartbeat, name=f'lease-{jid}', daemon=True)
    pulse.start()
    with server.LOCK:
        server.JOBS[jid] = dict(job)
    handler = object.__new__(server.Handler)
    try:
        args = list(job.get('args') or [])
        if not args:
            job['status'] = 'failed'
            job['log'] = 'Trabajo inválido: falta el comando de producción.'
            server.job_store_for_registry().finish_claim(job, WORKER_ID)
            return
        handler.run_job(jid, args, job.get('transcript_path'), job.get('video_url') or '', worker_id=WORKER_ID)
        if lost.is_set():
            print(f'[worker] lease lost while processing {jid}; result not trusted', flush=True)
    finally:
        stop.set()
        pulse.join(timeout=2)


def main() -> None:
    store = server.job_store_for_registry()
    print(f'[worker] {WORKER_ID} ready; polling SQLite queue', flush=True)
    while True:
        try:
            recovered = store.recover_expired()
            if recovered:
                print(f'[worker] recovered {recovered} expired job(s)', flush=True)
            job = store.claim_next(WORKER_ID, LEASE_SECONDS)
            if job is None:
                time.sleep(POLL_SECONDS)
                continue
            print(f"[worker] claimed {job['id']}", flush=True)
            execute(job)
            latest = store.get(str(job['id'])) or {}
            print(f"[worker] {job['id']} -> {latest.get('status', 'unknown')}", flush=True)
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print(f'[worker] loop error: {type(exc).__name__}: {exc}', flush=True)
            time.sleep(min(5, POLL_SECONDS * 2))


if __name__ == '__main__':
    main()
