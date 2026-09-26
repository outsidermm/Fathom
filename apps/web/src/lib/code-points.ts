// The API counts text positions in Unicode code points (Python string
// offsets); JS strings index UTF-16 units. Convert before comparing or slicing.

export function codePointLength(text: string) {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) index++;
    length++;
  }
  return length;
}

/** The UTF-16 offset of code point `points` in `text`, clamped to its length. */
export function codePointToUtf16(text: string, points: number) {
  let index = 0;
  for (let count = 0; count < points && index < text.length; count++) {
    const code = text.charCodeAt(index);
    index += code >= 0xd800 && code <= 0xdbff && index + 1 < text.length ? 2 : 1;
  }
  return index;
}
