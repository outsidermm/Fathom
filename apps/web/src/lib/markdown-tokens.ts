import type { Element, Root, Text } from "hast";
import { visit } from "unist-util-visit";

type Token = { index: number; text: string };
// A section start in the joined text (UTF-16 offset), marked on the first
// rendered text at or after it. Markers are applied in the given order.
export type SectionMarker = { offset: number; key: string };

// Annotate rendered Markdown with the original stream indices. Parsing the
// joined text handles formatting delimiters split across WebSocket messages.
export function rehypeStreamTokens(tokens: readonly Token[], markers: readonly SectionMarker[] = []) {
  let offset = 0;
  const cuts = [...markers].sort((a, b) => a.offset - b.offset); // stable: ties keep their order
  const ranges: { index: number; start: number; end: number }[] = [];
  for (const token of tokens) {
    const end = offset + token.text.length;
    // Split a token at any section start inside it, so markers land in place.
    let start = offset;
    for (const cut of cuts) {
      if (cut.offset <= start || cut.offset >= end) continue;
      ranges.push({ index: token.index, start, end: cut.offset });
      start = cut.offset;
    }
    ranges.push({ index: token.index, start, end });
    offset = end;
  }
  const source = tokens.map((token) => token.text).join("");

  return () => (tree: Root) => {
    let nextCut = 0;
    visit(tree, "text", (node: Text, index, parent) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || !parent || index === undefined) return;

      // Code positions include their backticks. Find the rendered text inside
      // its source range before intersecting it with token boundaries.
      const raw = source.slice(start, end);
      const relativeStart = raw.indexOf(node.value);
      const textStart = start + Math.max(0, relativeStart);
      const children: Element[] = [];
      let low = 0;
      let high = ranges.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (ranges[middle].end <= textStart) low = middle + 1;
        else high = middle;
      }
      for (let cursor = low; cursor < ranges.length; cursor++) {
        const token = ranges[cursor];
        if (token.start >= end) break;

        // Escapes and entities may decode to fewer characters. Keep their
        // rendered text intact and attribute it to the first intersecting token.
        const value = relativeStart < 0
          ? node.value
          : node.value.slice(Math.max(0, token.start - textStart), token.end - textStart);
        if (!value) continue;
        // Readings that land on the same text (a steered section: the parent's
        // reading and the branch's) share one marker, the latest.
        let section: string | undefined;
        while (nextCut < cuts.length && cuts[nextCut].offset < token.end) section = cuts[nextCut++].key;
        children.push({
          type: "element",
          tagName: "span",
          properties: {
            "data-token-index": token.index,
            ...(section ? { "data-section": section } : {}),
          },
          children: [{ type: "text", value }],
        });
        if (relativeStart < 0) break;
      }
      if (!children.length) return;
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}
