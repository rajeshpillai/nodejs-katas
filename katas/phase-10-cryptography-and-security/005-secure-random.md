---
id: secure-random
phase: 10
phase_title: Cryptography & Security
sequence: 5
title: Secure Random Generation
difficulty: intermediate
tags: [crypto, random, uuid, tokens, entropy, csprng]
prerequisites: [tokens-and-signatures]
estimated_minutes: 12
---

## Concept

`Math.random()` is **not** cryptographically secure. It uses a predictable pseudo-random algorithm — if an attacker observes a few outputs, they can predict all future values.

For security-sensitive values (tokens, keys, session IDs, nonces), use `crypto.randomBytes()` or `crypto.randomUUID()`:

```js
import { randomBytes, randomUUID, randomInt } from 'node:crypto';

randomBytes(32);          // 32 random bytes (Buffer)
randomUUID();             // UUIDv4: 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
randomInt(1, 100);        // Random integer in [1, 100)
```

These use the operating system's **CSPRNG** (Cryptographically Secure Pseudo-Random Number Generator):
- Linux: `/dev/urandom` (backed by the kernel entropy pool)
- macOS: `SecRandomCopyBytes`
- Windows: `BCryptGenRandom`

The OS CSPRNG is seeded from hardware entropy sources (CPU timing jitter, interrupt timing, etc.) and is designed to be unpredictable even if an attacker knows previous outputs.

## Key Insight

> `Math.random()` is fast but predictable — it's fine for shuffling a playlist but catastrophic for session tokens. `crypto.randomBytes()` is backed by the OS kernel's entropy pool and is unpredictable by design. The performance difference (~100ns vs ~1μs) is irrelevant for security operations. When in doubt, always use `crypto` for any value that an attacker should not be able to guess.

## Experiment

```js
import { randomBytes, randomUUID, randomInt } from "node:crypto";

console.log("=== Secure Random Generation ===\n");

// --- Demo 1: Math.random() vs crypto ---

console.log("--- Math.random() vs crypto.randomBytes() ---\n");

console.log("  Math.random() outputs (NOT secure):");
for (let i = 0; i < 5; i++) {
  console.log(`    ${Math.random()}`);
}

console.log("\n  crypto.randomBytes() outputs (secure):");
for (let i = 0; i < 5; i++) {
  console.log(`    ${randomBytes(16).toString("hex")}`);
}

console.log("\n  Key difference:");
console.log("    Math.random() uses xorshift128+ — predictable with ~20 observed outputs");
console.log("    crypto.randomBytes() uses OS CSPRNG — unpredictable by design\n");

// --- Demo 2: Common secure random formats ---

console.log("--- Secure random value formats ---\n");

// Raw bytes
const raw = randomBytes(32);
console.log(`  Raw bytes (32):     <Buffer ${raw.slice(0, 8).toString("hex")}...> (${raw.length} bytes)`);

// Hex string
const hex = randomBytes(16).toString("hex");
console.log(`  Hex (16 bytes):     ${hex} (${hex.length} chars)`);

// Base64
const b64 = randomBytes(24).toString("base64");
console.log(`  Base64 (24 bytes):  ${b64} (${b64.length} chars)`);

// Base64url (URL-safe)
const b64url = randomBytes(24).toString("base64url");
console.log(`  Base64url:          ${b64url} (${b64url.length} chars, no +/=)`);

// UUID v4
const uuid = randomUUID();
console.log(`  UUID v4:            ${uuid}`);

// Random integer
const int = randomInt(1000000);
console.log(`  Random int [0,1M):  ${int}`);

// Random integer in range
const ranged = randomInt(100, 999);
console.log(`  Random int [100,999): ${ranged}\n`);

// --- Demo 3: Token generation patterns ---

console.log("--- Token generation patterns ---\n");

// Session token
function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

// API key with prefix
function generateApiKey(prefix = "sk") {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

// Verification code (human-readable)
function generateVerificationCode(length = 6) {
  let code = "";
  while (code.length < length) {
    const byte = randomBytes(1)[0];
    if (byte < 250) { // Avoid modulo bias (250 is divisible by 10)
      code += (byte % 10).toString();
    }
  }
  return code;
}

// Password reset token with expiry
function generateResetToken() {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 3600000; // 1 hour
  return { token, expires };
}

console.log(`  Session token:      ${generateSessionToken()}`);
console.log(`  API key:            ${generateApiKey("sk_live")}`);
console.log(`  Verification code:  ${generateVerificationCode()}`);
const reset = generateResetToken();
console.log(`  Reset token:        ${reset.token.slice(0, 32)}... (expires: ${new Date(reset.expires).toISOString()})\n`);

// --- Demo 4: Entropy and token strength ---

console.log("--- Token strength (bits of entropy) ---\n");

const tokenTypes = [
  { name: "6-digit code", bits: Math.log2(10 ** 6), example: "482937" },
  { name: "8-char alphanum", bits: Math.log2(62 ** 8), example: "aB3dE7gH" },
  { name: "16 bytes hex", bits: 128, example: randomBytes(16).toString("hex") },
  { name: "UUID v4", bits: 122, example: randomUUID() },
  { name: "32 bytes base64url", bits: 256, example: randomBytes(32).toString("base64url") },
];

for (const t of tokenTypes) {
  const guessesPerSec = 1e9; // Assume 1 billion guesses/sec
  const totalGuesses = 2 ** t.bits;
  const seconds = totalGuesses / guessesPerSec;
  const years = seconds / (365.25 * 24 * 3600);

  let crackTime;
  if (years > 1e15) crackTime = "> age of universe";
  else if (years > 1e6) crackTime = `~${(years / 1e6).toFixed(0)}M years`;
  else if (years > 1000) crackTime = `~${Math.round(years)} years`;
  else if (years > 1) crackTime = `~${years.toFixed(1)} years`;
  else crackTime = `~${Math.round(seconds)} seconds`;

  console.log(`  ${t.name.padEnd(22)} ${String(Math.round(t.bits)).padStart(3)} bits  Brute force: ${crackTime}`);
}

// --- Demo 5: Modulo bias ---

console.log("\n--- Modulo bias (subtle bug) ---\n");

// Wrong: Math.random() * range → bias towards lower values
// Wrong: randomBytes(1)[0] % 10 → bias (256 is not divisible by 10)

// Demonstrate bias
const TRIALS = 100000;
const biased = new Array(10).fill(0);
const unbiased = new Array(10).fill(0);

for (let i = 0; i < TRIALS; i++) {
  // Biased: 256 % 10 means 0-5 appear slightly more often
  biased[randomBytes(1)[0] % 10]++;
}

for (let i = 0; i < TRIALS; i++) {
  // Unbiased: reject values >= 250 (250 is 25 * 10)
  let byte;
  do { byte = randomBytes(1)[0]; } while (byte >= 250);
  unbiased[byte % 10]++;
}

console.log("  Distribution of digits (100K trials):\n");
console.log("  Digit  Biased    Unbiased  Expected");
for (let i = 0; i < 10; i++) {
  const expected = TRIALS / 10;
  const biasedPct = ((biased[i] / expected - 1) * 100).toFixed(2);
  const unbiasedPct = ((unbiased[i] / expected - 1) * 100).toFixed(2);
  console.log(`    ${i}    ${String(biased[i]).padStart(6)} (${biasedPct.padStart(6)}%)  ${String(unbiased[i]).padStart(6)} (${unbiasedPct.padStart(6)}%)  ${expected}`);
}

console.log("\n  Use crypto.randomInt() to avoid this entirely!\n");

// --- Demo 6: Performance comparison ---

console.log("--- Performance ---\n");

const iterations = 10000;

const mathStart = performance.now();
for (let i = 0; i < iterations; i++) Math.random();
const mathTime = performance.now() - mathStart;

const cryptoStart = performance.now();
for (let i = 0; i < iterations; i++) randomBytes(16);
const cryptoTime = performance.now() - cryptoStart;

const uuidStart = performance.now();
for (let i = 0; i < iterations; i++) randomUUID();
const uuidTime = performance.now() - uuidStart;

console.log(`  ${iterations} iterations:`);
console.log(`    Math.random():     ${mathTime.toFixed(1)}ms`);
console.log(`    randomBytes(16):   ${cryptoTime.toFixed(1)}ms`);
console.log(`    randomUUID():      ${uuidTime.toFixed(1)}ms`);
console.log(`\n  crypto is slower but the difference is negligible for security operations`);
```

## Expected Output

```
=== Secure Random Generation ===

--- Math.random() vs crypto.randomBytes() ---

  Math.random() outputs (NOT secure):
    0.7412893104...
    ...

  crypto.randomBytes() outputs (secure):
    a3f8b2c1d4e5f60718293a4b5c6d7e8f
    ...

--- Secure random value formats ---

  Raw bytes (32):     <Buffer ...> (32 bytes)
  Hex (16 bytes):     <hex> (32 chars)
  Base64url:          <base64url> (32 chars, no +/=)
  UUID v4:            <uuid>
  ...

--- Token strength (bits of entropy) ---

  6-digit code             20 bits  Brute force: ~0 seconds
  8-char alphanum          48 bits  Brute force: ~...
  16 bytes hex            128 bits  Brute force: > age of universe
  UUID v4                 122 bits  Brute force: > age of universe
  32 bytes base64url      256 bits  Brute force: > age of universe
  ...
```

## Challenge

1. Implement a "secure link" system: generate a random token, store its hash in the database, and verify by hashing the submitted token. Why store the hash instead of the raw token?
2. Build a TOTP (Time-based One-Time Password) generator compatible with Google Authenticator — it uses HMAC-SHA1 with a shared secret and the current time
3. Why does `randomInt(0, 10)` not suffer from modulo bias but `randomBytes(1)[0] % 10` does? Read the Node.js source to understand the rejection sampling implementation

## Common Mistakes

- Using `Math.random()` for tokens, keys, or any security value — it's predictable
- Using `randomBytes(1)[0] % N` without rejection sampling — introduces modulo bias
- Generating tokens that are too short — a 4-character hex token has only 65,536 possible values
- Not using constant-time comparison for token verification — timing attacks can guess tokens character by character
- Storing raw tokens in the database — store a hash so that a database leak doesn't compromise active tokens
