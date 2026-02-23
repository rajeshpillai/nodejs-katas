---
id: password-storage
phase: 10
phase_title: Cryptography & Security
sequence: 2
title: Password Storage with scrypt
difficulty: intermediate
tags: [crypto, passwords, scrypt, argon2, salting, timing-attacks]
prerequisites: [hashing]
estimated_minutes: 15
---

## Concept

Plain hashing (SHA-256) is dangerously wrong for passwords. A modern GPU can compute **billions** of SHA-256 hashes per second, making brute-force attacks trivial.

**Password hashing** uses algorithms that are intentionally slow and memory-intensive:

- **scrypt** — built into Node.js `crypto`, tunable CPU and memory cost
- **argon2** — newer, winner of the Password Hashing Competition (requires a package)
- **bcrypt** — widely used, but limited to 72-byte passwords

**How it works:**

```
password + random_salt → slow_hash_function → stored_hash
```

Each password gets a unique random **salt** — so identical passwords produce different hashes. The salt is stored alongside the hash (not secret).

**Node.js scrypt:**
```js
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

// Hash a password
const salt = randomBytes(32);
const hash = await new Promise((resolve, reject) => {
  scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
});
const stored = `${salt.toString('hex')}:${hash.toString('hex')}`;

// Verify a password
const [saltHex, hashHex] = stored.split(':');
const saltBuf = Buffer.from(saltHex, 'hex');
const hashBuf = Buffer.from(hashHex, 'hex');
const candidate = await new Promise((resolve, reject) => {
  scrypt(candidatePassword, saltBuf, 64, (err, key) => err ? reject(err) : resolve(key));
});
const match = timingSafeEqual(hashBuf, candidate);
```

## Key Insight

> The point of password hashing is to be slow. SHA-256 takes ~10 nanoseconds. scrypt with recommended parameters takes ~100 milliseconds — that's 10 million times slower. An attacker who can try 1 billion SHA-256 hashes per second can only try ~10 scrypt hashes per second. The salt ensures that each password must be attacked individually — precomputed rainbow tables are useless.

## Experiment

```js
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

console.log("=== Password Storage ===\n");

// --- Demo 1: Why plain hashing is wrong ---

console.log("--- Why SHA-256 is wrong for passwords ---\n");

const password = "mypassword123";

// SHA-256: fast and no salt
const sha256Start = performance.now();
for (let i = 0; i < 10000; i++) {
  createHash("sha256").update(password).digest("hex");
}
const sha256Time = performance.now() - sha256Start;

console.log(`  SHA-256: 10,000 hashes in ${sha256Time.toFixed(1)}ms`);
console.log(`  Rate: ~${Math.round(10000 / (sha256Time / 1000)).toLocaleString()} hashes/sec`);
console.log(`  (GPUs can do billions/sec)\n`);

// Same password → same hash (no salt!)
const hash1 = createHash("sha256").update("password123").digest("hex");
const hash2 = createHash("sha256").update("password123").digest("hex");
console.log(`  Without salt, identical passwords → identical hash:`);
console.log(`    User A: ${hash1.slice(0, 32)}...`);
console.log(`    User B: ${hash2.slice(0, 32)}...`);
console.log(`    Match: ${hash1 === hash2} (attacker cracks one, gets all)\n`);

// --- Demo 2: scrypt with salt ---

console.log("--- scrypt with salt (correct approach) ---\n");

async function hashPassword(password) {
  const salt = randomBytes(32);
  const hash = await scryptAsync(password, salt, 64, {
    N: 16384,  // CPU/memory cost (2^14)
    r: 8,      // Block size
    p: 1,      // Parallelism
  });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const storedHash = Buffer.from(hashHex, "hex");

  const candidateHash = await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });

  // Timing-safe comparison (prevents timing attacks)
  return timingSafeEqual(storedHash, candidateHash);
}

// Hash a password
const startHash = performance.now();
const stored = await hashPassword("mypassword123");
const hashTime = performance.now() - startHash;

console.log(`  Password: "mypassword123"`);
console.log(`  Stored:   ${stored.slice(0, 40)}...${stored.slice(-20)}`);
console.log(`  Length:   ${stored.length} chars (salt:hash)`);
console.log(`  Time:     ${hashTime.toFixed(1)}ms (intentionally slow!)\n`);

// Same password → different hash (different salt!)
const stored2 = await hashPassword("mypassword123");
console.log(`  Same password, different salt:`);
console.log(`    Hash 1: ${stored.slice(0, 40)}...`);
console.log(`    Hash 2: ${stored2.slice(0, 40)}...`);
console.log(`    Match: ${stored === stored2} (different salts → different hashes)\n`);

// --- Demo 3: Verification ---

console.log("--- Password verification ---\n");

const startVerify = performance.now();
const correct = await verifyPassword("mypassword123", stored);
const verifyTime = performance.now() - startVerify;

const wrong = await verifyPassword("wrongpassword", stored);

console.log(`  Correct password: ${correct} (${verifyTime.toFixed(1)}ms)`);
console.log(`  Wrong password:   ${wrong}\n`);

// --- Demo 4: Timing-safe comparison ---

console.log("--- Timing-safe comparison ---\n");

console.log("  Why timingSafeEqual matters:\n");

// Regular comparison (vulnerable to timing attack)
const bufA = Buffer.from("correct_hash_value_here_abcdef01");
const bufB = Buffer.from("correct_hash_value_here_abcdef01");
const bufC = Buffer.from("wrong_hash_value__here_abcdef99");
const bufD = Buffer.from("xxxxxx_hash_value__here_abcdef99");

// Regular === comparison short-circuits at first mismatch
console.log("  Regular comparison (===):");
console.log("    Fails fast on first different byte → leaks info about hash\n");

console.log("  timingSafeEqual:");
console.log("    Always compares ALL bytes → constant time\n");

// Demonstrate
console.log(`  timingSafeEqual(A, B): ${timingSafeEqual(bufA, bufB)} (same)`);
console.log(`  timingSafeEqual(A, C): ${timingSafeEqual(bufA, bufC)} (differ at end)`);
console.log(`  timingSafeEqual(A, D): ${timingSafeEqual(bufA, bufD)} (differ at start)`);
console.log("  All false comparisons take the same time!\n");

// --- Demo 5: scrypt parameters ---

console.log("--- scrypt parameter tuning ---\n");

const params = [
  { N: 1024, r: 8, p: 1, label: "Low (dev)" },
  { N: 16384, r: 8, p: 1, label: "Medium (default)" },
  { N: 65536, r: 8, p: 1, label: "High (sensitive)" },
  { N: 131072, r: 8, p: 2, label: "Very high (paranoid)" },
];

const salt = randomBytes(32);

for (const param of params) {
  const start = performance.now();
  await scryptAsync("testpassword", salt, 64, {
    N: param.N,
    r: param.r,
    p: param.p,
  });
  const elapsed = performance.now() - start;
  const memory = param.N * param.r * 128;  // scrypt memory usage formula
  console.log(`  ${param.label.padEnd(22)} N=${String(param.N).padStart(6)}, r=${param.r}, p=${param.p} → ${elapsed.toFixed(0).padStart(4)}ms, ${(memory / 1024 / 1024).toFixed(1)}MB RAM`);
}

console.log(`\n  Rule of thumb: aim for 100-250ms on your production hardware\n`);

// --- Demo 6: Complete auth flow ---

console.log("=== Complete Auth Pattern ===\n");

console.log(`  // Registration
  async function register(email, password) {
    const stored = await hashPassword(password);
    await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
      [email, stored]
    );
  }

  // Login
  async function login(email, password) {
    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      // Hash anyway to prevent timing-based user enumeration
      await hashPassword(password);
      throw new Error('Invalid credentials');
    }

    const user = result.rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) throw new Error('Invalid credentials');

    return { userId: user.id };
  }
`);
```

## Expected Output

```
=== Password Storage ===

--- Why SHA-256 is wrong for passwords ---

  SHA-256: 10,000 hashes in <ms>
  Rate: ~<millions> hashes/sec
  (GPUs can do billions/sec)

  Without salt, identical passwords → identical hash:
    User A: ef92b778bafe771e89245b89ecbc08a4...
    User B: ef92b778bafe771e89245b89ecbc08a4...
    Match: true (attacker cracks one, gets all)

--- scrypt with salt (correct approach) ---

  Password: "mypassword123"
  Stored:   <salt_hex>:<hash_hex>
  Time:     ~100ms (intentionally slow!)

  Same password, different salt:
    Hash 1: <different>...
    Hash 2: <different>...
    Match: false (different salts → different hashes)

--- Password verification ---

  Correct password: true (~100ms)
  Wrong password:   false
  ...
```

## Challenge

1. Build a password strength checker that estimates crack time based on character set and length. How long would it take to brute-force a 12-character alphanumeric password with scrypt at 10 hashes/sec?
2. Implement password hash migration: when a user logs in with an old bcrypt hash, re-hash with scrypt and update the stored hash
3. Why does the login function hash the password even when the user doesn't exist? What attack does this prevent?

## Common Mistakes

- Using SHA-256/MD5 for passwords — too fast, GPU-crackable in seconds
- Not using a salt — identical passwords get identical hashes, enabling rainbow table attacks
- Using `===` instead of `timingSafeEqual` — timing attacks can reveal the hash character by character
- Logging passwords or hashes — never log authentication data, even in error handlers
- Using a fixed salt for all users — defeats the purpose; each user needs a unique random salt
