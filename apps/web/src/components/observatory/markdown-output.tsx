"use client";

import { memo, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import { useStreamStore, type TokenEntry } from "@/lib/stream-store";
import { rehypeStreamTokens, type SectionMarker } from "@/lib/markdown-tokens";

export type OutputSection = SectionMarker & { label: string; focus: string | null };

// Where a reading's section starts in the text; links it to its bubble.
function SectionDot({ section }: { section: OutputSection }) {
  const lit = useStreamStore((state) =>
    state.hoveredReading === section.key || state.openReading === section.key);
  const hoverReading = useStreamStore((state) => state.hoverReading);
  const setOpenReading = useStreamStore((state) => state.setOpenReading);
  return (
    <button
      type="button"
      data-section-key={section.key}
      aria-label={`${section.label}: ${section.focus ?? "no clear focus"}. Show in the ocean`}
      title={`${section.label} · ${section.focus ?? "no clear focus"}`}
      onPointerEnter={() => hoverReading(section.key)}
      onPointerLeave={() => hoverReading(null)}
      onClick={() => setOpenReading(section.key)}
      className={`mr-1.5 inline-block size-2.5 -translate-y-px scroll-my-16 rounded-full align-middle transition-[transform,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor ${
        lit ? "scale-150 bg-glow-3 shadow-[0_0_0_3px_color-mix(in_srgb,var(--glow-4)_45%,transparent)]" : "bg-glow-2"
      }`}
    />
  );
}

const NO_SECTIONS: readonly OutputSection[] = [];

export const MarkdownOutput = memo(function MarkdownOutput({ tokens, sections = NO_SECTIONS }: {
  tokens: readonly TokenEntry[]; sections?: readonly OutputSection[];
}) {
  const text = useMemo(() => tokens.map((token) => token.text).join(""), [tokens]);
  const plugins = useMemo(() => [rehypeStreamTokens(tokens, sections)], [tokens, sections]);
  const components = useMemo<Components>(() => {
    const byKey = new Map(sections.map((section) => [section.key, section]));
    return {
      // Token spans exist to place the section dots; they carry no behaviour.
      span: ({ node, children }) => {
        const section = byKey.get(String(node?.properties["data-section"] ?? ""));
        if (!section) return <span>{children}</span>;
        return <><SectionDot section={section} /><span>{children}</span></>;
      },
    };
  }, [sections]);

  return (
    <div className="space-y-3 [&_a]:text-harbor [&_a]:underline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-harbor [&_blockquote]:border-l-4 [&_blockquote]:border-crate [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-sand-light [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-sand-light [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6">
      <Markdown skipHtml disallowedElements={["img"]} rehypePlugins={plugins} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
