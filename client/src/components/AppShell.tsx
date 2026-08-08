import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import BrandMark from "@/components/BrandMark";
import CreditQuotaIndicator from "@/components/CreditQuotaIndicator";
import LanguageToggle from "@/components/LanguageToggle";
import { useT, type Dictionary } from "@/i18n";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Bot,
  Bug,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Plug,
  Settings,
  Sparkles,
  Tickets,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Bot;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const buildNavGroups = (t: Dictionary): NavGroup[] => [
  {
    label: t.nav.groupDaily,
    items: [
      { href: "/", label: t.nav.dashboard, icon: LayoutDashboard },
      { href: "/inbox", label: t.nav.inbox, icon: Inbox },
      { href: "/tickets", label: t.nav.tickets, icon: Tickets },
    ],
  },
  {
    label: t.nav.groupAgent,
    items: [
      { href: "/knowledge", label: t.nav.knowledge, icon: BookOpen },
      { href: "/chat", label: t.nav.chat, icon: MessagesSquare },
      { href: "/channels", label: t.nav.channels, icon: Plug },
    ],
  },
  {
    label: t.nav.groupSettings,
    items: [
      { href: "/settings", label: t.nav.settings, icon: Settings },
      { href: "/plans", label: t.plans.title, icon: Sparkles },
      { href: "/rag-debug", label: t.nav.ragDebug, icon: Bug },
    ],
  },
];

const getPathname = (location: string) => location.split("?")[0] || "/";

const isActivePath = (location: string, href: string) => {
  const pathname = getPathname(location);
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
};

/** `/ticket/123` should still light up the 工单 entry. */
const RELATED_PREFIXES: Array<[string, string]> = [
  ["/ticket/", "/tickets"],
  ["/runs/", "/chat"],
];

const resolveActiveHref = (location: string) => {
  const pathname = getPathname(location);
  for (const [prefix, href] of RELATED_PREFIXES) {
    if (pathname.startsWith(prefix)) return href;
  }
  return pathname;
};

function SidebarContents({
  activeHref,
  onNavigate,
}: {
  activeHref: string;
  onNavigate: (href: string) => void;
}) {
  const { workspace } = useWorkspace({ requireOnboarded: false });
  const { user, logout } = useAuth();
  const t = useT();
  const navGroups = buildNavGroups(t);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-4">
        <BrandMark />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">
            {workspace?.agentName || "Linply"}
          </p>
          <p className="truncate text-xs leading-tight text-muted-foreground">
            {workspace?.name || t.nav.defaultWorkspace}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="px-2 pb-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActivePath(activeHref, item.href);
                return (
                  <li key={item.href}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item.href)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-primary-soft font-medium text-primary-soft-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-tight text-foreground">
                  {user?.name || t.common.unnamed}
                </span>
                <span className="block truncate text-xs leading-tight text-muted-foreground">
                  {user?.email}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onNavigate("/settings")}>
              <Settings className="size-4" />
              {t.nav.settings}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => logout()}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="size-4" />
              {t.common.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export type AppShellProps = {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Chat-style pages manage their own scrolling and need the full viewport. */
  fullBleed?: boolean;
  maxWidth?: "default" | "wide" | "full";
};

export default function AppShell({
  children,
  title,
  description,
  actions,
  fullBleed = false,
  maxWidth = "default",
}: AppShellProps) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = useT();
  const activeHref = resolveActiveHref(location);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const navigate = (href: string) => {
    setLocation(href);
    setMobileOpen(false);
  };

  const widthClass =
    maxWidth === "full"
      ? "max-w-none"
      : maxWidth === "wide"
        ? "max-w-6xl"
        : "max-w-4xl";

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarContents activeHref={activeHref} onNavigate={navigate} />
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t.nav.closeNav}
            className="absolute inset-0 bg-foreground/25 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-sidebar-border bg-sidebar shadow-xl">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.nav.closeNav}
              className="absolute right-2 top-4"
              onClick={() => setMobileOpen(false)}
            >
              <X className="size-4" />
            </Button>
            <SidebarContents activeHref={activeHref} onNavigate={navigate} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={t.nav.openNav}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            {title ? (
              <h1 className="truncate text-sm font-semibold text-foreground">
                {title}
              </h1>
            ) : null}
            {description ? (
              <p className="truncate text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageToggle />
            <CreditQuotaIndicator className="hidden sm:flex" />
            {actions}
          </div>
        </header>

        {fullBleed ? (
          <div className="min-h-0 flex-1">{children}</div>
        ) : (
          <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <div className={cn("mx-auto w-full", widthClass)}>{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}
