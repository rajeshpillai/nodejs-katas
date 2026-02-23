import { A } from "@solidjs/router";

export default function NotFound() {
  return (
    <div
      class="min-h-screen flex flex-col items-center justify-center p-8"
      style={{ "background-color": "var(--bg-primary)" }}
    >
      <h1
        class="text-6xl font-bold mb-4"
        style={{ color: "var(--text-muted)" }}
      >
        404
      </h1>
      <p class="text-lg mb-6" style={{ color: "var(--text-secondary)" }}>
        Page not found
      </p>
      <A
        href="/"
        class="text-sm font-medium no-underline"
        style={{ color: "var(--accent)" }}
      >
        ← Back to Home
      </A>
    </div>
  );
}
