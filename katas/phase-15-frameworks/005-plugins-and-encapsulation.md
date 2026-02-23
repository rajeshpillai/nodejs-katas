---
id: plugins-and-encapsulation
phase: 15
phase_title: Frameworks (After Fundamentals)
sequence: 5
title: Plugins and Encapsulation
difficulty: advanced
tags: [plugins, encapsulation, fastify, dependency-injection, modularity]
prerequisites: [validation-and-serialization]
estimated_minutes: 15
---

## Concept

As applications grow, you need to organize code into modules. Frameworks solve this differently:

**Express: middleware and routers**
- `express.Router()` groups routes
- Middleware is global or router-scoped
- No encapsulation — all middleware shares the same `req`/`res`
- Dependencies passed via `req.app.locals` or closures

**Fastify: plugin tree**
- Plugins are encapsulated scopes
- A plugin's decorators and hooks don't leak to siblings
- Parent context flows down, but child context doesn't flow up
- Dependencies are explicit via `.decorate()` and `.decorateRequest()`

**Plugin tree (Fastify):**
```
Root (app)
├── Plugin A (db connection)          ← available to children
│   ├── Route /api/users              ← has access to db
│   └── Route /api/orders             ← has access to db
├── Plugin B (auth)                   ← separate scope
│   └── Route /api/admin              ← has access to auth, NOT db
└── Route /health                     ← no access to db or auth
```

**Why encapsulation matters:**
- Database connections stay in the data-access plugin
- Auth logic stays in the auth plugin
- Plugins can be tested in isolation
- No accidental coupling between features

## Key Insight

> Fastify's plugin system is built on the concept of "encapsulated contexts." When you register a plugin, it gets its own scope. Decorators added inside a plugin are only visible to that plugin and its children, not to siblings or the parent. This is the opposite of Express, where every `app.use()` affects all subsequent routes. Encapsulation prevents the most common large-app problems: one team's middleware breaking another team's routes, shared mutable state on `req`, and implicit dependencies between features. It's the difference between "everything can see everything" and "you can only see what was explicitly given to you."

## Experiment

```js
console.log("=== Plugins and Encapsulation ===\n");

// --- Demo 1: Express approach — shared everything ---

console.log("--- Express: shared middleware (no encapsulation) ---\n");

class ExpressApp {
  constructor() {
    this.decorators = {};
    this.routes = [];
    this.middleware = [];
  }

  set(key, value) {
    this.decorators[key] = value;
  }

  get(key) {
    return this.decorators[key];
  }

  use(fn) {
    this.middleware.push(fn);
  }

  route(method, path, handler) {
    this.routes.push({ method, path, handler });
  }

  listRoutes() {
    return this.routes.map(r => `${r.method} ${r.path}`);
  }
}

const expressApp = new ExpressApp();

// "Plugin A" sets a database connection
expressApp.set("db", { host: "localhost", pool: 10 });

// "Plugin B" sets auth
expressApp.set("auth", { secret: "supersecret" });

// Problem: everything is visible everywhere
console.log("  All decorators are global:");
console.log(`    db:   ${JSON.stringify(expressApp.get("db"))}`);
console.log(`    auth: ${JSON.stringify(expressApp.get("auth"))}`);
console.log("  → Any route can access any decorator\n");

// Middleware added by one "plugin" affects all routes
expressApp.use((req) => { req.timestamp = Date.now(); });

console.log("  Middleware is global:");
console.log("    MW added by plugin A runs for plugin B's routes too");
console.log("    → No isolation between features\n");

// --- Demo 2: Fastify approach — encapsulated plugins ---

console.log("--- Fastify: encapsulated plugins ---\n");

class PluginScope {
  constructor(parent = null) {
    this.parent = parent;
    this.decorators = new Map();
    this.requestDecorators = new Map();
    this.hooks = [];
    this.routes = [];
    this.children = [];
    this.name = "root";
  }

  decorate(key, value) {
    this.decorators.set(key, value);
  }

  decorateRequest(key, value) {
    this.requestDecorators.set(key, value);
  }

  hasDecorator(key) {
    if (this.decorators.has(key)) return true;
    return this.parent ? this.parent.hasDecorator(key) : false;
  }

  getDecorator(key) {
    if (this.decorators.has(key)) return this.decorators.get(key);
    return this.parent ? this.parent.getDecorator(key) : undefined;
  }

  addHook(fn) {
    this.hooks.push(fn);
  }

  addRoute(method, path, handler) {
    this.routes.push({ method, path, handler, scope: this.name });
  }

  register(pluginFn, opts = {}) {
    // Create an encapsulated child scope
    const child = new PluginScope(this);
    child.name = opts.prefix || pluginFn.name || `plugin-${this.children.length}`;

    // Run the plugin function with the child scope
    pluginFn(child, opts);

    this.children.push(child);
    return child;
  }

  // Visualize the scope tree
  visualize(indent = 0) {
    const pad = "  ".repeat(indent + 1);
    const decorators = [...this.decorators.keys()];
    const inherited = [];
    let p = this.parent;
    while (p) {
      inherited.push(...p.decorators.keys());
      p = p.parent;
    }

    console.log(`${pad}[${this.name}]`);
    if (decorators.length) console.log(`${pad}  own decorators: ${decorators.join(", ")}`);
    if (inherited.length) console.log(`${pad}  inherited: ${inherited.join(", ")}`);
    if (this.routes.length) {
      console.log(`${pad}  routes: ${this.routes.map(r => `${r.method} ${r.path}`).join(", ")}`);
    }
    if (this.hooks.length) console.log(`${pad}  hooks: ${this.hooks.length}`);

    for (const child of this.children) {
      child.visualize(indent + 1);
    }
  }

  // Check what's accessible from this scope
  accessible() {
    const result = { own: [], inherited: [] };
    for (const key of this.decorators.keys()) result.own.push(key);
    let p = this.parent;
    while (p) {
      for (const key of p.decorators.keys()) result.inherited.push(key);
      p = p.parent;
    }
    return result;
  }
}

const app = new PluginScope();
app.name = "root";

// Root-level decorator — available everywhere
app.decorate("config", { env: "production" });

// Database plugin
function dbPlugin(scope, opts) {
  // Decorate with database connection
  scope.decorate("db", {
    query: (sql) => `[DB] ${sql}`,
    pool: { total: 10, active: 3 },
  });

  scope.addHook((req) => { req.db = scope.getDecorator("db"); });
}

// Auth plugin
function authPlugin(scope, opts) {
  scope.decorate("auth", {
    verify: (token) => token === "valid",
    secret: opts.secret || "default-secret",
  });

  scope.addHook((req) => { req.user = null; });
}

// User routes plugin (depends on db + auth)
function userRoutes(scope) {
  scope.addRoute("GET", "/api/users", "listUsers");
  scope.addRoute("GET", "/api/users/:id", "getUser");
  scope.addRoute("POST", "/api/users", "createUser");
}

// Admin routes plugin (depends on auth only)
function adminRoutes(scope) {
  scope.decorate("adminOnly", true);
  scope.addRoute("GET", "/api/admin/stats", "adminStats");
  scope.addRoute("DELETE", "/api/admin/users/:id", "deleteUser");
}

// Register plugins
const dbScope = app.register(dbPlugin, { prefix: "db" });
const authScope = app.register(authPlugin, { prefix: "auth", secret: "my-secret" });

// User routes: registered under db scope (has db access)
dbScope.register(userRoutes, { prefix: "users" });

// Admin routes: registered under auth scope (has auth access but NOT db)
authScope.register(adminRoutes, { prefix: "admin" });

// Health route at root level
app.addRoute("GET", "/health", "healthCheck");

console.log("  Plugin tree:\n");
app.visualize();

// --- Demo 3: Encapsulation proof ---

console.log("\n--- Encapsulation proof ---\n");

// What can each scope access?
const scopes = [
  { name: "root", scope: app },
  { name: "db plugin", scope: dbScope },
  { name: "auth plugin", scope: authScope },
  { name: "user routes", scope: dbScope.children[0] },
  { name: "admin routes", scope: authScope.children[0] },
];

console.log(`  ${"Scope".padEnd(16)} ${"Has db?".padEnd(10)} ${"Has auth?".padEnd(12)} ${"Has config?".padEnd(14)} Has adminOnly?`);
console.log(`  ${"-".repeat(62)}`);

for (const { name, scope } of scopes) {
  console.log(
    `  ${name.padEnd(16)} ${String(scope.hasDecorator("db")).padEnd(10)} ` +
    `${String(scope.hasDecorator("auth")).padEnd(12)} ` +
    `${String(scope.hasDecorator("config")).padEnd(14)} ` +
    `${scope.hasDecorator("adminOnly")}`
  );
}

console.log(`\n  Key observations:`);
console.log(`    - "user routes" can see "db" (parent) and "config" (grandparent)`);
console.log(`    - "user routes" CANNOT see "auth" (sibling's parent)`);
console.log(`    - "admin routes" can see "auth" but NOT "db"`);
console.log(`    - "adminOnly" is only visible inside admin routes`);

// --- Demo 4: Dependency injection via decorators ---

console.log("\n--- Dependency injection ---\n");

class ServiceContainer {
  constructor() {
    this.services = new Map();
    this.factories = new Map();
  }

  register(name, factory) {
    this.factories.set(name, factory);
  }

  get(name) {
    if (!this.services.has(name)) {
      const factory = this.factories.get(name);
      if (!factory) throw new Error(`Service not registered: ${name}`);
      this.services.set(name, factory(this));
    }
    return this.services.get(name);
  }

  has(name) {
    return this.factories.has(name);
  }
}

const container = new ServiceContainer();

// Register services
container.register("config", () => ({
  db: { host: "localhost", port: 5432 },
  redis: { host: "localhost", port: 6379 },
}));

container.register("db", (c) => {
  const config = c.get("config").db;
  return { query: (sql) => `[${config.host}:${config.port}] ${sql}` };
});

container.register("cache", (c) => {
  const config = c.get("config").redis;
  return { get: (key) => `[${config.host}:${config.port}] GET ${key}` };
});

container.register("userService", (c) => {
  const db = c.get("db");
  const cache = c.get("cache");
  return {
    getUser: (id) => {
      const cached = cache.get(`user:${id}`);
      const queried = db.query(`SELECT * FROM users WHERE id = ${id}`);
      return { cached, queried };
    },
  };
});

// Lazy instantiation — services created on first access
console.log("  Service container (lazy instantiation):\n");

const userService = container.get("userService");
const result = userService.getUser(42);
console.log(`    cache.get: ${result.cached}`);
console.log(`    db.query:  ${result.queried}`);

// --- Demo 5: Plugin patterns ---

console.log("\n--- Common plugin patterns ---\n");

console.log(`  // 1. Database plugin
  async function dbPlugin(app, opts) {
    const pool = new Pool(opts.connectionString);
    await pool.query('SELECT 1');               // Verify connection
    app.decorate('db', pool);                   // Add to scope
    app.addHook('onClose', () => pool.end());   // Cleanup
  }

  // 2. Auth plugin
  async function authPlugin(app, opts) {
    app.decorate('authenticate', async (req) => {
      const token = req.headers.authorization?.slice(7);
      if (!token) throw new Error('Unauthorized');
      return verifyJWT(token, opts.secret);
    });

    app.addHook('preHandler', async (req) => {
      req.user = await app.authenticate(req);
    });
  }

  // 3. Feature plugin (groups routes)
  async function usersPlugin(app) {
    app.get('/', listUsers);
    app.get('/:id', getUser);
    app.post('/', createUser);
  }

  // 4. Registration
  app.register(dbPlugin, { connectionString: process.env.DATABASE_URL });
  app.register(authPlugin, { secret: process.env.JWT_SECRET });
  app.register(usersPlugin, { prefix: '/api/users' });
`);

// --- Demo 6: Express Router vs Fastify Plugin comparison ---

console.log("--- Express Router vs Fastify Plugin ---\n");

const comparison = [
  ["Feature", "Express Router", "Fastify Plugin"],
  ["Route grouping", "✓ (prefix)", "✓ (prefix)"],
  ["Isolated middleware", "Partial (router-scoped)", "✓ (encapsulated)"],
  ["Shared decorators", "Global (app.locals)", "Scoped (decorate)"],
  ["Hook lifecycle", "N/A", "✓ (7 phases)"],
  ["Dependency injection", "Manual", "Built-in (decorate)"],
  ["Async setup", "Manual", "✓ (async plugin fn)"],
  ["Testing in isolation", "Difficult", "Easy (register + inject)"],
];

for (const [feature, express, fastify] of comparison) {
  console.log(`  ${feature.padEnd(24)} ${express.padEnd(28)} ${fastify}`);
}
```

## Expected Output

```
=== Plugins and Encapsulation ===

--- Express: shared middleware (no encapsulation) ---

  All decorators are global:
    db:   {"host":"localhost","pool":10}
    auth: {"secret":"supersecret"}
  → Any route can access any decorator

--- Fastify: encapsulated plugins ---

  Plugin tree:

    [root]
      own decorators: config
      routes: GET /health
      [db]
        own decorators: db
        inherited: config
        ...

--- Encapsulation proof ---

  Scope            Has db?    Has auth?    Has config?    Has adminOnly?
  root             false      false        true           false
  db plugin        true       false        true           false
  auth plugin      false      true         true           false
  user routes      true       false        true           false
  admin routes     false      true         true           true
  ...
```

## Challenge

1. Build a plugin system that supports async initialization: `await app.register(async (scope) => { scope.decorate('db', await connectDB()); })`. Handle errors during plugin initialization gracefully
2. Implement Fastify's `fastify-plugin` pattern: a plugin that "breaks out" of encapsulation and decorates the parent scope. When would you want this vs. normal encapsulated plugins?
3. Design a testing strategy for a plugin-based app: how do you test a route that depends on `db` and `auth` decorators without starting the full app? Implement a `createTestApp()` helper that registers mock plugins

## Common Mistakes

- Global mutable state in Express — `app.set('key', value)` is visible everywhere and can be overwritten by any middleware. In large apps, this leads to subtle bugs
- Not encapsulating database connections — every route file imports the pool directly. Fastify's `decorate('db', pool)` keeps it scoped and testable
- Plugin order dependencies — registering auth before db when auth needs db. Use Fastify's async plugins to ensure dependencies are ready
- Testing entire apps instead of plugins — Fastify plugins can be tested in isolation by creating a minimal app, registering just that plugin with mock dependencies, and injecting requests
