---
id: length-prefix-framing
phase: 6
phase_title: Networking Fundamentals
sequence: 5
title: Length-Prefix Framing
difficulty: intermediate
tags: [tcp, framing, protocol, length-prefix, message-boundary]
prerequisites: [tcp-basics, parsing-binary-protocols]
estimated_minutes: 18
---

## Concept

TCP is a byte stream — it has no concept of messages. When you call `socket.write("Hello")` followed by `socket.write("World")`, the receiver might get `"HelloWorld"` as one chunk, or `"Hel"` and `"loWorld"` as two, or any other split. This is called the **TCP framing problem**.

To send discrete messages over TCP, you need a **framing protocol** — a way to mark where each message begins and ends. The two main approaches:

**1. Delimiter-based framing** — end each message with a special byte sequence (like `\r\n`):
- Pro: Simple to implement
- Con: The delimiter can't appear in the message (or must be escaped)
- Used by: HTTP/1.1 headers, Redis RESP, line-based protocols

**2. Length-prefix framing** — prepend each message with its byte length:
- Pro: Works with any content, including binary
- Con: Must buffer until the full message arrives
- Used by: PostgreSQL wire protocol, HTTP/2, Protocol Buffers, WebSocket

Length-prefix is the industry standard for binary protocols because it works with any payload and is efficient to parse.

## Key Insight

> The most common network programming bug is assuming one `write()` = one `data` event. It doesn't. You will eventually receive half a message, or two messages merged. Length-prefix framing solves this completely: read the length, buffer exactly that many bytes, emit the complete message. Every production TCP protocol does this.

## Experiment

```js
import { createServer, createConnection } from "net";

console.log("=== The Framing Problem ===\n");

// First, show the problem: messages get merged
const rawServer = createServer((socket) => {
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk.toString()));
  socket.on("end", () => {
    socket.write(JSON.stringify(chunks));
    socket.end();
  });
});

await new Promise(resolve => rawServer.listen(0, "127.0.0.1", resolve));
const rawPort = rawServer.address().port;

const rawClient = createConnection({ host: "127.0.0.1", port: rawPort });
await new Promise(resolve => rawClient.on("connect", resolve));

// Send 5 "messages" as fast as possible
rawClient.write("msg-1");
rawClient.write("msg-2");
rawClient.write("msg-3");
rawClient.write("msg-4");
rawClient.write("msg-5");
rawClient.end();

const rawResult = await new Promise(resolve => {
  const chunks = [];
  rawClient.on("data", (chunk) => chunks.push(chunk));
  rawClient.on("end", () => resolve(Buffer.concat(chunks).toString()));
});

console.log("Sent 5 separate writes");
console.log("Server received these chunks:", rawResult);
console.log("(Messages may be merged — TCP doesn't preserve boundaries!)\n");

rawServer.close();

console.log("=== Length-Prefix Framing Protocol ===\n");

// Frame format: [4 bytes: payload length (uint32 BE)] [N bytes: payload]

class FrameEncoder {
  static encode(payload) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const frame = Buffer.alloc(4 + data.length);
    frame.writeUInt32BE(data.length, 0);
    data.copy(frame, 4);
    return frame;
  }
}

class FrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.messages = [];
  }

  // Feed incoming TCP data — returns complete messages
  feed(chunk) {
    // Append new data to our buffer
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];

    // Extract complete frames
    while (this.buffer.length >= 4) {
      const payloadLength = this.buffer.readUInt32BE(0);

      // Do we have the complete frame?
      if (this.buffer.length < 4 + payloadLength) {
        break;  // Wait for more data
      }

      // Extract the payload
      const payload = this.buffer.slice(4, 4 + payloadLength);
      messages.push(payload);

      // Remove this frame from the buffer
      this.buffer = this.buffer.slice(4 + payloadLength);
    }

    return messages;
  }
}

// Demonstrate encoding
const encoded = FrameEncoder.encode("Hello, Framing!");
console.log("Encoded frame:");
console.log("  Length prefix:", encoded.readUInt32BE(0), "bytes");
console.log("  Payload:", encoded.slice(4).toString());
console.log("  Full frame hex:", encoded.toString("hex"));

// Demonstrate decoding with fragmented data
console.log("\nDecoding fragmented data:");
const decoder = new FrameDecoder();

// Simulate receiving data in arbitrary chunks
const frame1 = FrameEncoder.encode("First message");
const frame2 = FrameEncoder.encode("Second message");
const frame3 = FrameEncoder.encode("Third message");

const allData = Buffer.concat([frame1, frame2, frame3]);

// Feed it in weird-sized chunks (simulating TCP fragmentation)
const chunkSizes = [3, 10, 5, 20, allData.length];
let offset = 0;

for (const size of chunkSizes) {
  if (offset >= allData.length) break;
  const chunk = allData.slice(offset, Math.min(offset + size, allData.length));
  offset += size;

  const messages = decoder.feed(chunk);
  console.log(`  Fed ${chunk.length} bytes → ${messages.length} complete message(s)`);
  for (const msg of messages) {
    console.log(`    → "${msg.toString()}"`);
  }
}

console.log("\n=== Full Server/Client Example ===\n");

const framingServer = createServer((socket) => {
  const decoder = new FrameDecoder();
  let msgCount = 0;

  socket.on("data", (chunk) => {
    const messages = decoder.feed(chunk);
    for (const msg of messages) {
      msgCount++;
      const text = msg.toString();
      console.log(`[server] Message ${msgCount}: "${text}"`);

      // Reply with framed response
      socket.write(FrameEncoder.encode(`ACK-${msgCount}: ${text.toUpperCase()}`));
    }
  });

  socket.on("end", () => {
    console.log(`[server] Client disconnected after ${msgCount} messages`);
    socket.end();
  });
});

await new Promise(resolve => framingServer.listen(0, "127.0.0.1", resolve));
const framingPort = framingServer.address().port;

const framingClient = createConnection({ host: "127.0.0.1", port: framingPort });
await new Promise(resolve => framingClient.on("connect", resolve));

// Send 5 framed messages
const messagesToSend = [
  "Hello, server!",
  "This is message two",
  "Binary-safe: \x00\x01\x02",
  "Unicode: 日本語 🚀",
  "Final message",
];

for (const msg of messagesToSend) {
  framingClient.write(FrameEncoder.encode(msg));
}

// Collect responses
const responseDecoder = new FrameDecoder();
const responses = [];

await new Promise((resolve) => {
  framingClient.on("data", (chunk) => {
    const messages = responseDecoder.feed(chunk);
    for (const msg of messages) {
      responses.push(msg.toString());
      if (responses.length >= messagesToSend.length) resolve();
    }
  });
  setTimeout(resolve, 1000);
});

console.log("\n[client] Responses:");
for (const r of responses) {
  console.log(`  ${r}`);
}

framingClient.end();
await new Promise(r => setTimeout(r, 100));
framingServer.close();

console.log("\n=== JSON over Length-Prefix ===\n");

// Common pattern: length-prefix + JSON payloads
function encodeJson(obj) {
  return FrameEncoder.encode(JSON.stringify(obj));
}

function decodeJsonMessages(decoder, chunk) {
  const frames = decoder.feed(chunk);
  return frames.map(buf => JSON.parse(buf.toString()));
}

const jsonDecoder = new FrameDecoder();
const jsonData = Buffer.concat([
  encodeJson({ type: "login", user: "alice" }),
  encodeJson({ type: "message", text: "Hello!" }),
  encodeJson({ type: "logout" }),
]);

const objects = decodeJsonMessages(jsonDecoder, jsonData);
console.log("Decoded JSON messages:");
for (const obj of objects) {
  console.log(" ", obj);
}
```

## Expected Output

```
=== The Framing Problem ===

Sent 5 separate writes
Server received these chunks: ["msg-1msg-2msg-3msg-4msg-5"]
(Messages may be merged — TCP doesn't preserve boundaries!)

=== Length-Prefix Framing Protocol ===

Encoded frame:
  Length prefix: 15 bytes
  Payload: Hello, Framing!
  Full frame hex: 0000000f48656c6c6f2c204672616d696e6721

Decoding fragmented data:
  Fed 3 bytes → 0 complete message(s)
  Fed 10 bytes → 0 complete message(s)
  Fed 5 bytes → 1 complete message(s)
    → "First message"
  Fed 20 bytes → 1 complete message(s)
    → "Second message"
  Fed <remaining> bytes → 1 complete message(s)
    → "Third message"

=== Full Server/Client Example ===

[server] Message 1: "Hello, server!"
[server] Message 2: "This is message two"
[server] Message 3: "Binary-safe: <binary>"
[server] Message 4: "Unicode: 日本語 🚀"
[server] Message 5: "Final message"

[client] Responses:
  ACK-1: HELLO, SERVER!
  ACK-2: THIS IS MESSAGE TWO
  ACK-3: BINARY-SAFE: ...
  ACK-4: UNICODE: 日本語 🚀
  ACK-5: FINAL MESSAGE

[server] Client disconnected after 5 messages

=== JSON over Length-Prefix ===

Decoded JSON messages:
  { type: 'login', user: 'alice' }
  { type: 'message', text: 'Hello!' }
  { type: 'logout' }
```

## Challenge

1. Add a message type byte after the length prefix (before the payload). Define types: 0 = text, 1 = JSON, 2 = binary, 3 = ping, 4 = pong. Implement automatic ping/pong keep-alive
2. Implement a maximum message size check in the decoder — reject frames larger than 1 MB to prevent memory attacks
3. Build a delimiter-based framer using `\r\n` as the delimiter. Compare it with length-prefix: which handles binary data? Which is easier to debug with telnet?

## Deep Dive

Performance considerations for the frame decoder:

The naive `Buffer.concat()` approach in our decoder allocates a new buffer on every `feed()` call. For high-throughput servers, consider:

1. **Ring buffer** — pre-allocate a large buffer and track read/write positions
2. **Linked list of buffers** — avoid copying by maintaining a list of chunks with a total byte count
3. **Buffer pool** — reuse buffers from a pool instead of allocating new ones

Node.js's internal HTTP parser uses option (2) — it keeps chunks in a linked list and only copies when extracting a complete message. For most applications, the naive approach is fine up to thousands of messages per second.

## Common Mistakes

- Not handling partial frames — the most common framing bug. Always buffer incomplete data and wait for more
- Using 2-byte length prefix when messages can exceed 65 KB — `UInt16` overflows at 65,535 bytes
- Forgetting to handle zero-length messages — a frame with length 0 is valid (like a heartbeat)
- Not limiting maximum frame size — an attacker can send a length of 2^32-1 and make you allocate 4 GB of memory
- Using `Buffer.concat()` in a hot loop — allocates on every call. Pre-allocate or use a ring buffer for high throughput
