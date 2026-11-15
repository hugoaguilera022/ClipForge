import threading
from pathlib import Path
from job_store import JobStore


def test_sqlite_store_survives_reopen_and_preserves_payload(tmp_path):
    path = tmp_path / 'jobs.sqlite3'
    store = JobStore(path)
    jobs = {'a': {'id': 'a', 'status': 'queued', 'created': 1, 'args': ['x'], 'log': 'á'}}
    store.save_many(jobs)
    reopened = JobStore(path)
    assert reopened.all() == jobs
    assert reopened.get('a')['log'] == 'á'


def test_active_jobs_are_not_evicted_by_history_limit(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    jobs = {str(i): {'id': str(i), 'status': 'completed', 'created': i} for i in range(8)}
    jobs['active'] = {'id': 'active', 'status': 'queued', 'created': 0}
    store.save_many(jobs, limit=3)
    restored = store.all()
    assert 'active' in restored
    assert len(restored) == 3


def test_concurrent_updates_do_not_lose_jobs(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    errors = []
    def writer(n):
        try:
            for i in range(12):
                store.upsert({'id': f'{n}-{i}', 'status': 'queued', 'created': n*100+i})
        except Exception as exc:
            errors.append(exc)
    threads = [threading.Thread(target=writer, args=(n,)) for n in range(4)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert not errors
    assert len(store.all()) == 48


def test_only_one_worker_can_claim_a_queued_job(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'one', 'status': 'queued', 'created': 1})
    claimed = []
    errors = []
    def worker(name):
        try: claimed.append(store.claim_next(name, now=100))
        except Exception as exc: errors.append(exc)
    threads = [threading.Thread(target=worker, args=(f'w{i}',)) for i in range(8)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert not errors
    winners = [x for x in claimed if x]
    assert len(winners) == 1
    assert winners[0]['worker_id'] in {f'w{i}' for i in range(8)}


def test_expired_worker_lease_is_requeued_and_reclaimable(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'one', 'status': 'queued', 'created': 1})
    assert store.claim_next('dead-worker', lease_seconds=30, now=100)['status'] == 'processing'
    assert store.recover_expired(now=129) == 0
    assert store.recover_expired(now=130) == 1
    recovered = store.get('one')
    assert recovered['status'] == 'queued'
    assert 'worker_id' not in recovered
    assert store.claim_next('replacement', now=131)['worker_id'] == 'replacement'


def test_worker_cannot_commit_after_losing_lease(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'one', 'status': 'queued', 'created': 1})
    job = store.claim_next('worker-a', now=100)
    assert job
    job['status'] = 'completed'
    assert store.finish_claim(job, 'worker-b') is False
    assert store.get('one')['status'] == 'processing'
    assert store.finish_claim(job, 'worker-a') is True
    assert store.get('one')['status'] == 'completed'


def test_snapshot_save_does_not_delete_jobs_created_by_another_process(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'from-worker', 'status': 'queued', 'created': 2})
    store.save_many({'old-snapshot': {'id': 'old-snapshot', 'status': 'completed', 'created': 1}})
    assert set(store.all()) == {'from-worker', 'old-snapshot'}


def test_save_many_does_not_overwrite_lease_columns(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'job', 'status': 'queued', 'created': 1})
    claimed = store.claim_next('worker-a', lease_seconds=600, now=100)
    assert claimed
    store.save_many({'job': {'id': 'job', 'status': 'processing', 'created': 1, 'log': 'progress'}})
    with store._connect() as db:
        row = db.execute('SELECT lease_owner,lease_until FROM jobs WHERE id=?', ('job',)).fetchone()
    assert row['lease_owner'] == 'worker-a'
    assert row['lease_until'] == 700
    # A stale server snapshot must not roll back the worker's processing state.
    assert store.get('job')['status'] == 'processing'
    assert store.get('job')['worker_id'] == 'worker-a'


def test_stale_worker_cannot_update_claim_after_recovery(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    job = {'id': 'lease-guard', 'status': 'queued', 'created': 1, 'log': 'queued'}
    store.upsert(job)
    import time
    now = time.time()
    claimed = store.claim_next('worker-a', lease_seconds=30, now=now)
    assert claimed and claimed['worker_id'] == 'worker-a'
    assert store.recover_expired(now=now + 31) == 1
    claimed_b = store.claim_next('worker-b', lease_seconds=30)
    assert claimed_b and claimed_b['worker_id'] == 'worker-b'
    stale = dict(claimed, log='stale worker overwrote progress')
    assert store.update_claim(stale, 'worker-a') is False
    current = store.get('lease-guard')
    assert current['worker_id'] == 'worker-b'
    assert current['log'].startswith('queued\nTrabajo recuperado:')


def test_claim_owner_can_update_progress_and_finish(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'owned', 'status': 'queued', 'created': 2, 'log': ''})
    job = store.claim_next('worker-a', lease_seconds=60)
    job['log'] = 'rendering 50%'
    assert store.update_claim(job, 'worker-a') is True
    assert store.get('owned')['log'] == 'rendering 50%'
    job['status'] = 'completed'
    assert store.finish_claim(job, 'worker-a') is True
    assert store.get('owned')['status'] == 'completed'


def test_progress_update_preserves_latest_heartbeat_expiry(tmp_path):
    import time
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'heartbeat', 'status': 'queued', 'created': 3})
    job = store.claim_next('worker-a', lease_seconds=120)
    old_expiry = job['lease_until']
    assert store.renew_lease('heartbeat', 'worker-a', lease_seconds=600)
    renewed = store.get('heartbeat')['lease_until']
    assert renewed > old_expiry
    job['log'] = 'progress after heartbeat'
    assert store.update_claim(job, 'worker-a')
    assert store.get('heartbeat')['lease_until'] == renewed



def test_bulk_snapshot_cannot_requeue_a_completed_worker_job(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'active', 'status': 'queued', 'created': 1, 'log': 'queued'})
    claimed = store.claim_next('worker-a', lease_seconds=600)
    assert claimed
    claimed['status'] = 'completed'
    claimed['log'] = 'done'
    assert store.finish_claim(claimed, 'worker-a') is True

    # The HTTP process still has the old queued snapshot when another upload arrives.
    store.save_many({
        'active': {'id': 'active', 'status': 'queued', 'created': 1, 'log': 'old snapshot'},
        'new': {'id': 'new', 'status': 'queued', 'created': 2, 'log': 'new upload'},
    })
    assert store.get('active')['status'] == 'completed'
    assert store.get('active')['log'] == 'done'
    assert store.get('new')['status'] == 'queued'


def test_explicit_upsert_can_requeue_failed_job_for_retry(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'retry', 'status': 'failed', 'created': 1, 'log': 'failed'})
    retry = {'id': 'retry', 'status': 'queued', 'created': 1, 'log': 'retry requested'}
    store.upsert(retry)
    assert store.get('retry') == retry


def test_bulk_snapshot_cannot_requeue_a_processing_job_or_clear_its_lease(tmp_path):
    store = JobStore(tmp_path / 'jobs.sqlite3')
    store.upsert({'id': 'active', 'status': 'queued', 'created': 1, 'log': 'queued'})
    claimed = store.claim_next('worker-a', lease_seconds=600)
    assert claimed and claimed['worker_id'] == 'worker-a'

    # Simulate the HTTP server enqueueing a second job with its old in-memory copy.
    store.save_many({
        'active': {'id': 'active', 'status': 'queued', 'created': 1, 'log': 'stale queued snapshot'},
        'new': {'id': 'new', 'status': 'queued', 'created': 2, 'log': 'new upload'},
    })
    current = store.get('active')
    assert current['status'] == 'processing'
    assert current['worker_id'] == 'worker-a'
    with store._connect() as db:
        row = db.execute('SELECT lease_owner, lease_until FROM jobs WHERE id=?', ('active',)).fetchone()
    assert row['lease_owner'] == 'worker-a'
    assert row['lease_until'] == claimed['lease_until']
    assert store.get('new')['status'] == 'queued'
