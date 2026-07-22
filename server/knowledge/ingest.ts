/**
 * Knowledge document ingestion.
 *
 * Orchestrates: create document record → parse file into entries → insert
 * entries → build embeddings in the background while updating progress.
 *
 * The embedding loop runs detached (not awaited) so the upload request returns
 * immediately; the frontend polls listDocuments to follow progress.
 */
import {
  buildKnowledgeEmbeddingInput,
  createEmbedding,
  isEmbeddingEnabled,
} from "../_core/embeddings";
import type { KnowledgeDocumentStatus } from "../../shared/knowledge";
import * as db from "../db";
import { parseCsv, parseMarkdown, type ParsedKnowledgeEntry } from "./parse";

export type KnowledgeFileType = "markdown" | "csv";

function parseFile(
  fileType: KnowledgeFileType,
  content: string,
  category: string,
  overrideInlineCategory = false
): ParsedKnowledgeEntry[] {
  if (fileType === "csv") {
    return parseCsv(content, category);
  }
  return parseMarkdown(content, { category, overrideInlineCategory });
}

/**
 * Build embeddings for the given entries one at a time, marking each entry
 * completed/failed and finalizing the document status. Designed to be invoked
 * without awaiting.
 */
async function runEmbeddingJob(
  documentId: number,
  entries: Array<{ id: number; title: string; content: string; category: string; keywords?: string | null }>
) {
  let failed = 0;

  for (const entry of entries) {
    try {
      const input = buildKnowledgeEmbeddingInput(entry);
      const embedding = await createEmbedding(input, "document");
      await db.setKnowledgeEntryEmbedding(entry.id, embedding);

      // 嵌入完成后立即检测与已有条目的冲突（向量 + 标题）。
      try {
        const conflict = await db.detectEntryConflict({
          id: entry.id,
          title: entry.title,
          documentId,
          embedding,
        });
        if (conflict) {
          await db.setEntryConflict(
            entry.id,
            conflict.conflictWith,
            conflict.conflictScore
          );
        }
      } catch (conflictError) {
        console.warn(
          `[KnowledgeIngest] Conflict detection failed for entry #${entry.id}:`,
          conflictError
        );
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[KnowledgeIngest] Failed to embed entry #${entry.id} (doc #${documentId}):`,
        error
      );
      try {
        await db.setKnowledgeEntryStatus(entry.id, "failed");
      } catch {
        // ignore secondary failure
      }
    }
  }

  const allFailed = failed === entries.length && entries.length > 0;
  await db.updateKnowledgeDocument(documentId, {
    status: allFailed ? "failed" : "completed",
    error: allFailed ? "所有条目向量化失败" : null,
  });
}

/**
 * Ingest an uploaded document. Returns once entries are parsed and inserted;
 * embedding continues in the background.
 */
export async function ingestDocument(params: {
  filename: string;
  fileType: KnowledgeFileType;
  content: string;
  category?: string;
  userId?: number;
}): Promise<{
  documentId: number;
  totalChunks: number;
  status: KnowledgeDocumentStatus;
  embeddingEnabled: boolean;
}> {
  const { filename, fileType, content, userId } = params;
  const requestedCategory = params.category?.trim();
  // A filename identifies the source document, but is not a useful knowledge category.
  const category = requestedCategory || "未分类";

  const doc = await db.createKnowledgeDocument({
    filename,
    fileType,
    uploadedBy: userId,
    status: "parsing",
  });

  let entries: ParsedKnowledgeEntry[];
  try {
    entries = parseFile(fileType, content, category, Boolean(requestedCategory));
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析失败";
    await db.updateKnowledgeDocument(doc.id, { status: "failed", error: message });
    return {
      documentId: doc.id,
      totalChunks: 0,
      status: "failed",
      embeddingEnabled: isEmbeddingEnabled(),
    };
  }

  if (entries.length === 0) {
    await db.updateKnowledgeDocument(doc.id, {
      status: "failed",
      error: "未从文件中解析出任何条目（请检查格式：CSV 需含 title/content 表头，Markdown 需含标题与正文）",
    });
    return {
      documentId: doc.id,
      totalChunks: 0,
      status: "failed",
      embeddingEnabled: isEmbeddingEnabled(),
    };
  }

  const inserted = await db.addKnowledgeEntriesBatch(doc.id, entries);

  const embeddingEnabled = isEmbeddingEnabled();
  if (!embeddingEnabled) {
    // 无向量时退化为「标题匹配」冲突检测。
    for (const entry of inserted) {
      try {
        const conflict = await db.detectEntryConflict({
          id: entry.id,
          title: entry.title,
          documentId: doc.id,
          embedding: null,
        });
        if (conflict) {
          await db.setEntryConflict(
            entry.id,
            conflict.conflictWith,
            conflict.conflictScore
          );
        }
      } catch (conflictError) {
        console.warn(
          `[KnowledgeIngest] Conflict detection failed for entry #${entry.id}:`,
          conflictError
        );
      }
    }

    // Keyword fallback search still works without vectors; mark as completed.
    await db.updateKnowledgeDocument(doc.id, {
      status: "completed",
      totalChunks: inserted.length,
      error: null,
    });
    return {
      documentId: doc.id,
      totalChunks: inserted.length,
      status: "completed",
      embeddingEnabled: false,
    };
  }

  await db.updateKnowledgeDocument(doc.id, {
    status: "indexing",
    totalChunks: inserted.length,
    error: null,
  });

  // Fire-and-forget: build embeddings in the background.
  void runEmbeddingJob(doc.id, inserted);

  return {
    documentId: doc.id,
    totalChunks: inserted.length,
    status: "indexing",
    embeddingEnabled: true,
  };
}
