"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppShell } from "@/components/AppShellContext";
import PageNav from "@/components/PageNav";
import useAdminStatus from "@/components/useAdminStatus";

type ScreenHeaderProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  warnOnNavigate?: boolean;
  warnMessage?: string;
  actions?: ReactNode;
};

type RelatedLink = { href: string; label: string; adminOnly?: boolean; superOnly?: boolean };

function linksForPath(pathname: string): RelatedLink[] {
  if (pathname.startsWith("/events") || pathname.startsWith("/competitions") || ["/signups", "/results", "/live", "/weekly-reviews"].includes(pathname)) {
    return [
      { href: "/events", label: "Competitions" },
      { href: "/events/new", label: "Create competition", adminOnly: true },
      { href: "/signups", label: "Entries", adminOnly: true },
      { href: "/results", label: "Results" },
      { href: "/live", label: "Live", adminOnly: true },
    ];
  }
  if (pathname.startsWith("/players") || ["/rankings", "/handicaps", "/high-breaks", "/stats"].includes(pathname)) {
    return [
      { href: "/players", label: "Players", adminOnly: true },
      { href: "/rankings", label: "Rankings" },
      { href: "/handicaps", label: "Handicaps" },
      { href: "/high-breaks", label: "High breaks" },
      { href: "/stats", label: "Statistics", adminOnly: true },
    ];
  }
  if (["/notifications", "/install", "/help", "/rules", "/legal"].includes(pathname)) {
    return [
      { href: "/notifications", label: "Notifications" },
      { href: "/install", label: "Install app" },
      { href: "/help", label: "Help" },
      { href: "/rules", label: "Rules" },
    ];
  }
  return [
    { href: "/my-fixtures", label: "My fixtures" },
    { href: "/events", label: "Competitions" },
    { href: "/table-bookings", label: "Table bookings" },
    { href: "/notifications", label: "Notifications" },
  ];
}

export default function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  warnOnNavigate = false,
  warnMessage,
  actions,
}: ScreenHeaderProps) {
  const pathname = usePathname();
  const admin = useAdminStatus();
  const appShell = useAppShell();
  const relatedLinks = linksForPath(pathname).filter((item) => {
    if (item.superOnly && !admin.isSuper) return false;
    if (item.adminOnly && !(admin.isAdmin || admin.isSuper)) return false;
    return item.href !== pathname;
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,0.08)]">
      <div className="h-1 bg-gradient-to-r from-cyan-400 via-teal-600 to-[#0f1a31]" />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className={`flex min-w-0 items-start ${appShell.enabled ? "" : "gap-3"}`}>
            {!appShell.enabled ? <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#0f1a31] to-teal-800 text-xs font-black tracking-tight text-cyan-300 shadow-sm">R&amp;F</span> : null}
            <div className="min-w-0">
              {!appShell.enabled ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <Link href="/" className="hover:text-teal-700">Home</Link>
                  <span aria-hidden="true">/</span>
                  <span className="uppercase tracking-wide text-teal-700">{eyebrow || "Workspace"}</span>
                </div>
              ) : eyebrow ? <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">{eyebrow}</p> : null}
              <h1 className={`${appShell.enabled ? "mt-1" : "mt-0.5"} text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl`}>{title}</h1>
              {subtitle ? <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
            {actions}
            <PageNav warnOnNavigate={warnOnNavigate} warnMessage={warnMessage} />
          </div>
        </div>
        {!warnOnNavigate ? (
          <div className="mt-4 flex gap-2 overflow-x-auto border-t border-slate-100 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="shrink-0 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Related</span>
            {relatedLinks.map((item) => (
              <Link key={item.href} href={item.href} className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800">
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
