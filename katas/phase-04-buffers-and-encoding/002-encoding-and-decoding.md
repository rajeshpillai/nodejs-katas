---
id: encoding-and-decoding
phase: 4
phase_title: Buffers, Binary Data & Encoding
sequence: 2
title: Encoding and Decoding
difficulty: beginner
tags: [encoding, utf8, base64, hex, ascii]
prerequisites: [what-is-a-buffer]
estimated_minutes: 12
---

## Concept

Encoding is the bridge between bytes and text. The same sequence of bytes can mean completely different things depending on which encoding you use to interpret them.

Node.js supports these encodings:

| Encoding | Description | Use Case |
|----------|-------------|----------|
| `utf-8` | Variable-width Unicode (1–4 bytes per character) | Default for text files, JSON, HTML |
| `ascii` | 7-bit ASCII (0–127 only) | Legacy protocols |
| `latin1` | 8-bit single-byte (0–255) | Binary-to-string conversion, legacy |
| `base64` | 6-bit encoding into printable ASCII | Embedding binary in JSON, email, data URIs |
| `base64url` | URL-safe base64 (`-` and `_` instead of `+` and `/`) | JWTs, URLs |
| `hex` | Each byte as two hex characters | Hashes, debugging, binary inspection |
| `utf16le` | 2 or 4 bytes per character, little-endian | Windows APIs, some file formats |

The critical concept: **encoding is not encryption**. Base64 doesn't protect data — it just represents binary bytes using printable characters so they can travel through text-only channels (JSON, URLs, email).

## Key Insight

> Every string in JavaScript is internally UTF-16. Every file on disk is just bytes. Encoding is the contract that says "these bytes mean this text." Get the encoding wrong and you get garbage — not an error. This is why `Content-Type: text/html; charset=utf-8` matters.

## Experiment

```js
console.log("=== UTF-8 Encoding ===\n");

const text = "Hello, 世界! 🌍";
const utf8Buf = Buffer.from(text, "utf-8");

console.log("Text:", text);
console.log("String length:", text.length, "(UTF-16 code units)");
console.log("UTF-8 bytes:", utf8Buf.length);
console.log("Hex:", utf8Buf.toString("hex"));

// Show how different characters use different byte counts
const examples = ["A", "é", "世", "🌍"];
console.log("\nBytes per character in UTF-8:");
for (const ch of examples) {
  const buf = Buffer.from(ch);
  console.log(`  '${ch}' → ${buf.length} byte(s): [${[...buf].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
}

console.log("\n=== Base64 Encoding ===\n");

// Text → Base64
const message = "Node.js is awesome";
const base64 = Buffer.from(message).toString("base64");
console.log("Original:", message);
console.log("Base64:  ", base64);

// Base64 → Text
const decoded = Buffer.from(base64, "base64").toString("utf-8");
console.log("Decoded: ", decoded);

// Base64 makes binary safe for text channels
const binaryData = Buffer.from([0x00, 0xFF, 0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
console.log("\nBinary data:", binaryData);
console.log("As base64:", binaryData.toString("base64"));
console.log("As hex:   ", binaryData.toString("hex"));

// Base64url for URLs and JWTs
const urlSafe = Buffer.from(message).toString("base64url");
console.log("\nBase64:   ", base64);
console.log("Base64url:", urlSafe);

console.log("\n=== Hex Encoding ===\n");

const hexString = "48656c6c6f";
const fromHex = Buffer.from(hexString, "hex");
console.log("Hex string:", hexString);
console.log("Decoded:", fromHex.toString());
console.log("Bytes:", [...fromHex]);

// Hex is useful for inspecting binary data
const hash = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
console.log("\nHash bytes:", hash.toString("hex"));

console.log("\n=== Encoding Mismatches ===\n");

// What happens when you decode with the wrong encoding
const japanese = "日本語";
const utf8Bytes = Buffer.from(japanese, "utf-8");

console.log("Original:", japanese);
console.log("UTF-8 bytes:", [...utf8Bytes]);
console.log("Decoded as UTF-8:", utf8Bytes.toString("utf-8"));
console.log("Decoded as latin1:", utf8Bytes.toString("latin1"), "(garbage!)");
console.log("Decoded as ascii:", utf8Bytes.toString("ascii"), "(garbage!)");
console.log("Decoded as hex:", utf8Bytes.toString("hex"));

console.log("\n=== Practical: Data URI ===\n");

// Create a data URI (like embedding an image in HTML)
const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
console.log("SVG Data URI:");
console.log(dataUri);
console.log("\nDecoded back:");
const base64Part = dataUri.split(",")[1];
console.log(Buffer.from(base64Part, "base64").toString());
```

## Expected Output

```
=== UTF-8 Encoding ===

Text: Hello, 世界! 🌍
String length: 13 (UTF-16 code units)
UTF-8 bytes: 18
Hex: 48656c6c6f2c20e4b896e7958c2120f09f8c8d

Bytes per character in UTF-8:
  'A' → 1 byte(s): [0x41]
  'é' → 2 byte(s): [0xc3, 0xa9]
  '世' → 3 byte(s): [0xe4, 0xb8, 0x96]
  '🌍' → 4 byte(s): [0xf0, 0x9f, 0x8c, 0x8d]

=== Base64 Encoding ===

Original: Node.js is awesome
Base64:   Tm9kZS5qcyBpcyBhd2Vzb21l
Decoded:  Node.js is awesome

Binary data: <Buffer 00 ff 89 50 4e 47>
As base64: AP+JUEVH
As hex:    00ff89504e47

Base64:    Tm9kZS5qcyBpcyBhd2Vzb21l
Base64url: Tm9kZS5qcyBpcyBhd2Vzb21l

=== Hex Encoding ===

Hex string: 48656c6c6f
Decoded: Hello
Bytes: [ 72, 101, 108, 108, 111 ]

Hash bytes: deadbeef

=== Encoding Mismatches ===

Original: 日本語
UTF-8 bytes: [ 230, 151, ... ]
Decoded as UTF-8: 日本語
Decoded as latin1: <garbled text>
Decoded as ascii: <garbled text>
Decoded as hex: <hex string>

=== Practical: Data URI ===

SVG Data URI:
data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDov...
Decoded back:
<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>
```

## Challenge

1. Encode the string `"secret:password"` as base64 — this is how HTTP Basic Authentication works. What header value would you send?
2. Take a hex hash like `"a3f2b8c1"` and convert it to base64. Why might you want to do this? (Hint: shorter representation)
3. Read a file as a Buffer, convert to base64, then convert back and verify the bytes match using `Buffer.compare()`

## Deep Dive

Why base64 exists: Binary data (bytes 0–255) can include values that break text protocols. A null byte (0x00) terminates C strings. Control characters corrupt terminals. Base64 re-encodes binary using only 64 "safe" printable characters (`A-Z`, `a-z`, `0-9`, `+`, `/`), at the cost of ~33% size increase.

Base64 encoding expands data because it uses 6 bits per character (64 = 2^6) while a byte has 8 bits. Three bytes (24 bits) become four base64 characters (24 bits). So the ratio is 4/3 — every 3 bytes become 4 characters.

## Common Mistakes

- Treating base64 as encryption — it's trivially reversible, not a security measure
- Double-encoding: `Buffer.from(Buffer.from("hello").toString("base64"))` creates a Buffer of the base64 *string*, not the original data. You need `Buffer.from(str, "base64")` to decode
- Ignoring encoding when reading files — `readFile(path)` returns a Buffer, `readFile(path, "utf-8")` returns a string
- Assuming string length equals byte length — true only for ASCII. UTF-8 characters can be 1–4 bytes
