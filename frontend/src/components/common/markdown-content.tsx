import { createMemo } from "solid-js";
import { marked } from "marked";

interface MarkdownContentProps {
  content: string;
}

// GFM gives us tables, fenced code blocks and strikethrough. `breaks` stays off
// so a single newline inside a paragraph does not become a <br>.
marked.use({ gfm: true, breaks: false });

export default function MarkdownContent(props: MarkdownContentProps) {
  const rendered = createMemo(() =>
    marked.parse(props.content || "", { async: false })
  );

  return <div class="markdown-body" innerHTML={rendered()} />;
}
