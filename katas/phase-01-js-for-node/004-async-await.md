---
id: async-await
phase: 1
phase_title: JavaScript for the Node Runtime
sequence: 4
title: async/await
difficulty: beginner
tags: [async, await, promises, error-handling]
prerequisites: [promises]
estimated_minutes: 12
---

## Concept

`async/await` is syntax sugar over Promises. An `async` function always returns a Promise. The `await` keyword pauses execution of that function until the awaited Promise settles — but it does **not** block the event loop. Other code continues to run while the function is suspended.

When you `await`, the function's execution context is saved and removed from the call stack. The event loop is free to process other work. When the Promise resolves, the function resumes from where it left off.

This is the difference between **blocking** (while loop — freezes everything) and **suspending** (await — yields to the event loop).

## Key Insight

> `await` does not block. It suspends the current function and returns control to the event loop. This is fundamentally different from a synchronous sleep or busy-wait — the rest of the program keeps running.

## Experiment

```js
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUser(id) {
  console.log(`  Fetching user ${id}...`);
  await delay(50);  // simulate network latency
  return { id, name: `User_${id}` };
}

async function main() {
  console.log("1. Before await");

  // Sequential — each await waits for the previous
  const start = performance.now();
  const user1 = await fetchUser(1);
  const user2 = await fetchUser(2);
  const seqTime = Math.round(performance.now() - start);
  console.log(`2. Sequential: ${seqTime}ms`, [user1.name, user2.name]);

  // Concurrent — both start immediately, await the group
  const start2 = performance.now();
  const [user3, user4] = await Promise.all([
    fetchUser(3),
    fetchUser(4),
  ]);
  const concTime = Math.round(performance.now() - start2);
  console.log(`3. Concurrent: ${concTime}ms`, [user3.name, user4.name]);

  console.log("4. After all awaits");
}

// Show that other code runs while main() is suspended
main();
console.log("5. This runs while main() is awaiting!");
```

## Expected Output

```
1. Before await
  Fetching user 1...
5. This runs while main() is awaiting!
  Fetching user 2...
2. Sequential: ~100ms [ 'User_1', 'User_2' ]
  Fetching user 3...
  Fetching user 4...
3. Concurrent: ~50ms [ 'User_3', 'User_4' ]
4. After all awaits
```

## Challenge

1. Write a `for` loop with `await` inside — it runs sequentially. Now rewrite it with `Promise.all` and `map` — it runs concurrently. Compare the timings.
2. What happens if you forget `await` before an async call? What type is the return value?
3. Add error handling with `try/catch` around an `await` that rejects. Where does the error appear in the stack trace?

## Deep Dive

Under the hood, `async/await` compiles to a state machine similar to generators. Each `await` is a suspension point where:

1. The function's local state is captured
2. A `.then()` handler is registered on the Promise
3. The function returns (freeing the call stack)
4. When the Promise resolves, the function resumes from the saved state

This is why `await` in a loop is sequential — each iteration waits for the previous to finish. For concurrent operations, start all Promises first, then await them together.

## Common Mistakes

- Using `await` in a `forEach` callback — `forEach` ignores the returned Promise, so the loop doesn't wait. Use `for...of` instead
- Awaiting independent operations sequentially when they could run concurrently with `Promise.all`
- Forgetting that `async` functions always return a Promise — even if you return a plain value, it's wrapped in `Promise.resolve()`
- Using `try/catch` around the wrong scope — the `catch` must wrap the `await`, not just the function call
