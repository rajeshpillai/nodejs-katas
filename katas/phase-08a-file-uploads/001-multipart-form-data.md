---
id: multipart-form-data
phase: 8.5
phase_title: File Uploads & Multipart Streaming
sequence: 1
title: Understanding multipart/form-data
difficulty: intermediate
tags: [multipart, form-data, upload, boundary, mime]
prerequisites: [request-response-lifecycle]
estimated_minutes: 15
---

## Concept

When a browser sends a file upload, it uses `Content-Type: multipart/form-data`. This encoding packages multiple fields — text inputs, files, binary data — into a single HTTP request body, separated by a **boundary** string.

A multipart body looks like this on the wire:

```
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxk

------WebKitFormBoundary7MA4YWxk
Content-Disposition: form-data; name="username"

alice
------WebKitFormBoundary7MA4YWxk
Content-Disposition: form-data; name="avatar"; filename="photo.jpg"
Content-Type: image/jpeg

<binary JPEG data>
------WebKitFormBoundary7MA4YWxk--
```

The structure:
1. The `Content-Type` header includes the boundary string
2. Each part starts with `--boundary\r\n`
3. Each part has its own headers (`Content-Disposition`, optionally `Content-Type`)
4. Headers and body are separated by `\r\n\r\n`
5. The final boundary ends with `--boundary--\r\n`

Understanding this format is essential because every file upload on the web uses it. Frameworks hide the parsing, but when something goes wrong — large files, encoding issues, timeouts — you need to know what's happening at the protocol level.

## Key Insight

> `multipart/form-data` is just a text framing protocol over HTTP. Each "part" is a mini HTTP message with its own headers and body, separated by a boundary string. Parsing it is fundamentally the same as parsing HTTP: scan for boundaries, extract headers, read the body. The hard part is doing this as a stream without buffering everything in memory.

## Experiment

```js
import { createServer } from "http";

console.log("=== Multipart/form-data Format ===\n");

// Manually construct a multipart body to see the format
const boundary = "----KataBoundary" + Date.now();

function buildMultipart(fields) {
  const parts = [];

  for (const field of fields) {
    let part = `--${boundary}\r\n`;
    part += `Content-Disposition: form-data; name="${field.name}"`;

    if (field.filename) {
      part += `; filename="${field.filename}"`;
    }
    part += "\r\n";

    if (field.contentType) {
      part += `Content-Type: ${field.contentType}\r\n`;
    }

    part += "\r\n";

    parts.push(Buffer.from(part));
    parts.push(Buffer.isBuffer(field.value) ? field.value : Buffer.from(field.value));
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

// Build a sample multipart body
const body = buildMultipart([
  { name: "username", value: "alice" },
  { name: "bio", value: "Hello, I like Node.js!" },
  { name: "avatar", filename: "photo.jpg", contentType: "image/jpeg",
    value: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]) }, // JPEG magic bytes
  { name: "document", filename: "readme.txt", contentType: "text/plain",
    value: "This is a text file.\nLine 2." },
]);

console.log("Boundary:", boundary);
console.log("Body size:", body.length, "bytes");
console.log("\nRaw multipart body (text parts shown, binary abbreviated):");
const bodyStr = body.toString("utf-8");
const lines = bodyStr.split("\r\n");
for (const line of lines) {
  if (line.length > 80) {
    console.log(`  ${line.slice(0, 40)}... (${line.length} chars)`);
  } else {
    console.log(`  ${line}`);
  }
}

console.log("\n=== Parsing Multipart ===\n");

// Simple multipart parser (educational, not production-grade)
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBoundaryBuf = Buffer.from(`--${boundary}--`);

  let offset = 0;

  // Find each boundary
  while (offset < buffer.length) {
    // Find start of next boundary
    const boundaryStart = buffer.indexOf(boundaryBuf, offset);
    if (boundaryStart === -1) break;

    // Check if this is the end boundary
    if (buffer.indexOf(endBoundaryBuf, boundaryStart) === boundaryStart) {
      break;
    }

    // Skip past boundary + CRLF
    let headerStart = boundaryStart + boundaryBuf.length + 2;  // +2 for \r\n

    // Find end of headers (double CRLF)
    const headerEnd = buffer.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) break;

    // Parse headers
    const headerText = buffer.slice(headerStart, headerEnd).toString();
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        headers[key] = value;
      }
    }

    // Extract field info from Content-Disposition
    const disposition = headers["content-disposition"] || "";
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]+)"/);

    // Find the body (between header end and next boundary)
    const bodyStart = headerEnd + 4;  // +4 for \r\n\r\n
    const nextBoundary = buffer.indexOf(boundaryBuf, bodyStart);
    const bodyEnd = nextBoundary - 2;  // -2 for preceding \r\n

    const partBody = buffer.slice(bodyStart, bodyEnd);

    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: headers["content-type"] || null,
      headers,
      body: partBody,
      size: partBody.length,
    });

    offset = nextBoundary;
  }

  return parts;
}

const parsed = parseMultipart(body, boundary);
console.log(`Found ${parsed.length} parts:\n`);

for (const part of parsed) {
  console.log(`  Field: "${part.name}"`);
  if (part.filename) {
    console.log(`    Filename: ${part.filename}`);
    console.log(`    Content-Type: ${part.contentType}`);
    console.log(`    Size: ${part.size} bytes`);
    console.log(`    First bytes: [${[...part.body.slice(0, 8)].map(b => '0x' + b.toString(16)).join(', ')}]`);
  } else {
    console.log(`    Value: "${part.body.toString()}"`);
  }
  console.log();
}

console.log("=== Multipart Upload Server ===\n");

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/upload") {
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);

    if (!boundaryMatch) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing boundary" }));
      return;
    }

    // Read full body (educational only — production should stream)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const fullBody = Buffer.concat(chunks);

    const parts = parseMultipart(fullBody, boundaryMatch[1]);

    const result = parts.map(p => ({
      name: p.name,
      filename: p.filename,
      contentType: p.contentType,
      size: p.size,
      preview: p.filename ? `<${p.size} bytes>` : p.body.toString().slice(0, 100),
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ parts: result, totalParts: parts.length }));
    return;
  }

  res.writeHead(404).end();
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

// Send our multipart body to the server
const uploadRes = await fetch(`http://127.0.0.1:${port}/upload`, {
  method: "POST",
  headers: {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  },
  body: body,
});

const uploadData = await uploadRes.json();
console.log("Upload response:");
console.log(JSON.stringify(uploadData, null, 2));

server.close();
console.log("\nDone");
```

## Expected Output

```
=== Multipart/form-data Format ===

Boundary: ----KataBoundary<timestamp>
Body size: <number> bytes

Raw multipart body:
  ------KataBoundary...
  Content-Disposition: form-data; name="username"

  alice
  ------KataBoundary...
  Content-Disposition: form-data; name="bio"

  Hello, I like Node.js!
  ...

=== Parsing Multipart ===

Found 4 parts:

  Field: "username"
    Value: "alice"

  Field: "bio"
    Value: "Hello, I like Node.js!"

  Field: "avatar"
    Filename: photo.jpg
    Content-Type: image/jpeg
    Size: 8 bytes
    First bytes: [0xff, 0xd8, 0xff, 0xe0, ...]

  Field: "document"
    Filename: readme.txt
    Content-Type: text/plain
    Size: 28 bytes

=== Multipart Upload Server ===

Upload response:
{
  "parts": [...],
  "totalParts": 4
}
```

## Challenge

1. What happens if the boundary string appears inside a file's binary content? How does the multipart spec handle this? (Hint: the boundary is chosen to be unique)
2. Build a multipart encoder that creates a `ReadableStream` — don't buffer the entire body, stream each part
3. Parse a multipart body where a field value contains Unicode and is encoded differently — how do you handle encoding?

## Deep Dive

Why `multipart/form-data` instead of JSON for file uploads:

JSON can carry binary data as base64, but that adds 33% overhead. A 100 MB file becomes 133 MB of base64 text. Multipart carries binary directly — the raw bytes go on the wire. It also naturally handles mixed content: text fields and binary files in the same request.

The `application/x-www-form-urlencoded` content type is for simple form fields only — it encodes everything as key=value pairs, and binary data must be percent-encoded (3 bytes per input byte for non-ASCII).

## Common Mistakes

- Buffering the entire upload in memory — a 2 GB video upload should be streamed to disk, not held in RAM
- Not validating the boundary exists in the `Content-Type` header — crash on missing boundary
- Assuming parts arrive in a specific order — the spec doesn't guarantee ordering
- Not handling the case where `filename` is present but empty — some browsers send `filename=""` for empty file inputs
