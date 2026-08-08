import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { Database, Search } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useT } from "@/i18n";

export default function RagDebug() {
  const { workspace, loading } = useWorkspace();
  const t = useT();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(5);

  const { data, isFetching } = trpc.knowledge.debugSearch.useQuery(
    { query, limit },
    { enabled: Boolean(workspace) && query.trim().length > 0 }
  );

  if (loading || !workspace) {
    return (
      <AppShell title={t.ragDebug.title}>
        <div className="flex justify-center py-16">
          <Spinner className="size-5" />
        </div>
      </AppShell>
    );
  }

  const runSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };

  return (
    <AppShell
      title={t.ragDebug.title}
      description={t.ragDebug.subtitle}
      maxWidth="wide"
    >
      <div>

        <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <form
            onSubmit={runSearch}
            className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem_auto] md:items-end"
          >
            <label className="block min-w-0">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">测试问题</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  placeholder="例如：退款需要多久？"
                  className="bg-muted/60 pl-9 focus-visible:bg-card"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">召回条数</span>
              <Input
                aria-label="召回条数"
                type="number"
                min={1}
                max={20}
                value={limit}
                onChange={event => setLimit(Number(event.target.value))}
                className="bg-muted/60 focus-visible:bg-card"
              />
            </label>
            <Button type="submit" disabled={!draft.trim() || isFetching}>
              {isFetching ? <Spinner className="size-4" /> : <Search className="size-4" />}
              {isFetching ? "检索中" : "运行检索"}
            </Button>
          </form>
        </section>

        {query ? (
          <div className="mt-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">当前问题</p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{query}</p>
            </div>
            {data ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className={
                    data.mode === "vector"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }
                >
                  {data.mode === "vector" ? "向量召回" : "关键词兜底"}
                </Badge>
                {data.fallbackReason ? (
                  <Badge variant="outline">{data.fallbackReason}</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {isFetching ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Spinner className="size-5" />
          </div>
        ) : data && data.results.length > 0 ? (
          <section className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold text-foreground">召回结果</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{data.results.length} 条</span>
            </div>
            <div className="divide-y divide-border">
              {data.results.map((result, index) => (
                <article key={result.id} className="px-4 py-5 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <h3 className="truncate text-sm font-semibold text-foreground">
                          {result.title}
                        </h3>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline">{result.category}</Badge>
                        <Badge variant="secondary">
                          embedding {result.embeddingStatus}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-x-5 text-right text-xs sm:block">
                      <p className="text-muted-foreground">score</p>
                      <p className="mt-0.5 font-mono font-medium text-foreground">
                        {Number(result.score).toFixed(4)}
                      </p>
                      {result.distance != null ? (
                        <>
                          <p className="mt-2 text-muted-foreground">distance</p>
                          <p className="mt-0.5 font-mono text-muted-foreground">
                            {Number(result.distance).toFixed(4)}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                    {result.content}
                  </p>
                  {result.keywords ? (
                    <p className="mt-3 text-xs text-muted-foreground">关键词：{result.keywords}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : query ? (
          <div className="mt-4 flex h-56 flex-col items-center justify-center rounded-lg border border-border bg-card px-6 text-center">
            <Database className="mb-3 size-5 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">没有召回知识条目</p>
            <p className="mt-1 text-sm text-muted-foreground">调整问题表达或增加召回条数后重试</p>
          </div>
        ) : (
          <div className="mt-6 flex h-56 flex-col items-center justify-center border-y border-border px-6 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Database className="size-5" />
            </span>
            <p className="text-sm font-medium text-foreground">等待检索问题</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
