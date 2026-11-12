"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";

type Player = { id: string; display_name: string; full_name: string | null };
type Competition = { id: string; name: string; sport_type: string; is_archived: boolean };
type Match = {
  id: string;
  competition_id: string;
  status: string;
  match_mode: string;
  player1_id: string | null;
  player2_id: string | null;
  updated_at: string;
};
type Frame = {
  match_id: string;
  frame_number: number;
  winner_player_id: string | null;
  break_and_run: boolean;
  run_out_against_break: boolean;
  is_walkover_award: boolean;
};
type Achievement = {
  matchId: string;
  frameNumber: number;
  playerId: string;
  type: "break_and_run" | "run_out_against_break";
  opponent: string;
  competition: string;
  date: string;
};

function displayName(player?: Player) {
  return player?.full_name?.trim() || player?.display_name || "Unknown player";
}

export default function PoolAchievementsPage() {
  const admin = useAdminStatus();
  const [players, setPlayers] = useState<Player[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [competitionFilter, setCompetitionFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [correctionFrame, setCorrectionFrame] = useState("");
  const [correctionType, setCorrectionType] = useState<"break_and_run" | "run_out_against_break">("break_and_run");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      setMessage("Supabase is not configured.");
      return;
    }
    setLoading(true);
    const [playersResult, competitionsResult, matchesResult, framesResult] = await Promise.all([
      client.from("players").select("id,display_name,full_name").order("display_name"),
      client.from("competitions").select("id,name,sport_type,is_archived").order("name"),
      client
        .from("matches")
        .select("id,competition_id,status,match_mode,player1_id,player2_id,updated_at")
        .eq("status", "complete")
        .eq("match_mode", "singles"),
      client
        .from("frames")
        .select("match_id,frame_number,winner_player_id,break_and_run,run_out_against_break,is_walkover_award"),
    ]);
    const error = playersResult.error || competitionsResult.error || matchesResult.error || framesResult.error;
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    setPlayers((playersResult.data ?? []) as Player[]);
    setCompetitions((competitionsResult.data ?? []) as Competition[]);
    setMatches((matchesResult.data ?? []) as Match[]);
    setFrames((framesResult.data ?? []) as Frame[]);
    setMessage(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const playerById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const competitionById = useMemo(() => new Map(competitions.map((competition) => [competition.id, competition])), [competitions]);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const poolCompetitions = useMemo(
    () => competitions.filter((competition) => competition.sport_type.startsWith("pool") && !competition.is_archived),
    [competitions]
  );
  const relevantMatches = useMemo(
    () => matches.filter((match) => {
      const competition = competitionById.get(match.competition_id);
      return Boolean(
        competition &&
          competition.sport_type.startsWith("pool") &&
          (competitionFilter === "all" || match.competition_id === competitionFilter)
      );
    }),
    [competitionById, competitionFilter, matches]
  );
  const relevantMatchIds = useMemo(() => new Set(relevantMatches.map((match) => match.id)), [relevantMatches]);

  const achievements = useMemo(() => {
    const list: Achievement[] = [];
    for (const frame of frames) {
      if (!relevantMatchIds.has(frame.match_id) || !frame.winner_player_id || frame.is_walkover_award) continue;
      const match = matchById.get(frame.match_id);
      if (!match) continue;
      const opponentId = frame.winner_player_id === match.player1_id ? match.player2_id : match.player1_id;
      const base = {
        matchId: match.id,
        frameNumber: frame.frame_number,
        playerId: frame.winner_player_id,
        opponent: displayName(opponentId ? playerById.get(opponentId) : undefined),
        competition: competitionById.get(match.competition_id)?.name ?? "Pool competition",
        date: match.updated_at,
      };
      if (frame.break_and_run) list.push({ ...base, type: "break_and_run" });
      if (frame.run_out_against_break) list.push({ ...base, type: "run_out_against_break" });
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [competitionById, frames, matchById, playerById, relevantMatchIds]);

  const leaderboard = useMemo(() => {
    const rows = new Map<string, { playerId: string; name: string; breakRuns: number; againstBreak: number; achievements: Achievement[] }>();
    for (const match of relevantMatches) {
      for (const playerId of [match.player1_id, match.player2_id]) {
        if (playerId && !rows.has(playerId)) {
          rows.set(playerId, { playerId, name: displayName(playerById.get(playerId)), breakRuns: 0, againstBreak: 0, achievements: [] });
        }
      }
    }
    for (const achievement of achievements) {
      const row = rows.get(achievement.playerId);
      if (!row) continue;
      if (achievement.type === "break_and_run") row.breakRuns += 1;
      else row.againstBreak += 1;
      row.achievements.push(achievement);
    }
    return [...rows.values()].sort(
      (a, b) =>
        b.breakRuns + b.againstBreak - (a.breakRuns + a.againstBreak) ||
        b.breakRuns - a.breakRuns ||
        b.againstBreak - a.againstBreak ||
        a.name.localeCompare(b.name)
    );
  }, [achievements, playerById, relevantMatches]);

  const correctionOptions = useMemo(() => {
    return frames
      .filter((frame) => relevantMatchIds.has(frame.match_id) && frame.winner_player_id && !frame.is_walkover_award)
      .map((frame) => {
        const match = matchById.get(frame.match_id);
        if (!match || !frame.winner_player_id) return null;
        const opponentId = frame.winner_player_id === match.player1_id ? match.player2_id : match.player1_id;
        return {
          value: `${frame.match_id}|${frame.frame_number}`,
          label: `${displayName(playerById.get(frame.winner_player_id))} — rack ${frame.frame_number} vs ${displayName(opponentId ? playerById.get(opponentId) : undefined)} (${new Date(match.updated_at).toLocaleDateString("en-GB")})`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.label ?? "").localeCompare(b?.label ?? "")) as Array<{ value: string; label: string }>;
  }, [frames, matchById, playerById, relevantMatchIds]);

  const saveCorrection = async () => {
    if (!correctionFrame || !supabase) return;
    const [matchId, frameNumberRaw] = correctionFrame.split("|");
    setSaving(true);
    setMessage(null);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      setMessage("Please sign in again.");
      setSaving(false);
      return;
    }
    const response = await fetch("/api/admin/pool-achievements", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchId, frameNumber: Number(frameNumberRaw), achievementType: correctionType }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error ?? "The achievement could not be recorded.");
      setSaving(false);
      return;
    }
    setCorrectionFrame("");
    setMessage("Achievement recorded and the table has been refreshed.");
    await load();
    setSaving(false);
  };

  const totalBreakRuns = achievements.filter((item) => item.type === "break_and_run").length;
  const totalAgainstBreak = achievements.filter((item) => item.type === "run_out_against_break").length;
  const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

  return (
    <RequireAuth>
      <ScreenHeader
        title="Break & Run Table"
        eyebrow="Pool"
        subtitle="League rankings for Break & Run and Run Out Against the Break achievements."
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-10 sm:px-6 lg:px-8">
        {message ? <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">{message}</div> : null}

        <section className={`${cardClass} grid gap-4 md:grid-cols-[1fr_auto] md:items-end`}>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Pool achievement league</h2>
            <p className="mt-1 text-sm text-slate-600">Only played racks from completed pool matches count. Walkovers are excluded.</p>
          </div>
          <label className="block min-w-64 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Competition
            <select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900" value={competitionFilter} onChange={(event) => setCompetitionFilter(event.target.value)}>
              <option value="all">All current pool competitions</option>
              {poolCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
            </select>
          </label>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className={cardClass}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Break & Run</p><p className="mt-2 text-3xl font-bold text-slate-900">{totalBreakRuns}</p></div>
          <div className={cardClass}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Against the Break</p><p className="mt-2 text-3xl font-bold text-slate-900">{totalAgainstBreak}</p></div>
          <div className={cardClass}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total achievements</p><p className="mt-2 text-3xl font-bold text-slate-900">{achievements.length}</p></div>
        </section>

        <section className={cardClass}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-lg font-semibold text-slate-900">League table</h2><p className="mt-1 text-sm text-slate-600">Ranked by combined achievements, then Break & Run count.</p></div>
            <p className="text-sm text-slate-500">{leaderboard.length} players</p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left align-middle">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-3 text-right">Rank</th><th className="px-3 py-3">Player</th><th className="px-3 py-3 text-right">Break & Run</th><th className="px-3 py-3 text-right">Against Break</th><th className="px-3 py-3 text-right">Total</th></tr>
              </thead>
              <tbody>
                {leaderboard.map((row, index) => (
                  <tr key={row.playerId} className="border-t border-slate-100">
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-slate-600">{index + 1}</td>
                    <td className="px-3 py-3 text-sm font-semibold text-slate-900">
                      {row.achievements.length ? (
                        <details><summary className="cursor-pointer list-none text-teal-800 hover:underline">{row.name}</summary><div className="mt-2 space-y-1 text-xs font-normal text-slate-600">{row.achievements.map((item) => <p key={`${item.matchId}-${item.frameNumber}-${item.type}`}>{item.type === "break_and_run" ? "Break & Run" : "Against the Break"} · vs {item.opponent} · {new Date(item.date).toLocaleDateString("en-GB")}</p>)}</div></details>
                      ) : row.name}
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">{row.breakRuns}</td>
                    <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">{row.againstBreak}</td>
                    <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-teal-800">{row.breakRuns + row.againstBreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading ? <p className="p-4 text-sm text-slate-600">Loading table…</p> : null}
            {!loading && !leaderboard.length ? <p className="p-4 text-sm text-slate-600">No completed pool results are available yet.</p> : null}
          </div>
        </section>

        {admin.isSuper ? (
          <section className={`${cardClass} space-y-4`}>
            <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Super User</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Correct an omitted achievement</h2><p className="mt-1 text-sm text-slate-600">Use this only when a played rack was saved without its achievement marker.</p></div>
            <div className="grid gap-3 lg:grid-cols-[1fr_240px_auto] lg:items-end">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winning rack<select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-900" value={correctionFrame} onChange={(event) => setCorrectionFrame(event.target.value)}><option value="">Select a completed rack</option>{correctionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Achievement<select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-900" value={correctionType} onChange={(event) => setCorrectionType(event.target.value as typeof correctionType)}><option value="break_and_run">Break & Run</option><option value="run_out_against_break">Run Out Against the Break</option></select></label>
              <button type="button" onClick={() => void saveCorrection()} disabled={!correctionFrame || saving} className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Recording…" : "Record achievement"}</button>
            </div>
          </section>
        ) : null}
      </div>
    </RequireAuth>
  );
}
