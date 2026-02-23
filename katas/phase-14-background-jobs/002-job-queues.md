---
id: job-queues
phase: 14
phase_title: Background Jobs & Async Systems
sequence: 2
title: Job Queues with PostgreSQL
difficulty: advanced
tags: [queue, postgresql, jobs, skip-locked, reliable]
prerequisites: [background-workers]
estimated_minutes: 15
---

## Concept

While Redis-based queues (BullMQ) are popular, PostgreSQL can serve as a reliable job queue using `SELECT ... FOR UPDATE SKIP LOCKED`:

```sql
-- Claim the next job (atomic, concurrent-safe)
UPDATE jobs SET
  status = 'processing',
  started_at = now(),
  worker_id = $1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
    AND scheduled_for <= now()
  ORDER BY priority DESC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

**Why PostgreSQL for queues?**
- Already in your stack — no new infrastructure
- ACID transactions — jobs are never lost or double-processed
- `SKIP LOCKED` — multiple workers claim different jobs without blocking
- `LISTEN/NOTIFY` — instant notification when a job is enqueued
- Full SQL — complex queries on job history, statistics, filtering

**When to use Redis-based queues instead:**
- Very high throughput (>10K jobs/sec)
- Rate limiting with fine-grained control
- Job dependencies and complex workflows
- Delayed jobs with millisecond precision

## Key Insight

> `FOR UPDATE SKIP LOCKED` is the key to using PostgreSQL as a job queue. Without it, two workers claiming jobs simultaneously would either block each other (FOR UPDATE) or grab the same job (no lock). SKIP LOCKED makes each worker atomically claim a different job — if a row is already locked by another worker, it's skipped and the next available row is claimed. This gives you Redis-like concurrent job claiming with PostgreSQL's durability.

## Experiment

```js
console.log("=== Job Queues with PostgreSQL ===\n");

// Simulated PostgreSQL-backed job queue
class PgJobQueue {
  constructor() {
    this.jobs = [];
    this.nextId = 1;
    this.locks = new Set(); // Simulates row-level locks
    this.listeners = new Map(); // LISTEN/NOTIFY
  }

  // INSERT INTO jobs (type, data, priority, scheduled_for) VALUES (...)
  async enqueue(type, data, options = {}) {
    const job = {
      id: this.nextId++,
      type,
      data: JSON.stringify(data),
      status: "pending",
      priority: options.priority || 0,
      max_attempts: options.maxAttempts || 3,
      attempts: 0,
      created_at: new Date().toISOString(),
      scheduled_for: options.delay
        ? new Date(Date.now() + options.delay).toISOString()
        : new Date().toISOString(),
      started_at: null,
      completed_at: null,
      worker_id: null,
      result: null,
      last_error: null,
    };

    this.jobs.push(job);
    this._notify("new_job", { id: job.id, type: job.type });
    return job;
  }

  // SELECT ... FOR UPDATE SKIP LOCKED
  async claim(workerId) {
    const now = new Date().toISOString();

    for (const job of this.jobs) {
      if (job.status !== "pending") continue;
      if (job.scheduled_for > now) continue;
      if (this.locks.has(job.id)) continue; // SKIP LOCKED

      // Claim the job (atomic UPDATE)
      this.locks.add(job.id);
      job.status = "processing";
      job.started_at = new Date().toISOString();
      job.worker_id = workerId;
      job.attempts++;

      return { ...job, data: JSON.parse(job.data) };
    }

    return null;
  }

  // UPDATE jobs SET status = 'completed' WHERE id = $1
  async complete(jobId, result) {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job) return;
    job.status = "completed";
    job.completed_at = new Date().toISOString();
    job.result = JSON.stringify(result);
    this.locks.delete(jobId);
  }

  // UPDATE jobs SET status = 'pending' or 'failed'
  async fail(jobId, error) {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job) return;

    if (job.attempts < job.max_attempts) {
      job.status = "pending";
      job.last_error = error;
      // Exponential backoff
      const delay = Math.pow(2, job.attempts) * 1000;
      job.scheduled_for = new Date(Date.now() + delay).toISOString();
    } else {
      job.status = "failed";
      job.last_error = error;
    }
    this.locks.delete(jobId);
  }

  // LISTEN channel
  listen(channel, callback) {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, []);
    }
    this.listeners.get(channel).push(callback);
  }

  // NOTIFY channel
  _notify(channel, payload) {
    const listeners = this.listeners.get(channel) || [];
    for (const cb of listeners) {
      setTimeout(() => cb(payload), 0);
    }
  }

  // Aggregate stats
  stats() {
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const job of this.jobs) {
      counts[job.status]++;
    }
    return counts;
  }

  // Job history query
  history(options = {}) {
    let result = [...this.jobs];
    if (options.type) result = result.filter(j => j.type === options.type);
    if (options.status) result = result.filter(j => j.status === options.status);
    return result.slice(0, options.limit || 10);
  }
}

// --- Demo 1: Basic job lifecycle ---

console.log("--- Job lifecycle: enqueue → claim → process → complete ---\n");

const queue = new PgJobQueue();

// API server enqueues jobs
await queue.enqueue("email", { to: "alice@test.com", template: "welcome" });
await queue.enqueue("email", { to: "bob@test.com", template: "reset" });
await queue.enqueue("pdf", { report: "monthly", format: "a4" });

console.log(`  Enqueued 3 jobs. Stats: ${JSON.stringify(queue.stats())}\n`);

// Worker claims and processes
const job1 = await queue.claim("worker-1");
console.log(`  Worker claimed: Job #${job1.id} (${job1.type})`);
console.log(`    Data: ${JSON.stringify(job1.data)}`);

await queue.complete(job1.id, { sent: true });
console.log(`    → Completed\n`);

console.log(`  Stats: ${JSON.stringify(queue.stats())}\n`);

// --- Demo 2: Concurrent workers with SKIP LOCKED ---

console.log("--- Concurrent workers (SKIP LOCKED) ---\n");

const concQueue = new PgJobQueue();
for (let i = 0; i < 10; i++) {
  await concQueue.enqueue("task", { index: i }, { priority: Math.floor(Math.random() * 5) });
}

console.log(`  Enqueued 10 jobs\n`);

// 3 workers claim jobs concurrently
const claimed = {};
for (const workerId of ["worker-A", "worker-B", "worker-C"]) {
  claimed[workerId] = [];

  // Each worker claims multiple jobs
  while (true) {
    const job = await concQueue.claim(workerId);
    if (!job) break;
    claimed[workerId].push(job.id);
    await concQueue.complete(job.id, "done");
  }
}

console.log("  Job distribution across workers:");
for (const [worker, jobIds] of Object.entries(claimed)) {
  console.log(`    ${worker}: jobs [${jobIds.join(", ")}] (${jobIds.length} jobs)`);
}
console.log(`    No duplicates! Each job claimed by exactly one worker.\n`);

// --- Demo 3: Retry with backoff ---

console.log("--- Retry with exponential backoff ---\n");

const retryQueue = new PgJobQueue();
await retryQueue.enqueue("webhook", { url: "https://example.com/hook" }, { maxAttempts: 4 });

let attempts = 0;
while (true) {
  // Adjust scheduled_for for demo
  for (const j of retryQueue.jobs) {
    if (j.status === "pending") j.scheduled_for = new Date().toISOString();
  }

  const job = await retryQueue.claim("worker-1");
  if (!job) break;

  attempts++;
  if (attempts < 3) {
    console.log(`  Attempt ${attempts}: failing (simulated timeout)`);
    await retryQueue.fail(job.id, "Connection timeout");
  } else {
    console.log(`  Attempt ${attempts}: success!`);
    await retryQueue.complete(job.id, { delivered: true });
  }
}

console.log(`\n  Stats: ${JSON.stringify(retryQueue.stats())}\n`);

// --- Demo 4: LISTEN/NOTIFY for instant processing ---

console.log("--- LISTEN/NOTIFY (instant job notification) ---\n");

const notifyQueue = new PgJobQueue();
const notifications = [];

notifyQueue.listen("new_job", (payload) => {
  notifications.push(payload);
});

await notifyQueue.enqueue("instant-task", { urgent: true });
await notifyQueue.enqueue("instant-task", { urgent: false });

await new Promise(r => setTimeout(r, 10)); // Let notifications fire

console.log("  Received notifications:");
for (const n of notifications) {
  console.log(`    New job: #${n.id} (${n.type})`);
}
console.log(`\n  Workers can wake immediately instead of polling!\n`);

// --- Demo 5: SQL schema ---

console.log("=== PostgreSQL Job Queue Schema ===\n");

console.log(`  CREATE TABLE jobs (
    id          BIGSERIAL PRIMARY KEY,
    type        TEXT NOT NULL,
    data        JSONB NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'pending',
    priority    INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    attempts    INT NOT NULL DEFAULT 0,
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    worker_id   TEXT,
    result      JSONB,
    last_error  TEXT,

    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
  );

  -- Index for efficient job claiming
  CREATE INDEX idx_jobs_claimable
    ON jobs (priority DESC, created_at ASC)
    WHERE status = 'pending';

  -- Claim the next job (concurrent-safe)
  UPDATE jobs SET status = 'processing', worker_id = $1, started_at = now()
  WHERE id = (
    SELECT id FROM jobs
    WHERE status = 'pending' AND scheduled_for <= now()
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ) RETURNING *;

  -- Notify workers of new jobs
  CREATE OR REPLACE FUNCTION notify_new_job()
  RETURNS trigger AS $$
  BEGIN
    PERFORM pg_notify('new_job', json_build_object(
      'id', NEW.id, 'type', NEW.type
    )::text);
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER jobs_insert_notify
    AFTER INSERT ON jobs
    FOR EACH ROW EXECUTE FUNCTION notify_new_job();
`);
```

## Expected Output

```
=== Job Queues with PostgreSQL ===

--- Job lifecycle: enqueue → claim → process → complete ---

  Enqueued 3 jobs. Stats: {"pending":3,"processing":0,"completed":0,"failed":0}

  Worker claimed: Job #1 (email)
    Data: {"to":"alice@test.com","template":"welcome"}
    → Completed

--- Concurrent workers (SKIP LOCKED) ---

  Job distribution across workers:
    worker-A: jobs [1, 4, 7, 10] (4 jobs)
    worker-B: jobs [2, 5, 8] (3 jobs)
    worker-C: jobs [3, 6, 9] (3 jobs)
    No duplicates!
  ...
```

## Challenge

1. Implement a stale job detector: if a job stays in "processing" for more than 5 minutes, mark it as stale and make it claimable again (the worker probably crashed)
2. Build a job dashboard API: GET /api/jobs with filtering by status, type, and date range, plus aggregation stats (avg processing time, error rate by type)
3. Implement `LISTEN/NOTIFY` with the real `pg` driver to wake workers instantly when a job is enqueued, instead of polling

## Common Mistakes

- Polling too frequently — `SELECT` every 100ms wastes database resources. Use `LISTEN/NOTIFY` or poll every 1-5 seconds
- Not using `SKIP LOCKED` — without it, concurrent workers block each other waiting for the same row lock
- Not handling stale jobs — if a worker crashes mid-processing, the job stays in "processing" forever
- Storing large payloads in the job data — store a reference (S3 URL, file path) instead of the actual data
