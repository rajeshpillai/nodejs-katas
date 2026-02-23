---
id: failure-modes
phase: 14
phase_title: Background Jobs & Async Systems
sequence: 5
title: Failure Modes
difficulty: advanced
tags: [failure, poison-pill, dead-letter, timeout, partial-failure, compensation]
prerequisites: [idempotency]
estimated_minutes: 15
---

## Concept

Background jobs fail in ways that HTTP requests don't. Understanding failure modes is the difference between a system that recovers and one that silently loses work.

**Failure categories:**

1. **Transient failures** — temporary, will succeed on retry
   - Network timeout, database connection dropped, 503 from external API

2. **Permanent failures** — will never succeed no matter how many retries
   - Invalid data, missing resource, business rule violation

3. **Poison pill** — a job that crashes the worker every time it runs
   - Triggers an unhandled exception, causes OOM, hits an infinite loop

4. **Partial failure** — some steps succeeded, others didn't
   - Payment charged but email not sent, order created but inventory not decremented

5. **Timeout failure** — job takes too long
   - Large file processing, external API hangs, deadlocked query

**Recovery strategies:**

| Failure | Strategy |
|---------|----------|
| Transient | Retry with backoff |
| Permanent | Move to dead-letter queue, alert |
| Poison pill | Detect crash loop, quarantine |
| Partial | Compensation (undo completed steps) |
| Timeout | Kill and retry with longer timeout, or break into smaller jobs |

## Key Insight

> A dead-letter queue (DLQ) is where jobs go to die gracefully. After N retries, instead of discarding a failed job or retrying forever, you move it to a separate queue for human inspection. This is essential because some failures need human judgment — a payment that fails with "insufficient funds" needs a customer notification, not another retry. The DLQ preserves the job data, error history, and context so an operator can diagnose the issue, fix the root cause, and re-enqueue the job.

## Experiment

```js
console.log("=== Failure Modes ===\n");

// --- Job processing infrastructure ---

class Job {
  constructor(id, type, data, options = {}) {
    this.id = id;
    this.type = type;
    this.data = data;
    this.attempts = 0;
    this.maxAttempts = options.maxAttempts || 3;
    this.errors = [];
    this.status = "pending";
    this.createdAt = Date.now();
    this.timeout = options.timeout || 5000;
  }
}

class RobustJobProcessor {
  constructor() {
    this.handlers = new Map();
    this.queue = [];
    this.deadLetterQueue = [];
    this.completedJobs = [];
    this.log = [];
  }

  register(type, handler) {
    this.handlers.set(type, handler);
  }

  enqueue(job) {
    this.queue.push(job);
  }

  async processOne(job) {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = "dead-letter";
      job.errors.push({ attempt: job.attempts, error: `No handler for type: ${job.type}` });
      this.deadLetterQueue.push(job);
      this.log.push({ jobId: job.id, action: "dead-letter", reason: "no handler" });
      return;
    }

    job.attempts++;
    job.status = "processing";

    try {
      // Run with timeout
      const result = await Promise.race([
        handler(job.data),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("JOB_TIMEOUT")), Math.min(job.timeout, 100))
        ),
      ]);

      job.status = "completed";
      this.completedJobs.push(job);
      this.log.push({ jobId: job.id, action: "completed", attempts: job.attempts });
    } catch (err) {
      job.errors.push({
        attempt: job.attempts,
        error: err.message,
        time: new Date().toISOString(),
      });

      if (this.isPermanentError(err)) {
        // Permanent failure — don't retry
        job.status = "dead-letter";
        this.deadLetterQueue.push(job);
        this.log.push({ jobId: job.id, action: "dead-letter", reason: err.message });
      } else if (job.attempts >= job.maxAttempts) {
        // Max retries exhausted
        job.status = "dead-letter";
        this.deadLetterQueue.push(job);
        this.log.push({ jobId: job.id, action: "dead-letter", reason: "max retries" });
      } else {
        // Transient failure — retry
        job.status = "pending";
        this.queue.push(job);
        this.log.push({ jobId: job.id, action: "retry", attempt: job.attempts });
      }
    }
  }

  isPermanentError(err) {
    const permanent = ["VALIDATION_ERROR", "NOT_FOUND", "INVALID_DATA", "DUPLICATE"];
    return permanent.some(code => err.message.includes(code));
  }

  async processAll() {
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      await this.processOne(job);
    }
  }

  getStats() {
    return {
      completed: this.completedJobs.length,
      deadLetter: this.deadLetterQueue.length,
      pending: this.queue.length,
    };
  }
}

// --- Demo 1: Transient vs permanent failures ---

console.log("--- Transient vs permanent failures ---\n");

const processor = new RobustJobProcessor();

let transientCount = 0;
processor.register("send-email", async (data) => {
  transientCount++;
  if (transientCount <= 2) {
    throw new Error("SMTP connection timeout"); // Transient — will retry
  }
  return { sent: true, to: data.to };
});

processor.register("validate-order", async (data) => {
  if (!data.productId) {
    throw new Error("VALIDATION_ERROR: productId is required"); // Permanent — won't retry
  }
  return { valid: true };
});

// Transient failure — retries until success
processor.enqueue(new Job("job-1", "send-email", { to: "user@example.com" }, { maxAttempts: 5 }));

// Permanent failure — goes to DLQ immediately
processor.enqueue(new Job("job-2", "validate-order", { productId: null }, { maxAttempts: 5 }));

await processor.processAll();

console.log("  Job results:");
for (const entry of processor.log) {
  console.log(`    ${entry.jobId}: ${entry.action}${entry.reason ? ` (${entry.reason})` : ""}`);
}

const stats = processor.getStats();
console.log(`\n  Stats: completed=${stats.completed}, dead-letter=${stats.deadLetter}`);

// --- Demo 2: Poison pill detection ---

console.log("\n--- Poison pill detection ---\n");

class PoisonPillDetector {
  constructor(options = {}) {
    this.crashThreshold = options.crashThreshold || 3;
    this.windowMs = options.windowMs || 60000;
    this.crashLog = new Map(); // jobId → [timestamps]
    this.quarantine = [];
  }

  recordCrash(jobId) {
    if (!this.crashLog.has(jobId)) {
      this.crashLog.set(jobId, []);
    }
    this.crashLog.get(jobId).push(Date.now());
  }

  isPoisonPill(jobId) {
    const crashes = this.crashLog.get(jobId) || [];
    const now = Date.now();
    const recentCrashes = crashes.filter(t => now - t < this.windowMs);
    return recentCrashes.length >= this.crashThreshold;
  }

  quarantineJob(job) {
    job.status = "quarantined";
    this.quarantine.push({
      job,
      quarantinedAt: new Date().toISOString(),
      crashCount: this.crashLog.get(job.id)?.length || 0,
    });
  }
}

const detector = new PoisonPillDetector({ crashThreshold: 3, windowMs: 10000 });

// Simulate a job that crashes the worker every time
const poisonJob = new Job("poison-1", "process-image", { url: "corrupt-file.jpg" });

for (let i = 0; i < 4; i++) {
  detector.recordCrash(poisonJob.id);
  const isPP = detector.isPoisonPill(poisonJob.id);
  console.log(`  Crash ${i + 1}: isPoisonPill=${isPP}`);

  if (isPP) {
    detector.quarantineJob(poisonJob);
    console.log(`  → Job quarantined after ${i + 1} crashes`);
    break;
  }
}

console.log(`  Quarantined jobs: ${detector.quarantine.length}`);

// --- Demo 3: Partial failure and compensation ---

console.log("\n--- Partial failure and compensation ---\n");

class Saga {
  constructor(name) {
    this.name = name;
    this.steps = [];
    this.completedSteps = [];
    this.log = [];
  }

  addStep(name, execute, compensate) {
    this.steps.push({ name, execute, compensate });
  }

  async run(context) {
    this.log.push({ action: "saga-start", saga: this.name });

    for (const step of this.steps) {
      try {
        this.log.push({ action: "step-start", step: step.name });
        await step.execute(context);
        this.completedSteps.push(step);
        this.log.push({ action: "step-complete", step: step.name });
      } catch (err) {
        this.log.push({ action: "step-failed", step: step.name, error: err.message });

        // Compensate completed steps in reverse order
        this.log.push({ action: "compensating", stepsToUndo: this.completedSteps.length });

        for (const completed of [...this.completedSteps].reverse()) {
          try {
            await completed.compensate(context);
            this.log.push({ action: "compensated", step: completed.name });
          } catch (compErr) {
            this.log.push({
              action: "compensation-failed",
              step: completed.name,
              error: compErr.message,
            });
          }
        }

        return { success: false, failedAt: step.name, error: err.message };
      }
    }

    this.log.push({ action: "saga-complete", saga: this.name });
    return { success: true };
  }
}

// Order processing saga
const orderSaga = new Saga("create-order");

const orderState = {
  paymentCharged: false,
  inventoryReserved: false,
  orderCreated: false,
  emailSent: false,
};

orderSaga.addStep(
  "charge-payment",
  async (ctx) => { orderState.paymentCharged = true; },
  async (ctx) => {
    orderState.paymentCharged = false; // Refund
  }
);

orderSaga.addStep(
  "reserve-inventory",
  async (ctx) => { orderState.inventoryReserved = true; },
  async (ctx) => {
    orderState.inventoryReserved = false; // Release reservation
  }
);

orderSaga.addStep(
  "create-order-record",
  async (ctx) => {
    // Simulate failure!
    throw new Error("Database connection lost");
  },
  async (ctx) => {
    orderState.orderCreated = false;
  }
);

orderSaga.addStep(
  "send-confirmation-email",
  async (ctx) => { orderState.emailSent = true; },
  async (ctx) => { orderState.emailSent = false; }
);

const sagaResult = await orderSaga.run({});
console.log(`  Saga result: ${sagaResult.success ? "success" : "failed"}`);
if (!sagaResult.success) {
  console.log(`  Failed at: ${sagaResult.failedAt} (${sagaResult.error})`);
}

console.log(`\n  State after compensation:`);
for (const [key, value] of Object.entries(orderState)) {
  console.log(`    ${key}: ${value}`);
}

console.log(`\n  Saga log:`);
for (const entry of orderSaga.log) {
  const detail = entry.step ? ` [${entry.step}]` : "";
  const error = entry.error ? ` — ${entry.error}` : "";
  console.log(`    ${entry.action}${detail}${error}`);
}

// --- Demo 4: Dead-letter queue inspection ---

console.log("\n--- Dead-letter queue ---\n");

class DeadLetterQueue {
  constructor() {
    this.jobs = [];
  }

  add(job, reason) {
    this.jobs.push({
      job,
      reason,
      deadLetteredAt: new Date().toISOString(),
    });
  }

  inspect() {
    return this.jobs.map(entry => ({
      id: entry.job.id,
      type: entry.job.type,
      reason: entry.reason,
      attempts: entry.job.attempts,
      errors: entry.job.errors.map(e => e.error),
      data: entry.job.data,
    }));
  }

  retry(jobId) {
    const idx = this.jobs.findIndex(e => e.job.id === jobId);
    if (idx === -1) return null;

    const entry = this.jobs.splice(idx, 1)[0];
    entry.job.status = "pending";
    entry.job.attempts = 0;
    entry.job.errors = [];
    return entry.job;
  }

  purge(olderThanMs) {
    const cutoff = Date.now() - olderThanMs;
    const before = this.jobs.length;
    this.jobs = this.jobs.filter(e =>
      new Date(e.deadLetteredAt).getTime() > cutoff
    );
    return before - this.jobs.length;
  }
}

const dlq = new DeadLetterQueue();

// Add some failed jobs
const failedJob1 = new Job("fail-1", "send-email", { to: "bad-address" });
failedJob1.attempts = 3;
failedJob1.errors = [
  { attempt: 1, error: "SMTP timeout" },
  { attempt: 2, error: "SMTP timeout" },
  { attempt: 3, error: "SMTP timeout" },
];

const failedJob2 = new Job("fail-2", "process-payment", { amount: -100 });
failedJob2.attempts = 1;
failedJob2.errors = [
  { attempt: 1, error: "VALIDATION_ERROR: negative amount" },
];

dlq.add(failedJob1, "max retries exhausted");
dlq.add(failedJob2, "permanent error");

console.log("  Dead-letter queue contents:\n");
for (const entry of dlq.inspect()) {
  console.log(`    Job ${entry.id} (${entry.type}):`);
  console.log(`      Reason: ${entry.reason}`);
  console.log(`      Attempts: ${entry.attempts}`);
  console.log(`      Errors: ${entry.errors.join(", ")}`);
  console.log(`      Data: ${JSON.stringify(entry.data)}`);
  console.log();
}

// Retry a job from the DLQ
const retried = dlq.retry("fail-1");
console.log(`  Retried job: ${retried.id} (attempts reset to ${retried.attempts})`);
console.log(`  DLQ remaining: ${dlq.jobs.length}`);

// --- Demo 5: Failure mode classification ---

console.log("\n--- Failure classification decision tree ---\n");

function classifyFailure(error) {
  // Timeout
  if (error.message.includes("TIMEOUT") || error.message.includes("timeout")) {
    return { type: "timeout", action: "retry with longer timeout" };
  }

  // Rate limited
  if (error.message.includes("429") || error.message.includes("rate limit")) {
    return { type: "rate-limited", action: "retry after Retry-After delay" };
  }

  // Transient
  if (error.message.includes("ECONNREFUSED") || error.message.includes("503") ||
      error.message.includes("ECONNRESET")) {
    return { type: "transient", action: "retry with exponential backoff" };
  }

  // Validation
  if (error.message.includes("VALIDATION") || error.message.includes("400") ||
      error.message.includes("invalid")) {
    return { type: "permanent", action: "dead-letter, alert developer" };
  }

  // Not found
  if (error.message.includes("NOT_FOUND") || error.message.includes("404")) {
    return { type: "permanent", action: "dead-letter, skip" };
  }

  // Auth
  if (error.message.includes("401") || error.message.includes("403")) {
    return { type: "permanent", action: "dead-letter, check credentials" };
  }

  // Unknown
  return { type: "unknown", action: "retry cautiously, dead-letter after N failures" };
}

const testErrors = [
  new Error("ECONNREFUSED: connection refused"),
  new Error("429 Too Many Requests"),
  new Error("JOB_TIMEOUT after 30s"),
  new Error("VALIDATION_ERROR: missing required field"),
  new Error("404 NOT_FOUND: user does not exist"),
  new Error("Something unexpected happened"),
];

console.log(`  ${"Error".padEnd(45)} ${"Type".padEnd(15)} Action`);
console.log(`  ${"-".repeat(95)}`);

for (const err of testErrors) {
  const { type, action } = classifyFailure(err);
  console.log(`  ${err.message.padEnd(45)} ${type.padEnd(15)} ${action}`);
}

// --- Summary ---

console.log("\n=== Failure Handling Checklist ===\n");

const checklist = [
  ["Classify errors", "Separate transient from permanent before retrying"],
  ["Set max retries", "3-5 for API calls, 10+ for background jobs"],
  ["Use dead-letter queues", "Preserve failed jobs for inspection"],
  ["Implement compensation", "Undo completed steps on partial failure"],
  ["Detect poison pills", "Quarantine jobs that crash workers"],
  ["Add timeouts everywhere", "No operation should run unbounded"],
  ["Log failure context", "Include job data, attempt count, and full error"],
  ["Alert on DLQ growth", "Growing DLQ means a systemic problem"],
];

for (const [item, detail] of checklist) {
  console.log(`  ${item}`);
  console.log(`    → ${detail}\n`);
}
```

## Expected Output

```
=== Failure Modes ===

--- Transient vs permanent failures ---

  Job results:
    job-1: retry
    job-1: retry
    job-1: completed
    job-2: dead-letter (VALIDATION_ERROR: productId is required)

  Stats: completed=1, dead-letter=1

--- Poison pill detection ---

  Crash 1: isPoisonPill=false
  Crash 2: isPoisonPill=false
  Crash 3: isPoisonPill=true
  → Job quarantined after 3 crashes
  ...

--- Partial failure and compensation ---

  Saga result: failed
  Failed at: create-order-record (Database connection lost)

  State after compensation:
    paymentCharged: false
    inventoryReserved: false
    orderCreated: false
    emailSent: false
  ...
```

## Challenge

1. Build a robust job processor that: classifies errors, retries transient failures with backoff, dead-letters permanent failures, detects poison pills, and logs everything. Wire it to a PostgreSQL-backed queue
2. Implement the Saga pattern for a multi-step process (e.g., booking a flight: reserve seat → charge payment → send confirmation). Each step must have a compensation action that undoes it on failure
3. How would you handle a job that succeeds in processing but fails to acknowledge completion (the worker crashes after processing but before marking the job as done)? This is the "at least once" delivery problem — how does idempotency solve it?

## Common Mistakes

- Retrying permanent errors — wastes resources and delays other jobs. Classify errors first
- No dead-letter queue — failed jobs silently disappear, and you never learn about systemic issues
- Ignoring partial failures — if step 2 of 4 fails, steps 1's side effects remain. Always plan compensation
- No timeout on jobs — a hanging job blocks the worker forever. Always set execution timeouts
- Not logging enough context — when a job fails at 3am, you need the full picture: input data, error, attempt count, timestamps
