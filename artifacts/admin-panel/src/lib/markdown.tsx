/**
 * Tiny inline markdown renderer for analyst reports. Handles headings,
 * paragraphs, bullet/numbered lists, **bold**, *italic*, `code`, and
 * pipe-separated tables. No deps. Safe for trusted server-generated
 * markdown only — does NOT sanitize arbitrary HTML.
 */
import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" }
  | { kind: "blank" };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const trimmed = ln.trim();

    if (trimmed === "") { i++; continue; }
    if (/^---+$/.test(trimmed) || /^___+$/.test(trimmed)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    if (trimmed.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*[-:|\s]+\|/.test(lines[i + 1])) {
      const head = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const para: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|[-*]\s|\d+\.\s|\|)/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

function splitRow(row: string): string[] {
  return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function renderInline(text: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  let rest = text;
  let k = 0;
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(rest)) !== null) {
    if (m.index > last) parts.push(rest.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={`${key}-${k++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={`${key}-${k++}`} className="bg-muted px-1 py-0.5 rounded text-[12px] font-mono">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t);
      if (lm) parts.push(<a key={`${key}-${k++}`} href={lm[2]} target="_blank" rel="noreferrer" className="text-primary underline">{lm[1]}</a>);
    } else parts.push(<em key={`${key}-${k++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < rest.length) parts.push(rest.slice(last));
  return <Fragment key={key}>{parts}</Fragment>;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="text-sm leading-relaxed text-foreground/90 space-y-3">
      {blocks.map((b, i) => {
        if (b.kind === "blank") return null;
        if (b.kind === "hr") return <hr key={i} className="border-border/60 my-4" />;
        if (b.kind === "h") {
          const sizes = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];
          const cls = `${sizes[b.level - 1]} font-semibold mt-5 mb-1 text-foreground`;
          if (b.level === 1) return <h1 key={i} className={cls}>{renderInline(b.text, i)}</h1>;
          if (b.level === 2) return <h2 key={i} className={cls}>{renderInline(b.text, i)}</h2>;
          if (b.level === 3) return <h3 key={i} className={cls}>{renderInline(b.text, i)}</h3>;
          return <h4 key={i} className={cls}>{renderInline(b.text, i)}</h4>;
        }
        if (b.kind === "p") return <p key={i}>{renderInline(b.text, i)}</p>;
        if (b.kind === "ul") return (
          <ul key={i} className="list-disc pl-6 space-y-1">
            {b.items.map((it, j) => <li key={j}>{renderInline(it, j)}</li>)}
          </ul>
        );
        if (b.kind === "ol") return (
          <ol key={i} className="list-decimal pl-6 space-y-1">
            {b.items.map((it, j) => <li key={j}>{renderInline(it, j)}</li>)}
          </ol>
        );
        if (b.kind === "table") return (
          <div key={i} className="overflow-x-auto rounded border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>{b.head.map((h, j) => <th key={j} className="text-left px-3 py-2 font-semibold">{renderInline(h, j)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-t border-border/40">
                    {r.map((c, k) => <td key={k} className="px-3 py-1.5 align-top">{renderInline(c, k)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        return null;
      })}
    </div>
  );
}
