/**
 * Knowledge document parsers.
 *
 * Pure functions that turn an uploaded Markdown or CSV file into a list of
 * knowledge base entries. Kept dependency-free and side-effect-free so they are
 * easy to unit test (see parse.test.ts).
 */
import { resolveKnowledgeCategory } from "../../shared/knowledgeCategory";

export type ParsedKnowledgeEntry = {
  title: string;
  content: string;
  category: string;
  keywords?: string;
};

export type KnowledgeFileStream = AsyncIterable<Uint8Array | string>;

const TITLE_MAX_LENGTH = 255;
const STREAM_SECTION_MAX_CHARS = 4_000;
const STREAM_LINE_MAX_CHARS = 64_000;
const CSV_RECORD_MAX_CHARS = 2_000_000;

const clampTitle = (title: string) =>
  title.length > TITLE_MAX_LENGTH ? title.slice(0, TITLE_MAX_LENGTH) : title;

async function* decodeUtf8(source: KnowledgeFileStream) {
  // 创建可跨分片保留不完整字符的 UTF-8 解码器。
  const decoder = new TextDecoder("utf-8");
  // 记录当前是否仍在处理文件的第一个文本分片。
  let first = true;
  // 按文件流到达顺序逐个读取字节或文本分片。
  for await (const chunk of source) {
    // 字符串无需解码；字节分片交由解码器以流式模式转换。
    let text =
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    // 仅检查第一个文本分片是否带有 UTF-8 BOM 标记。
    if (first) {
      // 后续分片不再执行 BOM 检查。
      first = false;
      // 去掉文件开头的 BOM，避免它进入标题或正文。
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    // 忽略空分片，将有内容的文本交给后续解析器。
    if (text) yield text;
  }
  // 刷出解码器缓存中尚未产出的尾部字符。
  const tail = decoder.decode();
  // 仅在存在尾部文本时将其交给后续解析器。
  if (tail) yield tail;
}

async function* decodeLines(source: KnowledgeFileStream) {
  let pending = "";
  for await (const chunk of decodeUtf8(source)) {
    pending += chunk;
    let start = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const char = pending[index];
      if (char !== "\n" && char !== "\r") continue;
      if (char === "\r" && index === pending.length - 1) break;
      yield pending.slice(start, index);
      if (char === "\r" && pending[index + 1] === "\n") index += 1;
      start = index + 1;
    }
    pending = pending.slice(start);
    while (pending.length > STREAM_LINE_MAX_CHARS) {
      yield pending.slice(0, STREAM_LINE_MAX_CHARS);
      pending = pending.slice(STREAM_LINE_MAX_CHARS);
    }
  }
  if (pending.endsWith("\r")) pending = pending.slice(0, -1);
  if (pending) yield pending;
}

/**
 * Minimal RFC4180-style CSV tokenizer.
 * Handles quoted fields, escaped quotes ("") and commas/newlines inside quotes.
 * Returns an array of rows, each row an array of field strings.
 */
function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  // Normalize a leading BOM if present.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Handle CRLF and lone CR as a single row break.
      if (input[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // Flush the final field/row if the file does not end with a newline.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

/**
 * Parse a CSV with header row `title,content,category,keywords`.
 * Column order is resolved from the header (case-insensitive), so extra/reordered
 * columns are tolerated. Rows missing title or content are skipped.
 *
 * @param defaultCategory used when a row has no category value.
 */
export function parseCsv(
  text: string,
  defaultCategory = "未分类"
): ParsedKnowledgeEntry[] {
  const rows = tokenizeCsv(text).filter(
    row => row.length > 0 && row.some(cell => cell.trim().length > 0)
  );
  if (rows.length < 2) return [];

  const header = rows[0].map(cell => cell.trim().toLowerCase());
  const indexOf = (name: string) => header.indexOf(name);
  const titleIdx = indexOf("title");
  const contentIdx = indexOf("content");
  const categoryIdx = indexOf("category");
  const keywordsIdx = indexOf("keywords");

  if (titleIdx === -1 || contentIdx === -1) {
    throw new Error("CSV 缺少必需的表头列：title、content");
  }

  const entries: ParsedKnowledgeEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const title = (cells[titleIdx] ?? "").trim();
    const content = (cells[contentIdx] ?? "").trim();
    if (!title || !content) continue;

    const category =
      categoryIdx >= 0 && (cells[categoryIdx] ?? "").trim()
        ? cells[categoryIdx].trim()
        : resolveKnowledgeCategory(title, content, defaultCategory);
    const keywords =
      keywordsIdx >= 0 && (cells[keywordsIdx] ?? "").trim()
        ? cells[keywordsIdx].trim()
        : undefined;

    entries.push({ title: clampTitle(title), content, category, keywords });
  }

  return entries;
}

type CsvColumns = {
  title: number;
  content: number;
  category: number;
  keywords: number;
};

function resolveCsvColumns(headerRow: string[]): CsvColumns {
  const header = headerRow.map(cell => cell.trim().toLowerCase());
  const columns = {
    title: header.indexOf("title"),
    content: header.indexOf("content"),
    category: header.indexOf("category"),
    keywords: header.indexOf("keywords"),
  };
  if (columns.title === -1 || columns.content === -1) {
    throw new Error("CSV 缺少必需的表头列：title、content");
  }
  return columns;
}

function csvRowToEntry(
  cells: string[],
  columns: CsvColumns,
  defaultCategory: string
): ParsedKnowledgeEntry | null {
  const title = (cells[columns.title] ?? "").trim();
  const content = (cells[columns.content] ?? "").trim();
  if (!title || !content) return null;
  const categoryValue =
    columns.category >= 0 ? (cells[columns.category] ?? "").trim() : "";
  const keywordsValue =
    columns.keywords >= 0 ? (cells[columns.keywords] ?? "").trim() : "";
  return {
    title: clampTitle(title),
    content,
    category:
      categoryValue ||
      resolveKnowledgeCategory(title, content, defaultCategory),
    keywords: keywordsValue || undefined,
  };
}

/** Parse CSV incrementally, retaining at most one logical CSV row in memory. */
export async function* parseCsvStream(
  source: KnowledgeFileStream,
  defaultCategory = "未分类"
): AsyncGenerator<ParsedKnowledgeEntry> {
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let pendingQuote = false;
  let skipLf = false;
  let columns: CsvColumns | null = null;
  let recordChars = 0;

  const consumeRow = (cells: string[]) => {
    if (!cells.some(cell => cell.trim())) return null;
    if (!columns) {
      columns = resolveCsvColumns(cells);
      return null;
    }
    return csvRowToEntry(cells, columns, defaultCategory);
  };

  for await (const text of decodeUtf8(source)) {
    for (const char of text) {
      if (skipLf) {
        skipLf = false;
        if (char === "\n") continue;
      }
      recordChars += 1;
      if (recordChars > CSV_RECORD_MAX_CHARS) {
        throw new Error(`CSV 单行记录超过 ${CSV_RECORD_MAX_CHARS} 个字符`);
      }

      let reprocess = true;
      while (reprocess) {
        reprocess = false;
        if (inQuotes) {
          if (pendingQuote) {
            if (char === '"') {
              field += '"';
              pendingQuote = false;
              continue;
            }
            inQuotes = false;
            pendingQuote = false;
            reprocess = true;
            continue;
          }
          if (char === '"') pendingQuote = true;
          else field += char;
          continue;
        }

        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          row.push(field);
          field = "";
        } else if (char === "\r" || char === "\n") {
          row.push(field);
          field = "";
          const entry = consumeRow(row);
          row = [];
          recordChars = 0;
          if (entry) yield entry;
          if (char === "\r") skipLf = true;
        } else {
          field += char;
        }
      }
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    const entry = consumeRow(row);
    if (entry) yield entry;
  }
}

const HEADING_RE = /^(#{1,2})\s+(.*\S)\s*$/;

/**
 * Parse Markdown into entries by splitting on level 1-2 headings (# / ##).
 * Content before the first heading becomes a "概述" (overview) entry.
 * Headings inside fenced code blocks (```) are ignored. Sections with no body
 * text are dropped.
 *
 * @param opts.category category assigned to every entry (default 概述/filename).
 */
export function parseMarkdown(
  text: string,
  opts: { category: string; overrideInlineCategory?: boolean }
): ParsedKnowledgeEntry[] {
  const lines = text.split(/\r\n|\r|\n/);
  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } = { title: "概述", body: [] };
  let inFence = false;

  for (const line of lines) {
    const fenceMatch = /^\s*(```|~~~)/.test(line);
    if (fenceMatch) {
      inFence = !inFence;
      current.body.push(line);
      continue;
    }

    const headingMatch = inFence ? null : line.match(HEADING_RE);
    if (headingMatch) {
      sections.push(current);
      current = { title: headingMatch[2].trim(), body: [] };
      continue;
    }
    current.body.push(line);
  }
  sections.push(current);

  const entries: ParsedKnowledgeEntry[] = [];
  for (const section of sections) {
    const content = section.body.join("\n").trim();
    if (!content) continue;
    entries.push({
      title: clampTitle(section.title),
      content,
      category: opts.overrideInlineCategory
        ? opts.category
        : resolveKnowledgeCategory(section.title, content, opts.category),
    });
  }

  return entries;
}

/** Parse Markdown by headings without loading the entire source document. */
export async function* parseMarkdownStream(
  source: KnowledgeFileStream,
  opts: { category: string; overrideInlineCategory?: boolean }
): AsyncGenerator<ParsedKnowledgeEntry> {
  let title = "概述";
  let body: string[] = [];
  let bodyChars = 0;
  let continuation = 0;
  let inFence = false;

  const consumeSection = () => {
    const content = body.join("\n").trim();
    body = [];
    bodyChars = 0;
    if (!content) return null;
    continuation += 1;
    const entryTitle =
      continuation === 1 ? title : `${title}（续 ${continuation}）`;
    return {
      title: clampTitle(entryTitle),
      content,
      category: opts.overrideInlineCategory
        ? opts.category
        : resolveKnowledgeCategory(title, content, opts.category),
    } satisfies ParsedKnowledgeEntry;
  };

  for await (const line of decodeLines(source)) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) {
      inFence = !inFence;
    }
    const heading = fence || inFence ? null : line.match(HEADING_RE);
    if (heading) {
      const entry = consumeSection();
      if (entry) yield entry;
      title = heading[2].trim();
      continuation = 0;
      continue;
    }
    const pieces =
      line.length > STREAM_SECTION_MAX_CHARS
        ? Array.from(
            { length: Math.ceil(line.length / STREAM_SECTION_MAX_CHARS) },
            (_, index) =>
              line.slice(
                index * STREAM_SECTION_MAX_CHARS,
                (index + 1) * STREAM_SECTION_MAX_CHARS
              )
          )
        : [line];
    for (const piece of pieces) {
      if (
        body.length > 0 &&
        bodyChars + piece.length + 1 > STREAM_SECTION_MAX_CHARS
      ) {
        const entry = consumeSection();
        if (entry) yield entry;
      }
      body.push(piece);
      bodyChars += piece.length + (body.length > 1 ? 1 : 0);
    }
  }
  const entry = consumeSection();
  if (entry) yield entry;
}
