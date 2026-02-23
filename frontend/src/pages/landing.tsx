import TrackCard from "../components/landing/track-card";
import ThemeToggle from "../components/layout/theme-toggle";

export default function Landing() {
  return (
    <div
      class="min-h-screen flex flex-col items-center justify-center p-8"
      style={{ "background-color": "var(--bg-primary)" }}
    >
      <div class="absolute top-6 right-6">
        <ThemeToggle />
      </div>

      <div class="text-center mb-12 max-w-xl">
        <h1
          class="text-4xl font-bold mb-3"
          style={{ color: "var(--text-primary)" }}
        >
          Node.js Katas
        </h1>
        <p class="text-lg" style={{ color: "var(--text-secondary)" }}>
          A runtime for building event-driven systems, network servers,
          <br />
          real-time platforms, and data-intensive backends.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl w-full">
        <TrackCard
          title="Katas"
          description="A structured learning sequence across 17 phases — from the event loop and runtime internals to streams, PostgreSQL, WebSockets, and production architectures."
          status="active"
          href="/katas"
          icon=">"
        />
        <TrackCard
          title="Applications"
          description="Real-world Node.js systems and backend projects. Build production-grade services using the patterns learned in the katas."
          status="coming-soon"
          icon="{ }"
        />
      </div>
    </div>
  );
}
