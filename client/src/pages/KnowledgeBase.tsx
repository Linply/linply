import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import PageNav from "@/components/PageNav";
import KnowledgeDocuments from "@/components/KnowledgeDocuments";
import { useLocation, useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { toast } from "sonner";
import {
  extractKnowledgeCategory,
  inferKnowledgeCategory,
} from "@shared/knowledgeCategory";
import {
  AlertTriangle,
  BookOpen,
  Bug,
  CheckCircle2,
  Edit3,
  Plus,
  RefreshCcw,
  Search,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import type { KnowledgeSecurityStatus } from "@shared/knowledge";

type KnowledgeEntry = inferRouterOutputs<AppRouter>["knowledge"]["list"][number];
type SecurityFinding = KnowledgeEntry["securityFindings"][number];

const SECURITY_STATUS_META: Record<
  KnowledgeSecurityStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "待扫描",
    className: "border-gray-200 bg-gray-50 text-gray-600",
  },
  approved: {
    label: "已批准",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  quarantined: {
    label: "已隔离",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  rejected: {
    label: "已拒绝",
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function getHighlightTerms(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const terms = new Set<string>();
  if (trimmed.length >= 2) terms.add(trimmed);
  for (const part of trimmed.split(/[\s,，。！？!?、;；:：/\\|]+/)) {
    if (part.length >= 2) terms.add(part);
  }
  return Array.from(terms).sort((a, b) => b.length - a.length);
}

function highlightText(text: string, query: string): ReactNode {
  const terms = getHighlightTerms(query);
  if (terms.length === 0) return text;

  const pattern = new RegExp(
    `(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );
  return text.split(pattern).map((part, index) =>
    terms.some(
      term => part.toLocaleLowerCase() === term.toLocaleLowerCase()
    ) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-amber-200 px-0.5 text-inherit"
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  return <>{highlightText(text, query)}</>;
}

export default function KnowledgeBase() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const locationSearch = useSearch();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] =
    useState<KnowledgeSecurityStatus | null>(null);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  const [reviewEntry, setReviewEntry] = useState<KnowledgeEntry | null>(null);
  const [reviewDecision, setReviewDecision] = useState<
    "approve" | "reject"
  >("approve");
  const [reviewReason, setReviewReason] = useState("");
  const [entryForm, setEntryForm] = useState({
    title: "",
    content: "",
    category: "",
    keywords: "",
  });
  const rawQuery = search.trim();
  const debouncedSearch = useDebouncedValue(search, 300);
  const query = rawQuery.length === 0 ? "" : debouncedSearch.trim();
  const isDebouncing = rawQuery.length > 0 && rawQuery !== query;
  const targetEntryId = useMemo(() => {
    const value = new URLSearchParams(locationSearch).get("entry");
    return value && /^\d+$/.test(value) ? Number(value) : null;
  }, [locationSearch]);

  const utils = trpc.useUtils();
  const { data: entries, isLoading: listLoading } =
    trpc.knowledge.list.useQuery(
      securityStatus ? { securityStatus } : undefined
    );
  const { data: documents } = trpc.knowledge.listDocuments.useQuery();
  const { data: searchResults, isLoading: searchLoading } =
    trpc.knowledge.search.useQuery(
      { query, limit: 50 },
      { enabled: query.length > 0 }
    );

  const deleteEntryMutation = trpc.knowledge.deleteEntry.useMutation();
  const addEntryMutation = trpc.knowledge.add.useMutation();
  const updateEntryMutation = trpc.knowledge.updateEntry.useMutation();
  const reindexEntryMutation = trpc.knowledge.reindexEntry.useMutation();
  const reviewMutation = trpc.knowledge.review.useMutation();
  const rescanMutation = trpc.knowledge.rescan.useMutation();

  const refreshKnowledge = async () => {
    await Promise.all([
      utils.knowledge.list.invalidate(),
      utils.knowledge.search.invalidate(),
      utils.knowledge.listDocuments.invalidate(),
    ]);
  };

  const openCreateDialog = () => {
    setEditingEntry(null);
    setEntryForm({
      title: "",
      content: "",
      category: "",
      keywords: "",
    });
    setEntryDialogOpen(true);
  };

  const openEditDialog = (entry: KnowledgeEntry) => {
    setEditingEntry(entry);
    setEntryForm({
      title: entry.title,
      content: entry.content,
      category: getDisplayCategory(entry),
      keywords: entry.keywords ?? "",
    });
    setEntryDialogOpen(true);
  };

  const documentCategoryNames = useMemo(() => {
    return new Set(
      (documents ?? []).map(document =>
        document.filename.replace(/\.[^./\\]+$/, "")
      )
    );
  }, [documents]);

  const getDisplayCategory = (entry: {
    title: string;
    content: string;
    category: string;
    documentId?: number | null;
  }) => {
    // Older imports used the source filename as category. Reclassify only when
    // it matches a known source document, so manually chosen categories stay intact.
    if (entry.documentId != null && documentCategoryNames.has(entry.category)) {
      return (
        extractKnowledgeCategory(entry.content) ??
        inferKnowledgeCategory(entry.title, entry.content)
      );
    }
    return entry.category;
  };

  const handleSaveEntry = async () => {
    if (
      !entryForm.title.trim() ||
      !entryForm.content.trim() ||
      !entryForm.category.trim()
    ) {
      toast.error("请填写标题、内容和分类");
      return;
    }

    try {
      if (editingEntry) {
        await updateEntryMutation.mutateAsync({
          id: editingEntry.id,
          ...entryForm,
        });
        toast.success("知识条目已更新");
      } else {
        await addEntryMutation.mutateAsync(entryForm);
        toast.success("知识条目已新增");
      }
      setEntryDialogOpen(false);
      await refreshKnowledge();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const handleReindexEntry = async (id: number) => {
    try {
      await reindexEntryMutation.mutateAsync({ id });
      await refreshKnowledge();
      toast.success("已重新生成 embedding");
    } catch (error) {
      await refreshKnowledge();
      toast.error(error instanceof Error ? error.message : "重新生成失败");
    }
  };

  const handleReview = async () => {
    if (!reviewEntry?.securityContentHash) {
      toast.error("缺少内容哈希，请先重新扫描");
      return;
    }
    if (reviewReason.trim().length < 3) {
      toast.error("审核理由至少需要 3 个字符");
      return;
    }

    try {
      await reviewMutation.mutateAsync({
        id: reviewEntry.id,
        decision: reviewDecision,
        reason: reviewReason.trim(),
        expectedContentHash: reviewEntry.securityContentHash,
      });
      setReviewEntry(null);
      setReviewReason("");
      await refreshKnowledge();
      toast.success(reviewDecision === "approve" ? "条目已批准" : "条目已拒绝");
    } catch (error) {
      await refreshKnowledge();
      const message = error instanceof Error ? error.message : "审核失败";
      toast.error(
        /变化|CONFLICT|冲突/i.test(message)
          ? "条目内容已变化，列表已刷新，请检查最新内容后重新审核"
          : message
      );
    }
  };

  const handleRescan = async (id: number) => {
    try {
      const result = await rescanMutation.mutateAsync({ id });
      await refreshKnowledge();
      toast.success(
        result.status === "approved"
          ? "重新扫描完成，条目已批准"
          : `重新扫描完成，发现 ${result.findings.length} 项风险`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新扫描失败");
    }
  };

  const openReview = (
    entry: KnowledgeEntry,
    decision: "approve" | "reject"
  ) => {
    setReviewEntry(entry);
    setReviewDecision(decision);
    setReviewReason("");
  };

  const handleDeleteEntry = async (id: number) => {
    try {
      await deleteEntryMutation.mutateAsync({ id });
      await refreshKnowledge();
      toast.success("已删除该条目");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const rawVisibleEntries = query.length > 0 && !securityStatus ? searchResults : entries;
  // 冲突条目置顶，其余按更新时间从近到远排序。
  const visibleEntries = useMemo(() => {
    if (!rawVisibleEntries) return rawVisibleEntries;
    return rawVisibleEntries
      .filter(
        entry =>
          selectedCategory === null ||
          getDisplayCategory(entry) === selectedCategory
      )
      .sort((a, b) => {
        const aConflict = a.conflictWith != null ? 1 : 0;
        const bConflict = b.conflictWith != null ? 1 : 0;
        if (aConflict !== bConflict) return bConflict - aConflict;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
  }, [rawVisibleEntries, selectedCategory, documentCategoryNames]);
  const isLoading =
    isDebouncing || (query.length > 0 ? searchLoading : listLoading);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries ?? []) {
      const category = getDisplayCategory(entry);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [entries, documentCategoryNames]);

  const entryTitleById = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of entries ?? []) map.set(entry.id, entry.title);
    return map;
  }, [entries]);

  useEffect(() => {
    if (!targetEntryId || !entries?.some(entry => entry.id === targetEntryId)) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const entry = document.getElementById(`knowledge-entry-${targetEntryId}`);
      entry?.scrollIntoView({ behavior: "smooth", block: "center" });
      entry?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entries, targetEntryId]);

  if (user && user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background pt-[5.75rem]">
        <PageNav />
        <main className="mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-900">
            知识库仅对管理员开放
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/")}
            className="mt-4"
          >
            返回工作台
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-[5.75rem]">
      <PageNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-gray-500">Agent 数据源</p>
            <h1 className="mt-1 text-2xl font-semibold text-gray-950">
              知识库
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              管理 AI 客服可检索和引用的知识内容
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/admin/rag-debug")}
            >
              <Bug className="size-4" />
              RAG 调试
            </Button>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="size-4" />
              新增条目
            </Button>
          </div>
        </header>

        <KnowledgeDocuments />

        <section className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <Input
              aria-label="搜索知识库"
              placeholder="搜索标题、关键词或内容"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="border-transparent bg-gray-50 pl-9 pr-9 focus-visible:bg-white"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                aria-label="清空搜索"
                title="清空搜索"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1 border-gray-100 sm:border-l sm:pl-2">
            {(Object.entries(SECURITY_STATUS_META) as Array<
              [KnowledgeSecurityStatus, (typeof SECURITY_STATUS_META)[KnowledgeSecurityStatus]]
            >).map(([status, meta]) => (
              <Button
                key={status}
                type="button"
                variant={securityStatus === status ? "secondary" : "ghost"}
                size="sm"
                onClick={() =>
                  setSecurityStatus(current => (current === status ? null : status))
                }
              >
                {meta.label}
              </Button>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="sticky top-[6.75rem] h-fit max-h-[calc(100vh-7.75rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-4 flex items-center gap-2">
              <BookOpen className="size-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">分类</h2>
            </div>
            {listLoading ? (
              <div className="flex justify-center py-6">
                <Spinner className="size-5" />
              </div>
            ) : categoryCounts.length === 0 ? (
              <p className="text-sm text-gray-500">暂无分类</p>
            ) : (
              <div className="space-y-1">
                <button
                  type="button"
                  aria-pressed={selectedCategory === null}
                  onClick={() => setSelectedCategory(null)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    selectedCategory === null
                      ? "bg-gray-100 font-medium text-gray-950"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <span>全部分类</span>
                  <span className="tabular-nums text-xs text-gray-400">
                    {entries?.length ?? 0}
                  </span>
                </button>
                {categoryCounts.map(([category, count]) => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={selectedCategory === category}
                    onClick={() =>
                      setSelectedCategory(current =>
                        current === category ? null : category
                      )
                    }
                    className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      selectedCategory === category
                        ? "bg-gray-100 font-medium text-gray-950"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="min-w-0 truncate">{category}</span>
                    <span className="tabular-nums text-xs text-gray-400">
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {selectedCategory ? `分类：${selectedCategory} · ` : ""}
                {query
                  ? `搜索结果：${visibleEntries?.length ?? 0} 条`
                  : `全部条目：${visibleEntries?.length ?? 0} 条`}
              </p>
            </div>

            {isLoading ? (
              <div className="flex h-64 items-center justify-center rounded-lg border border-gray-200 bg-white">
                <Spinner className="size-5" />
              </div>
            ) : !visibleEntries || visibleEntries.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-6 py-14 text-center">
                <BookOpen className="mx-auto size-5 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">
                  {selectedCategory
                    ? "当前分类下暂无匹配条目"
                    : "暂无知识库条目"}
                </p>
                {selectedCategory && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => setSelectedCategory(null)}
                  >
                    查看全部分类
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                {visibleEntries.map(entry => (
                  <article
                    key={entry.id}
                    id={`knowledge-entry-${entry.id}`}
                    tabIndex={-1}
                    className={`scroll-mt-28 p-4 outline-none transition-[background-color,box-shadow] duration-500 sm:p-5 ${
                      targetEntryId === entry.id
                        ? "bg-blue-50/60 ring-1 ring-inset ring-blue-200"
                        : "bg-white"
                    }`}
                  >
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_9rem]">
                      <div className="min-w-0 break-words">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-950">
                            <HighlightedText text={entry.title} query={query} />
                          </h3>
                          <Badge
                            variant="outline"
                            className="bg-gray-50 text-gray-600"
                          >
                            <HighlightedText
                              text={getDisplayCategory(entry)}
                              query={query}
                            />
                          </Badge>
                          <Badge
                            variant="outline"
                            className={
                              SECURITY_STATUS_META[
                                entry.securityStatus as KnowledgeSecurityStatus
                              ]?.className
                            }
                          >
                            {SECURITY_STATUS_META[
                              entry.securityStatus as KnowledgeSecurityStatus
                            ]?.label ?? entry.securityStatus}
                          </Badge>
                          {entry.conflictWith != null && (
                            <Badge
                              variant="outline"
                              className="gap-1 border-amber-200 bg-amber-50 text-amber-700"
                            >
                              <AlertTriangle className="size-3" />
                              可能冲突
                              {entry.conflictScore != null
                                ? ` ${Math.round(entry.conflictScore * 100)}%`
                                : ""}
                            </Badge>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
                          <HighlightedText text={entry.content} query={query} />
                        </p>
                        {entry.conflictWith != null && (
                          <p className="mt-2 text-xs text-amber-700">
                            与已有条目
                            {entryTitleById.has(entry.conflictWith)
                              ? `「${entryTitleById.get(entry.conflictWith)}」`
                              : ""}
                            内容相近，请确认是否重复
                          </p>
                        )}
                        {entry.securityFindings?.length > 0 && (
                          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                            <p className="font-medium">
                              安全扫描发现 {entry.securityFindings.length} 项风险
                            </p>
                            <ul className="mt-2 space-y-2">
                              {entry.securityFindings.map((finding: SecurityFinding) => (
                                <li key={finding.ruleId}>
                                  <span className="font-medium">{finding.title}</span>
                                  <span className="text-amber-800">
                                    ：{finding.explanation}（{finding.severity} / {finding.score}）
                                  </span>
                                  {finding.evidence?.length ? (
                                    <p className="mt-0.5 break-all text-amber-700">
                                      证据：
                                      {finding.evidence
                                        .map(evidence =>
                                          typeof evidence === "string"
                                            ? evidence
                                            : `${evidence.text} [${evidence.start}, ${evidence.end})`
                                        )
                                        .join("；")}
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-gray-500 sm:grid-cols-2">
                          <div className="flex gap-1">
                            <dt>扫描器：</dt>
                            <dd className="break-all font-mono">{entry.securityScannerVersion}</dd>
                          </div>
                          <div className="flex gap-1">
                            <dt>风险项：</dt>
                            <dd>{entry.securityFindings?.length ?? 0}</dd>
                          </div>
                          <div className="flex gap-1 sm:col-span-2">
                            <dt className="shrink-0">内容哈希：</dt>
                            <dd className="break-all font-mono">{entry.securityContentHash ?? "未生成"}</dd>
                          </div>
                        </dl>
                        {entry.securityReviewReason ? (
                          <p className="mt-2 text-xs text-gray-500">
                            审核理由：{entry.securityReviewReason}
                          </p>
                        ) : null}
                        {entry.keywords && (
                          <p className="mt-3 text-xs text-gray-500">
                            关键词：
                            <HighlightedText
                              text={entry.keywords}
                              query={query}
                            />
                          </p>
                        )}
                      </div>
                      <div className="flex items-start justify-between gap-3 md:flex-col md:items-end">
                        <div className="shrink-0 text-xs text-gray-400 md:text-right">
                          <p>
                            {formatDistanceToNow(new Date(entry.updatedAt), {
                              locale: zhCN,
                              addSuffix: true,
                            })}
                          </p>
                          <p className="mt-1 break-words">
                            索引：{entry.embeddingStatus}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {entry.securityStatus === "quarantined" ? (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="批准条目"
                                    onClick={() => openReview(entry, "approve")}
                                  >
                                    <CheckCircle2 className="size-4 text-emerald-600" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>填写理由并批准</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="拒绝条目"
                                    onClick={() => openReview(entry, "reject")}
                                  >
                                    <XCircle className="size-4 text-red-600" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>填写理由并拒绝</TooltipContent>
                              </Tooltip>
                            </>
                          ) : null}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="重新安全扫描"
                                onClick={() => handleRescan(entry.id)}
                                disabled={rescanMutation.isPending}
                              >
                                <ShieldAlert className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>重新安全扫描</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="编辑条目"
                                onClick={() => openEditDialog(entry)}
                              >
                                <Edit3 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>编辑条目</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="重新生成 embedding"
                                onClick={() => handleReindexEntry(entry.id)}
                                disabled={
                                  reindexEntryMutation.isPending ||
                                  entry.securityStatus !== "approved"
                                }
                              >
                                <RefreshCcw className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {entry.securityStatus === "approved"
                                ? "重新生成 embedding"
                                : "仅已批准条目可以重新索引"}
                            </TooltipContent>
                          </Tooltip>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-gray-400 hover:text-red-600"
                                aria-label="删除条目"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>删除条目？</AlertDialogTitle>
                                <AlertDialogDescription>
                                  将删除「{entry.title}」，此操作不可撤销。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteEntry(entry.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  删除
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      <Dialog
        open={Boolean(reviewEntry)}
        onOpenChange={open => {
          if (!open && !reviewMutation.isPending) setReviewEntry(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewDecision === "approve" ? "批准知识条目" : "拒绝知识条目"}
            </DialogTitle>
            <DialogDescription>
              {reviewDecision === "approve"
                ? "批准后该条目可参与 Agent 检索。"
                : "拒绝后该条目不会参与 Agent 检索。"}
              提交时会校验当前内容哈希，避免审核过期内容。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-900">{reviewEntry?.title}</p>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                审核理由
              </label>
              <Textarea
                value={reviewReason}
                rows={4}
                maxLength={2000}
                placeholder="至少 3 个字符"
                onChange={event => setReviewReason(event.target.value)}
              />
            </div>
            <p className="break-all font-mono text-[11px] text-gray-400">
              Hash: {reviewEntry?.securityContentHash ?? "未生成"}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewEntry(null)}
              disabled={reviewMutation.isPending}
            >
              取消
            </Button>
            <Button
              variant={reviewDecision === "reject" ? "destructive" : "default"}
              onClick={handleReview}
              disabled={reviewMutation.isPending || reviewReason.trim().length < 3}
            >
              {reviewMutation.isPending
                ? "提交中…"
                : reviewDecision === "approve"
                  ? "确认批准"
                  : "确认拒绝"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? "编辑知识条目" : "新增知识条目"}
            </DialogTitle>
            <DialogDescription>
              保存后会尝试重新生成 embedding；服务不可用时仍会保留文本内容。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                标题
              </label>
              <Input
                value={entryForm.title}
                onChange={event =>
                  setEntryForm({ ...entryForm, title: event.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                分类
              </label>
              <Input
                value={entryForm.category}
                onChange={event =>
                  setEntryForm({ ...entryForm, category: event.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                关键词
              </label>
              <Input
                value={entryForm.keywords}
                onChange={event =>
                  setEntryForm({ ...entryForm, keywords: event.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                内容
              </label>
              <Textarea
                value={entryForm.content}
                rows={8}
                onChange={event =>
                  setEntryForm({ ...entryForm, content: event.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleSaveEntry}
              disabled={
                addEntryMutation.isPending || updateEntryMutation.isPending
              }
            >
              {addEntryMutation.isPending || updateEntryMutation.isPending
                ? "保存中..."
                : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
