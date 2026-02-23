---
id: file-size-limits
phase: 8.5
phase_title: File Uploads & Multipart Streaming
sequence: 3
title: File Size Limits and Validation
difficulty: intermediate
tags: [upload, validation, size-limits, security, mime-type]
prerequisites: [streaming-uploads]
estimated_minutes: 12
---

## Concept

Accepting file uploads without limits is a denial-of-service vulnerability. An attacker can send a 100 GB file and exhaust your server's disk or memory. Every upload endpoint needs:

1. **Total body size limit** — reject requests exceeding N bytes before reading the full body
2. **Per-file size limit** — individual files can't exceed a maximum
3. **File count limit** — maximum number of files per request
4. **File type validation** — verify the file is an allowed type (not just by extension — check magic bytes)
5. **Filename sanitization** — prevent path traversal attacks

These checks must happen **during streaming**, not after buffering the entire upload. Check the `Content-Length` header first (fast rejection), then enforce limits as bytes arrive (defense in depth, since `Content-Length` can be spoofed).

## Key Insight

> Validate during streaming, not after. If a client sends a 10 GB file and your limit is 10 MB, you should abort at 10 MB — not after receiving and storing all 10 GB. Check `Content-Length` first for a fast reject, then count bytes as they stream. Destroy the socket the moment a limit is exceeded.

## Experiment

```js
import { createServer } from "http";
import { writeFile, unlink, stat as fsStat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

console.log("=== Upload Validation ===\n");

// --- File Type Detection by Magic Bytes ---

const MAGIC_BYTES = [
  { type: "image/jpeg", ext: "jpg", magic: [0xFF, 0xD8, 0xFF] },
  { type: "image/png", ext: "png", magic: [0x89, 0x50, 0x4E, 0x47] },
  { type: "image/gif", ext: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
  { type: "application/pdf", ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  { type: "application/zip", ext: "zip", magic: [0x50, 0x4B, 0x03, 0x04] },
  { type: "image/webp", ext: "webp", magic: [0x52, 0x49, 0x46, 0x46], offset: 0,
    extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
];

function detectFileType(buffer) {
  for (const entry of MAGIC_BYTES) {
    let matches = true;
    const offset = entry.offset || 0;

    for (let i = 0; i < entry.magic.length; i++) {
      if (buffer[offset + i] !== entry.magic[i]) {
        matches = false;
        break;
      }
    }

    if (matches && entry.extra) {
      for (let i = 0; i < entry.extra.bytes.length; i++) {
        if (buffer[entry.extra.offset + i] !== entry.extra.bytes[i]) {
          matches = false;
          break;
        }
      }
    }

    if (matches) {
      return { type: entry.type, ext: entry.ext };
    }
  }

  return null;
}

// Demo: detect file types
console.log("Magic byte detection:");
const testFiles = [
  { name: "JPEG", bytes: [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10] },
  { name: "PNG", bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A] },
  { name: "PDF", bytes: [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31] },
  { name: "ZIP", bytes: [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00] },
  { name: "Unknown", bytes: [0x00, 0x01, 0x02, 0x03] },
  { name: "Fake (renamed .jpg)", bytes: [0x3C, 0x68, 0x74, 0x6D, 0x6C] }, // HTML pretending to be JPEG
];

for (const { name, bytes } of testFiles) {
  const detected = detectFileType(Buffer.from(bytes));
  console.log(`  ${name.padEnd(25)} → ${detected ? `${detected.type} (.${detected.ext})` : "unknown"}`);
}

// --- Filename Sanitization ---

console.log("\n=== Filename Sanitization ===\n");

function sanitizeFilename(filename) {
  // Remove path components
  let safe = filename.replace(/^.*[\\/]/, "");

  // Remove null bytes
  safe = safe.replace(/\0/g, "");

  // Replace dangerous characters
  safe = safe.replace(/[<>:"/\\|?*]/g, "_");

  // Remove leading dots (hidden files on Unix)
  safe = safe.replace(/^\.+/, "");

  // Limit length
  if (safe.length > 200) {
    const ext = safe.slice(safe.lastIndexOf("."));
    safe = safe.slice(0, 200 - ext.length) + ext;
  }

  // Fallback for empty or all-dots
  if (!safe || safe === ".") {
    safe = "upload";
  }

  return safe;
}

const dangerousNames = [
  "normal.jpg",
  "../../etc/passwd",
  "..\\..\\windows\\system32\\evil.exe",
  ".htaccess",
  "file\x00.jpg.exe",
  'file<script>.html',
  "a".repeat(300) + ".pdf",
  "",
];

console.log("Filename sanitization:");
for (const name of dangerousNames) {
  const display = name.length > 40 ? name.slice(0, 37) + "..." : name;
  console.log(`  ${JSON.stringify(display).padEnd(44)} → "${sanitizeFilename(name)}"`);
}

// --- Upload Server with Limits ---

console.log("\n=== Upload Server with Limits ===\n");

const LIMITS = {
  maxBodySize: 5 * 1024 * 1024,      // 5 MB total
  maxFileSize: 2 * 1024 * 1024,       // 2 MB per file
  maxFiles: 3,                         // 3 files max
  allowedTypes: ["image/jpeg", "image/png", "application/pdf"],
};

console.log("Limits:", {
  maxBodySize: `${LIMITS.maxBodySize / 1024 / 1024} MB`,
  maxFileSize: `${LIMITS.maxFileSize / 1024 / 1024} MB`,
  maxFiles: LIMITS.maxFiles,
  allowedTypes: LIMITS.allowedTypes,
});

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/upload") {
    res.writeHead(404).end();
    return;
  }

  const json = (data, status = 200) => {
    const body = JSON.stringify(data);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  };

  // Check 1: Content-Length header (fast reject)
  const contentLength = parseInt(req.headers["content-length"] || "0");
  if (contentLength > LIMITS.maxBodySize) {
    json({
      error: "Payload too large",
      maxSize: LIMITS.maxBodySize,
      receivedSize: contentLength,
    }, 413);
    req.destroy();  // Stop receiving data
    return;
  }

  // Check 2: Count bytes as they stream
  let totalBytes = 0;
  const chunks = [];

  try {
    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > LIMITS.maxBodySize) {
        json({ error: "Body size exceeds limit during transfer" }, 413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
  } catch {
    return;  // Client disconnected
  }

  const body = Buffer.concat(chunks);

  // Simulate parsing parts (simplified — just check each "file")
  // In production, use the streaming parser from the previous kata
  const files = [
    { name: "small.jpg", data: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(500).fill(0x42)]) },
    { name: "doc.pdf", data: Buffer.from([0x25, 0x50, 0x44, 0x46, ...Array(1000).fill(0x42)]) },
  ];

  // Check 3: File count
  if (files.length > LIMITS.maxFiles) {
    json({ error: `Too many files (max ${LIMITS.maxFiles})` }, 422);
    return;
  }

  const validatedFiles = [];
  const errors = [];

  for (const file of files) {
    // Check 4: Per-file size
    if (file.data.length > LIMITS.maxFileSize) {
      errors.push({ file: file.name, error: `Exceeds ${LIMITS.maxFileSize / 1024 / 1024} MB limit` });
      continue;
    }

    // Check 5: File type by magic bytes
    const detected = detectFileType(file.data);
    if (!detected || !LIMITS.allowedTypes.includes(detected.type)) {
      errors.push({
        file: file.name,
        error: `Type not allowed: ${detected?.type || "unknown"}`,
        allowed: LIMITS.allowedTypes,
      });
      continue;
    }

    // Check 6: Sanitize filename
    const safeName = sanitizeFilename(file.name);

    validatedFiles.push({
      originalName: file.name,
      safeName,
      detectedType: detected.type,
      size: file.data.length,
    });
  }

  json({
    accepted: validatedFiles,
    rejected: errors,
    totalBytes,
  });
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

// Test uploads
console.log("\n--- Testing limits ---\n");

// Normal upload
const res1 = await fetch(`http://127.0.0.1:${port}/upload`, {
  method: "POST",
  headers: { "Content-Type": "multipart/form-data; boundary=test" },
  body: Buffer.alloc(100),
});
console.log("Normal upload:", (await res1.json()).accepted?.length ?? 0, "files accepted");

// Oversized upload (via Content-Length)
const res2 = await fetch(`http://127.0.0.1:${port}/upload`, {
  method: "POST",
  headers: {
    "Content-Type": "multipart/form-data; boundary=test",
    "Content-Length": String(10 * 1024 * 1024),
  },
  body: Buffer.alloc(100),  // Actual body doesn't matter — header triggers rejection
});
console.log("Oversized (header):", res2.status, (await res2.json()).error);

server.close();
console.log("\nDone");
```

## Expected Output

```
=== Upload Validation ===

Magic byte detection:
  JPEG                      → image/jpeg (.jpg)
  PNG                       → image/png (.png)
  PDF                       → application/pdf (.pdf)
  ZIP                       → application/zip (.zip)
  Unknown                   → unknown
  Fake (renamed .jpg)       → unknown

=== Filename Sanitization ===

Filename sanitization:
  "normal.jpg"                               → "normal.jpg"
  "../../etc/passwd"                         → "passwd"
  "..\\..\\windows\\system32\\evil.exe"      → "evil.exe"
  ".htaccess"                                → "htaccess"
  ...

=== Upload Server with Limits ===

Limits: { maxBodySize: '5 MB', maxFileSize: '2 MB', maxFiles: 3, allowedTypes: [...] }

--- Testing limits ---

Normal upload: 2 files accepted
Oversized (header): 413 Payload too large
```

## Challenge

1. Implement a content-type whitelist that checks both the declared `Content-Type` header AND the magic bytes — reject if they don't match (prevents someone uploading a `.exe` renamed to `.jpg`)
2. Add virus scanning integration: pipe each uploaded file through a ClamAV stream scanner before accepting it
3. Implement upload quotas: each user gets 100 MB total storage. Track usage and reject when quota is exceeded

## Common Mistakes

- Only checking file extension, not magic bytes — trivially bypassed by renaming files
- Only checking `Content-Length` header — it can be set to 0 while sending a huge body. Count bytes during transfer
- Not destroying the request stream on rejection — the server keeps receiving data it will discard
- Trusting the client's `Content-Type` header for the file — always verify with magic bytes
