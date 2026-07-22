import { useAuth } from "@/_core/hooks/useAuth";
import PageNav from "@/components/PageNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  Bug,
  FilePlus2,
  MessageSquareText,
  Search,
  Tickets,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

type WorkspaceItem = {
  title: string;
  description: string;
  href: string;
  icon: typeof Bot;
};

function WorkspaceList({ items }: { items: WorkspaceItem[] }) {
  const [, setLocation] = useLocation();

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.href}
            type="button"
            onClick={() => setLocation(item.href)}
            className={`group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-gray-50 sm:px-5 ${
              index > 0 ? "border-t border-gray-100" : ""
            }`}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-700">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-950">
                {item.title}
              </span>
              <span className="mt-0.5 block text-sm leading-5 text-gray-500">
                {item.description}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-600" />
          </button>
        );
      })}
    </div>
  );
}

export default function Home() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const [runId, setRunId] = useState("");

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    );
  }

  const primaryItems: WorkspaceItem[] = [
    {
      title: "智能客服",
      description: "基于知识库获取回答，并按需查询或创建工单",
      href: "/chat",
      icon: MessageSquareText,
    },
    {
      title: user.role === "admin" ? "全部工单" : "我的工单",
      description: "筛选、跟踪和处理服务请求",
      href: "/tickets",
      icon: Tickets,
    },
    {
      title: "创建工单",
      description: "提交新的问题或人工服务请求",
      href: "/ticket/create",
      icon: FilePlus2,
    },
  ];

  const adminItems: WorkspaceItem[] = [
    {
      title: "运营概览",
      description: "查看工单数量、状态分布和处理进度",
      href: "/admin/dashboard",
      icon: BarChart3,
    },
    {
      title: "知识库",
      description: "维护客服知识、导入文档并检查索引状态",
      href: "/admin/knowledge",
      icon: BookOpen,
    },
    {
      title: "RAG 调试",
      description: "检查检索结果、相似度和降级状态",
      href: "/admin/rag-debug",
      icon: Search,
    },
  ];

  return (
    <div className="min-h-screen bg-background pt-[5.75rem]">
      <PageNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 border-b border-gray-200 pb-7">
          <p className="text-sm text-gray-500">
            {user.role === "admin" ? "管理员工作区" : "服务工作区"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-950">
            你好，{user.name || user.email}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            从这里开始处理咨询、跟踪工单和维护客服知识。
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">快速开始</h2>
                <span className="text-xs text-gray-400">常用工作</span>
              </div>
              <WorkspaceList items={primaryItems} />
            </section>

            {user.role === "admin" ? (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">管理工具</h2>
                  <span className="text-xs text-gray-400">仅管理员可见</span>
                </div>
                <WorkspaceList items={adminItems} />
              </section>
            ) : null}
          </div>

          <aside className="border-t border-gray-200 pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
            <div className="flex items-center gap-2 text-gray-900">
              <Bug className="size-4" />
              <h2 className="text-sm font-semibold">Agent Run 排查</h2>
            </div>
            <p className="mt-2 text-sm leading-5 text-gray-500">
              输入 Run UUID 查看执行步骤、错误原因和重试入口。
            </p>
            <form
              className="mt-4 space-y-2"
              onSubmit={event => {
                event.preventDefault();
                if (runId) setLocation(`/runs/${runId}`);
              }}
            >
              <Input
                aria-label="Agent Run ID"
                placeholder="Run UUID"
                value={runId}
                onChange={event => setRunId(event.target.value.trim())}
              />
              <Button type="submit" size="sm" disabled={!runId} className="w-full">
                查看运行详情
                <ArrowRight className="size-4" />
              </Button>
            </form>
          </aside>
        </div>
      </main>
    </div>
  );
}
