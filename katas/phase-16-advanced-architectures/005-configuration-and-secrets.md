---
id: configuration-and-secrets
phase: 16
phase_title: Advanced Architectures
sequence: 5
title: Configuration and Secrets Management
difficulty: advanced
tags: [configuration, secrets, environment, dotenv, 12-factor, security]
prerequisites: [monolith-vs-microservices]
estimated_minutes: 12
---

## Concept

Every production system needs external configuration: database URLs, API keys, feature flags, tuning parameters. How you manage this determines whether your app is secure, portable, and debuggable.

**The 12-Factor App rule:** Store configuration in environment variables, not in code.

**Configuration hierarchy (increasing precedence):**
1. Default values in code
2. Configuration files (`config.json`, `config.yaml`)
3. Environment variables (`.env` files for dev, real env vars in production)
4. Command-line arguments
5. Remote configuration (feature flags, service discovery)

**Secrets vs configuration:**
- **Configuration** — can be checked into source control: port numbers, log levels, feature flags
- **Secrets** — NEVER in source control: database passwords, API keys, JWT secrets, encryption keys

**Where secrets live in production:**
- Environment variables (basic)
- Cloud secret managers (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault)
- Kubernetes Secrets (mounted as env vars or files)
- Encrypted configuration files

## Key Insight

> The critical insight about configuration is the separation between *what can change per environment* and *what should never be in code*. A port number can be in code as a default (`6001`) and overridden by an environment variable. A database password should NEVER appear in code — not even as a default. The `.env` file bridges development convenience (readable config file) with production safety (real env vars). But `.env` files must NEVER be committed to git — one leaked `.env` file in a public repo exposes every secret.

## Experiment

```js
console.log("=== Configuration and Secrets Management ===\n");

// --- Demo 1: Configuration loader with hierarchy ---

console.log("--- Configuration hierarchy ---\n");

class ConfigLoader {
  constructor() {
    this.sources = [];
    this.values = new Map();
    this.log = [];
  }

  // Add a configuration source (lower priority = loaded first)
  addSource(name, values, priority) {
    this.sources.push({ name, values, priority });
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  // Load all sources in priority order
  load() {
    this.values.clear();

    for (const source of this.sources) {
      for (const [key, value] of Object.entries(source.values)) {
        const had = this.values.has(key);
        this.values.set(key, value);
        if (had) {
          this.log.push({ key, source: source.name, action: "override" });
        } else {
          this.log.push({ key, source: source.name, action: "set" });
        }
      }
    }
  }

  get(key, defaultValue) {
    return this.values.has(key) ? this.values.get(key) : defaultValue;
  }

  getRequired(key) {
    if (!this.values.has(key)) {
      throw new Error(`Missing required config: ${key}`);
    }
    return this.values.get(key);
  }

  getAll() {
    return Object.fromEntries(this.values);
  }
}

const config = new ConfigLoader();

// Priority 1: Defaults in code
config.addSource("defaults", {
  PORT: "6001",
  LOG_LEVEL: "info",
  NODE_ENV: "development",
  DB_POOL_SIZE: "10",
  CACHE_TTL: "3600",
}, 1);

// Priority 2: Config file
config.addSource("config-file", {
  LOG_LEVEL: "debug",
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_NAME: "myapp_dev",
}, 2);

// Priority 3: .env file
config.addSource("dotenv", {
  DB_HOST: "db.staging.internal",
  DB_PASSWORD: "staging-password-123",
  JWT_SECRET: "dev-secret-key",
}, 3);

// Priority 4: Environment variables
config.addSource("env-vars", {
  PORT: "8080",
  NODE_ENV: "production",
  DB_PASSWORD: "prod-password-very-secret",
}, 4);

config.load();

console.log("  Configuration sources (lowest → highest priority):\n");
for (const source of config.sources) {
  console.log(`    ${source.priority}. ${source.name}: ${Object.keys(source.values).join(", ")}`);
}

console.log("\n  Resolved values:\n");
const resolved = config.getAll();
for (const [key, value] of Object.entries(resolved)) {
  const isSensitive = /PASSWORD|SECRET|KEY|TOKEN/i.test(key);
  const display = isSensitive ? value.slice(0, 3) + "***" : value;
  console.log(`    ${key.padEnd(16)} = ${display}`);
}

console.log("\n  Override log:");
for (const entry of config.log.filter(e => e.action === "override")) {
  console.log(`    ${entry.key}: overridden by ${entry.source}`);
}

// --- Demo 2: Environment variable parsing ---

console.log("\n--- Environment variable parsing ---\n");

class EnvParser {
  static string(value, fallback) {
    return value !== undefined ? value : fallback;
  }

  static int(value, fallback) {
    if (value === undefined) return fallback;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) throw new Error(`Invalid integer: ${value}`);
    return parsed;
  }

  static float(value, fallback) {
    if (value === undefined) return fallback;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) throw new Error(`Invalid float: ${value}`);
    return parsed;
  }

  static bool(value, fallback) {
    if (value === undefined) return fallback;
    return ["true", "1", "yes"].includes(value.toLowerCase());
  }

  static list(value, fallback = []) {
    if (value === undefined) return fallback;
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }

  static url(value, fallback) {
    if (value === undefined) return fallback;
    try {
      new URL(value);
      return value;
    } catch {
      throw new Error(`Invalid URL: ${value}`);
    }
  }

  static duration(value, fallback) {
    if (value === undefined) return fallback;
    const match = value.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) throw new Error(`Invalid duration: ${value}`);
    const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return parseInt(match[1]) * multipliers[match[2]];
  }
}

// Parse environment variables with type safety
const envExamples = {
  PORT: { raw: "8080", parsed: EnvParser.int("8080"), type: "int" },
  DEBUG: { raw: "true", parsed: EnvParser.bool("true"), type: "bool" },
  ALLOWED_ORIGINS: { raw: "http://localhost,https://myapp.com", parsed: EnvParser.list("http://localhost,https://myapp.com"), type: "list" },
  CACHE_TTL: { raw: "30m", parsed: EnvParser.duration("30m"), type: "duration" },
  DB_URL: { raw: "postgresql://localhost:5432/app", parsed: EnvParser.url("postgresql://localhost:5432/app"), type: "url" },
};

console.log(`  ${"Variable".padEnd(20)} ${"Raw".padEnd(35)} ${"Parsed".padEnd(25)} Type`);
console.log(`  ${"-".repeat(90)}`);
for (const [key, { raw, parsed, type }] of Object.entries(envExamples)) {
  const parsedStr = JSON.stringify(parsed);
  console.log(`  ${key.padEnd(20)} ${raw.padEnd(35)} ${parsedStr.padEnd(25)} ${type}`);
}

// --- Demo 3: .env file parser ---

console.log("\n--- .env file parser ---\n");

function parseDotenv(content) {
  const vars = {};

  for (const line of content.split("\n")) {
    // Skip comments and empty lines
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Parse KEY=VALUE
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Handle escape sequences in double quotes
    if (trimmed.slice(eqIndex + 1).trim().startsWith('"')) {
      value = value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    }

    vars[key] = value;
  }

  return vars;
}

const dotenvContent = `# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp_development
DB_PASSWORD="p@ss w0rd!"

# App
PORT=6001
NODE_ENV=development
LOG_LEVEL=debug

# Secrets
JWT_SECRET='my-dev-secret-key-change-in-production'
API_KEY=sk_test_abc123def456

# Multiline (escaped)
GREETING="Hello\\nWorld"`;

const parsed = parseDotenv(dotenvContent);

console.log("  .env file parsed:\n");
for (const [key, value] of Object.entries(parsed)) {
  const isSensitive = /PASSWORD|SECRET|KEY|TOKEN/i.test(key);
  const display = isSensitive ? value.slice(0, 5) + "***" : value;
  console.log(`    ${key.padEnd(16)} = ${display}`);
}

// --- Demo 4: Configuration validation ---

console.log("\n--- Configuration validation (fail-fast) ---\n");

class ConfigSchema {
  constructor(schema) {
    this.schema = schema;
  }

  validate(config) {
    const errors = [];
    const warnings = [];

    for (const [key, rule] of Object.entries(this.schema)) {
      const value = config[key];

      // Required check
      if (rule.required && (value === undefined || value === "")) {
        errors.push(`${key}: required but missing`);
        continue;
      }

      if (value === undefined) continue;

      // Type check
      if (rule.type === "int" && isNaN(parseInt(value))) {
        errors.push(`${key}: must be an integer, got "${value}"`);
      }
      if (rule.type === "bool" && !["true", "false", "0", "1"].includes(value)) {
        errors.push(`${key}: must be boolean, got "${value}"`);
      }

      // Range check
      if (rule.min !== undefined && parseInt(value) < rule.min) {
        errors.push(`${key}: must be >= ${rule.min}, got ${value}`);
      }
      if (rule.max !== undefined && parseInt(value) > rule.max) {
        errors.push(`${key}: must be <= ${rule.max}, got ${value}`);
      }

      // Enum check
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`${key}: must be one of [${rule.enum.join(", ")}], got "${value}"`);
      }

      // Sensitive in non-production
      if (rule.sensitive && value.includes("dev") && config.NODE_ENV === "production") {
        warnings.push(`${key}: appears to be a dev value in production`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

const schema = new ConfigSchema({
  PORT: { required: true, type: "int", min: 1, max: 65535 },
  NODE_ENV: { required: true, enum: ["development", "staging", "production"] },
  DB_HOST: { required: true },
  DB_PORT: { required: true, type: "int", min: 1, max: 65535 },
  DB_PASSWORD: { required: true, sensitive: true },
  LOG_LEVEL: { enum: ["trace", "debug", "info", "warn", "error", "fatal"] },
  JWT_SECRET: { required: true, sensitive: true },
});

// Test with good config
const goodConfig = {
  PORT: "8080", NODE_ENV: "production", DB_HOST: "db.prod.internal",
  DB_PORT: "5432", DB_PASSWORD: "strong-prod-password",
  LOG_LEVEL: "info", JWT_SECRET: "production-secret-abc123",
};

const goodResult = schema.validate(goodConfig);
console.log(`  Good config: valid=${goodResult.valid}, errors=${goodResult.errors.length}\n`);

// Test with bad config
const badConfig = {
  PORT: "99999", NODE_ENV: "staging",
  DB_PORT: "not-a-number", LOG_LEVEL: "verbose",
};

const badResult = schema.validate(badConfig);
console.log(`  Bad config: valid=${badResult.valid}, errors=${badResult.errors.length}`);
for (const err of badResult.errors) {
  console.log(`    ✗ ${err}`);
}

// --- Demo 5: Secret masking ---

console.log("\n--- Secret masking in logs ---\n");

class SecretMasker {
  constructor(sensitiveKeys = []) {
    this.patterns = sensitiveKeys.map(k => new RegExp(k, "i"));
  }

  mask(obj, depth = 0) {
    if (depth > 10) return obj;
    if (typeof obj !== "object" || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.mask(item, depth + 1));

    const masked = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.patterns.some(p => p.test(key))) {
        masked[key] = typeof value === "string"
          ? value.slice(0, 3) + "***"
          : "***";
      } else if (typeof value === "object") {
        masked[key] = this.mask(value, depth + 1);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
}

const masker = new SecretMasker([
  "password", "secret", "token", "key", "authorization",
]);

const logEntry = {
  event: "user_login",
  user: "alice",
  headers: {
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz",
    "content-type": "application/json",
  },
  config: {
    dbPassword: "super-secret-password",
    apiKey: "sk_live_abc123",
    port: 8080,
  },
};

console.log("  Before masking:");
console.log(`    ${JSON.stringify(logEntry, null, 2).split("\n").join("\n    ")}\n`);

console.log("  After masking:");
const maskedEntry = masker.mask(logEntry);
console.log(`    ${JSON.stringify(maskedEntry, null, 2).split("\n").join("\n    ")}`);

// --- Demo 6: Best practices ---

console.log("\n=== Configuration Best Practices ===\n");

const practices = [
  [".env in .gitignore", "NEVER commit .env files with secrets"],
  ["Validate at startup", "Fail fast if required config is missing"],
  ["Type-parse env vars", "process.env values are always strings — parse them"],
  ["Use defaults wisely", "Default PORT is fine; default PASSWORD is not"],
  ["Mask secrets in logs", "Never log raw passwords, tokens, or keys"],
  ["Rotate secrets regularly", "Leaked secrets have limited damage if rotated"],
  ["Use secret managers", "AWS/GCP Secret Manager, HashiCorp Vault in production"],
  ["Separate config by env", "Dev defaults ≠ staging ≠ production"],
];

for (const [practice, detail] of practices) {
  console.log(`  ${practice}`);
  console.log(`    → ${detail}\n`);
}
```

## Expected Output

```
=== Configuration and Secrets Management ===

--- Configuration hierarchy ---

  Configuration sources (lowest → highest priority):

    1. defaults: PORT, LOG_LEVEL, NODE_ENV, DB_POOL_SIZE, CACHE_TTL
    2. config-file: LOG_LEVEL, DB_HOST, DB_PORT, DB_NAME
    3. dotenv: DB_HOST, DB_PASSWORD, JWT_SECRET
    4. env-vars: PORT, NODE_ENV, DB_PASSWORD

  Resolved values:

    PORT             = 8080
    LOG_LEVEL        = debug
    NODE_ENV         = production
    DB_PASSWORD      = pro***
    ...
```

## Challenge

1. Build a configuration module for your Node.js app: load defaults → config file → `.env` → real env vars, validate required fields at startup, parse types (int, bool, duration), and mask secrets in log output
2. Implement config hot-reloading: watch a config file for changes and update the running application without restarting. Which values can be hot-reloaded safely (log level, feature flags) and which require a restart (port, database URL)?
3. Design a secrets rotation strategy: your JWT secret needs to change every 30 days. How do you rotate it without invalidating all existing tokens? (Hint: support multiple active secrets)

## Common Mistakes

- Committing `.env` files — the #1 cause of credential leaks. Add `.env` to `.gitignore` immediately
- Hardcoded secrets in code — `const secret = "abc123"` in source code is visible in git history forever, even if you delete it later
- Not validating config at startup — a missing `DB_HOST` discovered 2 hours later during the first database query is much harder to debug than a startup failure
- Using `process.env` everywhere — scattered `process.env.X` calls throughout the codebase are hard to track. Load config once at startup and pass it explicitly
