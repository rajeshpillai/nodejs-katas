---
id: os-and-system-info
phase: 3
phase_title: File System & OS Interaction
sequence: 3
title: OS and System Information
difficulty: beginner
tags: [os, system, cpus, memory, platform]
prerequisites: [paths-and-directories]
estimated_minutes: 10
---

## Concept

The `os` module provides operating system-related utility methods. In a server or CLI tool, you often need to know:

- How many CPU cores are available (for worker pools, clustering)
- How much memory is free (for backpressure decisions)
- What platform you're on (for platform-specific behavior)
- The system's temp directory (for scratch files)
- The current user's home directory (for config files)
- Network interfaces (for binding servers)

This information is essential for building systems that adapt to their environment — a production server should use all available cores, respect memory limits, and store temp files in the right place.

## Key Insight

> System-aware code is production-ready code. Knowing your CPU count, available memory, and platform at runtime lets you make intelligent decisions about concurrency, caching, and resource allocation.

## Experiment

```js
import { cpus, totalmem, freemem, hostname, platform, arch, uptime,
         tmpdir, homedir, networkInterfaces, type, release } from "os";

console.log("=== System Identity ===\n");
console.log("  Hostname:", hostname());
console.log("  Platform:", platform());
console.log("  OS Type: ", type());
console.log("  Release: ", release());
console.log("  Arch:    ", arch());

console.log("\n=== CPU ===\n");
const cores = cpus();
console.log("  Cores:", cores.length);
console.log("  Model:", cores[0].model);
console.log("  Speed:", cores[0].speed, "MHz");

console.log("\n=== Memory ===\n");
const totalGB = (totalmem() / 1024 / 1024 / 1024).toFixed(2);
const freeGB = (freemem() / 1024 / 1024 / 1024).toFixed(2);
const usedPct = ((1 - freemem() / totalmem()) * 100).toFixed(1);
console.log(`  Total: ${totalGB} GB`);
console.log(`  Free:  ${freeGB} GB`);
console.log(`  Used:  ${usedPct}%`);

console.log("\n=== Paths ===\n");
console.log("  Temp dir:", tmpdir());
console.log("  Home dir:", homedir());

console.log("\n=== Uptime ===\n");
const up = uptime();
const hours = Math.floor(up / 3600);
const mins = Math.floor((up % 3600) / 60);
console.log(`  System uptime: ${hours}h ${mins}m`);

console.log("\n=== Network Interfaces ===\n");
const nets = networkInterfaces();
for (const [name, addrs] of Object.entries(nets)) {
  for (const addr of addrs) {
    if (addr.family === "IPv4") {
      console.log(`  ${name}: ${addr.address} (${addr.internal ? "internal" : "external"})`);
    }
  }
}
```

## Expected Output

```
=== System Identity ===

  Hostname: <hostname>
  Platform: linux
  OS Type:  Linux
  Release:  <kernel version>
  Arch:     x64

=== CPU ===

  Cores: <number>
  Model: <CPU model>
  Speed: <MHz>

=== Memory ===

  Total: <number> GB
  Free:  <number> GB
  Used:  <number>%

=== Paths ===

  Temp dir: /tmp
  Home dir: /home/<user>

=== Uptime ===

  System uptime: <hours>h <minutes>m

=== Network Interfaces ===

  lo: 127.0.0.1 (internal)
  <interface>: <ip> (external)
```

## Challenge

1. Write a function that returns the optimal worker count based on CPU cores (common pattern: `Math.max(1, cpus().length - 1)`)
2. Build a simple memory monitor that logs memory usage every second using `setInterval` and `freemem()`
3. Find the non-internal IPv4 address — this is the address clients would use to connect to your server

## Common Mistakes

- Hardcoding CPU counts or memory sizes instead of reading them from `os`
- Using `os.tmpdir()` without checking it exists — it always exists, but temp files may be cleaned by the OS
- Assuming `os.hostname()` returns a fully qualified domain name — it usually returns the short hostname
