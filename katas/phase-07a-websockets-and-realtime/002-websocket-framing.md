---
id: websocket-framing
phase: 7.5
phase_title: WebSockets & Real-Time Systems
sequence: 2
title: WebSocket Frame Protocol
difficulty: advanced
tags: [websocket, framing, binary, masking, opcodes]
prerequisites: [websocket-upgrade]
estimated_minutes: 18
---

## Concept

After the HTTP upgrade handshake, WebSocket communication uses a binary frame format. Each frame has:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - - +-------------------------------+
|                               | Masking-key, if MASK set to 1 |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------+ - - - - - - - - - - - - - - - +
```

Key fields:
- **FIN** (1 bit) — is this the final fragment? (1 = yes)
- **Opcode** (4 bits) — frame type: 0x1 = text, 0x2 = binary, 0x8 = close, 0x9 = ping, 0xA = pong
- **MASK** (1 bit) — is the payload masked? (client→server: always yes)
- **Payload length** — 7 bits, or 7+16, or 7+64 for large payloads
- **Masking key** (4 bytes) — XOR key for unmasking client data

Clients MUST mask data sent to servers. Servers MUST NOT mask data sent to clients. This asymmetry prevents cache poisoning attacks.

## Key Insight

> WebSocket frames are the message boundaries that TCP doesn't have. Each frame carries a complete message (or a fragment of one), an opcode saying what kind of data it is, and a length so the receiver knows exactly how many bytes to read. It's length-prefix framing with extra protocol features built in.

## Experiment

```js
import { createServer } from "http";
import { createHash, randomBytes } from "crypto";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB0DC85B711";

console.log("=== WebSocket Frame Format ===\n");

// Frame encoder (server-side: no masking)
function encodeFrame(data, opcode = 0x01) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;

  let headerSize;
  if (len < 126) headerSize = 2;
  else if (len < 65536) headerSize = 4;
  else headerSize = 10;

  const frame = Buffer.alloc(headerSize + len);

  // Byte 0: FIN + opcode
  frame[0] = 0x80 | opcode;  // FIN=1, opcode

  // Byte 1+: payload length (no mask for server→client)
  if (len < 126) {
    frame[1] = len;
  } else if (len < 65536) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 127;
    // Write as two 32-bit values (BigInt not needed for reasonable sizes)
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(len, 6);
  }

  payload.copy(frame, headerSize);
  return frame;
}

// Frame decoder (handles masked client frames)
function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const byte0 = buffer[0];
  const byte1 = buffer[1];

  const fin = (byte0 & 0x80) !== 0;
  const opcode = byte0 & 0x0F;
  const masked = (byte1 & 0x80) !== 0;
  let payloadLen = byte1 & 0x7F;

  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = buffer.readUInt32BE(6);  // Ignore high 32 bits
    offset = 10;
  }

  let maskKey = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLen) return null;

  let payload = buffer.slice(offset, offset + payloadLen);

  // Unmask the payload
  if (masked && maskKey) {
    payload = Buffer.from(payload);  // Copy to avoid mutating input
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  const opcodeNames = {
    0x0: "continuation", 0x1: "text", 0x2: "binary",
    0x8: "close", 0x9: "ping", 0xA: "pong",
  };

  return {
    fin,
    opcode,
    opcodeName: opcodeNames[opcode] || `unknown(0x${opcode.toString(16)})`,
    masked,
    payloadLength: payloadLen,
    payload,
    totalLength: offset + payloadLen,
  };
}

// Demonstrate frame encoding
console.log("--- Server→Client frames (unmasked) ---\n");

const textFrame = encodeFrame("Hello, WebSocket!");
console.log("Text frame for 'Hello, WebSocket!':");
console.log("  Bytes:", [...textFrame.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join(' '), "...");
console.log("  Byte 0:", `0x${textFrame[0].toString(16)}`, `(FIN=${textFrame[0] >> 7}, opcode=${textFrame[0] & 0xf})`);
console.log("  Byte 1:", `0x${textFrame[1].toString(16)}`, `(MASK=${textFrame[1] >> 7}, len=${textFrame[1] & 0x7f})`);

const decoded = decodeFrame(textFrame);
console.log("  Decoded:", decoded.opcodeName, `"${decoded.payload.toString()}"`);

// Medium frame (126-65535 bytes)
const mediumData = "x".repeat(300);
const mediumFrame = encodeFrame(mediumData);
const mediumDecoded = decodeFrame(mediumFrame);
console.log(`\nMedium frame (${mediumData.length} bytes):`);
console.log("  Header bytes:", [...mediumFrame.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log("  Byte 1:", `0x${mediumFrame[1].toString(16)}`, "(126 = use next 2 bytes for length)");
console.log("  Length from bytes 2-3:", mediumFrame.readUInt16BE(2));
console.log("  Total frame size:", mediumFrame.length);

console.log("\n--- Client→Server frame (masked) ---\n");

// Simulate a masked client frame
function encodeClientFrame(data, opcode = 0x01) {
  const payload = Buffer.from(data);
  const maskKey = randomBytes(4);

  const len = payload.length;
  let headerSize = len < 126 ? 2 : (len < 65536 ? 4 : 10);
  headerSize += 4;  // Mask key

  const frame = Buffer.alloc(headerSize + len);

  frame[0] = 0x80 | opcode;

  let offset;
  if (len < 126) {
    frame[1] = 0x80 | len;  // MASK bit set
    offset = 2;
  } else if (len < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    frame[1] = 0x80 | 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(len, 6);
    offset = 10;
  }

  maskKey.copy(frame, offset);
  offset += 4;

  // XOR-mask the payload
  for (let i = 0; i < len; i++) {
    frame[offset + i] = payload[i] ^ maskKey[i % 4];
  }

  return frame;
}

const clientFrame = encodeClientFrame("Hello from client!");
console.log("Masked client frame:");
console.log("  Byte 1:", `0x${clientFrame[1].toString(16)}`, `(MASK=1, len=${clientFrame[1] & 0x7f})`);
console.log("  Raw payload (masked):", [...clientFrame.slice(6, 16)].map(b => b.toString(16).padStart(2, '0')).join(' '), "...");

const clientDecoded = decodeFrame(clientFrame);
console.log("  Unmasked:", `"${clientDecoded.payload.toString()}"`);

console.log("\n=== Control Frames ===\n");

// Ping frame
const pingFrame = encodeFrame("heartbeat", 0x09);
const pingDecoded = decodeFrame(pingFrame);
console.log("Ping:", pingDecoded.opcodeName, `"${pingDecoded.payload.toString()}"`);

// Pong frame (response to ping — must echo the ping payload)
const pongFrame = encodeFrame("heartbeat", 0x0A);
const pongDecoded = decodeFrame(pongFrame);
console.log("Pong:", pongDecoded.opcodeName, `"${pongDecoded.payload.toString()}"`);

// Close frame (opcode 0x8, payload = 2-byte status code + optional reason)
const closePayload = Buffer.alloc(2 + Buffer.byteLength("Going away"));
closePayload.writeUInt16BE(1001, 0);  // 1001 = Going Away
closePayload.write("Going away", 2);
const closeFrame = encodeFrame(closePayload, 0x08);
const closeDecoded = decodeFrame(closeFrame);
const closeCode = closeDecoded.payload.readUInt16BE(0);
const closeReason = closeDecoded.payload.slice(2).toString();
console.log("Close:", closeDecoded.opcodeName, `code=${closeCode} reason="${closeReason}"`);

console.log("\n=== Close Codes ===\n");

const closeCodes = [
  [1000, "Normal Closure", "Clean shutdown"],
  [1001, "Going Away", "Server shutting down or browser navigating away"],
  [1002, "Protocol Error", "Malformed frame"],
  [1003, "Unsupported Data", "e.g., text endpoint received binary"],
  [1006, "Abnormal Closure", "No close frame received (connection dropped)"],
  [1008, "Policy Violation", "e.g., message too large"],
  [1011, "Internal Error", "Server had an unexpected condition"],
];

for (const [code, name, desc] of closeCodes) {
  console.log(`  ${code} ${name.padEnd(20)} — ${desc}`);
}

console.log("\n=== Opcodes Summary ===\n");

const opcodes = [
  [0x0, "Continuation", "Fragment of a multi-frame message"],
  [0x1, "Text", "UTF-8 text data"],
  [0x2, "Binary", "Binary data"],
  [0x8, "Close", "Close the connection (with status code)"],
  [0x9, "Ping", "Heartbeat request"],
  [0xA, "Pong", "Heartbeat response"],
];

for (const [code, name, desc] of opcodes) {
  console.log(`  0x${code.toString(16)} ${name.padEnd(14)} — ${desc}`);
}
```

## Expected Output

```
=== WebSocket Frame Format ===

--- Server→Client frames (unmasked) ---

Text frame for 'Hello, WebSocket!':
  Bytes: 81 11 48 65 6c 6c 6f 2c 20 57 ...
  Byte 0: 0x81 (FIN=1, opcode=1)
  Byte 1: 0x11 (MASK=0, len=17)
  Decoded: text "Hello, WebSocket!"

Medium frame (300 bytes):
  Header bytes: 81 7e 01 2c ...
  Byte 1: 0x7e (126 = use next 2 bytes for length)
  Length from bytes 2-3: 300
  Total frame size: 304

--- Client→Server frame (masked) ---

Masked client frame:
  Byte 1: 0x92 (MASK=1, len=18)
  Raw payload (masked): <hex bytes> ...
  Unmasked: "Hello from client!"

=== Control Frames ===

Ping: ping "heartbeat"
Pong: pong "heartbeat"
Close: close code=1001 reason="Going away"

...
```

## Challenge

1. Implement fragmented messages: send "Hello, World!" across three frames using opcode 0x1 (first), 0x0 (continuation), 0x0 (final with FIN). Reassemble on the receiving end
2. Why must clients mask their frames but servers don't? Research the cache poisoning attack that motivated this requirement
3. Implement a frame parser that handles streaming — TCP may deliver half a frame, so buffer incomplete frames and emit complete ones

## Deep Dive

Why client-to-server masking exists:

It prevents a class of attacks against transparent HTTP proxies. A malicious webpage could open a WebSocket to a victim proxy, send carefully crafted data that looks like an HTTP request, and trick the proxy into caching a poisoned response. The XOR masking ensures WebSocket data never accidentally resembles HTTP — because the mask key is random, the wire bytes are unpredictable.

Server-to-client masking isn't needed because the browser is the endpoint, not an intermediary.

## Common Mistakes

- Forgetting to mask client frames — servers MUST reject unmasked client frames and close with 1002
- Treating WebSocket as a pure byte stream — it's message-oriented. Each frame (or series of fragments) is one complete message
- Ignoring ping frames — RFC requires responding with pong. Servers use pings to detect dead connections
- Not handling the close handshake — when one side sends a close frame, the other must respond with a close frame before the connection terminates
