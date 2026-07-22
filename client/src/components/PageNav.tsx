import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookOpen,
  Bot,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Tickets,
} from "lucide-react";
import { Fragment } from "react";
import { useLocation } from "wouter";

type PageNavProps = {
  title?: string;
};

type BreadcrumbItem = {
  label: string;
  href?: string;
};

const getPathname = (location: string) => location.split("?")[0] || "/";

const isActivePath = (location: string, href: string) => {
  const pathname = getPathname(location);
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
};

const getBreadcrumbs = (location: string): BreadcrumbItem[] => {
  const pathname = getPathname(location);
  const root = { label: "工作台", href: "/" };

  if (pathname === "/") return [{ label: "工作台" }];
  if (pathname === "/chat") return [root, { label: "智能客服" }];
  if (pathname === "/tickets") return [root, { label: "工单" }];
  if (pathname === "/ticket/create") {
    return [root, { label: "工单", href: "/tickets" }, { label: "创建工单" }];
  }
  if (pathname.startsWith("/ticket/")) {
    const ticketId = pathname.slice("/ticket/".length);
    return [root, { label: "工单", href: "/tickets" }, { label: `工单 #${ticketId}` }];
  }
  if (pathname === "/admin/dashboard") return [root, { label: "运营概览" }];
  if (pathname === "/admin/knowledge") return [root, { label: "知识库" }];
  if (pathname === "/admin/rag-debug") {
    return [root, { label: "知识库", href: "/admin/knowledge" }, { label: "RAG 调试" }];
  }
  if (pathname.startsWith("/runs/")) {
    return [root, { label: "智能客服", href: "/chat" }, { label: "Agent Run" }];
  }

  return [root, { label: "当前页面" }];
};

export default function PageNav({ title = "客服工单系统" }: PageNavProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const breadcrumbs = getBreadcrumbs(location);
  const navItems = [
    { href: "/", label: "工作台", icon: LayoutDashboard },
    { href: "/chat", label: "智能客服", icon: MessageSquareText },
    { href: "/tickets", label: "工单", icon: Tickets },
    ...(user?.role === "admin"
      ? [{ href: "/admin/knowledge", label: "知识库", icon: BookOpen }]
      : []),
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[5.75rem] border-b border-black/10 bg-[#fafaf9]/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="flex shrink-0 items-center gap-2 text-left"
          aria-label="返回工作台"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-gray-950 text-white">
            <Bot className="size-4" />
          </span>
          <span className="hidden text-sm font-semibold text-gray-950 lg:block">
            {title}
          </span>
        </button>

        <nav className="hidden min-w-0 flex-1 items-center gap-1 sm:flex" aria-label="主导航">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const active = isActivePath(location, item.href);
            return (
              <Fragment key={item.href}>
                {index === 1 ? (
                  <span aria-hidden="true" className="mx-2 h-5 w-px shrink-0 bg-gray-300" />
                ) : null}
                <button
                  type="button"
                  onClick={() => setLocation(item.href)}
                  className={`flex h-8 items-center gap-2 rounded-md px-3 text-sm transition-colors ${
                    active
                      ? "bg-gray-200/80 font-medium text-gray-950"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-950"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 sm:hidden">
          <p className="truncate text-sm font-medium text-gray-800">
            {navItems.find(item => isActivePath(location, item.href))?.label ?? title}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {user?.name || user?.email ? (
            <div className="hidden items-center gap-2 md:flex">
              <span className="flex size-7 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">
                {(user.name || user.email || "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-36 truncate text-sm text-gray-600">
                {user.name || user.email}
              </span>
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="sm:hidden"
                aria-label="打开导航菜单"
                title="导航菜单"
              >
                <Menu className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {navItems.map((item, index) => {
                const Icon = item.icon;
                const active = isActivePath(location, item.href);
                return (
                  <Fragment key={item.href}>
                    <DropdownMenuItem
                      onSelect={() => setLocation(item.href)}
                      className={active ? "bg-gray-100 font-medium" : ""}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </DropdownMenuItem>
                    {index === 0 ? <DropdownMenuSeparator /> : null}
                  </Fragment>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout()}>
                <LogOut className="size-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden sm:inline-flex"
            onClick={() => logout()}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>

      <div className="h-9 border-t border-black/5 bg-white/55">
        <div className="mx-auto flex h-full max-w-7xl items-center px-4 sm:px-6">
          <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-xs">
            {breadcrumbs.map((item, index) => {
              const isCurrent = index === breadcrumbs.length - 1;
              return (
                <Fragment key={`${item.label}-${index}`}>
                  {index > 0 ? (
                    <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-gray-300" />
                  ) : null}
                  {item.href && !isCurrent ? (
                    <button
                      type="button"
                      onClick={() => setLocation(item.href!)}
                      className="shrink-0 rounded-sm text-gray-500 outline-none transition-colors hover:text-gray-950 focus-visible:ring-2 focus-visible:ring-gray-400"
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span
                      className={`truncate ${isCurrent ? "font-medium text-gray-800" : "text-gray-500"}`}
                      aria-current={isCurrent ? "page" : undefined}
                    >
                      {item.label}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
