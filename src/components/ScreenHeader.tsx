"use client";

import type { ReactNode } from "react";
import PageNav from "@/components/PageNav";

type ScreenHeaderProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  warnOnNavigate?: boolean;
  warnMessage?: string;
  actions?: ReactNode;
};

export default function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  warnOnNavigate = false,
  warnMessage,
  actions,
}: ScreenHeaderProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-teal-50 via-slate-50 to-amber-50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{eyebrow}</p> : null}
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-2xl text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {actions}
          <PageNav warnOnNavigate={warnOnNavigate} warnMessage={warnMessage} />
        </div>
      </div>
    </section>
  );
}
