import { useAuth } from "@/_core/hooks/useAuth";
import PageNav from "@/components/PageNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const priorityOptions = [
  { value: "low", label: "低", description: "一般咨询，预计 2-3 天响应" },
  { value: "medium", label: "中", description: "标准问题，预计 24 小时响应" },
  { value: "high", label: "高", description: "重要问题，预计 4-8 小时响应" },
  { value: "urgent", label: "紧急", description: "业务受阻，预计 1-2 小时响应" },
];

export default function TicketCreate() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const createMutation = trpc.tickets.create.useMutation();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error("请填写标题和问题描述");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        priority: priority as "low" | "medium" | "high" | "urgent",
      });
      toast.success("工单已创建");
      setLocation(result?.id ? `/ticket/${result.id}` : "/tickets");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建工单失败");
    }
  };

  const selectedPriority = priorityOptions.find(option => option.value === priority);

  return (
    <div className="min-h-screen bg-background pt-[5.75rem]">
      <PageNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section>
            <header className="mb-6">
              <p className="text-sm text-gray-500">新建服务请求</p>
              <h1 className="mt-1 text-2xl font-semibold text-gray-950">创建工单</h1>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                提供清晰的问题背景和期望结果，便于客服快速处理。
              </p>
            </header>

            <form
              onSubmit={handleSubmit}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white"
            >
              <div className="space-y-6 p-5 sm:p-6">
                <div>
                  <label htmlFor="ticket-title" className="mb-2 block text-sm font-medium text-gray-800">
                    标题
                  </label>
                  <Input
                    id="ticket-title"
                    placeholder="用一句话概括问题"
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    maxLength={120}
                    required
                  />
                  <p className="mt-1.5 text-right text-xs tabular-nums text-gray-400">
                    {title.length}/120
                  </p>
                </div>

                <div>
                  <label htmlFor="ticket-description" className="mb-2 block text-sm font-medium text-gray-800">
                    问题描述
                  </label>
                  <Textarea
                    id="ticket-description"
                    placeholder="说明发生了什么、已经尝试过什么，以及希望得到的结果"
                    value={description}
                    onChange={event => setDescription(event.target.value)}
                    rows={9}
                    className="resize-y"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-800">优先级</label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {priorityOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}优先级
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-xs text-gray-500">{selectedPriority?.description}</p>
                </div>
              </div>

              <footer className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                <Button type="button" variant="outline" onClick={() => setLocation("/tickets")}>
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || !title.trim() || !description.trim()}
                >
                  {createMutation.isPending ? "提交中" : "提交工单"}
                  {!createMutation.isPending ? <Send className="size-4" /> : null}
                </Button>
              </footer>
            </form>
          </section>

          <aside className="border-t border-gray-200 pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-1">
            <h2 className="text-sm font-semibold text-gray-900">提交前检查</h2>
            <div className="mt-4 space-y-4 text-sm text-gray-500">
              <p className="flex gap-2 leading-5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                标题能明确定位问题
              </p>
              <p className="flex gap-2 leading-5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                描述包含复现过程和影响范围
              </p>
              <p className="flex gap-2 leading-5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                优先级与实际影响相符
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
