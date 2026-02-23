---
id: buffer-operations
phase: 4
phase_title: Buffers, Binary Data & Encoding
sequence: 3
title: Buffer Operations
difficulty: intermediate
tags: [buffer, slice, copy, concat, typed-arrays]
prerequisites: [encoding-and-decoding]
estimated_minutes: 12
---

## Concept

Working with Buffers means manipulating raw bytes — slicing, copying, concatenating, searching, and filling. These operations are critical for parsing network protocols, file formats, and binary data streams.

Key operations:
- **`buf.slice()` / `buf.subarray()`** — create a view (shares memory!)
- **`Buffer.concat(list)`** — combine multiple buffers into one
- **`buf.copy(target)`** — copy bytes between buffers
- **`buf.fill(value)`** — fill with a repeated value
- **`buf.indexOf(value)`** / **`buf.includes(value)`** — search for bytes
- **`buf.write(string, offset)`** — write a string at a position

The most important thing to understand: `slice()` and `subarray()` return **views** into the same memory. Modifying the slice modifies the original. If you need an independent copy, use `Buffer.from(buf)` or `buf.slice().map(x => x)` won't work — use `Buffer.copyBytesFrom()` or the copy pattern.

## Key Insight

> `buf.slice()` shares memory with the original buffer. This is a performance feature — no bytes are copied — but it means modifying the slice modifies the original. This catches people who expect slice to behave like `Array.prototype.slice()` (which copies).

## Experiment

```js
console.log("=== Slicing (Shared Memory!) ===\n");

const original = Buffer.from("Hello, World!");
const slice = original.slice(0, 5);

console.log("Original:", original.toString());
console.log("Slice:   ", slice.toString());

// Modify the slice — it changes the original!
slice[0] = 0x4A;  // 'J'
console.log("\nAfter modifying slice[0] to 'J':");
console.log("Slice:   ", slice.toString());
console.log("Original:", original.toString(), "← also changed!");

// To get an independent copy
const copy = Buffer.from(original.slice(7, 13));
copy[0] = 0x45;  // 'E'
console.log("\nIndependent copy modified:");
console.log("Copy:    ", copy.toString());
console.log("Original:", original.toString(), "← unchanged");

console.log("\n=== Concatenating Buffers ===\n");

const parts = [
  Buffer.from("HTTP/1.1 "),
  Buffer.from("200 "),
  Buffer.from("OK\r\n"),
];
const combined = Buffer.concat(parts);
console.log("Parts:", parts.map(p => p.toString()));
console.log("Combined:", combined.toString());
console.log("Total length:", combined.length, "bytes");

// Concat with target length (truncates or pads)
const truncated = Buffer.concat(parts, 10);
console.log("Truncated to 10:", truncated.toString());

console.log("\n=== Copying Between Buffers ===\n");

const source = Buffer.from("ABCDEFGH");
const target = Buffer.alloc(8, 0x2D);  // fill with '-'
console.log("Source:", source.toString());
console.log("Target:", target.toString());

// Copy bytes 2-5 from source to target starting at position 1
source.copy(target, 1, 2, 6);
console.log("After copy(target, 1, 2, 6):", target.toString());
console.log("  Meaning: copy source[2..6] → target[1..]");

console.log("\n=== Filling Buffers ===\n");

const buf = Buffer.alloc(10);
buf.fill(0xAA);
console.log("Fill with 0xAA:", [...buf].map(b => '0x' + b.toString(16)));

buf.fill("ab");
console.log("Fill with 'ab':", buf.toString());

buf.fill(0x00, 3, 7);  // zero out bytes 3-6
console.log("Zero bytes 3-6:", [...buf].map(b => '0x' + b.toString(16)));

console.log("\n=== Searching in Buffers ===\n");

const data = Buffer.from("Hello, Hello, Hello!");

console.log("Data:", data.toString());
console.log("indexOf('Hello'):", data.indexOf("Hello"));
console.log("indexOf('Hello', 1):", data.indexOf("Hello", 1));
console.log("lastIndexOf('Hello'):", data.lastIndexOf("Hello"));
console.log("includes('World'):", data.includes("World"));
console.log("includes('Hello'):", data.includes("Hello"));

// Search for a byte value
console.log("indexOf(0x2C):", data.indexOf(0x2C), "(comma)");

console.log("\n=== Writing to Buffers ===\n");

const response = Buffer.alloc(32);
let offset = 0;

offset += response.write("OK", offset);
offset += response.write(" | ", offset);
offset += response.write("200", offset);

console.log("Written:", response.slice(0, offset).toString());
console.log("Offset after writes:", offset);

// write returns bytes written (not always === string length)
const emoji = "🚀";
const emojiBytes = response.write(emoji, offset);
console.log(`\nEmoji '${emoji}' wrote ${emojiBytes} bytes (string length: ${emoji.length})`);
```

## Expected Output

```
=== Slicing (Shared Memory!) ===

Original: Hello, World!
Slice:    Hello

After modifying slice[0] to 'J':
Slice:    Jello
Original: Jello, World! ← also changed!

Independent copy modified:
Copy:    Eorld!
Original: Jello, World! ← unchanged

=== Concatenating Buffers ===

Parts: [ 'HTTP/1.1 ', '200 ', 'OK\r\n' ]
Combined: HTTP/1.1 200 OK\r\n
Total length: 17 bytes
Truncated to 10: HTTP/1.1 2

=== Copying Between Buffers ===

Source: ABCDEFGH
Target: --------
After copy(target, 1, 2, 6): -CDEF---
  Meaning: copy source[2..6] → target[1..]

=== Filling Buffers ===

Fill with 0xAA: [ 0xaa, 0xaa, ... ]
Fill with 'ab': ababababab
Zero bytes 3-6: [ 0x61, 0x62, 0x61, 0x00, 0x00, 0x00, 0x00, 0x62, 0x61, 0x62 ]

=== Searching in Buffers ===

Data: Hello, Hello, Hello!
indexOf('Hello'): 0
indexOf('Hello', 1): 7
lastIndexOf('Hello'): 14
includes('World'): false
includes('Hello'): true
indexOf(0x2C): 5 (comma)

=== Writing to Buffers ===

Written: OK | 200
Offset after writes: 8
Emoji '🚀' wrote 4 bytes (string length: 2)
```

## Challenge

1. Implement a function that splits a Buffer on a delimiter byte (like `String.split()` but for Buffers). Example: split on `0x0A` (newline) to parse lines from binary data
2. Build a simple buffer pool: pre-allocate a large Buffer and hand out slices. Track which slices are "in use" and reclaim them when released
3. Write a function that finds all occurrences of a pattern in a Buffer (like a binary `matchAll`)

## Deep Dive

`Buffer.slice()` vs `Buffer.subarray()`:
Both return views into the same memory. `slice()` was the original Node.js API. `subarray()` comes from `Uint8Array`. In modern Node.js they behave identically. The `subarray()` name is more explicit about what it does — it returns a sub-view of the array, not a copy.

For performance-critical code, views are essential. If you're parsing a 10 MB network packet and need to extract a 20-byte header, creating a view costs nothing — no memory allocation, no copying. Creating a copy would allocate 20 bytes and copy them.

## Common Mistakes

- Assuming `buf.slice()` copies data — it creates a view. Mutating the slice mutates the original
- Using `Buffer.concat()` in a loop — each call allocates a new buffer and copies everything. Collect parts in an array, then concat once
- Forgetting that `buf.write()` returns bytes written, not characters written — important for multi-byte characters
- Not tracking offsets when building binary messages — off-by-one errors in binary protocols cause cascading parse failures
