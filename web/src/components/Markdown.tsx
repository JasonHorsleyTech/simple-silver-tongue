import { Check, Copy } from "lucide-react";
import { memo, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cx } from "../lib/cx.ts";
import { copyText } from "../lib/clipboard.ts";

/**
 * The scrollback's Markdown: GFM (tables, task lists, strikethrough, footnotes), single newlines kept as line
 * breaks, highlighted code blocks with a copy button, tables that scroll sideways instead of squashing, and
 * links that open in a new tab.
 *
 * Raw HTML is never rendered as HTML, and never silently dropped either: it shows as literal, faint text.
 * Models here see framing like `<!-- from: the user -->` and sometimes echo it back, and in this app nothing
 * a model wrote or will read should be invisible. Styles live in index.css under `.md`.
 */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx("md", className)}>
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };

/** Block containers: an html node directly inside one of these is a block of its own. */
const FLOW = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

/** remark plugin: turn every raw-HTML node into literal code text with the `md-html` class. */
function remarkVisibleHtml() {
  const visit = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type !== "html") {
        visit(child);
        return child;
      }
      const code: MdNode = { type: "inlineCode", value: child.value ?? "", data: { hProperties: { className: ["md-html"] } } };
      return FLOW.has(node.type) ? { type: "paragraph", children: [code] } : code;
    });
  };
  return (tree: MdNode) => visit(tree);
}

// remark-breaks: a single newline is a line break, as typed in the composer (and as a haiku needs).
const REMARK = [remarkGfm, remarkBreaks, remarkVisibleHtml];
const REHYPE = [[rehypeHighlight, { detect: false }]] as ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const textOf = (n: HastNode | undefined): string =>
  !n ? "" : n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join("");

const COMPONENTS: Components = {
  pre({ node, children }) {
    const code = (node as HastNode | undefined)?.children?.find((c) => c.tagName === "code");
    const classes = (code?.properties?.className as string[] | undefined) ?? [];
    const lang = classes.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
    return <CodeBlock lang={lang} raw={textOf(code).replace(/\n$/, "")}>{children}</CodeBlock>;
  },
  table({ children }) {
    return (
      <div className="md-table">
        <table>{children}</table>
      </div>
    );
  },
  a({ href, children }) {
    // In-page links (footnotes) stay here; everything else opens in a new tab, away from the chat.
    if (href?.startsWith("#")) return <a href={href}>{children}</a>;
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

function CodeBlock({ lang, raw, children }: { lang: string; raw: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || "text"}</span>
        <button
          type="button"
          className="md-code-copy"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={async () => {
            if (await copyText(raw)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
