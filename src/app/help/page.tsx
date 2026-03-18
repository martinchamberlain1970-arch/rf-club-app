"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import useAdminStatus from "@/components/useAdminStatus";
import ScreenHeader from "@/components/ScreenHeader";

type GuideFilter = "getting_started" | "matches" | "competitions" | "stats_rules" | "rankings" | "premium" | "approvals";
type GuideRole = "player" | "admin";

const faqs: { question: string; answer: string }[] = [
  {
    question: "How do I join a competition or league?",
    answer:
      "Open the event or the Competition Sign-ups page, sign in with your linked account, and submit your entry. Your status will show as pending until it is approved by the club admin or Super User.",
  },
  {
    question: "Where do I find my weekly league fixtures?",
    answer:
      "Use the My Fixtures tile on the dashboard. It groups your scheduled matches into Last Week, This Week, and Next Week so you can quickly open the right fixture.",
  },
  {
    question: "Can I submit results for someone else's fixture?",
    answer:
      "No. Players can only submit their own live fixture. Other fixtures stay view-only unless you are a Club Admin or Super User with review access.",
  },
  {
    question: "What happens if a weekly league fixture is not played?",
    answer:
      "If the weekly deadline passes and there is no valid result pending approval, the fixture can be voided with no points awarded. A walkover should only be used for a genuine no-show.",
  },
  {
    question: "Can a fixture be rescheduled?",
    answer:
      "Yes, but only by request. A player can request a one-week delay, and the Super User decides whether to approve or reject it. Only one outstanding reschedule is allowed at a time.",
  },
  {
    question: "How do handicapped snooker matches work?",
    answer:
      "If the competition is marked as handicapped, the fixture shows who receives the points start. Enter the final adjusted frame score including that start, not the raw score from scratch.",
  },
  {
    question: "How do snooker Elo and handicap work together?",
    answer:
      "Valid approved snooker singles results update Elo. Handicap is then reviewed from Elo rather than changing after every result. The Super User can also apply or override handicaps where needed.",
  },
  {
    question: "Why is there a maximum 40-point start in handicapped snooker?",
    answer:
      "The live match start is capped at 40 so frames stay competitive and do not feel decided before play begins. Elo still tracks the full strength gap in the background, but the cap keeps the scoreline understandable and the match playable for both sides.",
  },
  {
    question: "What does Premium unlock?",
    answer:
      "Premium adds advanced extras such as doubles support, full stats, live overview access where relevant, auto breaker, and more advanced competition tools. Core player and club features remain available without Premium.",
  },
];

const guideSections: Record<GuideRole, Record<GuideFilter, { title: string; bullets: string[] }>> = {
  player: {
    getting_started: {
      title: "Getting Started (Player)",
      bullets: [
        "Sign in and complete profile check: make sure your account is linked to the right player profile and club location.",
        "Your account must be linked to a player profile before match play is enabled.",
        "If your profile is not linked yet, request linking from the Players screen.",
      ],
    },
    matches: {
      title: "Quick Match & Submission (Player)",
      bullets: [
        "Create Quick Match in snooker, 8-ball pool, or 9-ball pool and ensure you are one of the selected players.",
        "Use My Fixtures to open your league or competition match for Last Week, This Week, or Next Week.",
        "For league fixtures, only your own live weekly fixture is editable. Other fixtures stay view-only.",
        "If a snooker competition is handicapped, enter the final adjusted frame score including the handicap start.",
        "Break & Run and Run Out submission is available; totals are validated against match length.",
      ],
    },
    competitions: {
      title: "Competitions (Player)",
      bullets: [
        "Players can enter events, follow fixtures, and track results from the Events board.",
        "Competition creation is reserved for Club Admin and Super User accounts.",
        "Competition Sign-ups lets players join open events and track entry status.",
        "Club leagues can be created for snooker or pool, with weekly fixtures generated from the approved field.",
        "League fixtures are expected to be played by the listed Sunday 21:00 deadline unless a reschedule is approved.",
        "You can request a one-week reschedule for your own fixture, but only the Super User can approve it.",
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
        "Snooker handicap is reviewed from Elo rather than changed after every result, with current and baseline handicap shown on the player profile.",
        "The live start in handicapped snooker is capped at 40, even if the reviewed handicap gap is larger, so fixtures stay competitive while Elo still reflects the full rating spread.",
        "BYE, walkover, void, and doubles outcomes are excluded from rating and handicap review.",
        "Player Profile shows current rating, peak rating, rated-match count, current handicap, baseline handicap, and rank for Pool and Snooker.",
        "Use Pop-out Ranking Card on Player Profile to show a clean ranking card on a second screen.",
      ],
    },
    approvals: {
      title: "Result Approvals (Player)",
      bullets: [
        "Track submitted results in Results Queue and Notifications.",
        "A submitted fixture locks while it waits for approval, then changes to approved once accepted.",
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
        "Register or link players, keeping profiles tied to the correct club location.",
        "Club Admin can run events, approve results, and manage day-to-day match operations.",
        "Super User has additional governance controls (roles, premium approvals, user linking, location management).",
      ],
    },
    matches: {
      title: "Match Flow (Admin)",
      bullets: [
        "Open matches to record rack/frame scoring live.",
        "Complete a match once a player reaches the required racks/frames.",
        "League fixtures open weekly and are intended to be played by the listed Sunday 21:00 deadline.",
        "If a fixture is not played and no valid result is pending approval, it can be voided with no points awarded.",
        "Walkovers and BYEs do not count toward player stats.",
      ],
    },
    competitions: {
      title: "Competitions (Club Admin)",
      bullets: [
        "Knockout supports uneven entries with BYEs and auto-advance.",
        "Competition setup supports snooker, 8-ball pool, and 9-ball pool in knockout and club league formats.",
        "Fixture List and Bracket views both stay available for event tracking.",
        "Competition Sign-ups can be opened per event, with admin approve/reject workflow.",
        "Club leagues can generate weekly fixtures with players meeting each other 1 to 4 times.",
        "Snooker competitions and leagues can be marked as handicapped where required.",
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
        "Super User can reopen, void, or override fixtures where needed.",
        "If no Club Admin exists for a location, approvals that need an admin can be escalated to the Super User.",
        "Role changes, premium approvals, handicap exceptions, and league reschedule approvals are Super User actions.",
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
    "Cannot create competitions, but can use Competition Sign-ups, view events, check results, open My Fixtures, and open their ranking card.",
    "Can play snooker, 8-ball pool, and 9-ball pool through Quick Match.",
  ],
  admin: [
    "Can run day-to-day event operations, create competitions, and approve match/result activity for their club.",
    "Can create knockout and club league competitions for their club.",
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
          <ScreenHeader title="Help & User Guide" eyebrow="Guide" subtitle="How to use Rack & Frame for quick matches, club competitions, club leagues, player profiles, and results." />

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

          <section className={cardBaseClass}>
            <h2 className="text-xl font-semibold text-slate-900">Frequently Asked Questions</h2>
            <div className="mt-3 space-y-3">
              {faqs.map((item) => (
                <article key={item.question} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-900">{item.question}</h3>
                  <p className="mt-2 text-sm text-slate-700">{item.answer}</p>
                </article>
              ))}
            </div>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
