"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Match = {
  id: string;
  competition_id: string;
  round_no: number | null;
  match_no: number | null;
  best_of: number;
  status: "pending" | "in_progress" | "complete" | "bye";
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  winner_player_id: string | null;
  opening_break_player_id: string | null;
};

type Player = { id: string; display_name: string; full_name: string | null; avatar_url?: string | null };
type Competition = { id: string; name: string; sport_type: "snooker" | "pool_8_ball" | "pool_9_ball"; competition_format: "knockout" | "league" };
type FrameRow = {
  frame_number: number;
  winner_player_id: string | null;
  is_walkover_award: boolean;
};

function getTeamInfo(match: Match, names: Map<string, string>) {
  const isByeSingles = match.match_mode === "singles" && match.status === "bye" && match.player1_id && match.player1_id === match.player2_id;
  if (isByeSingles) {
    const a = names.get(match.player1_id ?? "") ?? "TBC";
    return {
      team1Label: a,
      team2Label: "BYE",
      team1Rep: match.player1_id,
      team2Rep: null,
    };
  }
  if (match.match_mode === "doubles") {
    const a = names.get(match.team1_player1_id ?? "") ?? "TBC";
    const b = names.get(match.team1_player2_id ?? "") ?? "TBC";
    const c = names.get(match.team2_player1_id ?? "") ?? "TBC";
    const d = names.get(match.team2_player2_id ?? "") ?? "TBC";
    return {
      team1Label: `${a} & ${b}`,
      team2Label: `${c} & ${d}`,
      team1Rep: match.team1_player1_id,
      team2Rep: match.team2_player1_id,
    };
  }
  return {
    team1Label: names.get(match.player1_id ?? "") ?? "TBC",
    team2Label: names.get(match.player2_id ?? "") ?? "TBC",
    team1Rep: match.player1_id,
    team2Rep: match.player2_id,
  };
}

export default function QuickDisplayPage() {
  const params = useParams();
  const matchId = String(params.id ?? "");
  const [match, setMatch] = useState<Match | null>(null);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [frames, setFrames] = useState<FrameRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tvMode, setTvMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const refresh = async () => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const mRes = await client
      .from("matches")
      .select("id,competition_id,round_no,match_no,best_of,status,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id")
      .eq("id", matchId)
      .single();
    if (mRes.error || !mRes.data) {
      setMessage(mRes.error?.message ?? "Failed to load match.");
      setLoading(false);
      return;
    }
    const loadedMatch = mRes.data as Match;
    setMatch(loadedMatch);

    const [pRes, cRes, fRes] = await Promise.all([
      client.from("players").select("id,display_name,full_name,avatar_url"),
      client.from("competitions").select("id,name,sport_type,competition_format").eq("id", loadedMatch.competition_id).single(),
      client
        .from("frames")
        .select("frame_number,winner_player_id,is_walkover_award")
        .eq("match_id", matchId)
        .order("frame_number", { ascending: true }),
    ]);
    if (pRes.data) setPlayers(pRes.data as Player[]);
    if (cRes.data) setCompetition(cRes.data as Competition);
    if (fRes.data) setFrames(fRes.data as FrameRow[]);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await refresh();
    };
    run();

    const client = supabase;
    if (!client) return () => {
      active = false;
    };

    const channel = client
      .channel(`display-match-${matchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "frames", filter: `match_id=eq.${matchId}` },
        () => {
          run();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => {
          run();
        }
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [matchId]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      await document.exitFullscreen().catch(() => undefined);
    }
  };

  const names = useMemo(
    () => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])),
    [players]
  );
  const avatarMap = useMemo(() => new Map(players.map((p) => [p.id, p.avatar_url ?? null])), [players]);
  const teams = match ? getTeamInfo(match, names) : null;
  const dueToBreakName = useMemo(() => {
    if (!match?.opening_break_player_id || !teams) return null;
    const opener = match.opening_break_player_id;
    const openerName = names.get(opener) ?? null;
    if (!openerName) return null;
    if (!teams.team1Rep || !teams.team2Rep) return openerName;
    const racksPlayed = frames.filter((f) => f.winner_player_id).length;
    const shouldSwap = racksPlayed % 2 === 1;
    if (!shouldSwap) return openerName;
    const nextId = opener === teams.team1Rep ? teams.team2Rep : teams.team1Rep;
    return names.get(nextId) ?? openerName;
  }, [match?.opening_break_player_id, teams, names, frames]);

  const winnerName = match?.winner_player_id && teams ? (names.get(match.winner_player_id) ?? null) : null;
  const score = useMemo(() => {
    if (!match || !teams) return { team1: 0, team2: 0 };
    const relevant = frames.filter((f) => !f.is_walkover_award);
    let team1 = 0;
    let team2 = 0;
    for (const f of relevant) {
      if (f.winner_player_id === teams.team1Rep) team1 += 1;
      if (f.winner_player_id === teams.team2Rep) team2 += 1;
    }
    return { team1, team2 };
  }, [frames, match, teams]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className={`mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 ${tvMode ? "max-w-6xl" : ""}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-slate-400">Live Match</p>
              <h1 className="text-3xl font-semibold">
                {competition?.name ?? "Quick Match"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setTvMode((v) => !v)} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                {tvMode ? "Standard View" : "TV Mode"}
              </button>
              <button type="button" onClick={toggleFullscreen} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <button type="button" onClick={refresh} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                Refresh
              </button>
              <button type="button" onClick={() => window.close()} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                Close
              </button>
            </div>
          </div>

          {loading ? (
            <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-slate-200">Loading match...</p>
          ) : null}
          {message ? (
            <p className="rounded-xl border border-amber-400/60 bg-amber-500/20 p-4 text-amber-100">{message}</p>
          ) : null}

          {match && teams ? (
            <section className={`rounded-3xl border border-slate-800 bg-slate-900/60 p-6 ${tvMode ? "p-10" : ""}`}>
              {!tvMode ? (
                <p className="text-sm text-slate-400">
                  Round {match.round_no ?? 1} · Match {match.match_no ?? 1} · {competition?.competition_format ?? "quick"}
                </p>
              ) : null}
              <p className={`mt-2 text-slate-200 ${tvMode ? "text-2xl" : "text-lg"}`}>
                Best of {match.best_of} {competition?.sport_type === "snooker" ? "frames" : "racks"}
              </p>
              {winnerName ? (
                <p className={`mt-2 font-semibold text-emerald-300 ${tvMode ? "text-2xl" : "text-lg"}`}>
                  Winner: {winnerName}
                </p>
              ) : dueToBreakName ? (
                <p className={`mt-2 text-slate-300 ${tvMode ? "text-xl" : "text-base"}`}>
                  Due to break: {dueToBreakName}
                </p>
              ) : null}
              <div className={`mt-6 grid items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/40 ${tvMode ? "p-10" : "p-6"} sm:grid-cols-[1fr_auto_1fr]`}>
                <div className={`${tvMode ? "text-5xl" : "text-4xl"} font-semibold flex items-center gap-3`}>
                  {teams.team1Rep && avatarMap.get(teams.team1Rep) ? (
                    <img src={avatarMap.get(teams.team1Rep) ?? ""} alt={teams.team1Label} className="h-10 w-10 rounded-full object-cover" />
                  ) : null}
                  <span>{teams.team1Label}</span>
                </div>
                <div className={`${tvMode ? "text-6xl" : "text-5xl"} font-bold text-emerald-300`}>
                  {score.team1} - {score.team2}
                </div>
                <div className={`${tvMode ? "text-5xl" : "text-4xl"} font-semibold text-right flex items-center justify-end gap-3`}>
                  <span>{teams.team2Label}</span>
                  {teams.team2Rep && avatarMap.get(teams.team2Rep) ? (
                    <img src={avatarMap.get(teams.team2Rep) ?? ""} alt={teams.team2Label} className="h-10 w-10 rounded-full object-cover" />
                  ) : null}
                </div>
              </div>
              {!tvMode ? (
                <p className="mt-3 text-sm text-slate-400">
                  Status: {match.status === "bye" ? "Locked" : match.status.replace("_", " ")}
                </p>
              ) : null}
            </section>
          ) : null}
      </div>
    </main>
  );
}
