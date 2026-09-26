"use client";

import { memo, useMemo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStreamStore, type FlagEntry, type TokenEntry } from "@/lib/stream-store";
import { rehypeStreamTokens } from "@/lib/markdown-tokens";

function TokenText({ index, flag, showFlag, children }: {
  index: number; flag?: FlagEntry; showFlag: boolean; children: ReactNode;
}) {
  const hovered = useStreamStore((state) => state.hoveredTokenIndex === index);
  const hover = useStreamStore((state) => state.hoverToken);
  return (
    <span
      data-token-index={index}
      onPointerEnter={() => hover(index)}
      className={`${hovered ? "bg-water/60" : ""} ${flag ? "decoration-alert underline decoration-2 underline-offset-4" : ""}`}
    >
      {children}
      {flag && showFlag ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="mx-0.5 inline rounded text-alert focus-visible:outline-2 focus-visible:outline-harbor"
              aria-label={`Flag: ${flag.signature}, ${Math.round(flag.confidence * 100)} percent`}
            >
              ⚠
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {flag.signature} · {Math.round(flag.confidence * 100)}%
          </TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}

export const MarkdownOutput = memo(function MarkdownOutput({ tokens, flags }: {
  tokens: readonly TokenEntry[]; flags: readonly FlagEntry[];
}) {
  const text = useMemo(() => tokens.map((token) => token.text).join(""), [tokens]);
  const plugins = useMemo(() => [rehypeStreamTokens(tokens)], [tokens]);
  const components = useMemo<Components>(() => {
    const byToken = new Map(flags.map((flag) => [flag.tokenIndex, flag]));
    return {
      span: ({ node, children }) => {
        const index = Number(node?.properties["data-token-index"]);
        if (!Number.isFinite(index)) return <span>{children}</span>;
        return <TokenText index={index}
          flag={byToken.get(index)} showFlag={!!node?.properties["data-token-flag"]}>
          {children}
        </TokenText>;
      },
    };
  }, [flags]);

  return (
    <div className="space-y-3 [&_a]:text-harbor [&_a]:underline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-harbor [&_blockquote]:border-l-4 [&_blockquote]:border-crate [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-sand-light [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-sand-light [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6">
      <Markdown skipHtml disallowedElements={["img"]} rehypePlugins={plugins} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
