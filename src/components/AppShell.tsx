"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShellContextProvider } from "@/components/AppShellContext";
import ConfirmModal from "@/components/ConfirmModal";
import useAdminStatus from "@/components/useAdminStatus";
import useExperienceMode, { type ExperienceMode } from "@/components/useExperienceMode";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

type NavigationItem = {
  href: string;
  label: string;
  adminOnly?: boolean;
  superOnly?: boolean;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const playerNavigation: NavigationGroup[] = [
  {
    label: "Play",
    items: [
      { href: "/my-fixtures", label: "My fixtures" },
      { href: "/events", label: "Competitions" },
      { href: "/table-bookings", label: "Book a table" },
      { href: "/quick-match", label: "Quick match" },
    ],
  },
  {
    label: "Results & performance",
    items: [
      { href: "/rankings", label: "Rankings" },
      { href: "/high-breaks", label: "High breaks" },
      { href: "/stats", label: "Club statistics", adminOnly: true },
    ],
  },
  {
    label: "Account & guidance",
    items: [
      { href: "/notifications", label: "Notifications" },
      { href: "/install", label: "Install the app" },
      { href: "/rules", label: "Rules" },
      { href: "/help", label: "Help & user guide" },
      { href: "/premium", label: "Premium" },
      { href: "/legal", label: "Legal & privacy" },
    ],
  },
];

const manageNavigation: NavigationGroup[] = [
  {
    label: "Competitions",
    items: [
      { href: "/events", label: "Competition centre", adminOnly: true },
      { href: "/events/new", label: "Create competition", adminOnly: true },
      { href: "/signups", label: "Competition entries", adminOnly: true },
      { href: "/results", label: "Results & approvals", adminOnly: true },
      { href: "/live", label: "Live overview", adminOnly: true },
      { href: "/weekly-reviews", label: "Weekly reviews", superOnly: true },
    ],
  },
  {
    label: "Club operations",
    items: [
      { href: "/table-bookings", label: "Table bookings", adminOnly: true },
      { href: "/players", label: "Players", adminOnly: true },
      { href: "/rankings", label: "Rankings" },
      { href: "/high-breaks", label: "High breaks" },
      { href: "/stats", label: "Club statistics", adminOnly: true },
      { href: "/notifications", label: "Notifications" },
    ],
  },
  {
    label: "System owner",
    items: [
      { href: "/signup-requests", label: "Access requests", superOnly: true },
      { href: "/reschedules", label: "Fixture week requests", superOnly: true },
      { href: "/snooker-handicap-exceptions", label: "Handicap exceptions", superOnly: true },
      { href: "/locations", label: "Locations", superOnly: true },
      { href: "/emails", label: "System email activity", superOnly: true },
      { href: "/audit", label: "Audit log", superOnly: true },
      { href: "/usage", label: "Accounts & activity", superOnly: true },
      { href: "/backup", label: "Data management", superOnly: true },
    ],
  },
  {
    label: "Guidance",
    items: [
      { href: "/help", label: "Help & user guide" },
      { href: "/rules", label: "Rules" },
      { href: "/legal", label: "Legal & privacy" },
    ],
  },
];

const barePrefixes = [
  "/auth",
  "/display",
  "/join",
  "/entrant",
  "/league/",
  "/review/",
  "/legion-masters",
];

function isBarePath(pathname: string) {
  return barePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function hrefPath(href: string) {
  return href.split("?")[0];
}

function itemMatchesPath(pathname: string, currentSearch: string, href: string) {
  const target = hrefPath(href);
  const pathMatches = pathname === target || (target !== "/" && pathname.startsWith(`${target}/`));
  if (!pathMatches) return false;
  const expected = new URLSearchParams(href.split("?")[1] ?? "");
  const current = new URLSearchParams(currentSearch);
  return Array.from(expected.entries()).every(([key, value]) => current.get(key) === value);
}

function pageDetails(pathname: string, currentSearch: string, groups: NavigationGroup[]) {
  if (pathname === "/") return { group: "Home", label: "Dashboard" };
  for (const group of groups) {
    const item = group.items.find((candidate) => itemMatchesPath(pathname, currentSearch, candidate.href));
    if (item) return { group: group.label, label: item.label };
  }
  if (pathname.startsWith("/matches/")) return { group: "Play", label: "Fixture" };
  if (pathname.startsWith("/competitions/")) return { group: "Competitions", label: "Competition details" };
  if (pathname.startsWith("/players/")) return { group: "Club operations", label: "Player profile" };
  return { group: "Rack & Frame", label: "Club workspace" };
}

function NavigationContent({
  groups,
  pathname,
  currentSearch,
  roleLabel,
  mode,
  canManage,
  onModeChange,
  onNavigate,
  onSignOut,
}: {
  groups: NavigationGroup[];
  pathname: string;
  currentSearch: string;
  roleLabel: string;
  mode: ExperienceMode;
  canManage: boolean;
  onModeChange: (mode: ExperienceMode) => void;
  onNavigate: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
  onSignOut: () => void;
}) {
  const activeGroupLabel = groups.find((group) => group.items.some((item) => itemMatchesPath(pathname, currentSearch, item.href)))?.label;
  const [expandedGroups, setExpandedGroups] = useState<string[]>(() => activeGroupLabel ? [activeGroupLabel] : [groups[0]?.label].filter(Boolean));

  useEffect(() => {
    if (!activeGroupLabel) return;
    const timer = window.setTimeout(() => {
      setExpandedGroups((current) => current.includes(activeGroupLabel) ? current : [activeGroupLabel]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeGroupLabel]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b1730] text-white">
      <div className="border-b border-white/10 px-5 py-5">
        <Link href="/" onClick={(event) => onNavigate("/", event)} className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-teal-500 text-xs font-black text-[#0b1730] shadow-lg shadow-cyan-950/30">R&amp;F</span>
          <span>
            <span className="block text-sm font-black tracking-wide">Rack &amp; Frame</span>
            <span className="block text-xs text-slate-400">Club Manager</span>
          </span>
        </Link>
        {canManage ? (
          <div className="mt-4 grid grid-cols-2 rounded-xl border border-white/15 bg-black/20 p-1" aria-label="Choose app view">
            <button type="button" onClick={() => onModeChange("player")} className={`rounded-lg px-3 py-2 text-xs font-bold ${mode === "player" ? "bg-cyan-300 text-[#0b1730]" : "text-slate-300 hover:bg-white/10"}`}>Player</button>
            <button type="button" onClick={() => onModeChange("manage")} className={`rounded-lg px-3 py-2 text-xs font-bold ${mode === "manage" ? "bg-amber-300 text-[#0b1730]" : "text-slate-300 hover:bg-white/10"}`}>Manage</button>
          </div>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        <Link href="/" onClick={(event) => onNavigate("/", event)} aria-current={pathname === "/" ? "page" : undefined} className={`mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${pathname === "/" ? "bg-cyan-300 text-[#0b1730]" : "text-slate-200 hover:bg-white/10"}`}>
          <span aria-hidden="true">⌂</span> Dashboard
        </Link>
        <div className="space-y-1">
          {groups.map((group) => {
            const expanded = expandedGroups.includes(group.label);
            const containsActive = group.label === activeGroupLabel;
            return (
              <section key={group.label} className="rounded-xl">
                <h2>
                  <button type="button" onClick={() => setExpandedGroups((current) => current.includes(group.label) ? current.filter((label) => label !== group.label) : [...current, group.label])} aria-expanded={expanded} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.13em] transition ${containsActive ? "text-cyan-200" : "text-slate-400 hover:bg-white/10 hover:text-slate-200"}`}>
                    <span>{group.label}</span><span aria-hidden="true" className="text-base leading-none">{expanded ? "−" : "+"}</span>
                  </button>
                </h2>
                {expanded ? <div className="mb-2 space-y-0.5 border-l border-white/10 pl-2">
                  {group.items.map((item) => {
                    const active = itemMatchesPath(pathname, currentSearch, item.href);
                    return <Link key={item.href} href={item.href} onClick={(event) => onNavigate(item.href, event)} aria-current={active ? "page" : undefined} className={`block rounded-lg px-3 py-2 text-sm transition ${active ? "bg-white/15 font-bold text-cyan-200 ring-1 ring-white/10" : "font-medium text-slate-300 hover:bg-white/10 hover:text-white"}`}>{item.label}</Link>;
                  })}
                </div> : null}
              </section>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-bold text-white">{roleLabel}</p>
        <p className="mt-0.5 text-xs text-slate-400">Rack &amp; Frame Club</p>
        <button type="button" onClick={onSignOut} className="mt-3 w-full rounded-lg border border-white/15 px-3 py-2 text-left text-xs font-bold text-slate-200 hover:border-rose-300/50 hover:bg-rose-400/10 hover:text-rose-100">Sign out</button>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const admin = useAdminStatus();
  const canManage = admin.isAdmin || admin.isSuper;
  const [mode, setMode] = useExperienceMode(canManage ? "manage" : "player");
  const effectiveMode: ExperienceMode = canManage ? mode : "player";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [guard, setGuard] = useState({ enabled: false, message: "You have unsaved changes. Leave this screen?" });
  const [pendingAction, setPendingAction] = useState<{ type: "href"; href: string } | { type: "back" } | null>(null);
  const enabled = !isBarePath(pathname) && Boolean(admin.userId);

  const visibleGroups = useMemo(() => {
    const source = canManage && effectiveMode === "manage" ? manageNavigation : playerNavigation;
    return source.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.superOnly && !admin.isSuper) return false;
        if (item.adminOnly && !canManage) return false;
        return true;
      }),
    })).filter((group) => group.items.length > 0);
  }, [admin.isSuper, canManage, effectiveMode]);

  const details = useMemo(() => pageDetails(pathname, currentSearch, visibleGroups), [currentSearch, pathname, visibleGroups]);
  const roleLabel = admin.isSuper ? "Super User" : admin.isAdmin ? "Club Administrator" : "Player";

  useEffect(() => {
    const timer = window.setTimeout(() => setMobileOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname, currentSearch]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  const registerNavigationGuard = useCallback((guardEnabled: boolean, message: string) => {
    setGuard({ enabled: guardEnabled, message });
    return () => setGuard((current) => current.message === message ? { ...current, enabled: false } : current);
  }, []);

  const completeNavigation = useCallback((action: { type: "href"; href: string } | { type: "back" }) => {
    setMobileOpen(false);
    if (action.type === "back") router.back();
    else router.push(action.href);
  }, [router]);

  const requestNavigation = useCallback((href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
    if (guard.enabled) {
      event.preventDefault();
      setPendingAction({ type: "href", href });
      return;
    }
    setMobileOpen(false);
  }, [guard.enabled]);

  const requestBack = useCallback(() => {
    if (guard.enabled) setPendingAction({ type: "back" });
    else router.back();
  }, [guard.enabled, router]);

  const onSignOut = useCallback(async () => {
    if (typeof window !== "undefined" && admin.userId) {
      const prefix = `profile_photo_prompt_seen_${admin.userId}_`;
      for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith(prefix)) window.sessionStorage.removeItem(key);
      }
    }
    await logAudit("auth_sign_out", { entityType: "auth", summary: "User signed out.", meta: { path: pathname || "/" } });
    if (supabase) await supabase.auth.signOut();
    router.replace("/auth/sign-in");
  }, [admin.userId, pathname, router]);

  const contextValue = useMemo(() => ({ enabled, openNavigation: () => setMobileOpen(true), registerNavigationGuard }), [enabled, registerNavigationGuard]);

  if (!enabled) return <AppShellContextProvider value={contextValue}>{children}</AppShellContextProvider>;

  const navigationProps = { groups: visibleGroups, pathname, currentSearch, roleLabel, mode: effectiveMode, canManage, onModeChange: setMode, onNavigate: requestNavigation, onSignOut: () => void onSignOut() };

  return (
    <AppShellContextProvider value={contextValue}>
      <div className="rf-app-shell min-h-screen bg-[var(--rf-canvas)]">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-800 lg:block"><NavigationContent {...navigationProps} /></aside>
        <div className="min-h-screen lg:pl-72">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 shadow-sm backdrop-blur sm:px-5">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 lg:hidden" aria-label="Open navigation">☰</button>
            <button type="button" onClick={requestBack} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50" aria-label="Go back">←</button>
            <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-teal-700">Home / {details.group}</p><p className="truncate text-sm font-black text-slate-950 sm:text-base">{details.label}</p></div>
            {canManage ? <div className="hidden rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex"><button type="button" onClick={() => setMode("player")} className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${effectiveMode === "player" ? "bg-cyan-200 text-slate-950" : "text-slate-500"}`}>Player</button><button type="button" onClick={() => setMode("manage")} className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${effectiveMode === "manage" ? "bg-amber-200 text-slate-950" : "text-slate-500"}`}>Manage</button></div> : null}
            <Link href="/notifications" onClick={(event) => requestNavigation("/notifications", event)} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-sm hover:border-teal-300 hover:bg-teal-50" aria-label="Notifications">🔔</Link>
            <div className="hidden text-right md:block"><p className="text-xs font-bold text-slate-900">{roleLabel}</p><p className="text-[11px] capitalize text-slate-500">{effectiveMode} view</p></div>
          </header>
          <div>{children}</div>
        </div>

        {mobileOpen ? <div className="fixed inset-0 z-[80] bg-[#0b1730] lg:hidden" role="dialog" aria-modal="true" aria-label="Rack & Frame navigation"><button type="button" onClick={() => setMobileOpen(false)} className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-lg border border-white/20 bg-white/10 text-xl text-white" aria-label="Close navigation">×</button><NavigationContent {...navigationProps} /></div> : null}

        <ConfirmModal open={Boolean(pendingAction)} title="Unsaved changes" description={guard.message} confirmLabel="Leave screen" cancelLabel="Stay" onConfirm={() => { if (pendingAction) completeNavigation(pendingAction); setPendingAction(null); }} onCancel={() => setPendingAction(null)} />
      </div>
    </AppShellContextProvider>
  );
}
