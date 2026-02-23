---
id: idempotency
phase: 14
phase_title: Background Jobs & Async Systems
sequence: 4
title: Idempotency
difficulty: advanced
tags: [idempotency, idempotency-key, deduplication, at-least-once, exactly-once]
prerequisites: [retry-strategies]
estimated_minutes: 15
---

## Concept

An operation is **idempotent** if performing it multiple times produces the same result as performing it once.

**Why idempotency matters:**
- Retries happen (network failures, timeouts, crashes)
- Message queues deliver "at least once" — duplicates are expected
- Users double-click buttons
- Load balancers retry on 502/503

**Naturally idempotent operations:**
- `SET x = 5` — always results in x being 5
- `DELETE FROM orders WHERE id = 123` — deleting twice is fine
- `PUT /users/42 { name: "Alice" }` — replaces the whole resource

**NOT naturally idempotent:**
- `x = x + 1` — incrementing twice gives the wrong result
- `INSERT INTO orders (...)` — creates duplicate rows
- `POST /payments { amount: 100 }` — charges twice
- `balance -= amount` — deducts twice

**Making non-idempotent operations idempotent:**
1. **Idempotency key** — client sends a unique key; server deduplicates
2. **Conditional writes** — `UPDATE ... WHERE version = N` (optimistic locking)
3. **Deduplication table** — track processed operation IDs in a separate table
4. **Natural keys** — use business-meaningful unique constraints

## Key Insight

> The idempotency key pattern works like this: the client generates a UUID for each logical operation and sends it with every request (including retries). The server stores this key alongside the result. On retry, the server finds the existing key, skips the operation, and returns the stored result. The key insight is that the idempotency check and the operation MUST happen in the same database transaction — otherwise a crash between the check and the operation creates a window where duplicates slip through.

## Experiment

```js
console.log("=== Idempotency ===\n");

// --- Demo 1: The problem — non-idempotent operations ---

console.log("--- The duplicate problem ---\n");

class NaivePaymentService {
  constructor() {
    this.balance = 1000;
    this.payments = [];
  }

  processPayment(userId, amount) {
    this.balance -= amount;
    this.payments.push({ userId, amount, time: Date.now() });
    return { success: true, newBalance: this.balance };
  }
}

const naive = new NaivePaymentService();

// Client sends payment
naive.processPayment("user-1", 100);
console.log(`  After first payment:  balance = $${naive.balance}`);

// Network timeout — client retries the SAME payment
naive.processPayment("user-1", 100);
console.log(`  After retry (dup):    balance = $${naive.balance}`);

// User double-clicks
naive.processPayment("user-1", 100);
console.log(`  After double-click:   balance = $${naive.balance}`);

console.log(`  Expected balance: $900, Actual: $${naive.balance} ← $${900 - naive.balance} lost!\n`);

// --- Demo 2: Idempotency key pattern ---

console.log("--- Idempotency key pattern ---\n");

class IdempotentPaymentService {
  constructor() {
    this.balance = 1000;
    this.payments = [];
    this.processedKeys = new Map(); // idempotency_key → result
  }

  processPayment(idempotencyKey, userId, amount) {
    // Check if we've already processed this key
    if (this.processedKeys.has(idempotencyKey)) {
      const cached = this.processedKeys.get(idempotencyKey);
      return { ...cached, duplicate: true };
    }

    // Process the payment
    this.balance -= amount;
    const result = {
      success: true,
      newBalance: this.balance,
      paymentId: `pay_${this.payments.length + 1}`,
    };

    this.payments.push({ idempotencyKey, userId, amount });
    this.processedKeys.set(idempotencyKey, result);

    return { ...result, duplicate: false };
  }
}

const safe = new IdempotentPaymentService();

// Client generates a key for this logical operation
const paymentKey = "pay-key-abc-123";

const r1 = safe.processPayment(paymentKey, "user-1", 100);
console.log(`  First request:  balance=$${r1.newBalance}, duplicate=${r1.duplicate}`);

// Same key = same result, no side effects
const r2 = safe.processPayment(paymentKey, "user-1", 100);
console.log(`  Retry (same key): balance=$${r2.newBalance}, duplicate=${r2.duplicate}`);

const r3 = safe.processPayment(paymentKey, "user-1", 100);
console.log(`  Double-click:   balance=$${r3.newBalance}, duplicate=${r3.duplicate}`);

// Different key = different payment
const r4 = safe.processPayment("pay-key-def-456", "user-1", 50);
console.log(`  New payment:    balance=$${r4.newBalance}, duplicate=${r4.duplicate}`);

console.log(`\n  Payments processed: ${safe.payments.length} (not ${3 + 1})`);

// --- Demo 3: Database-backed idempotency ---

console.log("\n--- Database-backed idempotency (SQL pattern) ---\n");

class SimulatedDB {
  constructor() {
    this.tables = {
      idempotency_keys: [],
      payments: [],
      accounts: [{ id: 1, balance: 1000 }],
    };
    this.log = [];
  }

  async transaction(fn) {
    // Simulate a database transaction
    const snapshot = JSON.parse(JSON.stringify(this.tables));
    try {
      const result = await fn(this);
      this.log.push({ status: "committed" });
      return result;
    } catch (err) {
      this.tables = snapshot; // Rollback
      this.log.push({ status: "rolled-back", error: err.message });
      throw err;
    }
  }

  findIdempotencyKey(key) {
    return this.tables.idempotency_keys.find(r => r.key === key);
  }

  insertIdempotencyKey(key, result) {
    this.tables.idempotency_keys.push({
      key,
      result: JSON.stringify(result),
      created_at: new Date().toISOString(),
    });
  }

  updateBalance(accountId, amount) {
    const account = this.tables.accounts.find(a => a.id === accountId);
    if (!account) throw new Error("Account not found");
    account.balance -= amount;
    return account.balance;
  }

  insertPayment(payment) {
    this.tables.payments.push(payment);
  }
}

async function processPaymentSafely(db, idempotencyKey, accountId, amount) {
  return db.transaction(async (tx) => {
    // Step 1: Check idempotency key (inside transaction!)
    const existing = tx.findIdempotencyKey(idempotencyKey);
    if (existing) {
      return { ...JSON.parse(existing.result), duplicate: true };
    }

    // Step 2: Process payment
    const newBalance = tx.updateBalance(accountId, amount);
    const paymentId = `pay_${Date.now()}`;
    tx.insertPayment({ id: paymentId, accountId, amount });

    // Step 3: Store idempotency key with result (same transaction!)
    const result = { success: true, paymentId, newBalance };
    tx.insertIdempotencyKey(idempotencyKey, result);

    return { ...result, duplicate: false };
  });
}

const db = new SimulatedDB();
const key = "idem-key-001";

const res1 = await processPaymentSafely(db, key, 1, 100);
console.log(`  First:  balance=$${res1.newBalance}, dup=${res1.duplicate}`);

const res2 = await processPaymentSafely(db, key, 1, 100);
console.log(`  Retry:  balance=$${res2.newBalance}, dup=${res2.duplicate}`);

const res3 = await processPaymentSafely(db, "idem-key-002", 1, 50);
console.log(`  New op: balance=$${res3.newBalance}, dup=${res3.duplicate}`);

console.log(`\n  DB state:`);
console.log(`    Payments: ${db.tables.payments.length}`);
console.log(`    Idempotency keys: ${db.tables.idempotency_keys.length}`);
console.log(`    Account balance: $${db.tables.accounts[0].balance}`);

// --- Demo 4: Conditional writes (optimistic locking) ---

console.log("\n--- Conditional writes (optimistic locking) ---\n");

class VersionedDocument {
  constructor(id, data) {
    this.id = id;
    this.data = data;
    this.version = 1;
    this.log = [];
  }

  update(newData, expectedVersion) {
    if (this.version !== expectedVersion) {
      this.log.push({
        status: "conflict",
        expected: expectedVersion,
        actual: this.version,
      });
      return { success: false, error: "version_conflict" };
    }

    this.data = { ...this.data, ...newData };
    this.version++;
    this.log.push({ status: "updated", version: this.version });
    return { success: true, version: this.version };
  }
}

// SQL equivalent:
// UPDATE documents SET data = $1, version = version + 1
// WHERE id = $2 AND version = $3
// RETURNING version

const doc = new VersionedDocument("doc-1", { title: "Draft" });

// Two clients read version 1 simultaneously
const clientAVersion = doc.version;
const clientBVersion = doc.version;

// Client A updates successfully
const updateA = doc.update({ title: "Final" }, clientAVersion);
console.log(`  Client A: ${updateA.success ? "updated" : "conflict"} → version ${updateA.version || doc.version}`);

// Client B tries with stale version — conflict!
const updateB = doc.update({ title: "Other" }, clientBVersion);
console.log(`  Client B: ${updateB.success ? "updated" : "conflict"} → ${updateB.error || "ok"}`);

// Client B retries with fresh version
const updateB2 = doc.update({ title: "Other" }, doc.version);
console.log(`  Client B retry: ${updateB2.success ? "updated" : "conflict"} → version ${updateB2.version}`);

// --- Demo 5: Natural deduplication keys ---

console.log("\n--- Natural deduplication keys ---\n");

const examples = [
  {
    operation: "Process webhook event",
    key: "webhook event ID from provider",
    example: "evt_1234567890 (from Stripe)",
  },
  {
    operation: "Send daily report",
    key: "report type + date",
    example: "daily-sales:2024-01-15",
  },
  {
    operation: "Import CSV row",
    key: "file hash + row number",
    example: "sha256(file):row-42",
  },
  {
    operation: "Process order",
    key: "order ID from client",
    example: "order-2024-001",
  },
  {
    operation: "Sync external data",
    key: "source + external ID + timestamp",
    example: "crm:contact-789:2024-01-15",
  },
];

console.log(`  ${"Operation".padEnd(25)} ${"Key Strategy".padEnd(35)} Example`);
console.log(`  ${"-".repeat(90)}`);
for (const { operation, key, example } of examples) {
  console.log(`  ${operation.padEnd(25)} ${key.padEnd(35)} ${example}`);
}

// --- Demo 6: Key expiry ---

console.log("\n--- Idempotency key lifecycle ---\n");

class IdempotencyStore {
  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.keys = new Map();
    this.ttlMs = ttlMs;
  }

  check(key) {
    const entry = this.keys.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.keys.delete(key);
      return null;
    }

    return entry.result;
  }

  store(key, result) {
    this.keys.set(key, { result, createdAt: Date.now() });
  }

  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.keys) {
      if (now - entry.createdAt > this.ttlMs) {
        this.keys.delete(key);
        removed++;
      }
    }
    return removed;
  }

  size() {
    return this.keys.size;
  }
}

const store = new IdempotencyStore(100); // 100ms TTL for demo

store.store("key-1", { ok: true });
store.store("key-2", { ok: true });
console.log(`  Stored: ${store.size()} keys`);
console.log(`  Check key-1: ${store.check("key-1") ? "found" : "missing"}`);

// Wait for expiry
await new Promise(r => setTimeout(r, 150));

console.log(`  After 150ms: ${store.check("key-1") ? "found" : "expired"}`);
const cleaned = store.cleanup();
console.log(`  Cleanup removed: ${cleaned} expired keys`);

// --- Best practices ---

console.log("\n=== Idempotency Best Practices ===\n");

const practices = [
  ["Client generates the key", "Server can't know if it's a retry or new request"],
  ["Use UUIDv4 for keys", "Globally unique, no coordination needed"],
  ["Store key + result together", "Return the original result on duplicates"],
  ["Same DB transaction", "Key check and operation must be atomic"],
  ["Set key TTL (24-48h)", "Don't store keys forever — they accumulate"],
  ["Return same status code", "A duplicate should return the original response"],
  ["Log duplicates", "High duplicate rates reveal client/network issues"],
];

for (const [practice, reason] of practices) {
  console.log(`  ${practice}`);
  console.log(`    → ${reason}\n`);
}
```

## Expected Output

```
=== Idempotency ===

--- The duplicate problem ---

  After first payment:  balance = $900
  After retry (dup):    balance = $800
  After double-click:   balance = $700
  Expected balance: $900, Actual: $700 ← $200 lost!

--- Idempotency key pattern ---

  First request:  balance=$900, duplicate=false
  Retry (same key): balance=$900, duplicate=true
  Double-click:   balance=$900, duplicate=true
  New payment:    balance=$850, duplicate=false

  Payments processed: 2 (not 4)

--- Database-backed idempotency (SQL pattern) ---

  First:  balance=$900, dup=false
  Retry:  balance=$900, dup=true
  New op: balance=$850, dup=false
  ...
```

## Challenge

1. Implement idempotent API endpoints: `POST /payments` with an `Idempotency-Key` header. Store keys in PostgreSQL with a UNIQUE constraint and TTL. Return the cached response for duplicates with the same status code
2. Build a webhook processor that handles Stripe-style events: use the event ID as a natural deduplication key, process events exactly once even under concurrent delivery
3. What happens if the server crashes AFTER processing the payment but BEFORE storing the idempotency key? How does a two-phase approach (pending → completed) solve this?

## Common Mistakes

- Checking the idempotency key outside the transaction — a crash between check and operation allows duplicates
- Using server-generated keys — only the client knows if it's a retry or a new request
- Never expiring keys — idempotency keys accumulate forever and slow down lookups
- Returning different responses for duplicates — the client expects the same result it would have gotten originally
