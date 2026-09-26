import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { rehypeStreamTokens } from '../src/lib/markdown-tokens.ts';

function render(chunks) {
  const tokens = chunks.map((text, index) => ({ index, text }));
  return renderToStaticMarkup(createElement(Markdown, {
    skipHtml: true,
    rehypePlugins: [rehypeStreamTokens(tokens)],
  }, chunks.join('')));
}
const visible = (html) => html.replace(/<[^>]+>/g, '');

test('bold delimiters split across stream messages preserve token indices', () => {
  const html = render(['The ', '*', '*oce', 'an*', '* is blue.']);
  assert.equal(visible(html), 'The ocean is blue.');
  assert.match(html, /<strong><span data-token-index="2"[^>]*>oce<\/span><span data-token-index="3"[^>]*>an<\/span><\/strong>/);
  assert.match(html, /data-token-index="4"[^>]*> is blue\./);
});

test('an incomplete stream settles into formatting once the closing delimiter arrives', () => {
  assert.equal(visible(render(['**blue'])), '**blue');
  assert.match(render(['**blue', '**']), /<strong>/);
  assert.equal(visible(render(['**blue', '**'])), 'blue');
});

test('nested emphasis, lists and inline code render without leaking delimiters', () => {
  const html = render(['- **bold and ', '*italic*', '**\n- `a', '**b`']);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>/);
  assert.match(html, /<em>/);
  assert.match(html, /<code>/);
  assert.equal(visible(html).trim(), 'bold and italic\na**b');
});

test('escaped asterisks and decoded entities keep their visible content', () => {
  const html = render(['\\*literal\\* &', 'amp; ocean']);
  assert.equal(visible(html), '*literal* &amp; ocean');
  assert.doesNotMatch(html, /<em>|<strong>/);
});

test('a token spanning multiple formatting nodes gets one flag marker', () => {
  const html = render(['one **bold** end']);
  assert.equal((html.match(/data-token-flag="true"/g) ?? []).length, 1);
  assert.equal(visible(html), 'one bold end');
});

test('model HTML is not rendered and unsafe Markdown URLs are filtered', () => {
  const html = render(['<script>alert(1)</script>\n\n[click](javascript:alert(1))']);
  assert.doesNotMatch(html, /<script|href="javascript:/);
});
