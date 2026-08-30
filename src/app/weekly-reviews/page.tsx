"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import type { WeeklyReviewData } from "@/lib/weekly-review";

type Competition = { id: string; name: string; is_archived: boolean; is_completed: boolean };
type Week = { competitionId: string; weekStart: string; total: number; resolved: number };
type Review = { id: string; competition_id: string; week_start: string; status: "draft" | "published"; generated_at: string; published_at: string | null; report_data: WeeklyReviewData };

const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function WeeklyReviewsPage() {
  const admin = useAdminStatus();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const apiRequest = async (method: "GET" | "POST", body?: Record<string, unknown>) => {
    const session = await supabase?.auth.getSession();
    const token = session?.data.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const response = await fetch("/api/admin/weekly-reviews", { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Weekly reviews could not be loaded.");
    return payload;
  };

  const load = async () => {
    try {
      const payload = await apiRequest("GET");
      setCompetitions(payload.competitions ?? []);
      setWeeks(payload.weeks ?? []);
      setReviews(payload.reviews ?? []);
      setCompetitionId((current) => current || payload.competitions?.[0]?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Weekly reviews could not be loaded.");
    }
  };

  useEffect(() => {
    if (admin.loading || !admin.isSuper) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.loading, admin.isSuper]);

  const competitionWeeks = useMemo(() => weeks.filter((week) => week.competitionId === competitionId).sort((a, b) => b.weekStart.localeCompare(a.weekStart)), [competitionId, weeks]);
  useEffect(() => {
    if (!competitionWeeks.length) {
      queueMicrotask(() => setWeekStart(""));
      return;
    }
    if (!competitionWeeks.some((week) => week.weekStart === weekStart)) queueMicrotask(() => setWeekStart(competitionWeeks[0].weekStart));
  }, [competitionWeeks, weekStart]);
  const selectedReview = reviews.find((review) => review.competition_id === competitionId && review.week_start === weekStart) ?? null;
  const selectedWeek = competitionWeeks.find((week) => week.weekStart === weekStart) ?? null;
  const report = selectedReview?.report_data ?? null;
  const publicPath = competitionId && weekStart ? `/review/${competitionId}/${weekStart}` : "";

  const runAction = async (action: "generate" | "publish" | "unpublish") => {
    if (!competitionId || !weekStart) return;
    setBusy(true);
    try {
      await apiRequest("POST", { competitionId, weekStart, action });
      await load();
      setMessage(action === "publish" ? "Weekly review published and ready to share." : action === "unpublish" ? "Weekly review returned to draft." : "Draft weekly review generated. Check it before publishing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Weekly review could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const copyPublicLink = async () => {
    if (!publicPath) return;
    await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
    setMessage("Public weekly review link copied for WhatsApp.");
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Weekly Reviews" eyebrow="League reports" subtitle="Generate, check and publish weekly results and Elo analysis." />
          <MessageModal message={message} onClose={() => setMessage(null)} />
          {!admin.loading && !admin.isSuper ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">Super User access only.</section> : null}
          {admin.isSuper ? <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">Competition
                  <select value={competitionId} onChange={(event) => setCompetitionId(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base">
                    {competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}{competition.is_archived ? " · archived" : ""}</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">Official fixture week
                  <select value={weekStart} onChange={(event) => setWeekStart(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base">
                    {competitionWeeks.map((week) => <option key={week.weekStart} value={week.weekStart}>{formatDate(week.weekStart)} · {week.resolved}/{week.total} resolved</option>)}
                  </select>
                </label>
              </div>
              <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950"><strong>Official-week reporting:</strong> results are included according to the fixture’s scheduled week, not when they were entered. A future fixture played early stays in its future report.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy || !selectedWeek} onClick={() => void runAction("generate")} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">{selectedReview ? "Refresh draft" : "Generate draft"}</button>
                <button type="button" disabled={busy || !selectedReview} onClick={() => void runAction("publish")} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Publish review</button>
                {selectedReview?.status === "published" ? <button type="button" disabled={busy} onClick={() => void runAction("unpublish")} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 disabled:opacity-50">Unpublish</button> : null}
                {selectedReview?.status === "published" ? <button type="button" onClick={() => void copyPublicLink()} className="rounded-xl border border-emerald-300 bg-white px-4 py-2 font-semibold text-emerald-800">Copy WhatsApp link</button> : null}
                {selectedReview?.status === "published" ? <Link href={publicPath} target="_blank" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700">Open public report</Link> : null}
              </div>
              {selectedReview ? <p className="mt-3 text-sm text-slate-600">Status: <strong className={selectedReview.status === "published" ? "text-emerald-700" : "text-amber-700"}>{selectedReview.status}</strong> · Generated {new Date(selectedReview.generated_at).toLocaleString("en-GB")}</p> : null}
            </section>

            {report ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Draft preview</p><h2 className="mt-1 text-2xl font-black text-slate-950">{formatDate(report.weekStart)}–{formatDate(report.weekEnd)}</h2></div><span className={`rounded-full px-3 py-1 text-sm font-bold ${report.allResolved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{report.completedFixtures}/{report.totalFixtures} complete</span></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-100 p-3"><p className="text-xs uppercase text-slate-500">Results</p><p className="text-2xl font-black">{report.results.length}</p></div><div className="rounded-xl bg-slate-100 p-3"><p className="text-xs uppercase text-slate-500">Voids</p><p className="text-2xl font-black">{report.voidFixtures}</p></div><div className="rounded-xl bg-slate-100 p-3"><p className="text-xs uppercase text-slate-500">Outstanding</p><p className="text-2xl font-black">{report.unresolvedFixtures}</p></div></div>
              <div className="mt-4 space-y-2">{report.results.map((result) => <div key={result.matchId} className="rounded-xl border border-slate-200 p-3"><p className="font-bold text-slate-950">{result.player1} {result.score1}–{result.score2} {result.player2}</p><p className="mt-1 text-sm text-slate-600">Expected: {result.expectedFavourite} favourite · {result.expected1Pct}%/{result.expected2Pct}%{result.upset ? " · Upset result" : ""}{result.estimatedExpectation ? " · estimated from available Elo history" : ""}</p></div>)}</div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div><h3 className="font-black text-slate-950">Elo movers</h3><div className="mt-2 space-y-2">{report.eloMovers.map((mover) => <div key={mover.playerId} className="flex justify-between rounded-xl bg-slate-100 px-3 py-2 text-sm"><span className="font-semibold">{mover.playerName}</span><span><strong>{mover.change >= 0 ? "+" : ""}{mover.change}</strong>{mover.currentRating != null ? ` · now ${mover.currentRating}` : ""}</span></div>)}</div></div>
                {(report.eloTop10 ?? []).length ? <div><h3 className="font-black text-slate-950">Current Elo top 10</h3><div className="mt-2 space-y-2">{(report.eloTop10 ?? []).map((player) => <div key={player.playerId} className="flex justify-between rounded-xl bg-slate-100 px-3 py-2 text-sm"><span><strong className="mr-2">{player.position}</strong>{player.playerName}</span><strong>{player.rating}</strong></div>)}</div></div> : null}
              </div>
            </section> : null}
          </> : null}
        </RequireAuth>
      </div>
    </main>
  );
}
