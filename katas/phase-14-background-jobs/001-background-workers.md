---
id: background-workers
phase: 14
phase_title: Background Jobs & Async Systems
sequence: 1
title: Background Workers
difficulty: advanced
tags: [background, workers, queue, async, jobs]
prerequisites: [horizontal-scaling]
estimated_minutes: 15
---

## Concept

Not all work should happen in the request/response cycle. Background workers handle tasks that are:

- **Slow** — sending emails, generating PDFs, resizing images
- **Unreliable** — calling external APIs that may be down
- **Scheduled** — daily reports, cleanup tasks, data aggregation
- **Best-effort** — analytics, logging to external services

**The pattern:**
```
HTTP Request → Enqueue Job → Return 202 Accepted
                    ↓
              Job Queue (Redis/DB)
                    ↓
              Worker Process → Process Job → Done
```

The API server enqueues work and responds immediately. A separate worker process picks up jobs and processes them at its own pace. This decouples the API's response time from the work's processing time.

**Why separate workers?**
1. API stays fast — no long-running tasks blocking responses
2. Retry independently — failed jobs retry without the user waiting
3. Scale independently — add more workers without more API servers
4. Crash isolation — a worker crash doesn't affect the API

## Key Insight

> The job queue is the contract between the API and the worker. The API's only job is to validate the request, enqueue the work, and return 202 Accepted. The worker's only job is to pick up jobs, process them, and mark them done. Neither knows about the other's internals. This separation lets you deploy, scale, and debug them independently.

## Experiment

```js
console.log("=== Background Workers ===\n");

// --- Build a simple in-memory job queue ---

class JobQueue {
  constructor(name) {
    this.name = name;
    this.pending = [];
    this.processing = new Map();
    this.completed = [];
    this.failed = [];
    this.nextId = 1;
    this.listeners = { job: [] };
  }

  enqueue(type, data, options = {}) {
    const job = {
      id: this.nextId++,
      type,
      data,
      priority: options.priority || 0,
      maxRetries: options.maxRetries || 3,
      attempts: 0,
      status: "pending",
      createdAt: Date.now(),
      scheduledFor: options.delay ? Date.now() + options.delay : Date.now(),
    };

    this.pending.push(job);
    // Sort by priority (higher first), then by scheduledFor
    this.pending.sort((a, b) => b.priority - a.priority || a.scheduledFor - b.scheduledFor);

    this._notify();
    return job;
  }

  dequeue() {
    const now = Date.now();
    const idx = this.pending.findIndex(j => j.scheduledFor <= now);
    if (idx === -1) return null;

    const job = this.pending.splice(idx, 1)[0];
    job.status = "processing";
    job.startedAt = Date.now();
    job.attempts++;
    this.processing.set(job.id, job);
    return job;
  }

  complete(jobId, result) {
    const job = this.processing.get(jobId);
    if (!job) return;
    job.status = "completed";
    job.completedAt = Date.now();
    job.result = result;
    job.duration = job.completedAt - job.startedAt;
    this.processing.delete(jobId);
    this.completed.push(job);
  }

  fail(jobId, error) {
    const job = this.processing.get(jobId);
    if (!job) return;

    if (job.attempts < job.maxRetries) {
      // Re-enqueue with exponential backoff
      job.status = "pending";
      job.scheduledFor = Date.now() + Math.pow(2, job.attempts) * 1000;
      job.lastError = error;
      this.processing.delete(jobId);
      this.pending.push(job);
      this.pending.sort((a, b) => b.priority - a.priority || a.scheduledFor - b.scheduledFor);
    } else {
      job.status = "failed";
      job.failedAt = Date.now();
      job.lastError = error;
      this.processing.delete(jobId);
      this.failed.push(job);
    }
  }

  on(event, fn) {
    this.listeners[event]?.push(fn);
  }

  _notify() {
    for (const fn of this.listeners.job) fn();
  }

  getStats() {
    return {
      pending: this.pending.length,
      processing: this.processing.size,
      completed: this.completed.length,
      failed: this.failed.length,
    };
  }
}

// --- Build a worker that processes jobs ---

class Worker {
  constructor(queue, handlers) {
    this.queue = queue;
    this.handlers = handlers;
    this.running = false;
    this.processed = 0;
  }

  async start() {
    this.running = true;
    while (this.running) {
      const job = this.queue.dequeue();

      if (!job) {
        // No jobs available, wait
        await new Promise(r => setTimeout(r, 50));
        continue;
      }

      const handler = this.handlers[job.type];
      if (!handler) {
        this.queue.fail(job.id, `No handler for type: ${job.type}`);
        continue;
      }

      try {
        const result = await handler(job.data);
        this.queue.complete(job.id, result);
        this.processed++;
      } catch (err) {
        this.queue.fail(job.id, err.message);
      }
    }
  }

  stop() {
    this.running = false;
  }
}

// --- Demo 1: Basic job processing ---

console.log("--- Basic job queue ---\n");

const queue = new JobQueue("tasks");

// Define job handlers
const handlers = {
  "send-email": async (data) => {
    await new Promise(r => setTimeout(r, 10)); // Simulate sending
    return { sent: true, to: data.to };
  },
  "resize-image": async (data) => {
    await new Promise(r => setTimeout(r, 20)); // Simulate processing
    return { resized: true, size: data.size };
  },
  "generate-report": async (data) => {
    await new Promise(r => setTimeout(r, 30)); // Simulate generation
    return { pages: 5, format: data.format };
  },
};

// Enqueue jobs (like an API would)
console.log("  Enqueuing jobs (API side):\n");

const jobs = [
  queue.enqueue("send-email", { to: "alice@example.com", subject: "Welcome!" }),
  queue.enqueue("resize-image", { path: "/uploads/photo.jpg", size: "thumbnail" }),
  queue.enqueue("generate-report", { format: "pdf", month: "January" }),
  queue.enqueue("send-email", { to: "bob@example.com", subject: "Notification" }),
  queue.enqueue("resize-image", { path: "/uploads/banner.png", size: "medium" }),
];

for (const job of jobs) {
  console.log(`    Job #${job.id}: ${job.type} → status: ${job.status}`);
}

console.log(`\n  Queue stats: ${JSON.stringify(queue.getStats())}\n`);

// Start worker
console.log("  Starting worker...\n");
const worker = new Worker(queue, handlers);
const workerPromise = worker.start();

// Wait for all jobs to complete
await new Promise(resolve => {
  const check = setInterval(() => {
    if (queue.pending.length === 0 && queue.processing.size === 0) {
      clearInterval(check);
      worker.stop();
      resolve();
    }
  }, 50);
});

await workerPromise;

console.log("  Completed jobs:\n");
for (const job of queue.completed) {
  console.log(`    Job #${job.id}: ${job.type} — ${job.duration}ms — ${JSON.stringify(job.result)}`);
}

console.log(`\n  Queue stats: ${JSON.stringify(queue.getStats())}\n`);

// --- Demo 2: Retry on failure ---

console.log("--- Retry on failure ---\n");

const retryQueue = new JobQueue("retries");

let callCount = 0;
const retryHandlers = {
  "flaky-api": async (data) => {
    callCount++;
    if (callCount < 3) {
      throw new Error(`API timeout (attempt ${callCount})`);
    }
    return { success: true, attempts: callCount };
  },
};

retryQueue.enqueue("flaky-api", { url: "https://external.api/webhook" }, { maxRetries: 5 });

const retryWorker = new Worker(retryQueue, retryHandlers);
const retryPromise = retryWorker.start();

// Wait for processing (need shorter waits since retry delays are simulated)
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 100));
  if (retryQueue.pending.length === 0 && retryQueue.processing.size === 0) break;
  // Manually adjust scheduledFor for demo (normally would wait for backoff)
  for (const job of retryQueue.pending) {
    job.scheduledFor = Date.now();
  }
}

retryWorker.stop();
await retryPromise;

if (retryQueue.completed.length > 0) {
  const job = retryQueue.completed[0];
  console.log(`  Job completed after ${job.attempts} attempts`);
  console.log(`  Result: ${JSON.stringify(job.result)}\n`);
} else if (retryQueue.failed.length > 0) {
  const job = retryQueue.failed[0];
  console.log(`  Job failed after ${job.attempts} attempts`);
  console.log(`  Error: ${job.lastError}\n`);
}

// --- Demo 3: Priority queue ---

console.log("--- Priority-based processing ---\n");

const priorityQueue = new JobQueue("priority");

priorityQueue.enqueue("task", { name: "low-priority" }, { priority: 0 });
priorityQueue.enqueue("task", { name: "high-priority" }, { priority: 10 });
priorityQueue.enqueue("task", { name: "medium-priority" }, { priority: 5 });
priorityQueue.enqueue("task", { name: "critical" }, { priority: 100 });
priorityQueue.enqueue("task", { name: "normal" }, { priority: 1 });

const order = [];
while (true) {
  const job = priorityQueue.dequeue();
  if (!job) break;
  order.push(job.data.name);
  priorityQueue.complete(job.id, "done");
}

console.log("  Processing order (highest priority first):");
for (let i = 0; i < order.length; i++) {
  console.log(`    ${i + 1}. ${order[i]}`);
}

// --- Demo 4: API integration pattern ---

console.log("\n=== API Integration Pattern ===\n");

console.log(`  // API endpoint — enqueue and return immediately
  router.post('/api/reports', async (req, res) => {
    const { format, dateRange } = req.body;

    const job = await queue.enqueue('generate-report', {
      format,
      dateRange,
      requestedBy: req.userId,
    });

    res.status(202).json({
      jobId: job.id,
      status: 'queued',
      statusUrl: \`/api/jobs/\${job.id}\`,
    });
  });

  // Status endpoint — check job progress
  router.get('/api/jobs/:id', async (req, res) => {
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json({
      id: job.id,
      status: job.status,
      result: job.status === 'completed' ? job.result : undefined,
      error: job.status === 'failed' ? job.lastError : undefined,
    });
  });
`);
```

## Expected Output

```
=== Background Workers ===

--- Basic job queue ---

  Enqueuing jobs (API side):

    Job #1: send-email → status: pending
    Job #2: resize-image → status: pending
    Job #3: generate-report → status: pending
    ...

  Queue stats: {"pending":5,"processing":0,"completed":0,"failed":0}

  Starting worker...

  Completed jobs:

    Job #1: send-email — 10ms — {"sent":true,"to":"alice@example.com"}
    ...

--- Retry on failure ---

  Job completed after 3 attempts
  Result: {"success":true,"attempts":3}
  ...
```

## Challenge

1. Implement a dead-letter queue: after a job fails all retries, move it to a DLQ for manual inspection. Build an admin endpoint that lists DLQ jobs and allows retry
2. Build a job scheduler that runs recurring jobs (e.g., "every 5 minutes") using `setInterval` with drift correction — ensure jobs don't overlap if one takes longer than the interval
3. How would you implement job progress tracking? The worker reports progress (10%, 50%, 90%), and the API endpoint returns the current progress to the client

## Common Mistakes

- Processing slow tasks in the request handler — the client times out waiting for a response
- Not implementing retries — external services fail temporarily. Without retry, every transient failure becomes permanent
- Retrying non-idempotent operations — sending an email twice is a bug. Make operations idempotent or deduplicate
- Using in-memory queues in production — if the process restarts, all pending jobs are lost. Use Redis or a database
