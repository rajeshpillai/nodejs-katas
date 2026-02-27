# Troubleshooting Commands

Useful commands for developing and debugging the Node.js Katas project.

---

## Port Management

### Find what's using a port

```bash
lsof -ti :6001
```

`lsof` lists open files — and in Unix, network sockets are files. `-t` gives terse output (PIDs only), `-i :6001` filters by port. Useful when the server won't start because the port is already in use ("EADDRINUSE").

### Kill everything on a port

```bash
lsof -ti :6001 | xargs kill
```

Pipes the PIDs into `kill`, which sends `SIGTERM` (graceful shutdown). The process gets a chance to clean up before exiting.

### Force kill on a port

```bash
lsof -ti :6001 | xargs kill -9
```

Sends `SIGKILL` — the OS terminates the process immediately. Use this only when `SIGTERM` doesn't work (e.g., a hung process). The process gets no chance to clean up, so connections, temp files, etc. may be left behind.

### Check if a port is free

```bash
lsof -i :6001
```

Without `-t`, this shows full details: process name, PID, user, protocol (TCP/UDP), and connection state. If there's no output, the port is free.

---

## Process Management

### Find a process by name

```bash
pgrep -f "server.js"
```

`-f` matches against the full command line, not just the process name. Returns PIDs. Useful for finding backgrounded Node processes.

### Find with full details

```bash
ps aux | grep server.js
```

Shows user, PID, CPU/memory usage, and the full command. More context than `pgrep` when you need to understand what's running.

### Kill a process by PID

```bash
kill 12345          # SIGTERM — graceful
kill -9 12345       # SIGKILL — forceful
```

Always try `SIGTERM` first. Node.js servers can listen for it and close connections, flush logs, etc. `SIGKILL` is a last resort.

### Kill all Node processes

```bash
pkill -f node
```

Nuclear option. Kills every process with "node" in the command line. Avoid in production or if you have other Node apps running.

---

## Server Startup

### Start the backend

```bash
cd backend && node src/server.js
```

Runs in the foreground — you see logs directly and Ctrl+C stops it.

### Start in the background

```bash
cd backend && node src/server.js &
```

The `&` backgrounds the process. Output still goes to the terminal but the shell prompt returns. Use `jobs` to see background jobs, `fg` to bring one back.

### Start fresh (kill old, start new)

```bash
lsof -ti :6001 | xargs kill 2>/dev/null; sleep 1 && cd backend && node src/server.js
```

The `2>/dev/null` suppresses errors if nothing is on the port. `sleep 1` gives the old process time to release the port before starting the new one.

### Check if the server is healthy

```bash
curl -s http://localhost:6001/api/health
```

Returns `{"status":"ok","katas":100}` if everything is running. `-s` suppresses the progress bar.

---

## API Testing

### Run a kata's experiment code

```bash
curl -s http://localhost:6001/api/playground/run \
  -H 'Content-Type: application/json' \
  -d '{"code":"console.log(\"hello\")"}'
```

Posts code to the executor and returns `{ stdout, stderr, success, execution_time_ms }`.

### Fetch all katas

```bash
curl -s http://localhost:6001/api/katas | node -e "
  const d=[];
  process.stdin.on('data',c=>d.push(c));
  process.stdin.on('end',()=>{
    const {phases}=JSON.parse(Buffer.concat(d));
    console.log(phases.length,'phases');
    for(const p of phases)
      console.log('Phase',p.phase,'-',p.title,'('+p.katas.length+')');
  });
"
```

### Fetch a single kata detail

```bash
curl -s http://localhost:6001/api/katas/child-process-basics
```

Returns full kata with `concept`, `experimentCode`, `expectedOutput`, `challenge`, etc.

---

## Debugging

### Watch server logs in real time

```bash
cd backend && node src/server.js 2>&1 | tee /tmp/server.log
```

`tee` writes output to both the terminal and a file. `2>&1` merges stderr into stdout so you capture everything.

### Check which Node version is running

```bash
node --version
```

The katas assume Node.js LTS. Some features (like `node:test`, top-level await in .mjs) require specific versions.

### Check available memory and CPU

```bash
node -e "const os = require('os'); console.log('CPUs:', os.cpus().length, 'Mem:', Math.round(os.totalmem()/1e9)+'GB')"
```

Useful for understanding executor constraints (64MB limit per kata execution).

### Inspect open handles preventing exit

```bash
node --trace-warnings src/server.js
```

Shows where unresolved promises or open handles were created. Helps debug "why won't my process exit?" issues.

---

## Git

### Check what changed

```bash
git status              # Overview: modified, staged, untracked
git diff                # Unstaged changes (line by line)
git diff --staged       # Staged changes (what will be committed)
```

### Quick amend (typo in last commit)

```bash
git add <file>
git commit --amend --no-edit
```

Adds the file to the previous commit without changing the message. Only do this for unpushed commits — amending a pushed commit rewrites history.

### See recent history

```bash
git log --oneline -10
```

One line per commit, last 10. Good for checking commit message style before writing a new one.

---

## File System

### Find all kata markdown files

```bash
find katas -name '*.md' | sort
```

### Count katas per phase

```bash
find katas -name '*.md' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
```

Strips the filename, counts unique directories. Useful for spotting phases with missing katas.

### Find large files (potential issues)

```bash
find . -not -path './node_modules/*' -not -path './.git/*' -size +1M -ls
```

The executor has a 64MB memory limit. If a kata references a large file, it could cause issues.

---

## Concepts: I/O Redirection

Every process has three standard streams, each identified by a **file descriptor** (fd):

| fd | Name   | Purpose                        | Default     |
|----|--------|--------------------------------|-------------|
| 0  | stdin  | Input the process reads from   | Keyboard    |
| 1  | stdout | Normal output                  | Terminal    |
| 2  | stderr | Error/diagnostic output        | Terminal    |

### Redirect stdout to a file

```bash
node src/server.js > /tmp/server.log
```

`>` redirects fd 1 (stdout) to a file. The file is created or overwritten. Errors still appear in the terminal because stderr (fd 2) is unchanged.

### Redirect stderr to a file

```bash
node src/server.js 2> /tmp/errors.log
```

`2>` redirects fd 2 (stderr) to a file. Normal output still goes to the terminal.

### Redirect both stdout and stderr to the same file

```bash
node src/server.js > /tmp/all.log 2>&1
```

Breaking this down:
1. `> /tmp/all.log` — redirect stdout (fd 1) to the file
2. `2>&1` — redirect stderr (fd 2) to wherever fd 1 currently points (the file)

**Order matters.** `2>&1 > file` does NOT work the same way — it redirects stderr to the terminal (where stdout was *before* the redirect), then redirects stdout to the file. Always put `2>&1` after the `>`.

### Discard output entirely

```bash
lsof -ti :6001 | xargs kill 2>/dev/null
```

`/dev/null` is a special file that discards everything written to it. `2>/dev/null` silences errors — here, it suppresses "no process found" when the port is already free.

### Discard everything

```bash
node src/server.js > /dev/null 2>&1
```

Silences both stdout and stderr. The process runs but produces no visible output. Useful for background daemons.

### Append instead of overwrite

```bash
node src/server.js >> /tmp/server.log 2>&1
```

`>>` appends to the file instead of truncating it. Useful for accumulating logs across multiple runs.

### Pipe: connect stdout of one process to stdin of another

```bash
lsof -ti :6001 | xargs kill
```

The `|` (pipe) takes stdout from the left command and feeds it as stdin to the right command. Here, `lsof` outputs PIDs, and `xargs` reads them and passes them as arguments to `kill`.

### Here document: feed multi-line input to stdin

```bash
node -e "$(cat <<'EOF'
const x = 42;
console.log(x);
EOF
)"
```

`<<'EOF'` starts a here-document — everything until the closing `EOF` is fed as input. The single quotes around `EOF` prevent variable expansion inside the block.

---

## Concepts: Signals and kill

### What are signals?

Signals are messages the OS sends to processes. They're the primary way to communicate with running processes from outside.

### Common signals

| Signal    | Number | Default Action | Catchable? | Purpose                           |
|-----------|--------|----------------|------------|-----------------------------------|
| SIGTERM   | 15     | Terminate      | Yes        | Polite "please shut down"         |
| SIGKILL   | 9      | Terminate      | **No**     | Forceful immediate termination    |
| SIGINT    | 2      | Terminate      | Yes        | Ctrl+C from terminal              |
| SIGHUP    | 1      | Terminate      | Yes        | Terminal closed / reload config   |
| SIGUSR1   | 10     | Terminate      | Yes        | User-defined (Node: start debugger) |
| SIGUSR2   | 12     | Terminate      | Yes        | User-defined                      |
| SIGSTOP   | 19     | Stop (pause)   | **No**     | Freeze the process                |
| SIGCONT   | 18     | Continue       | Yes        | Resume a stopped process          |

### The kill command

Despite the name, `kill` sends *any* signal — not just fatal ones.

```bash
kill 12345              # Sends SIGTERM (default, signal 15)
kill -TERM 12345        # Same thing, explicit
kill -15 12345          # Same thing, by number

kill -9 12345           # Sends SIGKILL — cannot be caught or ignored
kill -KILL 12345        # Same thing, by name

kill -HUP 12345         # Sends SIGHUP — often used to reload config
kill -USR1 12345        # Sends SIGUSR1 — Node.js starts the debugger
```

### Why SIGTERM before SIGKILL?

```
SIGTERM:                          SIGKILL:
  Process receives signal           OS terminates immediately
  → runs cleanup handlers           → no cleanup
  → closes connections               → connections drop
  → flushes buffers                  → buffers lost
  → writes final logs                → no logs
  → exits gracefully                 → process gone
```

In Node.js, you handle SIGTERM like this:

```js
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Connections closed');
    process.exit(0);
  });
});
```

You **cannot** catch SIGKILL — the OS handles it directly, the process never sees it. That's why it's the last resort.

### Sending signals to process groups

```bash
kill -TERM -12345       # Note the negative PID
```

A negative PID sends the signal to the entire **process group**. When you start a server that spawns child processes, they share the same group ID. This kills the parent and all its children.

### xargs: turning input into arguments

```bash
lsof -ti :6001 | xargs kill
```

`xargs` reads items from stdin and passes them as arguments. If `lsof` outputs `1234\n5678`, then `xargs kill` runs `kill 1234 5678`.

Without xargs, the pipe would try to feed the PIDs as **stdin** to kill, but kill reads from arguments, not stdin. xargs bridges this gap.

```bash
# These are equivalent:
lsof -ti :6001 | xargs kill
kill $(lsof -ti :6001)         # $() captures output as arguments
```

### pkill vs kill

```bash
kill 12345                # Kill by PID — you need to know the PID
pkill -f "server.js"     # Kill by pattern — matches against command line
```

`pkill` is a shortcut that combines `pgrep` (find) + `kill` (signal) in one step.
