import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./app";
import Landing from "./pages/landing";
import KatasBrowser from "./pages/katas-browser";
import KataPage from "./pages/kata-page";
import NotFound from "./pages/not-found";
import "./global.css";

function Welcome() {
  return (
    <div class="flex flex-1 flex-col items-center justify-center p-12 text-center">
      <h2 class="text-xl font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
        Welcome to Node.js Katas
      </h2>
      <p class="max-w-md" style={{ color: "var(--text-secondary)" }}>
        Select a kata from the sidebar to begin. Start with Phase 0 to build
        the correct mental model for the Node.js runtime.
      </p>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Landing} />
      <Route path="/katas" component={KatasBrowser}>
        <Route path="/" component={Welcome} />
        <Route path="/:phaseId/:kataId" component={KataPage} />
      </Route>
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root
);
