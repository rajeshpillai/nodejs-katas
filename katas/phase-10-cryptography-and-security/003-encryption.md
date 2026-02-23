---
id: encryption
phase: 10
phase_title: Cryptography & Security
sequence: 3
title: Symmetric Encryption with AES
difficulty: intermediate
tags: [crypto, encryption, aes, gcm, iv, symmetric]
prerequisites: [password-storage]
estimated_minutes: 15
---

## Concept

Encryption transforms plaintext into ciphertext that can only be reversed with the correct key. Unlike hashing, encryption is **reversible**.

**Symmetric encryption** uses the same key to encrypt and decrypt:

```
plaintext + key → encrypt → ciphertext
ciphertext + key → decrypt → plaintext
```

**AES-256-GCM** is the recommended algorithm for most use cases:

- **AES-256** — 256-bit key, extremely strong
- **GCM** (Galois/Counter Mode) — provides both encryption AND authentication (detects tampering)
- Requires a unique **IV** (initialization vector) for each encryption — never reuse an IV with the same key

```js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encrypt
const key = randomBytes(32);  // 256 bits
const iv = randomBytes(12);   // 96 bits for GCM
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const authTag = cipher.getAuthTag();  // 16 bytes — proves no tampering

// Decrypt
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(authTag);
const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
```

## Key Insight

> AES-GCM provides authenticated encryption — it guarantees both confidentiality (nobody can read the data) AND integrity (nobody can tamper with it). If even one bit of the ciphertext is modified, decryption fails with an authentication error. This is why GCM is preferred over CBC — CBC encrypts but doesn't detect tampering, requiring a separate HMAC step.

## Experiment

```js
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

console.log("=== Symmetric Encryption with AES ===\n");

// --- Demo 1: Basic AES-256-GCM encrypt/decrypt ---

console.log("--- AES-256-GCM encrypt/decrypt ---\n");

function encrypt(plaintext, key) {
  const iv = randomBytes(12);  // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Pack: iv + authTag + ciphertext (all needed for decryption)
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(packed, key) {
  const iv = packed.subarray(0, 12);
  const authTag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

const key = randomBytes(32);  // 256-bit key

const plaintext = "Hello, this is a secret message!";
const encrypted = encrypt(plaintext, key);
const decrypted = decrypt(encrypted, key);

console.log(`  Plaintext:  "${plaintext}"`);
console.log(`  Key:        ${key.toString("hex").slice(0, 32)}... (${key.length * 8} bits)`);
console.log(`  Encrypted:  ${encrypted.toString("hex").slice(0, 40)}... (${encrypted.length} bytes)`);
console.log(`  Decrypted:  "${decrypted}"`);
console.log(`  Match:      ${plaintext === decrypted}\n`);

// --- Demo 2: IV uniqueness ---

console.log("--- IV must be unique per encryption ---\n");

const msg = "Same message";
const enc1 = encrypt(msg, key);
const enc2 = encrypt(msg, key);

console.log(`  Same message encrypted twice with same key:`);
console.log(`    Encryption 1: ${enc1.toString("hex").slice(0, 40)}...`);
console.log(`    Encryption 2: ${enc2.toString("hex").slice(0, 40)}...`);
console.log(`    Identical: ${enc1.equals(enc2)} (different IVs → different ciphertext)`);
console.log(`    Both decrypt to: "${decrypt(enc1, key)}"\n`);

// --- Demo 3: Tamper detection (authentication) ---

console.log("--- GCM tamper detection ---\n");

const original = encrypt("Transfer $100 to Alice", key);
console.log(`  Original ciphertext: ${original.toString("hex").slice(0, 40)}...`);

// Try to tamper with the ciphertext
const tampered = Buffer.from(original);
tampered[30] ^= 0xff;  // Flip bits in the ciphertext portion

console.log(`  Tampered ciphertext: ${tampered.toString("hex").slice(0, 40)}...`);

try {
  decrypt(tampered, key);
  console.log("  Decryption succeeded (BAD — tampering not detected)");
} catch (err) {
  console.log(`  Decryption failed: ${err.message}`);
  console.log("  GCM detected the tampering! (GOOD)\n");
}

// --- Demo 4: Wrong key ---

console.log("--- Wrong key detection ---\n");

const wrongKey = randomBytes(32);
try {
  decrypt(encrypted, wrongKey);
  console.log("  Decrypted with wrong key (BAD)");
} catch (err) {
  console.log(`  Wrong key: ${err.message}`);
  console.log("  Cannot decrypt without the correct key\n");
}

// --- Demo 5: Encrypting structured data ---

console.log("--- Encrypting JSON data ---\n");

const sensitiveData = {
  ssn: "123-45-6789",
  creditCard: "4111-1111-1111-1111",
  bankAccount: "9876543210",
};

const jsonEncrypted = encrypt(JSON.stringify(sensitiveData), key);
const jsonDecrypted = JSON.parse(decrypt(jsonEncrypted, key));

console.log(`  Original:  ${JSON.stringify(sensitiveData)}`);
console.log(`  Encrypted: ${jsonEncrypted.toString("base64").slice(0, 40)}...`);
console.log(`  Decrypted: ${JSON.stringify(jsonDecrypted)}`);
console.log(`  Match:     ${jsonDecrypted.ssn === sensitiveData.ssn}\n`);

// --- Demo 6: Encryption envelope pattern ---

console.log("--- Encryption envelope (for storage) ---\n");

function encryptForStorage(plaintext, key) {
  const packed = encrypt(plaintext, key);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    data: packed.toString("base64"),
  };
}

function decryptFromStorage(envelope, key) {
  if (envelope.version !== 1) throw new Error("Unknown version");
  if (envelope.algorithm !== "aes-256-gcm") throw new Error("Unknown algorithm");
  return decrypt(Buffer.from(envelope.data, "base64"), key);
}

const envelope = encryptForStorage("secret data", key);
console.log(`  Stored envelope: ${JSON.stringify(envelope, null, 2).split("\n").join("\n  ")}\n`);

const recovered = decryptFromStorage(envelope, key);
console.log(`  Recovered: "${recovered}"\n`);

console.log("  The envelope pattern lets you:");
console.log("  - Rotate keys (check version, decrypt with old key, re-encrypt with new)");
console.log("  - Migrate algorithms (add new version with different algorithm)");
console.log("  - Store in any text-based system (JSON, database, config files)");

// --- Demo 7: Comparison ---

console.log("\n=== Algorithm Comparison ===\n");

const algos = [
  ["Algorithm", "Key Size", "Auth", "Use Case"],
  ["AES-256-GCM", "256 bits", "Yes", "General purpose (recommended)"],
  ["AES-256-CBC", "256 bits", "No", "Legacy (add HMAC for auth)"],
  ["ChaCha20-Poly1305", "256 bits", "Yes", "Fast on CPUs without AES-NI"],
];

for (const [algo, keySize, auth, use] of algos) {
  console.log(`  ${algo.padEnd(22)} ${keySize.padEnd(10)} Auth: ${auth.padEnd(4)} ${use}`);
}
```

## Expected Output

```
=== Symmetric Encryption with AES ===

--- AES-256-GCM encrypt/decrypt ---

  Plaintext:  "Hello, this is a secret message!"
  Key:        <hex>... (256 bits)
  Encrypted:  <hex>... (59 bytes)
  Decrypted:  "Hello, this is a secret message!"
  Match:      true

--- IV must be unique per encryption ---

  Same message encrypted twice with same key:
    Encryption 1: <hex>...
    Encryption 2: <hex>... (different!)
    Identical: false (different IVs → different ciphertext)

--- GCM tamper detection ---

  Tampered ciphertext: <hex>...
  Decryption failed: Unsupported state or unable to authenticate data
  GCM detected the tampering! (GOOD)
  ...
```

## Challenge

1. Build an "encrypted config" module that encrypts sensitive config values (API keys, secrets) and stores them in a JSON file. Decrypt at startup using a master key from an environment variable
2. Implement key rotation: re-encrypt all stored data from an old key to a new key without downtime
3. What's the difference between symmetric encryption (AES) and asymmetric encryption (RSA)? When would you use each?

## Common Mistakes

- Reusing an IV with the same key — in GCM, this completely breaks security (reveals XOR of plaintexts)
- Using CBC without HMAC — CBC doesn't detect tampering, enabling padding oracle attacks
- Storing the key alongside the encrypted data — the key must be separate (environment variable, KMS, HSM)
- Using ECB mode — encrypts identical blocks to identical ciphertext, revealing patterns
