---
id: hashing
phase: 10
phase_title: Cryptography & Security
sequence: 1
title: Hashing with the crypto Module
difficulty: intermediate
tags: [crypto, hashing, sha256, md5, integrity, hmac]
prerequisites: [query-cancellation]
estimated_minutes: 12
---

## Concept

A hash function takes input of any size and produces a fixed-size output (the "digest"). Good cryptographic hash functions have three properties:

1. **Deterministic** — same input always produces the same hash
2. **One-way** — you can't reverse the hash to get the input
3. **Collision-resistant** — extremely hard to find two different inputs with the same hash

Node.js provides the `crypto` module with access to all hash algorithms supported by OpenSSL:

```js
import { createHash } from 'node:crypto';

const hash = createHash('sha256')
  .update('hello world')
  .digest('hex');
// '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
```

**Common algorithms:**
- `sha256` — general-purpose, used in most applications (32 bytes)
- `sha512` — longer hash, used when extra collision resistance is needed (64 bytes)
- `md5` — broken for security, but still used for checksums (16 bytes)
- `sha1` — deprecated for security, still in legacy systems (20 bytes)

**Use cases:**
- File integrity verification (checksums)
- Data deduplication
- Cache keys
- Content addressing (like Git)

## Key Insight

> Hashing is not encryption. Encryption is reversible (decrypt with a key). Hashing is one-way — there is no "unhash" function. SHA-256 produces the same 32 bytes whether the input is 1 byte or 1 GB. This makes hashes ideal for verification ("does this file match this hash?") but useless for hiding data that needs to be recovered.

## Experiment

```js
import { createHash } from "node:crypto";

console.log("=== Hashing with crypto ===\n");

// --- Demo 1: Basic hashing ---

console.log("--- Basic hash operations ---\n");

const algorithms = ["md5", "sha1", "sha256", "sha512"];
const input = "Hello, Node.js!";

console.log(`  Input: "${input}"\n`);

for (const algo of algorithms) {
  const hash = createHash(algo).update(input).digest("hex");
  console.log(`  ${algo.padEnd(8)} (${hash.length / 2} bytes): ${hash}`);
}

// --- Demo 2: Hash properties ---

console.log("\n--- Hash properties ---\n");

// Deterministic
const hash1 = createHash("sha256").update("test").digest("hex");
const hash2 = createHash("sha256").update("test").digest("hex");
console.log(`  Deterministic: "${hash1.slice(0, 16)}..." === "${hash2.slice(0, 16)}...": ${hash1 === hash2}`);

// Avalanche effect (tiny change → completely different hash)
const hashA = createHash("sha256").update("hello").digest("hex");
const hashB = createHash("sha256").update("hellp").digest("hex");  // One character different
console.log(`\n  Avalanche effect (1 char change):`);
console.log(`    "hello" → ${hashA}`);
console.log(`    "hellp" → ${hashB}`);

let diffBits = 0;
for (let i = 0; i < hashA.length; i++) {
  if (hashA[i] !== hashB[i]) diffBits++;
}
console.log(`    ${diffBits}/${hashA.length} hex digits differ (${((diffBits / hashA.length) * 100).toFixed(0)}%)`);

// Fixed output size regardless of input
console.log("\n  Fixed output size:");
const inputs = ["a", "Hello, World!", "x".repeat(10000)];
for (const inp of inputs) {
  const h = createHash("sha256").update(inp).digest("hex");
  console.log(`    ${String(inp.length).padStart(5)} bytes input → ${h.length / 2} bytes hash: ${h.slice(0, 20)}...`);
}

// --- Demo 3: Incremental hashing (streaming) ---

console.log("\n--- Incremental hashing (streaming) ---\n");

// You can call .update() multiple times
const incremental = createHash("sha256");
incremental.update("Hello, ");
incremental.update("Node.js!");
const incrementalHash = incremental.digest("hex");

// Same as hashing the whole string at once
const wholeHash = createHash("sha256").update("Hello, Node.js!").digest("hex");

console.log(`  Incremental: ${incrementalHash.slice(0, 32)}...`);
console.log(`  Whole:       ${wholeHash.slice(0, 32)}...`);
console.log(`  Match: ${incrementalHash === wholeHash}`);

console.log("\n  This is how you hash files without loading them into memory:");
console.log(`
    import { createReadStream } from 'fs';
    import { createHash } from 'crypto';

    const hash = createHash('sha256');
    const stream = createReadStream('/path/to/large-file');
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => console.log(hash.digest('hex')));
  `);

// --- Demo 4: Output formats ---

console.log("--- Output formats ---\n");

const hash = createHash("sha256").update("test");

// hex: human-readable, 64 chars for SHA-256
console.log(`  hex:    ${createHash("sha256").update("test").digest("hex")}`);

// base64: shorter, used in headers/tokens
console.log(`  base64: ${createHash("sha256").update("test").digest("base64")}`);

// base64url: URL-safe (no +/= characters)
console.log(`  base64url: ${createHash("sha256").update("test").digest("base64url")}`);

// Buffer: raw bytes
const buf = createHash("sha256").update("test").digest();
console.log(`  buffer: <Buffer ${buf.slice(0, 8).toString("hex")}... > (${buf.length} bytes)`);

// --- Demo 5: Practical use cases ---

console.log("\n--- Practical use cases ---\n");

// File checksum
console.log("  1. File integrity check:");
const fileContent = "file contents here...";
const checksum = createHash("sha256").update(fileContent).digest("hex");
console.log(`     SHA-256: ${checksum}`);
console.log(`     Verify: sha256sum myfile.txt\n`);

// Cache key from query
console.log("  2. Cache key from query parameters:");
const query = { table: "users", filters: { age: 25 }, sort: "name" };
const cacheKey = createHash("sha256")
  .update(JSON.stringify(query))
  .digest("base64url")
  .slice(0, 16);
console.log(`     Query: ${JSON.stringify(query)}`);
console.log(`     Cache key: ${cacheKey}\n`);

// ETag for HTTP caching
console.log("  3. ETag for HTTP caching:");
const responseBody = JSON.stringify({ users: [1, 2, 3] });
const etag = createHash("md5").update(responseBody).digest("hex");
console.log(`     Body: ${responseBody}`);
console.log(`     ETag: "${etag}"`);
console.log(`     Header: ETag: "${etag}"\n`);

// Content addressing (like Git)
console.log("  4. Content-addressed storage (like Git):");
const blob = "blob 13\0Hello, World!";  // Git blob format
const gitHash = createHash("sha1").update(blob).digest("hex");
console.log(`     Content: "Hello, World!"`);
console.log(`     Git SHA-1: ${gitHash}`);

// --- Demo 6: What NOT to use hashing for ---

console.log("\n--- What NOT to use hashing for ---\n");

console.log("  ✗ Password storage — use scrypt/argon2 instead (next kata)");
console.log("  ✗ Encryption — hashing is one-way, use AES for encryption");
console.log("  ✗ MD5/SHA-1 for security — both have known collisions");
console.log("  ✗ Hashing secrets without HMAC — vulnerable to length extension");

console.log("\n  Available algorithms on this system:");
const { getHashes } = await import("node:crypto");
const hashes = getHashes().filter(h => !h.includes("RSA")).slice(0, 15);
console.log(`    ${hashes.join(", ")}...`);
```

## Expected Output

```
=== Hashing with crypto ===

--- Basic hash operations ---

  Input: "Hello, Node.js!"

  md5      (16 bytes): <32 hex chars>
  sha1     (20 bytes): <40 hex chars>
  sha256   (32 bytes): <64 hex chars>
  sha512   (64 bytes): <128 hex chars>

--- Hash properties ---

  Deterministic: "9f86d08188..." === "9f86d08188...": true

  Avalanche effect (1 char change):
    "hello" → 2cf24dba5fb0a30e...
    "hellp" → <completely different>
    ~50% hex digits differ

  Fixed output size:
      1 bytes input → 32 bytes hash: ...
     13 bytes input → 32 bytes hash: ...
  10000 bytes input → 32 bytes hash: ...
  ...
```

## Challenge

1. Implement a file deduplication system: hash file contents and skip files with identical hashes
2. Build an ETag middleware for an HTTP server that computes SHA-256 ETags and returns 304 Not Modified when the client sends a matching `If-None-Match` header
3. Why is MD5 broken for security but still acceptable for checksums? What's the difference between collision resistance and preimage resistance?

## Common Mistakes

- Using MD5 or SHA-1 for security purposes — both have practical collision attacks
- Using plain SHA-256 for passwords — it's too fast! Attackers can hash billions of guesses per second. Use bcrypt/scrypt/argon2
- Hashing without HMAC when integrity + authenticity is needed — SHA-256 alone doesn't prove who created the hash
- Creating a new hash object for each `.update()` call instead of reusing one — each `createHash()` allocates a new context
