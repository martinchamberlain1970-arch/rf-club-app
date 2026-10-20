"use client";

import { useMemo, useState } from "react";

export type LeaguePlayerFixture = {
  id: string;
  week: number;
  matchNo: number;
  status: string;
  scheduledFor: string | null;
  player1Id: string | null;
  player2Id: string | null;
  player1: string;
  player2: string;
  score: { player1: number; player2: number; void: boolean } | null;
  isReschedulePlaceholder: boolean;
  rescheduledFrom: string | null;
};

type Props = {
  player: { id: string; name: string };
  competitionName: string;
  fixtures: LeaguePlayerFixture[];
  onClose: () => void;
};

function displayDate(value: string | null) {
  if (!value) return "Date to be arranged";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function LeaguePlayerSummaryModal({ player, competitionName, fixtures, onClose }: Props) {
  const [tab, setTab] = useState<"results" | "fixtures">("results");
  const playerFixtures = useMemo(
    () => fixtures.filter((fixture) => !fixture.isReschedulePlaceholder && (fixture.player1Id === player.id || fixture.player2Id === player.id)),
    [fixtures, player.id]
  );
  const results = useMemo(
    () => playerFixtures.filter((fixture) => fixture.status === "complete" && fixture.score).sort((a, b) => b.week - a.week || b.matchNo - a.matchNo),
    [playerFixtures]
  );
  const upcoming = useMemo(
    () => playerFixtures.filter((fixture) => !["complete", "bye"].includes(fixture.status)).sort((a, b) => a.week - b.week || a.matchNo - b.matchNo),
    [playerFixtures]
  );
  const visible = tab === "results" ? results : upcoming;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="league-player-summary-title" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Player record</p>
            <h2 id="league-player-summary-title" className="mt-1 text-xl font-black">{player.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{competitionName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Close</button>
        </div>

        <div className="grid grid-cols-2 border-b border-slate-200 bg-white p-3">
          <button type="button" onClick={() => setTab("results")} className={`rounded-xl px-3 py-2 text-sm font-bold ${tab === "results" ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Past results ({results.length})</button>
          <button type="button" onClick={() => setTab("fixtures")} className={`rounded-xl px-3 py-2 text-sm font-bold ${tab === "fixtures" ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Future fixtures ({upcoming.length})</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {visible.length ? <div className="space-y-3">{visible.map((fixture) => {
            const playerIsOne = fixture.player1Id === player.id;
            const opponent = playerIsOne ? fixture.player2 : fixture.player1;
            const playerScore = fixture.score ? (playerIsOne ? fixture.score.player1 : fixture.score.player2) : null;
            const opponentScore = fixture.score ? (playerIsOne ? fixture.score.player2 : fixture.score.player1) : null;
            const outcome = fixture.score?.void ? "Void" : playerScore != null && opponentScore != null ? (playerScore > opponentScore ? "Won" : "Lost") : null;
            return <article key={fixture.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Week {fixture.week} · Match {fixture.matchNo}</p>
                  <h3 className="mt-1 font-bold text-slate-950">vs {opponent}</h3>
                  <p className="mt-1 text-sm text-slate-600">{displayDate(fixture.scheduledFor)}</p>
                  {fixture.rescheduledFrom ? <p className="mt-1 text-xs font-semibold text-teal-700">Rescheduled fixture</p> : null}
                </div>
                {fixture.score ? <div className="text-right">
                  <p className="rounded-xl bg-slate-900 px-3 py-2 text-lg font-black text-white">{fixture.score.void ? "VOID" : `${playerScore} – ${opponentScore}`}</p>
                  {outcome ? <p className={`mt-1 text-xs font-bold ${outcome === "Won" ? "text-emerald-700" : outcome === "Lost" ? "text-rose-700" : "text-slate-600"}`}>{outcome}</p> : null}
                </div> : <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{fixture.status === "in_progress" ? "Live" : "To play"}</span>}
              </div>
            </article>;
          })}</div> : <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No {tab === "results" ? "completed results" : "future fixtures"} are currently recorded for this player.</p>}
        </div>
      </div>
    </div>
  );
}
