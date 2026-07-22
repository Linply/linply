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

const TITLE_MAX_LENGTH = 255;

const clampTitle = (title: string) =>
  title.length > TITLE_MAX_LENGTH ? title.slice(0, TITLE_MAX_LENGTH) : title;

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
    throw new Error('CSV 缺少必需的表头列：title、content');
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
