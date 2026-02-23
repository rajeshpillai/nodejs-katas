---
id: transactions
phase: 9
phase_title: PostgreSQL Integration
sequence: 4
title: Transactions
difficulty: intermediate
tags: [postgresql, transactions, acid, isolation, rollback]
prerequisites: [parameterized-queries]
estimated_minutes: 15
---

## Concept

A transaction groups multiple SQL operations into an atomic unit. Either all operations succeed (COMMIT) or all are undone (ROLLBACK). This is the "A" (Atomicity) in ACID.

**Why transactions matter:**

Transfer $100 from Alice to Bob:
```sql
UPDATE accounts SET balance = balance - 100 WHERE user = 'Alice';
UPDATE accounts SET balance = balance + 100 WHERE user = 'Bob';
```

Without a transaction, if the server crashes between these two statements, Alice loses $100 but Bob doesn't receive it. With a transaction, either both happen or neither does.

**ACID properties:**
- **Atomicity** — all or nothing
- **Consistency** — constraints are enforced (balance ≥ 0, foreign keys, etc.)
- **Isolation** — concurrent transactions don't see each other's intermediate states
- **Durability** — committed data survives crashes (it's in the WAL)

**In Node.js with pg:**
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE user_id = $2', [100, alice]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE user_id = $2', [100, bob]);
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

Critical: you must use the same `client` for all queries in a transaction. `pool.query()` borrows different connections per call.

## Key Insight

> Transactions require a dedicated connection. Using `pool.query()` for each statement in a transaction is a bug — each call may get a different connection from the pool, and `BEGIN` on connection A has no effect on connection B. Always use `pool.connect()` and the returned client for all statements in a transaction.

## Experiment

```js
console.log("=== Transaction Simulation ===\n");

// Simulated database with transaction support
class SimulatedDB {
  constructor() {
    this.tables = new Map();
    this.nextId = new Map();
  }

  createTable(name, rows = []) {
    this.tables.set(name, rows.map((r, i) => ({ id: i + 1, ...r })));
    this.nextId.set(name, rows.length + 1);
  }

  // Begin a transaction — returns a snapshot for isolation
  begin() {
    const snapshot = new Map();
    for (const [name, rows] of this.tables) {
      snapshot.set(name, rows.map(r => ({ ...r })));
    }
    return { snapshot, committed: false };
  }

  // Execute a query within a transaction (or directly)
  query(table, operation, condition, data, txn = null) {
    const rows = txn ? txn.snapshot.get(table) : this.tables.get(table);
    if (!rows) throw new Error(`Table ${table} does not exist`);

    switch (operation) {
      case "SELECT": {
        return rows.filter(r => condition ? condition(r) : true);
      }
      case "UPDATE": {
        let updated = 0;
        for (const row of rows) {
          if (condition(row)) {
            Object.assign(row, data(row));
            updated++;
          }
        }
        return { rowCount: updated };
      }
      case "INSERT": {
        const id = this.nextId.get(table);
        this.nextId.set(table, id + 1);
        const newRow = { id, ...data };
        rows.push(newRow);
        return { rowCount: 1, rows: [newRow] };
      }
      case "DELETE": {
        const before = rows.length;
        const remaining = rows.filter(r => !condition(r));
        if (txn) txn.snapshot.set(table, remaining);
        else this.tables.set(table, remaining);
        return { rowCount: before - remaining.length };
      }
    }
  }

  commit(txn) {
    // Apply the transaction's snapshot to the real tables
    for (const [name, rows] of txn.snapshot) {
      this.tables.set(name, rows);
    }
    txn.committed = true;
  }

  rollback(txn) {
    // Discard the snapshot — nothing changes
    txn.committed = false;
  }

  getAll(table) {
    return this.tables.get(table) || [];
  }
}

const db = new SimulatedDB();
db.createTable("accounts", [
  { name: "Alice", balance: 1000 },
  { name: "Bob", balance: 500 },
  { name: "Charlie", balance: 250 },
]);

console.log("Initial balances:");
for (const acc of db.getAll("accounts")) {
  console.log(`  ${acc.name}: $${acc.balance}`);
}

// --- Successful transaction ---
console.log("\n--- Transfer $200: Alice → Bob (success) ---\n");

const txn1 = db.begin();

// Debit Alice
db.query("accounts", "UPDATE",
  r => r.name === "Alice",
  r => ({ balance: r.balance - 200 }),
  txn1
);

// Credit Bob
db.query("accounts", "UPDATE",
  r => r.name === "Bob",
  r => ({ balance: r.balance + 200 }),
  txn1
);

// Check intermediate state (visible within transaction)
const aliceInTxn = db.query("accounts", "SELECT", r => r.name === "Alice", null, txn1);
console.log("Alice during txn:", aliceInTxn[0].balance);

// Commit
db.commit(txn1);
console.log("Committed!");

console.log("\nAfter commit:");
for (const acc of db.getAll("accounts")) {
  console.log(`  ${acc.name}: $${acc.balance}`);
}

// --- Failed transaction (rollback) ---
console.log("\n--- Transfer $2000: Bob → Charlie (fails: insufficient funds) ---\n");

const txn2 = db.begin();

// Check balance before debit
const bobBalance = db.query("accounts", "SELECT", r => r.name === "Bob", null, txn2);

if (bobBalance[0].balance < 2000) {
  console.log(`Bob's balance ($${bobBalance[0].balance}) < $2000`);
  console.log("Rolling back!");
  db.rollback(txn2);
} else {
  db.query("accounts", "UPDATE",
    r => r.name === "Bob",
    r => ({ balance: r.balance - 2000 }),
    txn2
  );
  db.query("accounts", "UPDATE",
    r => r.name === "Charlie",
    r => ({ balance: r.balance + 2000 }),
    txn2
  );
  db.commit(txn2);
}

console.log("\nAfter rollback (unchanged):");
for (const acc of db.getAll("accounts")) {
  console.log(`  ${acc.name}: $${acc.balance}`);
}

// --- Transaction with error handling ---
console.log("\n--- Transaction with error handling ---\n");

async function transfer(db, from, to, amount) {
  const txn = db.begin();

  try {
    // Debit
    const fromAcc = db.query("accounts", "SELECT", r => r.name === from, null, txn);
    if (fromAcc.length === 0) throw new Error(`Account not found: ${from}`);
    if (fromAcc[0].balance < amount) throw new Error(`Insufficient funds: ${from} has $${fromAcc[0].balance}`);

    db.query("accounts", "UPDATE", r => r.name === from, r => ({ balance: r.balance - amount }), txn);

    // Credit
    const toAcc = db.query("accounts", "SELECT", r => r.name === to, null, txn);
    if (toAcc.length === 0) throw new Error(`Account not found: ${to}`);

    db.query("accounts", "UPDATE", r => r.name === to, r => ({ balance: r.balance + amount }), txn);

    db.commit(txn);
    console.log(`  ✓ Transferred $${amount}: ${from} → ${to}`);
    return true;

  } catch (err) {
    db.rollback(txn);
    console.log(`  ✗ Failed: ${err.message}`);
    return false;
  }
}

await transfer(db, "Alice", "Bob", 100);      // Should succeed
await transfer(db, "Charlie", "Alice", 5000);  // Should fail: insufficient funds
await transfer(db, "Alice", "Nobody", 50);     // Should fail: account not found

console.log("\nFinal balances:");
for (const acc of db.getAll("accounts")) {
  console.log(`  ${acc.name}: $${acc.balance}`);
}

console.log("\n=== Transaction Patterns (pg Library) ===\n");

console.log("Pattern 1: Basic transaction");
console.log(`
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO orders ...', [userId, total]);
    await client.query('UPDATE inventory SET stock = stock - $1 ...', [qty]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();  // ALWAYS release, even on error!
  }
`);

console.log("Pattern 2: Reusable transaction helper");
console.log(`
  async function withTransaction(pool, fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Usage:
  await withTransaction(pool, async (client) => {
    await client.query('INSERT INTO ...', [...]);
    await client.query('UPDATE ...', [...]);
    return { success: true };
  });
`);
```

## Expected Output

```
=== Transaction Simulation ===

Initial balances:
  Alice: $1000
  Bob: $500
  Charlie: $250

--- Transfer $200: Alice → Bob (success) ---

Alice during txn: 800
Committed!

After commit:
  Alice: $800
  Bob: $700
  Charlie: $250

--- Transfer $2000: Bob → Charlie (fails: insufficient funds) ---

Bob's balance ($700) < $2000
Rolling back!

After rollback (unchanged):
  Alice: $800
  Bob: $700
  Charlie: $250

--- Transaction with error handling ---

  ✓ Transferred $100: Alice → Bob
  ✗ Failed: Insufficient funds: Charlie has $250
  ✗ Failed: Account not found: Nobody

Final balances:
  Alice: $700
  Bob: $800
  Charlie: $250
```

## Challenge

1. Implement the `withTransaction` helper function and use it for a multi-step operation: create a user, create their profile, and insert a welcome notification — all atomically
2. What is a savepoint? Implement `SAVEPOINT` and `ROLLBACK TO SAVEPOINT` to partially roll back a transaction
3. What happens if you forget to call `ROLLBACK` after an error and the connection is returned to the pool? How does `pg` handle this?

## Common Mistakes

- Using `pool.query()` inside a transaction — each call may use a different connection. The transaction only exists on one connection
- Forgetting `finally { client.release() }` — the connection leaks from the pool, eventually exhausting it
- Not rolling back on error — the connection stays "in transaction" and is returned to the pool in a broken state
- Holding transactions open too long — long transactions hold locks and increase contention
