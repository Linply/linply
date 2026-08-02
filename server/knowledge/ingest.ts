import {
  buildKnowledgeEmbeddingInput,
  createEmbedding,
  isEmbeddingEnabled,
} from "../_core/embeddings";
import type { KnowledgeDocumentStatus } from "../../shared/knowledge";
import * as db from "../db";
import {
  parseCsv,
  parseCsvStream,
  parseMarkdown,
  parseMarkdownStream,
  type ParsedKnowledgeEntry,
} from "./parse";
import { enqueueKnowledgeEmbed } from "./queue";
import { getStoredDocumentStream } from "./storage";
import { scanKnowledgeContent } from "./security";

export type KnowledgeFileType = "markdown" | "csv";
const INSERT_BATCH_SIZE = 100;

function parseFile(
  fileType: KnowledgeFileType,
  content: string,
  category: string,
  overrideInlineCategory = false
): ParsedKnowledgeEntry[] {
  return fileType === "csv"
    ? parseCsv(content, category)
    : parseMarkdown(content, { category, overrideInlineCategory });
}

async function detectKeywordConflicts(
  documentId: number,
  entries: Array<{ id: number; title: string }>
) {
  for (const entry of entries) {
    try {
      const conflict = await db.detectEntryConflict({
        id: entry.id,
        title: entry.title,
        documentId,
        embedding: null,
      });
      if (conflict) {
        await db.setEntryConflict(
          entry.id,
          conflict.conflictWith,
          conflict.conflictScore
        );
      }
    } catch (error) {
      console.warn(
        `[KnowledgeIngest] Conflict detection failed for entry #${entry.id}:`,
        error
      );
    }
  }
}

async function maybeFinalizeIndexing(documentId: number) {
  const document = await db.getKnowledgeDocument(documentId);
  if (
    !document ||
    (document.status !== "indexing" &&
      !(document.status === "failed" && document.failureStage === "embedding"))
  )
    return;
  const counts = await db.getKnowledgeDocumentEmbeddingCounts(documentId);
  if (counts.total === 0 || counts.completed + counts.failed < counts.total)
    return;
  const allFailed = counts.failed === counts.total;
  await db.updateKnowledgeDocument(documentId, {
    status: allFailed ? "failed" : "completed",
    failureStage: allFailed ? "embedding" : null,
    error: allFailed ? "所有条目向量化失败" : null,
    completedAt: new Date(),
  });
}

export async function processKnowledgeEmbeddingBatch(
  documentId: number,
  entryIds: number[]
) {
  const entries = await db.getKnowledgeEntriesByIds(entryIds);
  let attempted = 0;
  let failed = 0;

  for (const entry of entries) {
    if (entry.securityStatus !== "approved") {
      await db
        .setKnowledgeEntryStatus(entry.id, "blocked")
        .catch(() => undefined);
      continue;
    }
    if (entry.embeddingStatus === "completed") continue;
    attempted += 1;
    try {
      const embedding = await createEmbedding(
        buildKnowledgeEmbeddingInput(entry),
        "document"
      );
      await db.setKnowledgeEntryEmbedding(entry.id, embedding);
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
      } catch (error) {
        console.warn(
          `[KnowledgeIngest] Conflict detection failed for entry #${entry.id}:`,
          error
        );
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[KnowledgeIngest] Failed to embed entry #${entry.id}:`,
        error
      );
      await db
        .setKnowledgeEntryStatus(entry.id, "failed")
        .catch(() => undefined);
    }
  }

  await maybeFinalizeIndexing(documentId);
  if (attempted > 0 && failed === attempted) {
    throw new Error(`文档 #${documentId} 的向量化批次全部失败`);
  }
}

export async function processStoredKnowledgeDocument(
  documentId: number,
  uploadVersion: number
) {
  const document = await db.getKnowledgeDocument(documentId);
  if (!document) throw new Error(`知识库文档 #${documentId} 不存在`);
  if (document.uploadVersion !== uploadVersion) return;
  if (!document.objectKey) throw new Error("知识库文档缺少对象存储 key");

  await db.deleteKnowledgeEntriesByDocument(documentId);
  await db.updateKnowledgeDocument(documentId, {
    status: "parsing",
    parsedChunks: 0,
    totalChunks: 0,
    failureStage: null,
    error: null,
    completedAt: null,
  });

  const category = document.category?.trim() || "未分类";
  const stream = await getStoredDocumentStream(document.objectKey);
  const entries =
    document.fileType === "csv"
      ? parseCsvStream(stream, category)
      : parseMarkdownStream(stream, {
          category,
          overrideInlineCategory: Boolean(document.category?.trim()),
        });
  const embeddingEnabled = isEmbeddingEnabled();
  let batch: ParsedKnowledgeEntry[] = [];
  let parsedChunks = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const scannedBatch = batch.map(entry => {
      const scan = scanKnowledgeContent(entry);
      return {
        ...entry,
        securityStatus: scan.status,
        securityScannerVersion: scan.scannerVersion,
        securityContentHash: scan.contentHash,
        securityFindings: scan.findings,
        securityScore: scan.securityScore,
        securityScannedAt: new Date(),
      };
    });
    const inserted = await db.addKnowledgeEntriesBatch(
      documentId,
      scannedBatch,
      embeddingEnabled ? "pending" : "completed"
    );
    parsedChunks += inserted.length;
    batch = [];
    const securityCounts = await db.refreshKnowledgeDocumentSecurityCounts(
      documentId
    );
    await db.updateKnowledgeDocument(documentId, {
      parsedChunks,
      totalChunks: parsedChunks,
      approvedChunks: securityCounts.approved,
      quarantinedChunks: securityCounts.quarantined,
      rejectedChunks: securityCounts.rejected,
      pendingSecurityChunks: securityCounts.pending,
    });
    const approved = inserted.filter(
      entry => entry.securityStatus === "approved"
    );
    if (embeddingEnabled && approved.length > 0) {
      await enqueueKnowledgeEmbed({
        documentId,
        entryIds: approved.map(entry => entry.id),
      });
    } else if (!embeddingEnabled) {
      await detectKeywordConflicts(documentId, approved);
    }
  };

  try {
    for await (const entry of entries) {
      batch.push(entry);
      if (batch.length >= INSERT_BATCH_SIZE) await flush();
    }
    await flush();
    if (parsedChunks === 0) {
      throw new Error(
        "未从文件中解析出任何条目（CSV 需含 title/content 表头，Markdown 需含标题与正文）"
      );
    }
    const finalSecurityCounts =
      await db.refreshKnowledgeDocumentSecurityCounts(documentId);
    if (embeddingEnabled && finalSecurityCounts.approved > 0) {
      await db.updateKnowledgeDocument(documentId, {
        status: "indexing",
        totalChunks: parsedChunks,
        failureStage: null,
        error: null,
      });
      await maybeFinalizeIndexing(documentId);
    } else {
      await db.updateKnowledgeDocument(documentId, {
        status: "completed",
        totalChunks: parsedChunks,
        failureStage: null,
        error: null,
        completedAt: new Date(),
      });
    }
  } catch (error) {
    await db.deleteKnowledgeEntriesByDocument(documentId);
    await db.updateKnowledgeDocument(documentId, {
      status: "failed",
      parsedChunks: 0,
      totalChunks: 0,
      failureStage: "parsing",
      error: error instanceof Error ? error.message : "解析失败",
    });
    throw error;
  }
}

/** Legacy JSON upload path retained for local environments without object storage. */
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
  const requestedCategory = params.category?.trim();
  const category = requestedCategory || "未分类";
  const doc = await db.createKnowledgeDocument({
    filename: params.filename,
    fileType: params.fileType,
    uploadedBy: params.userId,
    status: "parsing",
    category: requestedCategory,
  });

  let entries: ParsedKnowledgeEntry[];
  try {
    entries = parseFile(
      params.fileType,
      params.content,
      category,
      Boolean(requestedCategory)
    );
  } catch (error) {
    await db.updateKnowledgeDocument(doc.id, {
      status: "failed",
      failureStage: "parsing",
      error: error instanceof Error ? error.message : "解析失败",
    });
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
      failureStage: "parsing",
      error: "未从文件中解析出任何条目（请检查文件格式）",
    });
    return {
      documentId: doc.id,
      totalChunks: 0,
      status: "failed",
      embeddingEnabled: isEmbeddingEnabled(),
    };
  }

  const embeddingEnabled = isEmbeddingEnabled();
  const scannedEntries = entries.map(entry => {
    const scan = scanKnowledgeContent(entry);
    return {
      ...entry,
      securityStatus: scan.status,
      securityScannerVersion: scan.scannerVersion,
      securityContentHash: scan.contentHash,
      securityFindings: scan.findings,
        securityScore: scan.securityScore,
      securityScannedAt: new Date(),
    };
  });
  const inserted = await db.addKnowledgeEntriesBatch(
    doc.id,
    scannedEntries,
    embeddingEnabled ? "pending" : "completed"
  );
  const approved = inserted.filter(entry => entry.securityStatus === "approved");
  const securityCounts = await db.refreshKnowledgeDocumentSecurityCounts(doc.id);
  await db.updateKnowledgeDocument(doc.id, {
    status: embeddingEnabled && approved.length > 0 ? "indexing" : "completed",
    parsedChunks: inserted.length,
    totalChunks: inserted.length,
    approvedChunks: securityCounts.approved,
    quarantinedChunks: securityCounts.quarantined,
    rejectedChunks: securityCounts.rejected,
    pendingSecurityChunks: securityCounts.pending,
    error: null,
    completedAt: embeddingEnabled && approved.length > 0 ? null : new Date(),
  });
  if (embeddingEnabled && approved.length > 0) {
    void processKnowledgeEmbeddingBatch(
      doc.id,
      approved.map(entry => entry.id)
    ).catch(error => {
      console.error(
        `[KnowledgeIngest] Legacy embedding job failed for #${doc.id}:`,
        error
      );
    });
  } else {
    await detectKeywordConflicts(doc.id, approved);
  }
  return {
    documentId: doc.id,
    totalChunks: inserted.length,
    status: embeddingEnabled && approved.length > 0 ? "indexing" : "completed",
    embeddingEnabled,
  };
}
