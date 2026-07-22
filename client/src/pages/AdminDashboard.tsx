import { useAuth } from "@/_core/hooks/useAuth";
import PageNav from "@/components/PageNav";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { ChevronRight, Tickets } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation } from "wouter";

const statusColors = ["#d6a63a", "#547a91", "#3f8c6d", "#a3a3a3"];

export default function AdminDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = trpc.tickets.getStats.useQuery();

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background pt-[5.75rem]">
        <PageNav />
        <main className="mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-900">您没有权限访问此页面</p>
          <Button variant="outline" size="sm" onClick={() => setLocation("/")} className="mt-4">
            返回工作台
          </Button>
        </main>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pt-[5.75rem]">
        <PageNav />
        <div className="flex h-[calc(100vh-5.75rem)] items-center justify-center">
          <Spinner className="size-5" />
        </div>
      </div>
    );
  }

  const statusData = [
    { name: "待处理", value: stats?.pending || 0 },
    { name: "处理中", value: stats?.inProgress || 0 },
    { name: "已解决", value: stats?.resolved || 0 },
    { name: "已关闭", value: stats?.closed || 0 },
  ];

  const metricData = [
    { label: "总工单", value: stats?.total || 0, href: "/tickets" },
    { label: "待处理", value: stats?.pending || 0, href: "/tickets?status=pending" },
    { label: "处理中", value: stats?.inProgress || 0, href: "/tickets?status=in_progress" },
    { label: "已解决", value: stats?.resolved || 0, href: "/tickets?status=resolved" },
  ];

  return (
    <div className="min-h-screen bg-background pt-[5.75rem]">
      <PageNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <div>
            <p className="text-sm text-gray-500">服务运营</p>
            <h1 className="mt-1 text-2xl font-semibold text-gray-950">运营概览</h1>
            <p className="mt-1 text-sm text-gray-500">当前工单状态与处理进度</p>
          </div>
        </header>

        <section className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-gray-200 bg-white md:grid-cols-4">
          {metricData.map((metric, index) => (
            <button
              type="button"
              key={metric.label}
              onClick={() => setLocation(metric.href)}
              aria-label={`查看${metric.label}`}
              className={`group relative px-4 py-5 text-left outline-none transition-colors hover:bg-gray-50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400 sm:px-5 ${
                index % 2 ? "border-l border-gray-100" : ""
              } ${index >= 2 ? "border-t border-gray-100 md:border-t-0" : ""} ${
                index > 0 ? "md:border-l md:border-gray-100" : ""
              }`}
            >
              <span className="flex items-center justify-between gap-2 text-xs font-medium text-gray-500">
                {metric.label}
                <ChevronRight className="size-3.5 text-gray-300 transition-colors group-hover:text-gray-600" />
              </span>
              <span className="mt-2 block text-2xl font-semibold tabular-nums text-gray-950">
                {metric.value}
              </span>
            </button>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">状态分布</h2>
                <p className="mt-1 text-xs text-gray-500">按当前处理状态统计</p>
              </div>
              <Tickets className="size-4 text-gray-400" />
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={statusData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#ececea" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#737373", fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#a3a3a3", fontSize: 11 }} />
                <Tooltip cursor={{ fill: "#f5f5f4" }} contentStyle={{ border: "1px solid #e5e5e5", borderRadius: 6, boxShadow: "none", fontSize: 12 }} />
                <Bar dataKey="value" name="工单数" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {statusData.map((entry, index) => (
                    <Cell key={entry.name} fill={statusColors[index]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-900">工单占比</h2>
              <p className="mt-1 text-xs text-gray-500">各状态占总量比例</p>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={entry.name} fill={statusColors[index]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ border: "1px solid #e5e5e5", borderRadius: 6, boxShadow: "none", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3">
                {statusData.map((item, index) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-gray-500">
                      <span className="size-2 rounded-full" style={{ backgroundColor: statusColors[index] }} />
                      {item.name}
                    </span>
                    <span className="font-medium tabular-nums text-gray-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
