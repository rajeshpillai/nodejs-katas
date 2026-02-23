import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

export const lightSyntaxHighlighting: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "#d73a49" },
    { tag: tags.definitionKeyword, color: "#d73a49" },
    { tag: tags.bool, color: "#d73a49" },
    { tag: tags.null, color: "#d73a49" },
    { tag: tags.self, color: "#e36209" },
    { tag: tags.string, color: "#032f62" },
    { tag: tags.comment, color: "#6a737d", fontStyle: "italic" },
    { tag: tags.number, color: "#005cc5" },
    { tag: tags.function(tags.variableName), color: "#6f42c1" },
    { tag: tags.operator, color: "#d73a49" },
    { tag: tags.className, color: "#6f42c1" },
  ])
);

export const darkSyntaxHighlighting: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "#ff79c6" },
    { tag: tags.definitionKeyword, color: "#ff79c6" },
    { tag: tags.bool, color: "#ff79c6" },
    { tag: tags.null, color: "#ff79c6" },
    { tag: tags.self, color: "#ffb86c" },
    { tag: tags.string, color: "#f1fa8c" },
    { tag: tags.comment, color: "#6272a4", fontStyle: "italic" },
    { tag: tags.number, color: "#bd93f9" },
    { tag: tags.function(tags.variableName), color: "#50fa7b" },
    { tag: tags.operator, color: "#ff79c6" },
    { tag: tags.className, color: "#8be9fd" },
  ])
);

export const editorTheme: Extension = [
  EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--bg-code)",
        color: "var(--text-primary)",
      },
      ".cm-content": {
        caretColor: "var(--text-primary)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--bg-code)",
        color: "var(--text-muted)",
      },
      ".cm-activeLine": {
        backgroundColor: "rgba(255,255,255,0.04)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "rgba(99,102,241,0.3)",
      },
    },
    { dark: true }
  ),
  EditorView.baseTheme({
    "&": {
      fontSize: "0.85rem",
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      height: "100%",
    },
    ".cm-scroller": {
      overflow: "auto",
      lineHeight: "1.5",
      fontFamily: "inherit",
    },
    ".cm-gutters": {
      borderRight: "1px solid var(--border)",
      fontSize: "0.8rem",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
    },
    ".cm-cursor": {
      borderLeftWidth: "2px",
    },
  }),
];
