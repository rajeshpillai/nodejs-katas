---
id: tokens-and-signatures
phase: 10
phase_title: Cryptography & Security
sequence: 4
title: Tokens and Signatures (HMAC and JWT)
difficulty: intermediate
tags: [crypto, hmac, jwt, tokens, authentication, signatures]
prerequisites: [encryption]
estimated_minutes: 15
---

## Concept

A **signature** proves that data hasn't been tampered with and was created by someone with the secret key. Unlike encryption, the data stays readable — the signature only ensures integrity and authenticity.

**HMAC (Hash-based Message Authentication Code):**
```js
import { createHmac } from 'node:crypto';

const signature = createHmac('sha256', secretKey)
  .update(message)
  .digest('hex');
```

HMAC combines a secret key with a hash function. Only someone with the key can create or verify the signature.

**JWT (JSON Web Token):**
A JWT is three base64url-encoded parts separated by dots:

```
header.payload.signature
```

- **Header**: `{"alg":"HS256","typ":"JWT"}`
- **Payload**: `{"sub":"user123","exp":1709123456}`
- **Signature**: `HMAC-SHA256(base64url(header) + "." + base64url(payload), secret)`

The server creates JWTs and verifies them later without a database lookup — the signature proves the token hasn't been modified.

## Key Insight

> HMAC is to hashing what a wax seal is to an envelope. A plain hash (SHA-256) proves the message hasn't changed, but anyone can compute a SHA-256 hash. An HMAC proves the message hasn't changed AND that it was created by someone who knows the secret key. This is why JWTs use HMAC (or RSA) — the signature proves the token was issued by your server, not forged by an attacker.

## Experiment

```js
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

console.log("=== Tokens and Signatures ===\n");

// --- Demo 1: HMAC basics ---

console.log("--- HMAC (Hash-based Message Authentication Code) ---\n");

const secret = "my-secret-key-do-not-share";

function sign(message, key) {
  return createHmac("sha256", key).update(message).digest("hex");
}

function verify(message, signature, key) {
  const expected = createHmac("sha256", key).update(message).digest();
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

const message = "Transfer $500 to account 12345";
const hmac = sign(message, secret);

console.log(`  Message:   "${message}"`);
console.log(`  HMAC:      ${hmac}`);
console.log(`  Valid:     ${verify(message, hmac, secret)}`);

// Tamper with the message
const tampered = "Transfer $50000 to account 12345";
console.log(`\n  Tampered:  "${tampered}"`);
console.log(`  Valid:     ${verify(tampered, hmac, secret)} (HMAC doesn't match!)`);

// Wrong key
console.log(`  Wrong key: ${verify(message, hmac, "wrong-key")} (different key = different HMAC)\n`);

// --- Demo 2: Build a JWT from scratch ---

console.log("--- JWT (JSON Web Token) from scratch ---\n");

function base64url(data) {
  const str = typeof data === "string" ? data : JSON.stringify(data);
  return Buffer.from(str).toString("base64url");
}

function base64urlDecode(str) {
  return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
}

function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, error: "Invalid format" };

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  const sigValid = timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureB64)
  );

  if (!sigValid) return { valid: false, error: "Invalid signature" };

  // Decode payload
  const payload = base64urlDecode(payloadB64);

  // Check expiration
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    return { valid: false, error: "Token expired", payload };
  }

  return { valid: true, payload };
}

// Create a JWT
const now = Math.floor(Date.now() / 1000);
const jwtPayload = {
  sub: "user_42",
  name: "Alice",
  role: "admin",
  iat: now,
  exp: now + 3600, // 1 hour
};

const jwtSecret = randomBytes(32).toString("hex");
const token = createJWT(jwtPayload, jwtSecret);

console.log("  JWT Token:");
const [h, p, s] = token.split(".");
console.log(`    Header:    ${h}`);
console.log(`    Payload:   ${p}`);
console.log(`    Signature: ${s}`);
console.log(`    Full:      ${token.slice(0, 50)}...\n`);

// Decode the parts
console.log("  Decoded:");
console.log(`    Header:  ${JSON.stringify(base64urlDecode(h))}`);
console.log(`    Payload: ${JSON.stringify(base64urlDecode(p))}\n`);

// Verify
const result = verifyJWT(token, jwtSecret);
console.log(`  Verification: ${JSON.stringify(result)}\n`);

// --- Demo 3: Tamper detection ---

console.log("--- JWT tamper detection ---\n");

// Try to modify the payload
const parts = token.split(".");
const tamperedPayload = base64urlDecode(parts[1]);
tamperedPayload.role = "superadmin";  // Privilege escalation attempt!
parts[1] = base64url(tamperedPayload);
const tamperedToken = parts.join(".");

const tamperedResult = verifyJWT(tamperedToken, jwtSecret);
console.log(`  Original role:  "admin"`);
console.log(`  Tampered role:  "superadmin"`);
console.log(`  Verification:   ${JSON.stringify(tamperedResult)}`);
console.log("  Signature mismatch — tampering detected!\n");

// Wrong secret
const wrongResult = verifyJWT(token, "wrong-secret");
console.log(`  Wrong secret:   ${JSON.stringify(wrongResult)}\n`);

// --- Demo 4: Token expiration ---

console.log("--- Token expiration ---\n");

const expiredPayload = {
  sub: "user_42",
  iat: now - 7200,
  exp: now - 3600,  // Expired 1 hour ago
};

const expiredToken = createJWT(expiredPayload, jwtSecret);
const expiredResult = verifyJWT(expiredToken, jwtSecret);
console.log(`  Expired token: ${JSON.stringify(expiredResult)}\n`);

// --- Demo 5: Webhook signature verification ---

console.log("--- Webhook signature verification ---\n");

// Stripe-style webhook signature
function signWebhook(payload, secret, timestamp) {
  const message = `${timestamp}.${payload}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

function verifyWebhook(payload, sigHeader, secret) {
  const [tsPart, sigPart] = sigHeader.split(",").map(p => p.split("=")[1]);
  const timestamp = parseInt(tsPart);

  // Reject old webhooks (replay prevention)
  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (age > 300) return { valid: false, error: "Webhook too old" };

  const expected = signWebhook(payload, secret, timestamp);
  const valid = timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(sigPart)
  );

  return { valid, timestamp, age };
}

const webhookPayload = JSON.stringify({ event: "payment.success", amount: 4999 });
const webhookSecret = "whsec_" + randomBytes(16).toString("hex");
const ts = Math.floor(Date.now() / 1000);
const webhookSig = signWebhook(webhookPayload, webhookSecret, ts);

const sigHeader = `t=${ts},v1=${webhookSig}`;
console.log(`  Payload: ${webhookPayload}`);
console.log(`  Signature header: ${sigHeader.slice(0, 50)}...`);
console.log(`  Verification: ${JSON.stringify(verifyWebhook(webhookPayload, sigHeader, webhookSecret))}\n`);

// --- Demo 6: API key generation ---

console.log("--- API key generation ---\n");

function generateApiKey(prefix = "sk") {
  const key = randomBytes(24).toString("base64url");
  return `${prefix}_${key}`;
}

function hashApiKey(apiKey) {
  return createHmac("sha256", "api-key-salt")
    .update(apiKey)
    .digest("hex");
}

const apiKey = generateApiKey("sk_live");
const hashedKey = hashApiKey(apiKey);

console.log(`  API Key:     ${apiKey}`);
console.log(`  Stored hash: ${hashedKey}`);
console.log(`  Never store the raw API key — only the hash!\n`);

console.log("  Verification flow:");
console.log("    1. User sends API key in Authorization header");
console.log("    2. Server hashes the key with HMAC");
console.log("    3. Server looks up the hash in the database");
console.log("    4. If found, the key is valid");
```

## Expected Output

```
=== Tokens and Signatures ===

--- HMAC (Hash-based Message Authentication Code) ---

  Message:   "Transfer $500 to account 12345"
  HMAC:      <hex>
  Valid:     true

  Tampered:  "Transfer $50000 to account 12345"
  Valid:     false (HMAC doesn't match!)
  Wrong key: false

--- JWT (JSON Web Token) from scratch ---

  JWT Token:
    Header:    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
    Payload:   <base64url>
    Signature: <base64url>

  Decoded:
    Header:  {"alg":"HS256","typ":"JWT"}
    Payload: {"sub":"user_42","name":"Alice","role":"admin",...}

  Verification: {"valid":true,"payload":{...}}
  ...
```

## Challenge

1. Implement a refresh token flow: short-lived JWT (15 min) + long-lived opaque refresh token stored in the database. When the JWT expires, use the refresh token to get a new one
2. Build a signed URL system: generate URLs like `/download/file.pdf?expires=123&sig=abc` that expire and can't be tampered with
3. What's the difference between HS256 (HMAC) and RS256 (RSA) for JWT signing? When would you choose each?

## Common Mistakes

- Storing JWT secrets in source code — use environment variables or a secrets manager
- Not checking token expiration (`exp`) — expired tokens should be rejected
- Using `===` instead of `timingSafeEqual` for signature comparison — timing attacks can reveal the expected signature
- Storing sensitive data in JWT payload — JWTs are base64-encoded (readable), not encrypted. Anyone can decode the payload
- Not validating the `alg` header — the "alg: none" attack tricks servers into accepting unsigned tokens
