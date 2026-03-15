"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import useAdminStatus from "@/components/useAdminStatus";
import ScreenHeader from "@/components/ScreenHeader";

type GuideFilter = "getting_started" | "matches" | "competitions" | "stats_rules" | "rankings" | "premium" | "approvals";
type GuideRole = "player" | "admin";

const guideSections: Record<GuideRole, Record<GuideFilter, { title: string; bullets: string[] }>> = {
  player: {
    getting_started: {
      title: "Getting Started (Player)",
      bullets: [
        "Sign in and complete profile check: first name, second name, age band, and location.",
        "Your account must be linked to a player profile before match play is enabled.",
        "If your profile is not linked yet, request linking from the Players screen.",
      ],
    },
    matches: {
      title: "Quick Match & Submission (Player)",
      bullets: [
        "Create Quick Match in snooker, 8-ball pool, or 9-ball pool and ensure you are one of the selected players.",
        "Submit final score for approval instead of editing frame-by-frame live scoring.",
        "Break & Run and Run Out submission is available; totals are validated against match length.",
      ],
    },
    competitions: {
      title: "Competitions (Player)",
      bullets: [
        "Players can enter events, follow fixtures, and track results from the Events board.",
        "Competition creation is reserved for Club Admin and Super User accounts.",
        "Competition Sign-ups lets players join open events and track entry status.",
        "You can open events and view fixtures/brackets for assigned matches.",
      ],
    },
    stats_rules: {
      title: "Stats & Rules (Player)",
      bullets: [
        "Stats are based on approved completed matches only (not in-progress).",
        "Rules page includes pool/snooker quick reference and dispute wizard.",
        "Under-18 accounts have safety controls applied (restricted identity/display/media rules).",
      ],
    },
    rankings: {
      title: "Player Ratings & Rankings (Player)",
      bullets: [
        "Each completed approved match updates player ratings using an Elo-style calculation.",
        "Expected result is calculated from both players' current rating; larger upsets produce larger gains/losses.",
        "K-factor scales by experience (fewer rated matches = faster movement, more matches = steadier movement).",
        "Player Profile shows current rating, peak rating, rated-match count, and rank for Pool and Snooker.",
        "Use Pop-out Ranking Card on Player Profile to show a clean ranking card on a second screen.",
      ],
    },
    approvals: {
      title: "Result Approvals (Player)",
      bullets: [
        "Track submitted results in Results Queue and Notifications.",
        "Approve/reject is admin-only; players can view status updates.",
        "Approved submissions update event progress and stats automatically.",
      ],
    },
    premium: {
      title: "Premium Features",
      bullets: [
        "Premium is requested from your profile and approved by the Super User.",
        "New accounts can receive a 14-day premium trial period (where enabled) to test advanced features.",
        "Premium unlocks: full Stats, Live Overview, doubles, larger competitions, advanced round lengths, and auto-breaker.",
        "Free access remains: Quick Match and small singles knockout competitions.",
      ],
    },
  },
  admin: {
    getting_started: {
      title: "Getting Started (Club Admin)",
      bullets: [
        "Register players with mandatory first name, second name, age band, and location.",
        "Club Admin can run events, approve results, and manage day-to-day match operations.",
        "Super User has additional governance controls (roles, premium approvals, user linking, location management).",
      ],
    },
    matches: {
      title: "Match Flow (Admin)",
      bullets: [
        "Open matches to record rack/frame scoring live.",
        "Complete a match once a player reaches the required racks/frames.",
        "Walkovers and BYEs do not count toward player stats.",
      ],
    },
    competitions: {
      title: "Competitions (Club Admin)",
      bullets: [
        "Knockout supports uneven entries with BYEs and auto-advance.",
        "Competition setup supports snooker, 8-ball pool, and 9-ball pool.",
        "Fixture List and Bracket views both stay available for event tracking.",
        "Competition Sign-ups can be opened per event, with admin approve/reject workflow.",
        "Round-specific best-of settings and advanced setup are Premium features.",
      ],
    },
    stats_rules: {
      title: "Stats & Rules (Admin)",
      bullets: [
        "Stats include Table, Head-to-Head, and Predictor views.",
        "Only completed approved matches are counted in stats.",
        "Rules and dispute wizard are available for in-match decisions.",
      ],
    },
    rankings: {
      title: "Player Ratings & Rankings (Admin)",
      bullets: [
        "Ratings are applied once per approved completed match and stored against each player profile.",
        "BYE and walkover outcomes are excluded from rating movement.",
        "Player Profile displays both sport ratings (Pool/Snooker), rank position, peak rating, and rated-match totals.",
        "Pop-out Ranking Card is available from Player Profile for TV/external display use.",
      ],
    },
    approvals: {
      title: "Approvals (Club Admin)",
      bullets: [
        "Review pending result submissions in Results Queue.",
        "Approve applies score/stats progression; reject returns outcome as not accepted.",
        "If no Club Admin exists for a location, approvals that need an admin can be escalated to the Super User.",
        "Role or premium request approvals are Super User actions.",
      ],
    },
    premium: {
      title: "Premium Features (Admin View)",
      bullets: [
        "Administrators can use Premium features only when premium is enabled for their account.",
        "Trial and premium-access state is governed centrally and can be reviewed by Super User.",
        "Super User can approve premium requests and enable premium globally or per user.",
        "Super User account is always fully unlocked.",
      ],
    },
  },
};

const roleSummary: Record<GuideRole, string[]> = {
  player: [
    "Can create and submit Quick Match results (must be a selected player).",
    "Cannot create competitions, but can use Competition Sign-ups, view events, check results, and open their ranking card.",
    "Can play snooker, 8-ball pool, and 9-ball pool through Quick Match.",
  ],
  admin: [
    "Can run day-to-day event operations, create competitions, and approve match/result activity for their club.",
    "Cannot perform Super User-only governance actions unless account role is Super User.",
    "Super User controls roles, premium approvals, account linking, locations, and governance.",
  ],
};

export default function HelpPage() {
  const admin = useAdminStatus();
  const [role, setRole] = useState<GuideRole>("player");
  const [filter, setFilter] = useState<GuideFilter>("getting_started");
  const [tipResetMessage, setTipResetMessage] = useState<string | null>(null);
  const selectedRole: GuideRole = admin.isAdmin ? role : "player";
  const section = useMemo(() => guideSections[selectedRole][filter], [filter, selectedRole]);
  const cardBaseClass = "rounded-3xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm";
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillActiveClass = `${pillBaseClass} border-teal-700 bg-teal-700 text-white`;
  const pillInactiveClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const buttonSecondaryClass = "rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50";
  const buttonPrimaryClass = "inline-flex items-center rounded-full border border-teal-700 bg-teal-700 px-3 py-1 text-sm font-medium text-white transition hover:bg-teal-800";

  const onResetProfileSetupTip = () => {
    if (typeof window === "undefined") return;
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("profile_onboarding_prompt_seen_")) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((k) => window.localStorage.removeItem(k));
    setTipResetMessage("Profile setup tip reset. It will show again on Dashboard after your next sign-in.");
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <ScreenHeader title="Help & User Guide" eyebrow="Guide" subtitle="How to use Rack & Frame for quick matches, club competitions, player profiles, and results." />

          <section className="rounded-3xl border border-slate-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-800">
                  Guide
                </span>
                <p className="max-w-2xl text-slate-700">
                  Step-by-step guidance for players, club admins, and the Super User running Rack &amp; Frame in day-to-day club use.
                </p>
              </div>
              <div className="grid min-w-[220px] flex-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Role</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{selectedRole === "player" ? "Player" : "Club Admin"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Section</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{section.title}</p>
                </div>
                <div className="flex items-center">
                  <Link href="/welcome-tour" className={`${buttonPrimaryClass} w-full justify-center`}>
                    Open Welcome Tour
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className={`${cardBaseClass} space-y-3`}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRole("player")}
                className={selectedRole === "player" ? pillActiveClass : pillInactiveClass}
              >
                Player / User
              </button>
              {admin.isAdmin ? (
                <button
                  type="button"
                  onClick={() => setRole("admin")}
                  className={selectedRole === "admin" ? pillActiveClass : pillInactiveClass}
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
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Profile setup tip</p>
              <p className="mt-1 text-sm text-slate-700">
                If needed, you can show the profile setup prompt again.
              </p>
              <button
                type="button"
                onClick={onResetProfileSetupTip}
                className={`mt-2 ${buttonSecondaryClass}`}
              >
                Show profile setup tip again
              </button>
              {tipResetMessage ? <p className="mt-2 text-xs text-emerald-700">{tipResetMessage}</p> : null}
            </div>
            <select
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              value={filter}
              onChange={(e) => setFilter(e.target.value as GuideFilter)}
            >
              <option value="getting_started">Getting Started</option>
              <option value="matches">Quick Match & Match Flow</option>
              <option value="competitions">Competitions</option>
              <option value="stats_rules">Stats & Rules</option>
              <option value="rankings">Ratings & Rankings</option>
              <option value="approvals">Approvals</option>
              <option value="premium">Premium Features</option>
            </select>
          </section>

          <section id="report-an-issue" className={cardBaseClass}>
            <h2 className="text-xl font-semibold text-slate-900">Report an issue</h2>
            <p className="mt-2 text-slate-700">
              If something is broken or does not look right, send a short description and, if possible, a screenshot to{" "}
              <a href="mailto:rackandframe.app@gmail.com" className="font-medium text-teal-700 underline">
                rackandframe.app@gmail.com
              </a>
              .
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Include what page you were on, what you expected to happen, what happened instead, and whether you were signed in as a player, club admin, or Super User.
            </p>
          </section>

          <section className={cardBaseClass}>
            <h2 className="text-xl font-semibold text-slate-900">Rules and official guidance</h2>
            <p className="mt-2 text-slate-700">
              The Rules page includes quick-reference guidance for snooker, 8-ball pool, and 9-ball pool, plus links to the official governing-body rule websites for formal rulings.
            </p>
            <div className="mt-3">
              <Link href="/rules" className={buttonPrimaryClass}>
                Open Rules
              </Link>
            </div>
          </section>

          <section className={cardBaseClass}>
            <h2 className="text-xl font-semibold text-slate-900">{section.title}</h2>
            <ul className="mt-3 space-y-3 text-slate-700">
              {section.bullets.map((b) => (
                <li key={b} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  {b}
                </li>
              ))}
            </ul>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
