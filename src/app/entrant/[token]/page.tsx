"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type Fixture = {
  id: string;
  roundNo: number | null;
  matchNo: number | null;
  bestOf: number;
  status: "pending" | "in_progress" | "complete" | "bye";
  scheduledFor: string | null;
  opponent: { name: string; email: string | null; phone: string | null };
  outcome: "won" | "lost" | "void" | null;
  submission: { status: "pending" | "approved" | "rejected"; submittedAt: string; entrantScore: number; opponentScore: number } | null;
  comparison: "waiting" | "agreed" | "disputed" | null;
  opponentSubmission: { entrantScore: number; opponentScore: number } | null;
};

type PortalData = {
  entrant: { name: string };
  competition: { id: string; name: string; venue: string | null; best_of: number };
  fixtures: Fixture[];
};

const londonDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const phoneHref = (value: string) => `tel:${value.replace(/[^\d+]/g, "")}`;
const whatsappHref = (value: string, message: string) => {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

export default function EntrantFixturesPage() {
  const token = String(useParams().token ?? "");
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [opponentScores, setOpponentScores] = useState<Record<string, number>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/public/entrant/${encodeURIComponent(token)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "Your fixtures could not be loaded.");
      return;
    }
    setData(payload as PortalData);
    setError(null);
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const orderedFixtures = useMemo(() => data?.fixtures ?? [], [data]);

  const submitResult = async (fixture: Fixture) => {
    const entrantScore = scores[fixture.id];
    const opponentScore = opponentScores[fixture.id];
    if (!Number.isInteger(entrantScore) || !Number.isInteger(opponentScore)) {
      setNotice("Enter the rack total for both players.");
      return;
    }
    if (entrantScore + opponentScore !== fixture.bestOf) {
      setNotice(`The two scores must total ${fixture.bestOf} racks.`);
      return;
    }
    if (entrantScore === opponentScore) {
      setNotice("The result cannot be a draw.");
      return;
    }
    if (!window.confirm(`Submit ${data?.entrant.name} ${entrantScore}-${opponentScore} ${fixture.opponent.name}?`)) return;
    setSubmittingId(fixture.id);
    setNotice(null);
    const response = await fetch(`/api/public/entrant/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId: fixture.id, entrantScore, opponentScore }),
    });
    const payload = await response.json().catch(() => ({}));
    setSubmittingId(null);
    if (!response.ok) {
      setNotice(payload.error ?? "The result could not be submitted.");
      return;
    }
    setNotice("Result submitted. It will appear in the table after the organiser approves it.");
    await load();
  };

  if (error) return <main className="min-h-screen bg-slate-100 p-5"><div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow"><h1 className="text-2xl font-bold text-slate-950">Private fixture link</h1><p className="mt-3 text-red-700">{error}</p></div></main>;
  if (!data) return <main className="min-h-screen bg-slate-100 p-5"><p className="mx-auto max-w-xl rounded-2xl bg-white p-6 text-slate-600 shadow">Loading your fixtures…</p></main>;

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="rounded-2xl bg-slate-950 p-5 text-white shadow">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-lime-300">My fixtures</p>
          <h1 className="mt-1 text-2xl font-bold">{data.competition.name}</h1>
          <p className="mt-2 text-slate-200">{data.entrant.name}{data.competition.venue ? ` · ${data.competition.venue}` : ""}</p>
        </header>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Keep this link private. It lets you see your fixtures and submit results without creating an app account.
        </div>
        {notice ? <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-medium text-sky-950">{notice}</div> : null}
        {orderedFixtures.length === 0 ? <div className="rounded-2xl bg-white p-5 shadow-sm">Your fixtures have not been published yet. Keep this link and check again after the draw.</div> : null}
        {orderedFixtures.map((fixture) => {
          const chosen = scores[fixture.id];
          const chosenOpponentScore = opponentScores[fixture.id];
          const canSubmit = ["pending", "in_progress"].includes(fixture.status) && fixture.submission?.status !== "pending";
          return (
            <section key={fixture.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Week {fixture.roundNo ?? "–"}{fixture.scheduledFor ? ` · from ${londonDate(fixture.scheduledFor)}` : ""}</p>
                  <h2 className="mt-1 text-xl font-bold text-slate-950">vs {fixture.opponent.name}</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">All {fixture.bestOf} racks count</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {fixture.opponent.phone ? <a href={phoneHref(fixture.opponent.phone)} className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-800">Call {fixture.opponent.phone}</a> : null}
                {fixture.opponent.phone ? <a href={whatsappHref(fixture.opponent.phone, `Hi ${fixture.opponent.name}, it’s ${data.entrant.name} about our ${data.competition.name} fixture.`)} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-700 px-3 py-2 font-medium text-white">WhatsApp</a> : null}
                {fixture.opponent.email ? <a href={`mailto:${fixture.opponent.email}`} className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-800">Email opponent</a> : null}
                {!fixture.opponent.phone && !fixture.opponent.email ? <span className="text-amber-700">Ask the organiser for contact details.</span> : null}
              </div>
              {fixture.outcome ? <p className="mt-4 rounded-lg bg-slate-100 p-3 font-semibold capitalize text-slate-800">Fixture {fixture.outcome}</p> : null}
              {fixture.submission ? (
                <p className={`mt-4 rounded-lg p-3 text-sm font-semibold ${fixture.submission.status === "rejected" ? "bg-red-50 text-red-800" : fixture.submission.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                  Submitted {fixture.submission.entrantScore}–{fixture.submission.opponentScore} · {fixture.submission.status}
                  {fixture.submission.status === "rejected" ? " — enter the corrected result below." : ""}
                </p>
              ) : null}
              {fixture.comparison === "waiting" ? <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm font-medium text-sky-900">Waiting for {fixture.opponent.name} to submit their score.</p> : null}
              {fixture.comparison === "agreed" ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Scores agree. The result is ready for organiser approval.</p> : null}
              {fixture.comparison === "disputed" ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
                  Score discrepancy: you submitted {fixture.submission?.entrantScore}–{fixture.submission?.opponentScore}; your opponent submitted {fixture.opponentSubmission?.entrantScore}–{fixture.opponentSubmission?.opponentScore}. The organiser will review this dispute.
                </p>
              ) : null}
              {canSubmit ? (
                <div className="mt-4 rounded-xl border border-lime-200 bg-lime-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Enter both rack totals</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="text-sm text-slate-700">{data.entrant.name}<select value={chosen ?? ""} onChange={(event) => setScores((current) => ({ ...current, [fixture.id]: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"><option value="" disabled>Racks</option>{Array.from({ length: fixture.bestOf + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    <label className="text-sm text-slate-700">{fixture.opponent.name}<select value={chosenOpponentScore ?? ""} onChange={(event) => setOpponentScores((current) => ({ ...current, [fixture.id]: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"><option value="" disabled>Racks</option>{Array.from({ length: fixture.bestOf + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
                  </div>
                  {Number.isInteger(chosen) && Number.isInteger(chosenOpponentScore) ? <p className="mt-2 text-sm text-slate-700">Result: <strong>{data.entrant.name} {chosen}–{chosenOpponentScore} {fixture.opponent.name}</strong></p> : null}
                  <button type="button" onClick={() => void submitResult(fixture)} disabled={submittingId === fixture.id || !Number.isInteger(chosen) || !Number.isInteger(chosenOpponentScore)} className="mt-3 w-full rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">
                    {submittingId === fixture.id ? "Submitting…" : "Submit result for approval"}
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}
