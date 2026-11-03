import { estimateTokens } from './tokens.js';

export interface ChunkDraft {
  index: number;
  title: string;
  content: string;
  tokens: number;
}

interface Section {
  title: string;
  body: string;
}

const MAX_CHARS = 900;
const OVERLAP_CHARS = 140;
const MIN_CHARS = 180;

function splitSections(content: string, docTitle: string): Section[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  const headingPath: string[] = [];
  let currentTitle = docTitle;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ title: currentTitle, body });
    buffer = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingPath[level - 1] = heading[2].trim();
      headingPath.length = level;
      currentTitle = [docTitle, ...headingPath.filter(Boolean)].join(' › ');
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections.length ? sections : [{ title: docTitle, body: content.trim() }];
}

function windows(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + MAX_CHARS);
    result.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return result.filter(Boolean);
}

function chunkSection(section: Section): Array<{ content: string; title: string }> {
  const paragraphs = section.body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  const pushBuffer = () => {
    const value = buffer.trim();
    if (value) chunks.push(value);
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    const pieces =
      paragraph.length > MAX_CHARS ? windows(paragraph) : [paragraph];
    for (const piece of pieces) {
      if (!buffer) {
        buffer = piece;
        continue;
      }
      if (buffer.length + piece.length + 2 <= MAX_CHARS) {
        buffer += `\n\n${piece}`;
        continue;
      }

      const overlap = buffer.slice(-OVERLAP_CHARS);
      pushBuffer();
      buffer = `${overlap}\n${piece}`.trim();
      if (buffer.length > MAX_CHARS) {
        const split = windows(buffer);
        chunks.push(...split.slice(0, -1));
        buffer = split.at(-1) || '';
      }
    }
  }
  pushBuffer();

  // Merge trailing fragments into the previous chunk when they are too small.
  if (chunks.length > 1 && chunks.at(-1)!.length < MIN_CHARS) {
    const tail = chunks.pop()!;
    chunks[chunks.length - 1] = `${chunks.at(-1)}\n${tail}`.slice(0, MAX_CHARS + 80);
  }

  return chunks.map((content) => ({ title: section.title, content }));
}

export function chunkDocument(
  docTitle: string,
  content: string,
): ChunkDraft[] {
  const sections = splitSections(content, docTitle);
  const chunks: ChunkDraft[] = [];
  for (const section of sections) {
    for (const chunk of chunkSection(section)) {
      chunks.push({
        index: chunks.length,
        title: chunk.title || docTitle,
        content: chunk.content,
        tokens: estimateTokens(chunk.content),
      });
      if (chunks.length >= 400) {
        throw new Error('文档切片超过 400 个，请拆分后再上传');
      }
    }
  }
  return chunks;
}
