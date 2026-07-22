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
  Edit3,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";

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
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
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
    trpc.knowledge.list.useQuery();
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

  const openEditDialog = (entry: any) => {
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

  const handleDeleteEntry = async (id: number) => {
    try {
      await deleteEntryMutation.mutateAsync({ id });
      await refreshKnowledge();
      toast.success("已删除该条目");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const rawVisibleEntries = query.length > 0 ? searchResults : entries;
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
              className="border-transparent bg-gray-50 pl-9 focus-visible:bg-white"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearch("")}
            disabled={!search}
          >
            清空
          </Button>
        </section>

        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="h-fit rounded-lg border border-gray-200 bg-white p-4">
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
                        <div className="flex shrink-0 items-center gap-1">
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
                                disabled={reindexEntryMutation.isPending}
                              >
                                <RefreshCcw className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>重新生成 embedding</TooltipContent>
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
