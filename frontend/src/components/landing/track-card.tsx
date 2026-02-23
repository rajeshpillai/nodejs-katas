import { A } from "@solidjs/router";

interface TrackCardProps {
  title: string;
  description: string;
  status: "active" | "coming-soon";
  href?: string;
  icon: string;
}

export default function TrackCard(props: TrackCardProps) {
  const cardClasses = () =>
    `relative rounded-xl border p-8 transition-all duration-200 ${
      props.status === "active"
        ? "cursor-pointer hover:-translate-y-1"
        : "opacity-60 cursor-not-allowed"
    }`;

  const content = () => (
    <div
      class={cardClasses()}
      style={{
        "background-color": "var(--card-bg)",
        "border-color": "var(--border)",
        "box-shadow": `0 2px 8px var(--shadow)`,
      }}
    >
      {props.status === "coming-soon" && (
        <span
          class="absolute top-4 right-4 text-xs font-medium px-2 py-1 rounded-full"
          style={{
            "background-color": "var(--badge-bg)",
            color: "var(--badge-text)",
          }}
        >
          Coming Soon
        </span>
      )}
      <div class="text-4xl mb-4">{props.icon}</div>
      <h2 class="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
        {props.title}
      </h2>
      <p class="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {props.description}
      </p>
      {props.status === "active" && (
        <div class="mt-6 text-sm font-medium" style={{ color: "var(--accent)" }}>
          Start Learning →
        </div>
      )}
    </div>
  );

  return props.status === "active" && props.href ? (
    <A href={props.href} class="no-underline block">
      {content()}
    </A>
  ) : (
    content()
  );
}
