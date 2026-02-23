# Node.js Katas

An interactive, kata-driven learning platform for Node.js — from runtime internals to production backend systems.

## What This Is

A structured playground that teaches Node.js as an **event-driven systems runtime**, not just "JavaScript with Express." Learners work through hands-on katas that cover:

- Runtime internals & the event loop
- Streams, buffers, and backpressure
- TCP/UDP networking & HTTP from first principles
- WebSockets & real-time systems
- PostgreSQL integration (connections, transactions, streaming queries)
- Security, observability, and production scaling

## Learning Path

| Phase | Topic |
|-------|-------|
| 0 | What is Node.js Really? |
| 1 | JavaScript for the Node Runtime |
| 2 | Node.js Core Architecture |
| 3 | File System & OS Interaction |
| 4 | Buffers, Binary Data & Encoding |
| 5 | Streams & Backpressure |
| 6 | Networking Fundamentals |
| 7 | HTTP from First Principles |
| 7A | WebSockets & Real-Time Systems |
| 8 | Building Web Servers & APIs |
| 8A | File Uploads & Multipart Streaming |
| 9 | PostgreSQL Integration |
| 9A | Advanced PostgreSQL in Node.js |
| 10 | Cryptography & Security |
| 11 | Child Processes & Worker Threads |
| 12 | Observability & Reliability |
| 13 | Performance & Scaling |
| 14 | Background Jobs & Async Systems |
| 15 | Frameworks (After Fundamentals) |
| 16 | Advanced Architectures |

## Project Structure

```
nodejs-katas/
├── katas/           # Kata content in markdown
├── backend/         # Node.js API & sandboxed executor
├── frontend/        # SolidJS UI (editor, visualizers)
└── scripts/         # Build & publish tooling
```

## Tech Stack

- **Backend:** Node.js (latest LTS), PostgreSQL
- **Frontend:** SolidJS, Tailwind CSS
- **Katas:** Markdown with YAML frontmatter

## Prerequisites

- **Node.js** v18+ (LTS recommended)
- **npm** (comes with Node.js)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/rajeshpillai/nodejs-katas.git
cd nodejs-katas

# Install dependencies
cd backend && npm install
cd ../frontend && npm install
cd ..
```

## Running the App

You need two terminals — one for the backend, one for the frontend.

**Terminal 1 — Backend (port 6000):**

```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend (port 3000):**

```bash
cd frontend
npm run dev
```

Open **http://localhost:3000** in your browser.

Or run both at once from the project root:

```bash
npm run dev
```

## Usage

1. Open http://localhost:3000
2. Click **Katas** on the landing page
3. Select a kata from the sidebar (start with Phase 0)
4. Read the **Description** tab to understand the concept
5. Switch to the **Experiment** tab to see the starter code
6. Click **Run** (or press `Ctrl+Enter`) to execute
7. Modify the code and re-run to explore

## Production Build

```bash
cd frontend && npm run build    # outputs to frontend/dist/
cd ../backend && npm run start  # serves API + frontend on port 6000
```

## License

MIT
