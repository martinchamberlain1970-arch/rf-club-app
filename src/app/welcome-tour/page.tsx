"use client";

import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import { useMemo, useState } from "react";

type TourRole = "player" | "admin";

const stepsByRole: Record<TourRole, { title: string; detail: string; href: string; cta: string }[]> = {
  player: [
    {
      title: "1) Sign in and complete profile check",
      detail: "Sign in, make sure your account is linked to the right player profile, and confirm your club location before you start playing.",
      href: "/auth/sign-in",
      cta: "Open sign in",
    },
    {
      title: "2) Create a Quick Match",
      detail: "Quick Match is the fastest way to start a local singles match and jump straight into scoring.",
      href: "/quick-match",
      cta: "Open Quick Match",
    },
    {
      title: "3) Submit your result",
      detail: "Submit your final result and let the club admin approve it so rankings, results, and event progress stay accurate.",
      href: "/results",
      cta: "Open My Submissions",
    },
    {
      title: "4) Follow events and updates",
      detail: "Use Events, Notifications, and Results to keep track of club competitions, approvals, and account activity.",
      href: "/events",
      cta: "Open Events",
    },
    {
      title: "5) Explore Premium extras",
      detail: "Premium adds doubles, stats, live overview access where relevant, auto breaker, and other advanced features.",
      href: "/premium",
      cta: "Open Premium",
    },
  ],
  admin: [
    {
      title: "1) Check players and account requests",
      detail: "Use Players to manage linked profiles, review child/profile requests, and keep club accounts organised.",
      href: "/players",
      cta: "Open Players",
    },
    {
      title: "2) Create competitions",
      detail: "Club Admin accounts can create and run club competitions, assign locations, and manage fixtures from the Events flow.",
      href: "/events/new",
      cta: "Open Create Competition",
    },
    {
      title: "3) Run quick matches and scoring",
      detail: "Quick Match remains the fastest way to start a local practice or social match and open the scoring screen.",
      href: "/quick-match",
      cta: "Open Quick Match",
    },
    {
      title: "4) Review results and sign-ups",
      detail: "Use Results, Notifications, and Competition Sign-ups to keep scores and event entries moving for your club.",
      href: "/results",
      cta: "Open Results",
    },
    {
      title: "5) Use Premium where enabled",
      detail: "Premium adds the advanced extras on top of your Club Admin role, including doubles, stats, live overview, and enhanced competition tools.",
      href: "/premium",
      cta: "Open Premium",
    },
    {
      title: "6) Leave governance to the Super User",
      detail: "Locations, role changes, premium approvals, audit tools, and wider system controls stay with the Super User account.",
      href: "/help",
      cta: "Open Help",
    },
  ],
};

const roleSummary: Record<TourRole, string[]> = {
  player: [
    "You can create Quick Match entries and follow club activity once your player profile is linked.",
    "Club Admin accounts create competitions and run day-to-day club operations.",
    "Premium adds advanced extras like doubles, stats, live overview access where relevant, and enhanced match tools.",
  ],
  admin: [
    "Club Admin accounts can create competitions, manage player activity, and approve result submissions for their club.",
    "Super User controls role promotion, premium approvals, account linking, locations, and system governance.",
    "Premium adds the advanced extras on top of the Club Admin role rather than replacing it.",
  ],
};

export default function WelcomeTourPage() {
  const admin = useAdminStatus();
  const [role, setRole] = useState<TourRole>("player");
  const selectedRole: TourRole = admin.isAdmin ? role : "player";
  const steps = useMemo(() => stepsByRole[selectedRole], [selectedRole]);
  const heroSummary =
    selectedRole === "player"
      ? "Use this path if you are joining as a player, linking your profile, playing quick matches, and following club activity."
      : "Use this path if you run club activity, create competitions, approve results, and keep player requests moving.";

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Welcome Tour"
            eyebrow="Welcome"
            subtitle="Fast setup path for players and Club Admin accounts on the current stable build."
          />

          <section className="rounded-3xl border border-slate-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-800">
                  Welcome
                </span>
                <p className="max-w-2xl text-slate-700">
                  Fast setup path for the current Rack &amp; Frame club workflow. Choose your role to see the right day-to-day path.
                </p>
                <p className="max-w-2xl text-sm text-slate-600">{heroSummary}</p>
              </div>
              <div className="grid min-w-[220px] flex-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tour role</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{selectedRole === "player" ? "Player" : "Club Admin"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Steps</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{steps.length}</p>
                </div>
                <div className="flex items-center">
                  <Link href="/help" className="inline-flex w-full items-center justify-center rounded-full border border-teal-700 bg-teal-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-800">
                    Open full User Guide
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRole("player")}
                className={`rounded-full border px-3 py-1 text-sm ${selectedRole === "player" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              >
                Player / User
              </button>
              {admin.isAdmin ? (
                <button
                  type="button"
                  onClick={() => setRole("admin")}
                  className={`rounded-full border px-3 py-1 text-sm ${selectedRole === "admin" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  Club Admin
                </button>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Role summary</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {roleSummary[selectedRole].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="space-y-3">
            {steps.map((step) => (
              <article key={step.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-[240px] flex-1">
                    <h2 className="text-xl font-semibold text-slate-900">{step.title}</h2>
                    <p className="mt-2 text-slate-700">{step.detail}</p>
                  </div>
                  <div className="flex items-center">
                    <Link
                      href={step.href}
                      className="inline-flex rounded-full border border-teal-700 bg-teal-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-800"
                    >
                      {step.cta}
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
