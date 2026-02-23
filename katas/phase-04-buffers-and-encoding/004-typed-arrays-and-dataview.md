---
id: typed-arrays-and-dataview
phase: 4
phase_title: Buffers, Binary Data & Encoding
sequence: 4
title: Typed Arrays and DataView
difficulty: intermediate
tags: [typed-arrays, dataview, arraybuffer, endianness, binary-protocols]
prerequisites: [buffer-operations]
estimated_minutes: 15
---

## Concept

JavaScript's typed array system has three layers:

1. **`ArrayBuffer`** — a raw chunk of memory (you can't read/write it directly)
2. **Typed Arrays** (`Uint8Array`, `Int16Array`, `Float64Array`, etc.) — a view over an ArrayBuffer that interprets the bytes as a specific numeric type
3. **`DataView`** — a flexible view that lets you read/write any type at any offset, with explicit endianness control

`Buffer` is a Node.js subclass of `Uint8Array`. This means every Buffer has an underlying `ArrayBuffer`, and you can create other typed array views over the same memory.

This matters for binary protocols. When a network packet contains a 32-bit integer at byte offset 4, you need `DataView` to read it correctly — especially when the protocol uses big-endian byte order (network byte order) while your CPU uses little-endian.

## Key Insight

> Endianness is the #1 source of binary protocol bugs. Network protocols (TCP, HTTP/2, DNS) use big-endian (most significant byte first). x86/ARM CPUs use little-endian. `DataView` forces you to be explicit about byte order — use it for any multi-byte reads from external data.

## Experiment

```js
console.log("=== ArrayBuffer and Typed Arrays ===\n");

// ArrayBuffer is raw memory — can't read/write directly
const rawMem = new ArrayBuffer(16);
console.log("ArrayBuffer:", rawMem);
console.log("  byteLength:", rawMem.byteLength);

// View the same memory as different types
const bytes = new Uint8Array(rawMem);
const shorts = new Uint16Array(rawMem);
const ints = new Uint32Array(rawMem);
const floats = new Float64Array(rawMem);

// Write through one view, read through another
bytes[0] = 0x48;  // 'H'
bytes[1] = 0x65;  // 'e'
bytes[2] = 0x6C;  // 'l'
bytes[3] = 0x6C;  // 'l'

console.log("\nWrote bytes: [0x48, 0x65, 0x6C, 0x6C]");
console.log("As Uint8Array: ", [...bytes.slice(0, 4)].map(b => '0x' + b.toString(16)));
console.log("As Uint16Array:", [...shorts.slice(0, 2)].map(n => '0x' + n.toString(16)));
console.log("As Uint32Array:", '0x' + ints[0].toString(16));

console.log("\n=== Buffer ↔ ArrayBuffer ===\n");

const buf = Buffer.from("Hello!");
console.log("Buffer:", buf);
console.log("Buffer.buffer:", buf.buffer.constructor.name);
console.log("Buffer.byteOffset:", buf.byteOffset);
console.log("Buffer.byteLength:", buf.byteLength);

// Create a Buffer from an ArrayBuffer
const ab = new ArrayBuffer(4);
new Uint8Array(ab).set([0x4E, 0x6F, 0x64, 0x65]);
const fromAB = Buffer.from(ab);
console.log("\nBuffer from ArrayBuffer:", fromAB.toString());

console.log("\n=== DataView for Protocol Parsing ===\n");

// Simulate a binary packet: [type:u8] [flags:u8] [length:u16be] [payload_id:u32be] [value:f64be]
const packet = Buffer.alloc(16);
const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

// Write a packet (big-endian = network byte order)
view.setUint8(0, 0x01);           // type = 1
view.setUint8(1, 0b10000001);     // flags = compressed + final
view.setUint16(2, 1024, false);   // length = 1024 (big-endian)
view.setUint32(4, 42, false);     // payload_id = 42 (big-endian)
view.setFloat64(8, 3.14159, false); // value = pi (big-endian)

console.log("Packet bytes:", [...packet].map(b => b.toString(16).padStart(2, '0')).join(' '));

// Read it back
console.log("\nParsed packet:");
console.log("  type:", view.getUint8(0));
console.log("  flags:", view.getUint8(1).toString(2).padStart(8, '0'));
console.log("  length:", view.getUint16(2, false));
console.log("  payload_id:", view.getUint32(4, false));
console.log("  value:", view.getFloat64(8, false));

console.log("\n=== Endianness Matters ===\n");

const demo = Buffer.alloc(4);
const dv = new DataView(demo.buffer, demo.byteOffset, demo.byteLength);

dv.setUint32(0, 0x01020304, false);  // big-endian
console.log("Big-endian 0x01020304:", [...demo].map(b => '0x' + b.toString(16)));
console.log("  Bytes: 01 02 03 04 (MSB first)");

dv.setUint32(0, 0x01020304, true);   // little-endian
console.log("\nLittle-endian 0x01020304:", [...demo].map(b => '0x' + b.toString(16)));
console.log("  Bytes: 04 03 02 01 (LSB first)");

// Reading with wrong endianness gives wrong values
dv.setUint16(0, 256, false);  // big-endian: 0x0100
console.log("\nWrote 256 as big-endian:", [...demo.slice(0, 2)].map(b => '0x' + b.toString(16)));
console.log("Read as big-endian:   ", dv.getUint16(0, false), "(correct)");
console.log("Read as little-endian:", dv.getUint16(0, true), "(wrong!)");

console.log("\n=== Buffer Read/Write Methods ===\n");

// Buffer has convenience methods for reading/writing numbers
const numBuf = Buffer.alloc(8);

numBuf.writeUInt16BE(0xCAFE, 0);
numBuf.writeUInt32BE(0xDEADBEEF, 2);
numBuf.writeInt16BE(-1, 6);

console.log("Buffer:", numBuf.toString("hex"));
console.log("readUInt16BE(0):", '0x' + numBuf.readUInt16BE(0).toString(16));
console.log("readUInt32BE(2):", '0x' + numBuf.readUInt32BE(2).toString(16));
console.log("readInt16BE(6):", numBuf.readInt16BE(6));
```

## Expected Output

```
=== ArrayBuffer and Typed Arrays ===

ArrayBuffer: ArrayBuffer { [Uint8Contents]: <...>, byteLength: 16 }
  byteLength: 16

Wrote bytes: [0x48, 0x65, 0x6C, 0x6C]
As Uint8Array:  [ '0x48', '0x65', '0x6c', '0x6c' ]
As Uint16Array: [ '0x6548', '0x6c6c' ]
As Uint32Array: 0x6c6c6548

=== Buffer ↔ ArrayBuffer ===

Buffer: <Buffer 48 65 6c 6c 6f 21>
Buffer.buffer: ArrayBuffer
Buffer.byteOffset: <number>
Buffer.byteLength: 6

Buffer from ArrayBuffer: Node

=== DataView for Protocol Parsing ===

Packet bytes: 01 81 04 00 00 00 00 2a 40 09 21 f9 f0 1b 86 6e

Parsed packet:
  type: 1
  flags: 10000001
  length: 1024
  payload_id: 42
  value: 3.14159

=== Endianness Matters ===

Big-endian 0x01020304: [ '0x1', '0x2', '0x3', '0x4' ]
  Bytes: 01 02 03 04 (MSB first)

Little-endian 0x01020304: [ '0x4', '0x3', '0x2', '0x1' ]
  Bytes: 04 03 02 01 (LSB first)

Wrote 256 as big-endian: [ '0x1', '0x0' ]
Read as big-endian:    256 (correct)
Read as little-endian: 1 (wrong!)

=== Buffer Read/Write Methods ===

Buffer: cafe deadbeef ffff
readUInt16BE(0): 0xcafe
readUInt32BE(2): 0xdeadbeef
readInt16BE(6): -1
```

## Challenge

1. Parse a simplified DNS response: 2-byte ID (big-endian), 2-byte flags, 2-byte question count, 2-byte answer count. Create the buffer manually and parse it with DataView
2. Write a function that converts a JavaScript number to its IEEE 754 double-precision byte representation and back. Verify with `DataView`
3. Create a `Uint32Array` view over a Buffer and observe what happens when the Buffer's `byteOffset` is not aligned to 4 bytes

## Deep Dive

Why endianness exists: When a CPU stores a 32-bit integer in memory, it must decide which byte goes at the lowest address. Intel/AMD (x86) and ARM (in default mode) put the least significant byte first — **little-endian**. Network protocols historically used **big-endian** (also called "network byte order") because it reads left-to-right like humans read numbers.

The typed array system always uses the CPU's native endianness for performance. `DataView` lets you specify endianness explicitly, making it essential for cross-platform binary data.

## Common Mistakes

- Using typed arrays directly for network data — they use CPU-native endianness, which is usually little-endian. Network protocols expect big-endian. Use `DataView` instead
- Forgetting alignment requirements — `Uint32Array` views must start at 4-byte aligned offsets. `DataView` has no alignment requirement
- Assuming Buffer and its ArrayBuffer share the same offset — `buf.byteOffset` may not be 0 (Buffer can reference a slice of a larger ArrayBuffer pool)
- Mixing signed and unsigned reads — `readInt16BE` vs `readUInt16BE` interpret the same bytes differently
