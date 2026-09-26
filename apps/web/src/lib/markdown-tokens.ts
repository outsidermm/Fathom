import type { Element, Root, Text } from "hast";
import { visit } from "unist-util-visit";

type Token = { index: number; text: string };

// Annotate rendered Markdown with the original stream indices. Parsing the
// joined text handles formatting delimiters split across WebSocket messages.
export function rehypeStreamTokens(tokens: readonly Token[]) {
  let offset = 0;
  const ranges = tokens.map((token) => {
    const start = offset;
    offset += token.text.length;
    return { index: token.index, start, end: offset };
  });
  const source = tokens.map((token) => token.text).join("");

  return () => (tree: Root) => {
    const annotated = new Set<number>();
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
        const showFlag = !annotated.has(token.index) && !(parent.type === "element" && parent.tagName === "a");
        annotated.add(token.index);
        children.push({
          type: "element",
          tagName: "span",
          properties: { "data-token-index": token.index, "data-token-flag": showFlag },
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
