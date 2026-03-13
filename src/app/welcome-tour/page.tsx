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
      detail: "Enter first name, second name, age band, and location. Profile linking is required before match creation.",
      href: "/auth/sign-in",
      cta: "Open sign in",
    },
    {
      title: "2) Create a Quick Match",
      detail: "Create a singles quick match and ensure you are selected as one of the players.",
      href: "/quick-match",
      cta: "Open Quick Match",
    },
    {
      title: "3) Submit your result",
      detail: "Submit final score (plus optional Break & Run / Run Out counts) for administrator approval.",
      href: "/results",
      cta: "Open My Submissions",
    },
    {
      title: "4) Create a small knockout competition",
      detail: "Free users can create singles knockout competitions up to 4 players.",
      href: "/events/new",
      cta: "Open Create Competition",
    },
    {
      title: "5) Track updates",
      detail: "Use Notifications and Results Queue to monitor approvals and account requests.",
      href: "/notifications",
      cta: "Open Notifications",
    },
  ],
  admin: [
    {
      title: "1) Register players",
      detail: "Add players with mandatory first name, second name, age band, and location.",
      href: "/players",
      cta: "Open Registered Players",
    },
    {
      title: "2) Create events and matches",
      detail: "Run competitions and quick matches for your club operations.",
      href: "/events/new",
      cta: "Open Create Competition",
    },
    {
      title: "3) Record live match scoring",
      detail: "Open matches to capture rack/frame winners and complete matches.",
      href: "/events",
      cta: "Open Events",
    },
    {
      title: "4) Approve results",
      detail: "Review and approve submitted scores so stats update.",
      href: "/results",
      cta: "Open Results Queue",
    },
    {
      title: "5) Manage premium operations",
      detail: "Use premium-enabled features where your account has access.",
      href: "/premium",
      cta: "Open Premium",
    },
    {
      title: "6) Super User governance",
      detail: "Role changes, premium approvals, linking users, and location management are Super User actions.",
      href: "/players",
      cta: "Open governance screen",
    },
  ],
};

const roleSummary: Record<TourRole, string[]> = {
  player: [
    "You can create quick matches and submit results when your profile is linked.",
    "You can create singles knockout competitions up to 4 players on free access.",
    "Premium unlocks advanced competition setup, full stats, live overview, and doubles.",
  ],
  admin: [
    "You can run events, score matches, and approve result submissions.",
    "Super User controls role promotion, premium approvals, account linking, and locations.",
    "Operational notifications appear in your bell/inbox.",
  ],
};

export default function WelcomeTourPage() {
  const admin = useAdminStatus();
  const [role, setRole] = useState<TourRole>("player");
  const selectedRole: TourRole = admin.isAdmin ? role : "player";
  const steps = useMemo(() => stepsByRole[selectedRole], [selectedRole]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Welcome Tour"
            eyebrow="Welcome"
            subtitle="Fast setup path for players and administrators."
          />

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <p className="text-slate-700">
              Fast setup path for Rack &amp; Frame. Choose your role to see the right steps.
            </p>
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
                  Administrator
                </button>
              ) : null}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Role summary</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {roleSummary[selectedRole].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="mt-3">
              <Link href="/help" className="text-sm font-medium text-teal-700 underline">
                Open full User Guide
              </Link>
            </div>
          </section>

          <section className="space-y-3">
            {steps.map((step) => (
              <article key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">{step.title}</h2>
                <p className="mt-1 text-slate-700">{step.detail}</p>
                <Link href={step.href} className="mt-2 inline-block text-sm font-medium text-teal-700 underline">
                  {step.cta}
                </Link>
              </article>
            ))}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
