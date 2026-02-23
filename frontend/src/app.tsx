import type { RouteSectionProps } from "@solidjs/router";
import { ThemeProvider } from "./context/theme-context";

export default function App(props: RouteSectionProps) {
  return <ThemeProvider>{props.children}</ThemeProvider>;
}
