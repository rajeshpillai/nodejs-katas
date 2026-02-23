---
id: parsing-binary-protocols
phase: 4
phase_title: Buffers, Binary Data & Encoding
sequence: 5
title: Parsing Binary Protocols
difficulty: intermediate
tags: [binary, protocols, parsing, serialization, network]
prerequisites: [typed-arrays-and-dataview]
estimated_minutes: 15
---

## Concept

Binary protocols encode structured data as a sequence of bytes with fixed layouts. Unlike JSON (text-based, self-describing), binary protocols are compact and fast to parse — but you must know the exact format to read them.

Common patterns in binary protocols:

- **Magic bytes** — fixed bytes at the start to identify the format (PNG starts with `89 50 4E 47`)
- **Fixed-width fields** — a 4-byte integer, a 2-byte port number
- **Length-prefixed data** — a length field followed by that many bytes of payload
- **Null-terminated strings** — bytes until a `0x00` is found
- **Flags / bitfields** — individual bits packed into a byte

Real-world binary protocols you'll encounter: TCP/IP headers, DNS packets, WebSocket frames, PNG/JPEG headers, Protocol Buffers (wire format), MessagePack.

## Key Insight

> Every binary protocol is just a contract: "byte 0 means X, bytes 1–2 mean Y (big-endian), bytes 3–N are the payload where N is read from bytes 1–2." Parsing is just walking through the buffer with an offset, reading the right type at each position. Get the offset wrong by even one byte, and everything after it is garbage.

## Experiment

```js
console.log("=== Building a Simple Binary Protocol ===\n");

// Protocol: Simple Message Format
// Offset  Size  Field
// 0       4     Magic: 0x4E4F4445 ("NODE")
// 4       1     Version: uint8
// 5       1     Type: uint8 (0=text, 1=binary, 2=error)
// 6       2     Payload length: uint16 big-endian
// 8       N     Payload bytes

function encodeMessage(type, payload) {
  const payloadBuf = Buffer.from(payload);
  const msg = Buffer.alloc(8 + payloadBuf.length);
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);

  // Header
  view.setUint32(0, 0x4E4F4445, false);     // Magic "NODE"
  view.setUint8(4, 1);                       // Version 1
  view.setUint8(5, type);                    // Message type
  view.setUint16(6, payloadBuf.length, false); // Payload length (big-endian)

  // Payload
  payloadBuf.copy(msg, 8);

  return msg;
}

function decodeMessage(buf) {
  if (buf.length < 8) {
    throw new Error(`Message too short: ${buf.length} bytes (minimum 8)`);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Verify magic bytes
  const magic = view.getUint32(0, false);
  if (magic !== 0x4E4F4445) {
    throw new Error(`Invalid magic: 0x${magic.toString(16)} (expected 0x4e4f4445)`);
  }

  const version = view.getUint8(4);
  const type = view.getUint8(5);
  const payloadLength = view.getUint16(6, false);

  if (buf.length < 8 + payloadLength) {
    throw new Error(`Incomplete message: expected ${8 + payloadLength} bytes, got ${buf.length}`);
  }

  const payload = buf.slice(8, 8 + payloadLength);
  const typeNames = ["text", "binary", "error"];

  return {
    version,
    type: typeNames[type] || `unknown(${type})`,
    payloadLength,
    payload,
    text: type === 0 ? payload.toString("utf-8") : undefined,
  };
}

// Encode some messages
const msg1 = encodeMessage(0, "Hello, Protocol!");
const msg2 = encodeMessage(2, "Something went wrong");

console.log("Encoded text message:");
console.log("  Hex:", msg1.toString("hex"));
console.log("  Bytes:", msg1.length);
console.log("  Header:", [...msg1.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' '));

// Decode them
const decoded1 = decodeMessage(msg1);
console.log("\nDecoded:", decoded1);

const decoded2 = decodeMessage(msg2);
console.log("Decoded:", decoded2);

console.log("\n=== Length-Prefixed Framing ===\n");

// When sending multiple messages over a stream, use length-prefixed framing
// Format: [4 bytes: message length (big-endian)] [N bytes: message]

function frameMessages(messages) {
  const frames = messages.map(msg => {
    const encoded = encodeMessage(0, msg);
    const frame = Buffer.alloc(4 + encoded.length);
    frame.writeUInt32BE(encoded.length, 0);
    encoded.copy(frame, 4);
    return frame;
  });
  return Buffer.concat(frames);
}

function parseFrames(buf) {
  const messages = [];
  let offset = 0;

  while (offset < buf.length) {
    if (offset + 4 > buf.length) {
      console.log("  Incomplete frame header at offset", offset);
      break;
    }

    const frameLen = buf.readUInt32BE(offset);
    offset += 4;

    if (offset + frameLen > buf.length) {
      console.log("  Incomplete frame body at offset", offset);
      break;
    }

    const frame = buf.slice(offset, offset + frameLen);
    messages.push(decodeMessage(frame));
    offset += frameLen;
  }

  return messages;
}

const stream = frameMessages(["First message", "Second message", "Third message"]);
console.log("Framed stream:", stream.length, "bytes total");
console.log("Hex:", stream.toString("hex").replace(/(.{32})/g, "$1\n     "));

const parsed = parseFrames(stream);
console.log("\nParsed", parsed.length, "messages:");
for (const msg of parsed) {
  console.log(`  [${msg.type}] ${msg.text}`);
}

console.log("\n=== Bitfield Parsing ===\n");

// Flags byte: [reserved:2] [compressed:1] [encrypted:1] [priority:2] [type:2]
function parseFlags(byte) {
  return {
    type: byte & 0b11,
    priority: (byte >> 2) & 0b11,
    encrypted: Boolean((byte >> 4) & 1),
    compressed: Boolean((byte >> 5) & 1),
    reserved: (byte >> 6) & 0b11,
  };
}

function encodeFlags(flags) {
  let byte = 0;
  byte |= (flags.type & 0b11);
  byte |= (flags.priority & 0b11) << 2;
  byte |= (flags.encrypted ? 1 : 0) << 4;
  byte |= (flags.compressed ? 1 : 0) << 5;
  return byte;
}

const flags = { type: 2, priority: 3, encrypted: true, compressed: false };
const encoded = encodeFlags(flags);
console.log("Flags:", flags);
console.log("Encoded:", '0b' + encoded.toString(2).padStart(8, '0'), `(0x${encoded.toString(16)})`);

const decoded = parseFlags(encoded);
console.log("Decoded:", decoded);

console.log("\n=== Error Handling ===\n");

// Test protocol robustness
const badInputs = [
  { name: "Empty buffer", data: Buffer.alloc(0) },
  { name: "Wrong magic", data: Buffer.from("BADMAGIC00000000", "hex") },
  { name: "Truncated", data: Buffer.from("4E4F44450100", "hex") },
];

for (const { name, data } of badInputs) {
  try {
    decodeMessage(data);
  } catch (err) {
    console.log(`${name}: ${err.message}`);
  }
}
```

## Expected Output

```
=== Building a Simple Binary Protocol ===

Encoded text message:
  Hex: 4e4f444501000010 48656c6c6f2c2050726f746f636f6c21
  Bytes: 24
  Header: 4e 4f 44 45 01 00 00 10

Decoded: {
  version: 1,
  type: 'text',
  payloadLength: 16,
  payload: <Buffer ...>,
  text: 'Hello, Protocol!'
}
Decoded: {
  version: 1,
  type: 'error',
  payloadLength: 20,
  payload: <Buffer ...>,
  text: undefined
}

=== Length-Prefixed Framing ===

Framed stream: <number> bytes total
...

Parsed 3 messages:
  [text] First message
  [text] Second message
  [text] Third message

=== Bitfield Parsing ===

Flags: { type: 2, priority: 3, encrypted: true, compressed: false }
Encoded: 0b00011110 (0x1e)
Decoded: { type: 2, priority: 3, encrypted: true, compressed: false, reserved: 0 }

=== Error Handling ===

Empty buffer: Message too short: 0 bytes (minimum 8)
Wrong magic: Invalid magic: 0xbadmagic (expected 0x4e4f4445)
Truncated: Message too short: 6 bytes (minimum 8)
```

## Challenge

1. Extend the protocol with a CRC-32 checksum: compute a 4-byte checksum of the payload and append it. Verify on decode. (Use Node.js `zlib.crc32` or implement a simple checksum)
2. Add a null-terminated string field to the header (e.g., a sender name). The parser must scan for `0x00` to find the end
3. Parse a real protocol: decode a simplified PNG file header — read the 8-byte magic, then parse the first IHDR chunk (4-byte length, 4-byte type, width, height, bit depth, color type)

## Deep Dive

Length-prefixed framing vs delimiter-based framing:

- **Length-prefix** (what we used): `[4 bytes: length][N bytes: data]`. Always knows exactly how many bytes to read. Works for binary payloads. Used by: PostgreSQL wire protocol, HTTP/2, Protocol Buffers.
- **Delimiter-based**: Read until you see a special byte sequence (e.g., `\r\n`). Simpler but the delimiter can't appear in the payload (or must be escaped). Used by: HTTP/1.1 headers, Redis RESP, line-based protocols.

Length-prefix is almost always better for binary protocols. Delimiter-based is fine for text protocols.

## Common Mistakes

- Not validating magic bytes — leads to silently parsing garbage data as valid messages
- Forgetting to check buffer length before reading — causes RangeError or reads past the end
- Using wrong endianness — the most common binary protocol bug. Always document and verify byte order
- Building strings with `buf.toString()` on the entire buffer instead of the payload slice — includes header bytes in the text
- Not handling partial messages in streams — TCP delivers bytes, not messages. A single `data` event may contain half a message or three and a half messages
