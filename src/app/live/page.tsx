"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import usePremiumStatus from "@/components/usePremiumStatus";
import { supabase } from "@/lib/supabase";
import useAdminStatus from "@/components/useAdminStatus";
import MessageModal from "@/components/MessageModal";

type Competition = {
  id: string;
  name: string;
  competition_format: "knockout" | "league";
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  is_archived: boolean;
  is_completed: boolean;
};

type MatchRow = {
  id: string;
  competition_id: string;
  status: "pending" | "in_progress" | "complete" | "bye";
  updated_at: string | null;
  is_archived?: boolean | null;
};

function relativeTime(fromMs: number, toMs: number): string {
  const diffSec = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export default function LivePage() {
  const premium = usePremiumStatus();
  const admin = useAdminStatus();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshMs, setLastRefreshMs] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const cardBaseClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillSecondaryClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const buttonSecondaryClass = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";

  const load = async () => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }
    if (!admin.loading && !admin.isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const [compRes, matchRes] = await Promise.all([
        client
          .from("competitions")
          .select("id,name,competition_format,sport_type,is_archived,is_completed")
          .order("created_at", { ascending: false }),
        client.from("matches").select("id,competition_id,status,updated_at,is_archived"),
      ]);
      if (compRes.error || !compRes.data) {
        setMessage(compRes.error?.message ?? "Failed to load Live Overview.");
        setLoading(false);
        return;
      }
      if (matchRes.error || !matchRes.data) {
        setMessage(matchRes.error?.message ?? "Failed to load match activity.");
        setLoading(false);
        return;
      }
      setCompetitions((compRes.data ?? []) as Competition[]);
      setMatches((matchRes.data ?? []) as MatchRow[]);
      setLastRefreshMs(Date.now());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Load failed";
      setMessage(`Failed to load Live Overview. ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [admin.loading, admin.isAdmin]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      const initialNow = Date.now();
      setLastRefreshMs(initialNow);
      setNowMs(initialNow);
    }, 0);
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const statsByCompetition = useMemo(() => {
    const map = new Map<string, { total: number; complete: number; inProgress: number; remaining: number; lastUpdated: number | null }>();
    for (const m of matches) {
      if (m.is_archived) continue;
      const row = map.get(m.competition_id) ?? { total: 0, complete: 0, inProgress: 0, remaining: 0, lastUpdated: null };
      row.total += 1;
      if (m.status === "complete" || m.status === "bye") row.complete += 1;
      if (m.status === "in_progress") row.inProgress += 1;
      if (m.updated_at) {
        const ts = Date.parse(m.updated_at);
        if (!Number.isNaN(ts) && (row.lastUpdated === null || ts > row.lastUpdated)) row.lastUpdated = ts;
      }
      row.remaining = Math.max(0, row.total - row.complete);
      map.set(m.competition_id, row);
    }
    return map;
  }, [matches]);

  const liveCompetitions = useMemo(() => {
    return competitions
      .filter((c) => !c.is_archived && !c.is_completed)
      .filter((c) => (statsByCompetition.get(c.id)?.inProgress ?? 0) > 0)
      .filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        const at = statsByCompetition.get(a.id)?.lastUpdated ?? 0;
        const bt = statsByCompetition.get(b.id)?.lastUpdated ?? 0;
        return bt - at;
      });
  }, [competitions, statsByCompetition, search]);

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Live Overview"
            eyebrow="Live"
            subtitle="Current in-progress events and status."
            actions={
              <span className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
                Live {liveCompetitions.length}
              </span>
            }
          />

          {!admin.loading && !admin.isAdmin ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <p className="font-semibold">Live Overview is available to Club Admin accounts only.</p>
              <p className="mt-1">
                This screen is designed for organisers keeping track of active matches and event progress.
              </p>
            </section>
          ) : !premium.loading && !premium.unlocked ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <p className="font-semibold">Live Overview is a Premium feature.</p>
              <p className="mt-1">
                Club Admin access is required first, and Premium then unlocks the live event board for in-progress competitions.
              </p>
              <Link href="/premium" className="mt-3 inline-flex rounded-full border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-900">
                View premium access options
              </Link>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search in-progress events"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                />
                <div className="flex items-center gap-3">
                  <p className="flex-1 text-sm text-slate-600">Updated {relativeTime(lastRefreshMs, nowMs)}</p>
                  <button type="button" onClick={() => load()} className={buttonSecondaryClass}>
                    Refresh
                  </button>
                  <button type="button" onClick={() => setAutoRefresh((v) => !v)} className={autoRefresh ? `${pillBaseClass} border-teal-700 bg-teal-700 text-white` : buttonSecondaryClass}>
                    {autoRefresh ? "Auto On" : "Auto Off"}
                  </button>
                </div>
              </section>

              {loading ? <p className={cardBaseClass}>Loading live events...</p> : null}
              <MessageModal message={message ?? (!supabase ? "Supabase is not configured." : null)} onClose={() => setMessage(null)} />

              <section className="space-y-3">
                {!loading && !liveCompetitions.length ? (
                  <article className={cardBaseClass}>
                    <h2 className="text-xl font-semibold text-slate-900">No live events</h2>
                    <p className="text-sm text-slate-600">Start or resume a match to show it here.</p>
                  </article>
                ) : null}
                {liveCompetitions.map((c) => {
                  const stats = statsByCompetition.get(c.id) ?? { total: 0, complete: 0, inProgress: 0, remaining: 0, lastUpdated: null };
                  return (
                    <Link key={c.id} href={`/competitions/${c.id}`} className={`${cardBaseClass} block hover:border-amber-300`}>
                      <h2 className="text-2xl font-semibold text-slate-900">{c.name}</h2>
                      <div className="mt-2 flex items-center gap-3">
                        <span className={pillSecondaryClass}>In Progress</span>
                        <p className="text-slate-700">
                          {c.competition_format === "knockout" ? "Knockout" : "League"} · {c.sport_type === "pool_8_ball" ? "Pool (8-ball)" : c.sport_type === "pool_9_ball" ? "Pool (9-ball)" : "Snooker"}
                        </p>
                      </div>
                      <p className="mt-2 text-3xl font-semibold text-slate-900">
                        {stats.complete}/{stats.total} complete <span className="text-slate-700 text-2xl">· {stats.remaining} remaining</span>
                      </p>
                      <p className="mt-1 text-slate-600">Tap for details</p>
                    </Link>
                  );
                })}
              </section>
            </>
          )}
        </RequireAuth>
      </div>
    </main>
  );
}
