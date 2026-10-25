const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const BLANK = /[\s\u200b]+/gu;

export function countChars(text: string): number {
  const compact = text.replace(BLANK, "");
  if (!compact) return 0;
  if (!graphemeSegmenter) return Array.from(compact).length;
  return Array.from(graphemeSegmenter.segment(compact)).length;
}

export function createCharCounter(): (text: string) => number {
  let previous = "";
  let count = 0;
  return (text) => {
    if (!text.startsWith(previous)) {
      previous = text;
      count = countChars(text);
      return count;
    }
    count += countChars(text.slice(previous.length));
    previous = text;
    return count;
  };
}
