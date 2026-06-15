import { Fragment, type ReactNode } from "react";

const URL_RE = /(?:https?:\/\/|www\.)[^\s<]+/gi;

function trimTrailingPunctuation(url: string): { href: string; trailing: string } {
  let href = url;
  let trailing = "";
  while (href.length > 0 && /[.,;:!?)\]}>]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }
  return { href, trailing };
}

function toHref(url: string): string {
  return url.startsWith("www.") ? `https://${url}` : url;
}

export function linkifyText(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  const re = new RegExp(URL_RE.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const { href, trailing } = trimTrailingPunctuation(raw);
    if (href) {
      nodes.push(
        <a
          key={`${match.index}-${href}`}
          href={toHref(href)}
          target="_blank"
          rel="noopener noreferrer"
          className="message-link"
        >
          {href}
        </a>
      );
    } else {
      nodes.push(raw);
    }
    if (trailing) nodes.push(trailing);
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  if (nodes.length === 0) return text;
  return <>{nodes.map((node, i) => <Fragment key={i}>{node}</Fragment>)}</>;
}
