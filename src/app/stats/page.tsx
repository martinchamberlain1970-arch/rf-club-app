"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import usePremiumStatus from "@/components/usePremiumStatus";
import { supabase } from "@/lib/supabase";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import MessageModal from "@/components/MessageModal";

type FormatFilter = "all" | "knockout";
type SportFilter = "all" | "pool_8_ball" | "pool_9_ball" | "snooker";
type ModeFilter = "singles" | "doubles";
type ViewFilter = "table" | "head_to_head" | "predictor";

type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  age_band?: string | null;
  location_id?: string | null;
  rating_pool?: number | null;
  rating_snooker?: number | null;
};
type Location = { id: string; name: string };
type Competition = {
  id: string;
  competition_format: "knockout" | "league";
  sport_type: "pool_8_ball" | "pool_9_ball" | "snooker";
};
type Match = {
  id: string;
  competition_id: string;
  status: "pending" | "in_progress" | "complete" | "bye";
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  winner_player_id: string | null;
  updated_at: string | null;
};
type Frame = {
  match_id: string;
  winner_player_id: string | null;
  is_walkover_award: boolean;
  team1_points: number;
  team2_points: number;
  breaks_over_30_team1_values: number[] | null;
  breaks_over_30_team2_values: number[] | null;
  breaks_over_30_team1: number;
  breaks_over_30_team2: number;
  high_break_team1: number;
  high_break_team2: number;
};
type Row = {
  id: string;
  label: string;
  rating?: number;
  rank?: number;
  played: number;
  won: number;
  lost: number;
  framesFor: number;
  framesAgainst: number;
  pointsFor?: number;
  pointsAgainst?: number;
  avgPoints?: number;
  highBreak?: number;
  centuryBreaks?: number;
  breaksOver30?: number;
};
type H2hRow = {
  id: string;
  leftId: string;
  rightId: string;
  leftLabel: string;
  rightLabel: string;
  played: number;
  leftWins: number;
  rightWins: number;
  frameDiff: number;
};
type PredictorSummary = {
  blocked: boolean;
  title: string;
  chance?: number;
  confidence?: "Low" | "Medium" | "High";
  lines: string[];
};

function pct(won: number, played: number): number {
  if (!played) return 0;
  return Math.round((won / played) * 100);
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("|");
}

function sortByRecent(a: Match, b: Match): number {
  const av = a.updated_at ? Date.parse(a.updated_at) : 0;
  const bv = b.updated_at ? Date.parse(b.updated_at) : 0;
  return bv - av;
}

function confidenceFrom(gap: number, sample: number): "Low" | "Medium" | "High" {
  if (sample >= 16 && gap >= 14) return "High";
  if (sample >= 8 && gap >= 8) return "Medium";
  return "Low";
}

function breakValues(values: number[] | null | undefined): number[] {
  return (values ?? []).filter((v) => Number.isFinite(v) && v > 30);
}

export default function StatsPage() {
  const premium = usePremiumStatus();
  const admin = useAdminStatus();
  const [players, setPlayers] = useState<Player[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [viewerPlayerId, setViewerPlayerId] = useState<string | null>(null);
  const [viewerIsMinor, setViewerIsMinor] = useState(false);

  const [format, setFormat] = useState<FormatFilter>("all");
  const [sport, setSport] = useState<SportFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("singles");
  const [view, setView] = useState<ViewFilter>("table");
  const [locationFilter, setLocationFilter] = useState<string>("all");

  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [team1Player1, setTeam1Player1] = useState("");
  const [team1Player2, setTeam1Player2] = useState("");
  const [team2Player1, setTeam2Player1] = useState("");
  const [team2Player2, setTeam2Player2] = useState("");
  const [h2hPlayerA, setH2hPlayerA] = useState("");
  const [h2hPlayerB, setH2hPlayerB] = useState("");
  const [h2hTeamA, setH2hTeamA] = useState("");
  const [h2hTeamB, setH2hTeamB] = useState("");

  const h2hHasSelection =
    mode === "singles"
      ? Boolean(h2hPlayerA && h2hPlayerB && h2hPlayerA !== h2hPlayerB)
      : Boolean(h2hTeamA && h2hTeamB && h2hTeamA !== h2hTeamB);

  const h2hEmptyMessage = h2hHasSelection ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
      <p className="font-semibold">No head-to-head data available for this matchup.</p>
      <p className="mt-1">
        There are currently no completed results between these two sides under the selected filters (format, sport, and mode).
        Try broadening filters to <strong>All formats</strong> or switching sport/mode to view any existing history.
      </p>
      <p className="mt-1">
        Once they play each other, this section will show record, frame difference, recent meetings, and whether outcomes aligned with the predictor.
      </p>
    </div>
  ) : (
    <p className="text-slate-600">
      Select both sides to load head-to-head details, including record, recent meetings, and predictor alignment.
    </p>
  );

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const run = async () => {
      const authRes = await client.auth.getUser();
      const userId = authRes.data.user?.id ?? null;
      let linkedPlayerId: string | null = null;
      if (userId) {
        const linkRes = await client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle();
        linkedPlayerId = linkRes.data?.linked_player_id ?? null;
      }
      const [pRes, cRes, mRes, fRes, lRes] = await Promise.all([
        client
          .from("players")
          .select("id,display_name,full_name,age_band,location_id,rating_pool,rating_snooker")
          .eq("is_archived", false)
          .order("display_name"),
        client.from("competitions").select("id,competition_format,sport_type"),
        client
          .from("matches")
          .select(
            "id,competition_id,status,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,updated_at"
          )
          .eq("status", "complete"),
        client
          .from("frames")
          .select(
            "match_id,winner_player_id,is_walkover_award,team1_points,team2_points,breaks_over_30_team1_values,breaks_over_30_team2_values,breaks_over_30_team1,breaks_over_30_team2,high_break_team1,high_break_team2"
          ),
        client.from("locations").select("id,name").order("name"),
      ]);
      if (!active) return;
      if (pRes.error || cRes.error || mRes.error || fRes.error || lRes.error) {
        setMessage(
          pRes.error?.message || cRes.error?.message || mRes.error?.message || fRes.error?.message || lRes.error?.message || "Failed to load stats."
        );
        return;
      }
      const loadedPlayers = (pRes.data ?? []) as Player[];
      setLocations((lRes.data ?? []) as Location[]);
      setPlayers(loadedPlayers);
      setCompetitions((cRes.data ?? []) as Competition[]);
      const completedMatches = (mRes.data ?? []) as Match[];
      const completedMatchIds = new Set(completedMatches.map((m) => m.id));
      const completedFrames = (fRes.data ?? []).filter((f: Frame) => completedMatchIds.has(f.match_id)) as Frame[];
      setMatches(completedMatches);
      setFrames(completedFrames);
      setViewerPlayerId(linkedPlayerId);
      const linked = loadedPlayers.find((p) => p.id === linkedPlayerId);
      setViewerIsMinor(Boolean(linked?.age_band && linked.age_band !== "18_plus"));
    };
    run();
    return () => {
      active = false;
    };
  }, [admin.loading, admin.isAdmin]);

  const minorIds = useMemo(() => new Set(players.filter((p) => p.age_band && p.age_band !== "18_plus").map((p) => p.id)), [players]);
  const visiblePlayers = useMemo(() => {
    if (admin.isAdmin) return players;
    if (viewerPlayerId && viewerIsMinor) return players.filter((p) => p.id === viewerPlayerId);
    return players.filter((p) => !minorIds.has(p.id) || p.id === viewerPlayerId);
  }, [players, admin.isAdmin, viewerPlayerId, viewerIsMinor, minorIds]);
  const locationByPlayer = useMemo(() => new Map(players.map((p) => [p.id, p.location_id ?? null])), [players]);
  const activeRatingByPlayer = useMemo(() => {
    const isSnooker = sport === "snooker";
    const map = new Map<string, number>();
    for (const p of players) {
      map.set(p.id, isSnooker ? p.rating_snooker ?? 1000 : p.rating_pool ?? 1000);
    }
    return map;
  }, [players, sport]);
  const locationFilteredPlayers = useMemo(() => {
    if (locationFilter === "all") return visiblePlayers;
    return visiblePlayers.filter((p) => p.location_id === locationFilter);
  }, [visiblePlayers, locationFilter]);
  const playerMap = useMemo(
    () => new Map(visiblePlayers.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])),
    [visiblePlayers]
  );
  const compMap = useMemo(() => new Map(competitions.map((c) => [c.id, c])), [competitions]);

  const framesByMatch = useMemo(() => {
    const map = new Map<string, Frame[]>();
    for (const f of frames) {
      const prev = map.get(f.match_id) ?? [];
      prev.push(f);
      map.set(f.match_id, prev);
    }
    return map;
  }, [frames]);

  function isWalkoverMatch(m: Match) {
    const rows = framesByMatch.get(m.id) ?? [];
    return rows.length > 0 && rows.every((f) => f.is_walkover_award);
  }

  function isCountedMatch(m: Match) {
    return m.status === "complete" && !isWalkoverMatch(m);
  }

  function matchHasPlayer(m: Match, pid: string) {
    return m.match_mode === "singles"
      ? m.player1_id === pid || m.player2_id === pid
      : m.team1_player1_id === pid || m.team1_player2_id === pid || m.team2_player1_id === pid || m.team2_player2_id === pid;
  }

  function matchHasMinor(m: Match) {
    const ids = m.match_mode === "singles"
      ? [m.player1_id, m.player2_id]
      : [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id];
    return ids.some((id) => id && minorIds.has(id));
  }

  const privacyMatches = admin.isAdmin
    ? matches
    : viewerPlayerId && viewerIsMinor
      ? matches.filter((m) => matchHasPlayer(m, viewerPlayerId))
      : matches.filter((m) => !matchHasMinor(m));

  const filteredMatches = privacyMatches.filter((m) => {
    if (!isCountedMatch(m)) return false;
    if (m.match_mode !== mode) return false;
    const c = compMap.get(m.competition_id);
    if (!c) return false;
    if (format !== "all" && c.competition_format !== format) return false;
    if (sport !== "all" && c.sport_type !== sport) return false;
    return true;
  });

  const filteredAllModesMatches = privacyMatches.filter((m) => {
    if (!isCountedMatch(m)) return false;
    const c = compMap.get(m.competition_id);
    if (!c) return false;
    if (format !== "all" && c.competition_format !== format) return false;
    if (sport !== "all" && c.sport_type !== sport) return false;
    return true;
  });

  const individualRows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const m of filteredAllModesMatches) {
      if (m.match_mode === "singles") {
        if (!m.player1_id || !m.player2_id) continue;
        const ids = [m.player1_id, m.player2_id];
        for (const id of ids) {
          if (!map.has(id)) {
            map.set(id, { id, label: playerMap.get(id) ?? "Unknown", played: 0, won: 0, lost: 0, framesFor: 0, framesAgainst: 0 });
          }
        }
        const a = map.get(m.player1_id)!;
        const b = map.get(m.player2_id)!;
        a.played += 1;
        b.played += 1;
        if (m.winner_player_id === m.player1_id) {
          a.won += 1;
          b.lost += 1;
        } else if (m.winner_player_id === m.player2_id) {
          b.won += 1;
          a.lost += 1;
        }
        for (const f of (framesByMatch.get(m.id) ?? []).filter((x) => !x.is_walkover_award)) {
          if (f.winner_player_id === m.player1_id) {
            a.framesFor += 1;
            b.framesAgainst += 1;
          } else if (f.winner_player_id === m.player2_id) {
            b.framesFor += 1;
            a.framesAgainst += 1;
          }
        }
      } else {
        const allIds = [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id].filter(Boolean) as string[];
        if (allIds.length !== 4) continue;
        for (const id of allIds) {
          if (!map.has(id)) {
            map.set(id, { id, label: playerMap.get(id) ?? "Unknown", played: 0, won: 0, lost: 0, framesFor: 0, framesAgainst: 0 });
          }
        }
        const team1 = [m.team1_player1_id!, m.team1_player2_id!];
        const team2 = [m.team2_player1_id!, m.team2_player2_id!];
        for (const id of team1) map.get(id)!.played += 1;
        for (const id of team2) map.get(id)!.played += 1;

        const winnerIsTeam1 = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
        const winnerIsTeam2 = m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id;
        if (winnerIsTeam1) {
          for (const id of team1) map.get(id)!.won += 1;
          for (const id of team2) map.get(id)!.lost += 1;
        } else if (winnerIsTeam2) {
          for (const id of team2) map.get(id)!.won += 1;
          for (const id of team1) map.get(id)!.lost += 1;
        }

        for (const f of (framesByMatch.get(m.id) ?? []).filter((x) => !x.is_walkover_award)) {
          const frameTeam1 = f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id;
          const frameTeam2 = f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id;
          if (frameTeam1) {
            for (const id of team1) map.get(id)!.framesFor += 1;
            for (const id of team2) map.get(id)!.framesAgainst += 1;
          } else if (frameTeam2) {
            for (const id of team2) map.get(id)!.framesFor += 1;
            for (const id of team1) map.get(id)!.framesAgainst += 1;
          }
        }
      }
    }
    return map;
  }, [filteredAllModesMatches, playerMap, framesByMatch]);

  const tableRows = useMemo(() => {
    if (mode === "singles") {
      const map = new Map<string, Row>();
      for (const m of filteredMatches) {
        if (!m.player1_id || !m.player2_id) continue;
        const p1 = m.player1_id;
        const p2 = m.player2_id;
        if (!map.has(p1)) {
          map.set(p1, {
            id: p1,
            label: playerMap.get(p1) ?? "Unknown",
            rating: activeRatingByPlayer.get(p1) ?? 1000,
            played: 0,
            won: 0,
            lost: 0,
            framesFor: 0,
            framesAgainst: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            avgPoints: 0,
            highBreak: 0,
            centuryBreaks: 0,
            breaksOver30: 0,
          });
        }
        if (!map.has(p2)) {
          map.set(p2, {
            id: p2,
            label: playerMap.get(p2) ?? "Unknown",
            rating: activeRatingByPlayer.get(p2) ?? 1000,
            played: 0,
            won: 0,
            lost: 0,
            framesFor: 0,
            framesAgainst: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            avgPoints: 0,
            highBreak: 0,
            centuryBreaks: 0,
            breaksOver30: 0,
          });
        }
        const r1 = map.get(p1)!;
        const r2 = map.get(p2)!;
        r1.played += 1;
        r2.played += 1;
        if (m.winner_player_id === p1) {
          r1.won += 1;
          r2.lost += 1;
        } else if (m.winner_player_id === p2) {
          r2.won += 1;
          r1.lost += 1;
        }
        const ff = (framesByMatch.get(m.id) ?? []).filter((f) => !f.is_walkover_award);
        for (const f of ff) {
          if (f.winner_player_id === p1) {
            r1.framesFor += 1;
            r2.framesAgainst += 1;
          } else if (f.winner_player_id === p2) {
            r2.framesFor += 1;
            r1.framesAgainst += 1;
          }
          if (sport === "snooker") {
            const breaks1 = breakValues(f.breaks_over_30_team1_values);
            const breaks2 = breakValues(f.breaks_over_30_team2_values);
            r1.pointsFor = (r1.pointsFor ?? 0) + (f.team1_points ?? 0);
            r1.pointsAgainst = (r1.pointsAgainst ?? 0) + (f.team2_points ?? 0);
            r2.pointsFor = (r2.pointsFor ?? 0) + (f.team2_points ?? 0);
            r2.pointsAgainst = (r2.pointsAgainst ?? 0) + (f.team1_points ?? 0);
            r1.breaksOver30 = (r1.breaksOver30 ?? 0) + (breaks1.length || f.breaks_over_30_team1 || 0);
            r2.breaksOver30 = (r2.breaksOver30 ?? 0) + (breaks2.length || f.breaks_over_30_team2 || 0);
            const high1 = breaks1.length ? Math.max(...breaks1) : (f.high_break_team1 ?? 0);
            const high2 = breaks2.length ? Math.max(...breaks2) : (f.high_break_team2 ?? 0);
            r1.highBreak = Math.max(r1.highBreak ?? 0, high1);
            r2.highBreak = Math.max(r2.highBreak ?? 0, high2);
            r1.centuryBreaks = (r1.centuryBreaks ?? 0) + (breaks1.filter((b) => b >= 100).length || (high1 >= 100 ? 1 : 0));
            r2.centuryBreaks = (r2.centuryBreaks ?? 0) + (breaks2.filter((b) => b >= 100).length || (high2 >= 100 ? 1 : 0));
          }
        }
      }
      if (sport === "snooker") {
        for (const row of map.values()) {
          row.avgPoints = row.framesFor > 0 ? Number(((row.pointsFor ?? 0) / row.framesFor).toFixed(1)) : 0;
        }
      }
      const rows = [...map.values()]
        .filter((r) => locationFilter === "all" || locationByPlayer.get(r.id) === locationFilter)
        .sort((a, b) => pct(b.won, b.played) - pct(a.won, a.played) || b.won - a.won || a.label.localeCompare(b.label));
      if (sport !== "all") {
        const byRating = [...rows].sort((a, b) => (b.rating ?? 1000) - (a.rating ?? 1000) || a.label.localeCompare(b.label));
        const rankById = new Map(byRating.map((r, i) => [r.id, i + 1]));
        for (const row of rows) row.rank = rankById.get(row.id);
      }
      return rows;
    }

    const map = new Map<string, Row>();
    for (const m of filteredMatches) {
      if (!m.team1_player1_id || !m.team1_player2_id || !m.team2_player1_id || !m.team2_player2_id) continue;
      const t1Key = pairKey(m.team1_player1_id, m.team1_player2_id);
      const t2Key = pairKey(m.team2_player1_id, m.team2_player2_id);
      const t1Label = `${playerMap.get(m.team1_player1_id) ?? "TBC"} & ${playerMap.get(m.team1_player2_id) ?? "TBC"}`;
      const t2Label = `${playerMap.get(m.team2_player1_id) ?? "TBC"} & ${playerMap.get(m.team2_player2_id) ?? "TBC"}`;
      if (!map.has(t1Key)) {
        const t1AvgRating = ((activeRatingByPlayer.get(m.team1_player1_id) ?? 1000) + (activeRatingByPlayer.get(m.team1_player2_id) ?? 1000)) / 2;
        map.set(t1Key, {
          id: t1Key,
          label: t1Label,
          rating: Number(t1AvgRating.toFixed(0)),
          played: 0,
          won: 0,
          lost: 0,
          framesFor: 0,
          framesAgainst: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          avgPoints: 0,
          highBreak: 0,
          centuryBreaks: 0,
          breaksOver30: 0,
        });
      }
      if (!map.has(t2Key)) {
        const t2AvgRating = ((activeRatingByPlayer.get(m.team2_player1_id) ?? 1000) + (activeRatingByPlayer.get(m.team2_player2_id) ?? 1000)) / 2;
        map.set(t2Key, {
          id: t2Key,
          label: t2Label,
          rating: Number(t2AvgRating.toFixed(0)),
          played: 0,
          won: 0,
          lost: 0,
          framesFor: 0,
          framesAgainst: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          avgPoints: 0,
          highBreak: 0,
          centuryBreaks: 0,
          breaksOver30: 0,
        });
      }
      const r1 = map.get(t1Key)!;
      const r2 = map.get(t2Key)!;
      r1.played += 1;
      r2.played += 1;
      const t1Win = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
      const t2Win = m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id;
      if (t1Win) {
        r1.won += 1;
        r2.lost += 1;
      } else if (t2Win) {
        r2.won += 1;
        r1.lost += 1;
      }
      const ff = (framesByMatch.get(m.id) ?? []).filter((f) => !f.is_walkover_award);
      for (const f of ff) {
        if (f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id) {
          r1.framesFor += 1;
          r2.framesAgainst += 1;
        } else if (f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id) {
          r2.framesFor += 1;
          r1.framesAgainst += 1;
        }
        if (sport === "snooker") {
          const breaks1 = breakValues(f.breaks_over_30_team1_values);
          const breaks2 = breakValues(f.breaks_over_30_team2_values);
          r1.pointsFor = (r1.pointsFor ?? 0) + (f.team1_points ?? 0);
          r1.pointsAgainst = (r1.pointsAgainst ?? 0) + (f.team2_points ?? 0);
          r2.pointsFor = (r2.pointsFor ?? 0) + (f.team2_points ?? 0);
          r2.pointsAgainst = (r2.pointsAgainst ?? 0) + (f.team1_points ?? 0);
          r1.breaksOver30 = (r1.breaksOver30 ?? 0) + (breaks1.length || f.breaks_over_30_team1 || 0);
          r2.breaksOver30 = (r2.breaksOver30 ?? 0) + (breaks2.length || f.breaks_over_30_team2 || 0);
          const high1 = breaks1.length ? Math.max(...breaks1) : (f.high_break_team1 ?? 0);
          const high2 = breaks2.length ? Math.max(...breaks2) : (f.high_break_team2 ?? 0);
          r1.highBreak = Math.max(r1.highBreak ?? 0, high1);
          r2.highBreak = Math.max(r2.highBreak ?? 0, high2);
          r1.centuryBreaks = (r1.centuryBreaks ?? 0) + (breaks1.filter((b) => b >= 100).length || (high1 >= 100 ? 1 : 0));
          r2.centuryBreaks = (r2.centuryBreaks ?? 0) + (breaks2.filter((b) => b >= 100).length || (high2 >= 100 ? 1 : 0));
        }
      }
    }
    if (sport === "snooker") {
      for (const row of map.values()) {
        row.avgPoints = row.framesFor > 0 ? Number(((row.pointsFor ?? 0) / row.framesFor).toFixed(1)) : 0;
      }
    }
    const rows = [...map.values()]
      .filter((r) => {
        if (locationFilter === "all") return true;
        const ids = r.id.split("|");
        return ids.length === 2 && ids.every((pid) => locationByPlayer.get(pid) === locationFilter);
      })
      .sort((a, b) => pct(b.won, b.played) - pct(a.won, a.played) || b.won - a.won || a.label.localeCompare(b.label));
    if (sport !== "all") {
      const byRating = [...rows].sort((a, b) => (b.rating ?? 1000) - (a.rating ?? 1000) || a.label.localeCompare(b.label));
      const rankById = new Map(byRating.map((r, i) => [r.id, i + 1]));
      for (const row of rows) row.rank = rankById.get(row.id);
    }
    return rows;
  }, [mode, filteredMatches, playerMap, framesByMatch, sport, locationFilter, locationByPlayer, activeRatingByPlayer]);

  const highBreakRows = useMemo(() => {
    if (sport !== "snooker") return [];
    return tableRows
      .map((r) => ({
        id: r.id,
        label: r.label,
        highBreak: r.highBreak ?? 0,
        centuryBreaks: r.centuryBreaks ?? 0,
        breaksOver30: r.breaksOver30 ?? 0,
      }))
      .filter((r) => r.highBreak > 0 || r.centuryBreaks > 0 || r.breaksOver30 > 0)
      .sort((a, b) => b.highBreak - a.highBreak || b.centuryBreaks - a.centuryBreaks || b.breaksOver30 - a.breaksOver30 || a.label.localeCompare(b.label));
  }, [sport, tableRows]);

  const headToHeadRows = useMemo(() => {
    const map = new Map<string, H2hRow>();

    for (const m of filteredMatches) {
      if (mode === "singles") {
        if (!m.player1_id || !m.player2_id) continue;
        const leftId = [m.player1_id, m.player2_id].sort()[0];
        const rightId = [m.player1_id, m.player2_id].sort()[1];
        const key = `${leftId}::${rightId}`;
        if (!map.has(key)) {
          map.set(key, {
            id: key,
            leftId,
            rightId,
            leftLabel: playerMap.get(leftId) ?? "Unknown",
            rightLabel: playerMap.get(rightId) ?? "Unknown",
            played: 0,
            leftWins: 0,
            rightWins: 0,
            frameDiff: 0,
          });
        }
        const row = map.get(key)!;
        row.played += 1;
        if (m.winner_player_id === leftId) row.leftWins += 1;
        if (m.winner_player_id === rightId) row.rightWins += 1;

        for (const f of (framesByMatch.get(m.id) ?? []).filter((x) => !x.is_walkover_award)) {
          if (f.winner_player_id === leftId) row.frameDiff += 1;
          if (f.winner_player_id === rightId) row.frameDiff -= 1;
        }
      } else {
        if (!m.team1_player1_id || !m.team1_player2_id || !m.team2_player1_id || !m.team2_player2_id) continue;
        const team1 = pairKey(m.team1_player1_id, m.team1_player2_id);
        const team2 = pairKey(m.team2_player1_id, m.team2_player2_id);
        const leftId = [team1, team2].sort()[0];
        const rightId = [team1, team2].sort()[1];
        const key = `${leftId}::${rightId}`;

        const leftParts = leftId.split("|");
        const rightParts = rightId.split("|");

        if (!map.has(key)) {
          map.set(key, {
            id: key,
            leftId,
            rightId,
            leftLabel: `${playerMap.get(leftParts[0]) ?? "TBC"} & ${playerMap.get(leftParts[1]) ?? "TBC"}`,
            rightLabel: `${playerMap.get(rightParts[0]) ?? "TBC"} & ${playerMap.get(rightParts[1]) ?? "TBC"}`,
            played: 0,
            leftWins: 0,
            rightWins: 0,
            frameDiff: 0,
          });
        }

        const row = map.get(key)!;
        row.played += 1;
        const winnerIsTeam1 = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
        const winnerIsTeam2 = m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id;

        const leftIsTeam1 = leftId === team1;
        if (winnerIsTeam1) {
          if (leftIsTeam1) row.leftWins += 1;
          else row.rightWins += 1;
        }
        if (winnerIsTeam2) {
          if (leftIsTeam1) row.rightWins += 1;
          else row.leftWins += 1;
        }

        for (const f of (framesByMatch.get(m.id) ?? []).filter((x) => !x.is_walkover_award)) {
          const frameTeam1 = f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id;
          const frameTeam2 = f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id;
          if (frameTeam1) row.frameDiff += leftIsTeam1 ? 1 : -1;
          if (frameTeam2) row.frameDiff += leftIsTeam1 ? -1 : 1;
        }
      }
    }

    return [...map.values()].sort((a, b) => b.played - a.played || a.leftLabel.localeCompare(b.leftLabel));
  }, [filteredMatches, mode, framesByMatch, playerMap]);

  const recentFormForPlayer = (id: string): string => {
    const chars: string[] = [];
    const relevant = filteredAllModesMatches
      .filter((m) => {
        if (m.match_mode === "singles") return m.player1_id === id || m.player2_id === id;
        return m.team1_player1_id === id || m.team1_player2_id === id || m.team2_player1_id === id || m.team2_player2_id === id;
      })
      .sort(sortByRecent);

    for (const m of relevant) {
      const frameRows = (framesByMatch.get(m.id) ?? []).filter((f) => !f.is_walkover_award);
      if (frameRows.length) {
        for (const f of frameRows) {
          if (m.match_mode === "singles") {
            chars.push(f.winner_player_id === id ? "W" : "L");
          } else {
            const inTeam1 = m.team1_player1_id === id || m.team1_player2_id === id;
            const frameTeam1 = f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id;
            const frameTeam2 = f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id;
            const isWin = inTeam1 ? frameTeam1 : frameTeam2;
            chars.push(isWin ? "W" : "L");
          }
          if (chars.length >= 10) return chars.join("");
        }
      } else {
        if (m.match_mode === "singles") {
          chars.push(m.winner_player_id === id ? "W" : "L");
        } else {
          const inTeam1 = m.team1_player1_id === id || m.team1_player2_id === id;
          const winnerIsTeam1 = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
          const winnerIsTeam2 = m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id;
          const isWin = inTeam1 ? winnerIsTeam1 : winnerIsTeam2;
          chars.push(isWin ? "W" : "L");
        }
        if (chars.length >= 10) return chars.join("");
      }
    }
    return chars.length ? chars.join("") : "-";
  };

  const doublesMatches = useMemo(
    () => filteredAllModesMatches.filter((m) => m.match_mode === "doubles"),
    [filteredAllModesMatches]
  );

  const teamHistoryStats = (teamKey: string) => {
    let played = 0;
    let won = 0;
    let lost = 0;
    let framesFor = 0;
    let framesAgainst = 0;
    for (const m of doublesMatches) {
      if (!m.team1_player1_id || !m.team1_player2_id || !m.team2_player1_id || !m.team2_player2_id) continue;
      const t1 = pairKey(m.team1_player1_id, m.team1_player2_id);
      const t2 = pairKey(m.team2_player1_id, m.team2_player2_id);
      if (t1 !== teamKey && t2 !== teamKey) continue;
      played += 1;
      const isTeam1 = t1 === teamKey;
      const winnerIsTeam1 = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
      const winnerIsTeam2 = m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id;
      if (isTeam1 && winnerIsTeam1) won += 1;
      else if (!isTeam1 && winnerIsTeam2) won += 1;
      else if (winnerIsTeam1 || winnerIsTeam2) lost += 1;

      for (const f of (framesByMatch.get(m.id) ?? []).filter((x) => !x.is_walkover_award)) {
        const frameTeam1 = f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id;
        const frameTeam2 = f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id;
        if ((isTeam1 && frameTeam1) || (!isTeam1 && frameTeam2)) framesFor += 1;
        if ((isTeam1 && frameTeam2) || (!isTeam1 && frameTeam1)) framesAgainst += 1;
      }
    }
    return { played, won, lost, framesFor, framesAgainst };
  };

  function computeSinglesPrediction(idA: string, idB: string) {
    const a = tableRows.find((r) => r.id === idA);
    const b = tableRows.find((r) => r.id === idB);
    if (!a || !b) return null;

    const h2hMatches = filteredMatches.filter(
      (m) => m.player1_id && m.player2_id && [m.player1_id, m.player2_id].includes(idA) && [m.player1_id, m.player2_id].includes(idB)
    );
    const aH2hWins = h2hMatches.filter((m) => m.winner_player_id === idA).length;
    const bH2hWins = h2hMatches.filter((m) => m.winner_player_id === idB).length;

    const aForm = recentFormForPlayer(idA);
    const bForm = recentFormForPlayer(idB);
    const aRecentWins = aForm.split("").filter((c) => c === "W").length;
    const bRecentWins = bForm.split("").filter((c) => c === "W").length;

    const aScore = pct(a.won, a.played) + (a.framesFor - a.framesAgainst) * 1.4 + (aH2hWins - bH2hWins) * 7 + (aRecentWins - bRecentWins) * 2;
    const bScore = pct(b.won, b.played) + (b.framesFor - b.framesAgainst) * 1.4 + (bH2hWins - aH2hWins) * 7 + (bRecentWins - aRecentWins) * 2;
    const scoreGap = Math.abs(aScore - bScore);
    const chance = Math.max(51, Math.min(92, 50 + Math.round(scoreGap / 2)));
    const sample = a.played + b.played + h2hMatches.length;
    const confidence = confidenceFrom(scoreGap, sample);
    const winner = aScore >= bScore ? a : b;
    return { a, b, winnerId: winner.id, winnerLabel: winner.label, chance, confidence, aH2hWins, bH2hWins, aForm, bForm };
  }

  function computeDoublesPredictionByTeam(teamAKey: string, teamBKey: string) {
    const teamAParts = teamAKey.split("|");
    const teamBParts = teamBKey.split("|");
    if (teamAParts.length !== 2 || teamBParts.length !== 2) return null;
    const [a1, a2] = teamAParts;
    const [b1, b2] = teamBParts;

    const teamALabel = `${playerMap.get(a1) ?? "TBC"} & ${playerMap.get(a2) ?? "TBC"}`;
    const teamBLabel = `${playerMap.get(b1) ?? "TBC"} & ${playerMap.get(b2) ?? "TBC"}`;

    const tA = teamHistoryStats(teamAKey);
    const tB = teamHistoryStats(teamBKey);
    const pA1 = individualRows.get(a1);
    const pA2 = individualRows.get(a2);
    const pB1 = individualRows.get(b1);
    const pB2 = individualRows.get(b2);

    const aIndWin = ((pA1 ? pct(pA1.won, pA1.played) : 50) + (pA2 ? pct(pA2.won, pA2.played) : 50)) / 2;
    const bIndWin = ((pB1 ? pct(pB1.won, pB1.played) : 50) + (pB2 ? pct(pB2.won, pB2.played) : 50)) / 2;
    const aIndDiff = ((pA1 ? pA1.framesFor - pA1.framesAgainst : 0) + (pA2 ? pA2.framesFor - pA2.framesAgainst : 0)) / 2;
    const bIndDiff = ((pB1 ? pB1.framesFor - pB1.framesAgainst : 0) + (pB2 ? pB2.framesFor - pB2.framesAgainst : 0)) / 2;

    const h2h = headToHeadRows.find((h) => (h.leftId === teamAKey && h.rightId === teamBKey) || (h.leftId === teamBKey && h.rightId === teamAKey));
    const aH2hWins = h2h ? (h2h.leftId === teamAKey ? h2h.leftWins : h2h.rightWins) : 0;
    const bH2hWins = h2h ? (h2h.leftId === teamBKey ? h2h.leftWins : h2h.rightWins) : 0;

    const formA1 = recentFormForPlayer(a1);
    const formA2 = recentFormForPlayer(a2);
    const formB1 = recentFormForPlayer(b1);
    const formB2 = recentFormForPlayer(b2);
    const aRecentWins = formA1.split("").filter((c) => c === "W").length + formA2.split("").filter((c) => c === "W").length;
    const bRecentWins = formB1.split("").filter((c) => c === "W").length + formB2.split("").filter((c) => c === "W").length;

    const aScore =
      aIndWin +
      aIndDiff * 1.1 +
      (tA.played ? pct(tA.won, tA.played) - 50 : 0) +
      (tA.framesFor - tA.framesAgainst) * 1.1 +
      (aH2hWins - bH2hWins) * 7 +
      (aRecentWins - bRecentWins) * 1.2;
    const bScore =
      bIndWin +
      bIndDiff * 1.1 +
      (tB.played ? pct(tB.won, tB.played) - 50 : 0) +
      (tB.framesFor - tB.framesAgainst) * 1.1 +
      (bH2hWins - aH2hWins) * 7 +
      (bRecentWins - aRecentWins) * 1.2;

    const winnerKey = aScore >= bScore ? teamAKey : teamBKey;
    const winnerLabel = winnerKey === teamAKey ? teamALabel : teamBLabel;
    const scoreGap = Math.abs(aScore - bScore);
    const chance = Math.max(51, Math.min(92, 50 + Math.round(scoreGap / 2)));
    const sample =
      (pA1?.played ?? 0) +
      (pA2?.played ?? 0) +
      (pB1?.played ?? 0) +
      (pB2?.played ?? 0) +
      tA.played +
      tB.played +
      (h2h?.played ?? 0);
    const confidence = confidenceFrom(scoreGap, sample);

    return {
      winnerKey,
      winnerLabel,
      chance,
      confidence,
      teamALabel,
      teamBLabel,
      tA,
      tB,
      aH2hWins,
      bH2hWins,
      formA1,
      formA2,
      formB1,
      formB2,
      parts: { a1, a2, b1, b2 },
    };
  }

  const selectedHeadToHead = useMemo(() => {
    if (mode === "singles") {
      if (!h2hPlayerA || !h2hPlayerB || h2hPlayerA === h2hPlayerB) return null;
      const leftId = [h2hPlayerA, h2hPlayerB].sort()[0];
      const rightId = [h2hPlayerA, h2hPlayerB].sort()[1];
      return headToHeadRows.find((row) => row.leftId === leftId && row.rightId === rightId) ?? null;
    }
    if (!h2hTeamA || !h2hTeamB || h2hTeamA === h2hTeamB) return null;
    const leftId = [h2hTeamA, h2hTeamB].sort()[0];
    const rightId = [h2hTeamA, h2hTeamB].sort()[1];
    return headToHeadRows.find((row) => row.leftId === leftId && row.rightId === rightId) ?? null;
  }, [mode, h2hPlayerA, h2hPlayerB, h2hTeamA, h2hTeamB, headToHeadRows]);

  const headToHeadRecent = useMemo(() => {
    if (mode === "singles") {
      if (!h2hPlayerA || !h2hPlayerB || h2hPlayerA === h2hPlayerB) return [];
      return filteredMatches
        .filter(
          (m) =>
            m.player1_id &&
            m.player2_id &&
            [m.player1_id, m.player2_id].includes(h2hPlayerA) &&
            [m.player1_id, m.player2_id].includes(h2hPlayerB)
        )
        .sort(sortByRecent)
        .slice(0, 8);
    }
    if (!h2hTeamA || !h2hTeamB || h2hTeamA === h2hTeamB) return [];
    return filteredMatches
      .filter((m) => {
        if (!m.team1_player1_id || !m.team1_player2_id || !m.team2_player1_id || !m.team2_player2_id) return false;
        const t1 = pairKey(m.team1_player1_id, m.team1_player2_id);
        const t2 = pairKey(m.team2_player1_id, m.team2_player2_id);
        return (t1 === h2hTeamA && t2 === h2hTeamB) || (t1 === h2hTeamB && t2 === h2hTeamA);
      })
      .sort(sortByRecent)
      .slice(0, 8);
  }, [mode, h2hPlayerA, h2hPlayerB, h2hTeamA, h2hTeamB, filteredMatches]);

  const predictor: PredictorSummary = (() => {
    if (sport === "all") {
      return {
        blocked: true,
        title: "Select Pool or Snooker",
        lines: ["Predictor is only available when a specific sport is selected."],
      };
    }

    if (mode === "singles") {
      if (!playerA || !playerB || playerA === playerB) {
        return { blocked: false, title: "Select two different players", lines: [] };
      }

      const model = computeSinglesPrediction(playerA, playerB);
      if (!model) {
        return { blocked: false, title: "Not enough data", lines: ["No results available for one or both players under current filters."] };
      }

      return {
        blocked: false,
        title: `Likely winner: ${model.winnerLabel}`,
        chance: model.chance,
        confidence: model.confidence,
        lines: [
          `Head-to-head: ${model.a.label} ${model.aH2hWins} - ${model.bH2hWins} ${model.b.label}.`,
          `Recent form (last up to 10 frames): ${model.a.label} ${model.aForm} | ${model.b.label} ${model.bForm}.`,
          `Key factors: win rate ${pct(model.a.won, model.a.played)}% vs ${pct(model.b.won, model.b.played)}%, frame diff ${model.a.framesFor - model.a.framesAgainst} vs ${model.b.framesFor - model.b.framesAgainst}.`,
          `Model basis: overall win rate, frame/rack efficiency, head-to-head edge, and recent form trend.`,
        ],
      };
    }

    const selected = [team1Player1, team1Player2, team2Player1, team2Player2].filter(Boolean);
    if (selected.length < 4) {
      return { blocked: false, title: "Select Team 1 and Team 2 players", lines: [] };
    }
    if (new Set(selected).size !== 4) {
      return { blocked: false, title: "Each player can only be selected once", lines: [] };
    }

    const teamAKey = pairKey(team1Player1, team1Player2);
    const teamBKey = pairKey(team2Player1, team2Player2);
    const model = computeDoublesPredictionByTeam(teamAKey, teamBKey);
    if (!model) {
      return { blocked: false, title: "Not enough data", lines: ["Unable to build doubles prediction for selected teams."] };
    }

    return {
      blocked: false,
      title: `Likely winner: ${model.winnerLabel}`,
      chance: model.chance,
      confidence: model.confidence,
      lines: [
        `Head-to-head (team): ${model.teamALabel} ${model.aH2hWins} - ${model.bH2hWins} ${model.teamBLabel}.`,
        `Doubles history: ${model.teamALabel} ${model.tA.won}/${model.tA.played || 0} | ${model.teamBLabel} ${model.tB.won}/${model.tB.played || 0}.`,
        `Recent form (last up to 10 frames): ${playerMap.get(model.parts.a1)} ${model.formA1}, ${playerMap.get(model.parts.a2)} ${model.formA2}, ${playerMap.get(model.parts.b1)} ${model.formB1}, ${playerMap.get(model.parts.b2)} ${model.formB2}.`,
        `Model basis: individual performance + doubles pair history + head-to-head + recent form.`,
        `Comparison: ${model.winnerLabel} is currently favored.`,
      ],
    };
  })();

  const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const fieldClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900";
  const subCardClass = "rounded-xl border border-slate-200 bg-slate-50 p-3";
  const sectionSummaryClass = "group flex cursor-pointer list-none items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900";
  const filterItemClass = "min-w-[150px] flex-1 sm:w-[170px] sm:flex-none";
  const filterLabelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
  const tableHeaderTextClass = "py-2 pr-4 text-sm font-semibold text-slate-700";
  const tableCellTextClass = "py-2 pr-4 text-sm text-slate-700";
  const tableNumericHeaderClass = `${tableHeaderTextClass} text-right tabular-nums whitespace-nowrap`;
  const tableNumericCellClass = `${tableCellTextClass} text-right tabular-nums whitespace-nowrap`;

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Stats" eyebrow="Stats" subtitle="Performance tables, head-to-head, and predictions." />
          <MessageModal message={message} onClose={() => setMessage(null)} />
          {!premium.loading && !premium.unlocked ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <p className="font-semibold">Stats is a Premium feature.</p>
              <p className="mt-1">
                Premium unlocks the full stats suite, including performance tables, head-to-head records, and predictor views.
              </p>
              <a href="/premium" className="mt-3 inline-flex rounded-full border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-900">
                View premium access options
              </a>
            </section>
          ) : (
            <>
                  <section className={`${cardClass} p-4`}>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className={filterItemClass}>
                        <label className={filterLabelClass}>Format</label>
                        <select className={fieldClass} value={format} onChange={(e) => setFormat(e.target.value as FormatFilter)}>
                          <option value="all">All formats</option>
                          <option value="knockout">Knockout</option>
                        </select>
                      </div>
                      <div className={filterItemClass}>
                        <label className={filterLabelClass}>Sport</label>
                        <select className={fieldClass} value={sport} onChange={(e) => setSport(e.target.value as SportFilter)}>
                          <option value="all">All sports</option>
                          <option value="pool_8_ball">Pool (8-ball)</option>
                          <option value="pool_9_ball">Pool (9-ball)</option>
                          <option value="snooker">Snooker</option>
                        </select>
                      </div>
                      <div className={filterItemClass}>
                        <label className={filterLabelClass}>Mode</label>
                        <select className={fieldClass} value={mode} onChange={(e) => setMode(e.target.value as ModeFilter)}>
                          <option value="singles">Singles</option>
                          <option value="doubles">Doubles</option>
                        </select>
                      </div>
                      <div className={filterItemClass}>
                        <label className={filterLabelClass}>View</label>
                        <select className={fieldClass} value={view} onChange={(e) => setView(e.target.value as ViewFilter)}>
                          <option value="table">Table</option>
                          <option value="head_to_head">Head-to-Head</option>
                          <option value="predictor">Predictor</option>
                        </select>
                      </div>
                      <div className={filterItemClass}>
                        <label className={filterLabelClass}>Location</label>
                        <select className={fieldClass} value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                          <option value="all">All locations</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </section>

                  {view === "table" ? (
                    <>
                      <section className={cardClass}>
                        <details open>
                          <summary className={sectionSummaryClass}>
                            <span>{mode === "singles" ? "Player Table" : "Team Table"}</span>
                            <span className="text-xs font-medium text-slate-500 group-open:hidden">Expand</span>
                            <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Collapse</span>
                          </summary>
                          <div className="mt-3 overflow-x-auto">
                            <table className="min-w-full text-left align-middle">
                              <thead>
                                <tr className="text-slate-700">
                                  <th className={tableHeaderTextClass}>{mode === "singles" ? "Player" : "Team"}</th>
                                  {sport !== "all" ? <th className={tableNumericHeaderClass}>Rank</th> : null}
                                  {sport !== "all" ? <th className={tableNumericHeaderClass}>Rating</th> : null}
                                  <th className={tableNumericHeaderClass}>P</th>
                                  <th className={tableNumericHeaderClass}>W</th>
                                  <th className={tableNumericHeaderClass}>L</th>
                                  <th className={tableNumericHeaderClass}>F</th>
                                  <th className={tableNumericHeaderClass}>A</th>
                                  {sport === "snooker" ? (
                                    <>
                                      <th className={tableNumericHeaderClass}>Points For</th>
                                      <th className={tableNumericHeaderClass}>Points Against</th>
                                      <th className={tableNumericHeaderClass}>Avg Points/Frame</th>
                                      <th className={tableNumericHeaderClass}>High Break</th>
                                    </>
                                  ) : null}
                                  <th className={tableNumericHeaderClass}>Win%</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tableRows.map((r) => (
                                  <tr key={r.id} className="border-t border-slate-100">
                                    <td className={`${tableCellTextClass} font-medium text-slate-900`}>{r.label}</td>
                                    {sport !== "all" ? <td className={tableNumericCellClass}>{r.rank ?? "—"}</td> : null}
                                    {sport !== "all" ? <td className={tableNumericCellClass}>{Math.round(r.rating ?? 1000)}</td> : null}
                                    <td className={tableNumericCellClass}>{r.played}</td>
                                    <td className={tableNumericCellClass}>{r.won}</td>
                                    <td className={tableNumericCellClass}>{r.lost}</td>
                                    <td className={tableNumericCellClass}>{r.framesFor}</td>
                                    <td className={tableNumericCellClass}>{r.framesAgainst}</td>
                                    {sport === "snooker" ? (
                                      <>
                                        <td className={tableNumericCellClass}>{r.pointsFor ?? 0}</td>
                                        <td className={tableNumericCellClass}>{r.pointsAgainst ?? 0}</td>
                                        <td className={tableNumericCellClass}>{(r.avgPoints ?? 0).toFixed(1)}</td>
                                        <td className={tableNumericCellClass}>{r.highBreak ?? 0}</td>
                                      </>
                                    ) : null}
                                    <td className={tableNumericCellClass}>{pct(r.won, r.played)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {!tableRows.length ? <p className="text-slate-600">No data for current filters.</p> : null}
                          </div>
                        </details>
                      </section>
                      {sport === "snooker" ? (
                        <section className={cardClass}>
                          <details open>
                            <summary className={sectionSummaryClass}>
                              <span>High Break Table</span>
                              <span className="text-xs font-medium text-slate-500 group-open:hidden">Expand</span>
                              <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Collapse</span>
                            </summary>
                            <div className="mt-3 overflow-x-auto">
                              <table className="min-w-full text-left align-middle">
                                <thead>
                                  <tr className="text-slate-700">
                                    <th className={tableNumericHeaderClass}>Rank</th>
                                    <th className={tableHeaderTextClass}>{mode === "singles" ? "Player" : "Team"}</th>
                                    <th className={tableNumericHeaderClass}>High Break</th>
                                    <th className={tableNumericHeaderClass}>Century Breaks</th>
                                    <th className={tableNumericHeaderClass}>Breaks 30+</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {highBreakRows.map((r, idx) => (
                                    <tr key={r.id} className="border-t border-slate-100">
                                      <td className={tableNumericCellClass}>{idx + 1}</td>
                                      <td className={`${tableCellTextClass} font-medium text-slate-900`}>{r.label}</td>
                                      <td className={tableNumericCellClass}>{r.highBreak}</td>
                                      <td className={tableNumericCellClass}>{r.centuryBreaks}</td>
                                      <td className={tableNumericCellClass}>{r.breaksOver30}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {!highBreakRows.length ? <p className="text-slate-600">No high-break data for current filters.</p> : null}
                            </div>
                          </details>
                        </section>
                      ) : null}
                    </>
                  ) : null}

                  {view === "head_to_head" ? (
                    <section className={`${cardClass} space-y-3`}>
                      {mode === "singles" ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <select className={fieldClass} value={h2hPlayerA} onChange={(e) => setH2hPlayerA(e.target.value)}>
                            <option value="">Player A</option>
                            {locationFilteredPlayers.map((p) => (
                              <option key={p.id} value={p.id} disabled={p.id === h2hPlayerB}>
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                          <select className={fieldClass} value={h2hPlayerB} onChange={(e) => setH2hPlayerB(e.target.value)}>
                            <option value="">Player B</option>
                            {locationFilteredPlayers.map((p) => (
                              <option key={p.id} value={p.id} disabled={p.id === h2hPlayerA}>
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <select className={fieldClass} value={h2hTeamA} onChange={(e) => setH2hTeamA(e.target.value)}>
                            <option value="">Team A</option>
                            {tableRows.map((r) => (
                              <option key={r.id} value={r.id} disabled={r.id === h2hTeamB}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          <select className={fieldClass} value={h2hTeamB} onChange={(e) => setH2hTeamB(e.target.value)}>
                            <option value="">Team B</option>
                            {tableRows.map((r) => (
                              <option key={r.id} value={r.id} disabled={r.id === h2hTeamA}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                  {!selectedHeadToHead ? (
                    h2hEmptyMessage
                  ) : (
                    <>
                      <div className={subCardClass}>
                        <p className="font-semibold text-slate-900">
                          {selectedHeadToHead.leftLabel} vs {selectedHeadToHead.rightLabel}
                        </p>
                        <p className="text-slate-700">
                          Played: {selectedHeadToHead.played} · Record: {selectedHeadToHead.leftWins}-{selectedHeadToHead.rightWins} · Frame diff: {selectedHeadToHead.frameDiff > 0 ? `+${selectedHeadToHead.frameDiff}` : selectedHeadToHead.frameDiff}
                        </p>
                      </div>

                      {headToHeadRecent.length ? (
                        <div className="space-y-2">
                          <p className="font-semibold text-slate-900">Recent matches</p>
                          {headToHeadRecent.map((m) => {
                            const predictedWinner =
                              mode === "singles" && h2hPlayerA && h2hPlayerB
                                ? computeSinglesPrediction(h2hPlayerA, h2hPlayerB)?.winnerId ?? null
                                : mode === "doubles" && h2hTeamA && h2hTeamB
                                ? computeDoublesPredictionByTeam(h2hTeamA, h2hTeamB)?.winnerKey ?? null
                                : null;

                            let actualWinner = "Unknown";
                            let expected = "No predictor baseline";
                            if (mode === "singles") {
                              const left = playerMap.get(m.player1_id ?? "") ?? "TBC";
                              const right = playerMap.get(m.player2_id ?? "") ?? "TBC";
                              actualWinner = playerMap.get(m.winner_player_id ?? "") ?? "Unknown";
                              const aligned = predictedWinner && m.winner_player_id === predictedWinner;
                              expected = predictedWinner ? (aligned ? "In line with predictor" : "Against predictor") : expected;
                              return (
                                <div key={m.id} className="rounded-lg border border-slate-200 p-3">
                                  <p className="font-medium text-slate-900">{left} vs {right}</p>
                                  <p className="text-slate-700">Winner: {actualWinner}</p>
                                  <p className="text-slate-600">{expected}</p>
                                </div>
                              );
                            }

                            const t1 =
                              m.team1_player1_id && m.team1_player2_id
                                ? `${playerMap.get(m.team1_player1_id) ?? "TBC"} & ${playerMap.get(m.team1_player2_id) ?? "TBC"}`
                                : "TBC";
                            const t2 =
                              m.team2_player1_id && m.team2_player2_id
                                ? `${playerMap.get(m.team2_player1_id) ?? "TBC"} & ${playerMap.get(m.team2_player2_id) ?? "TBC"}`
                                : "TBC";
                            const actualWinnerKey =
                              m.winner_player_id && m.team1_player1_id && m.team1_player2_id && m.team2_player1_id && m.team2_player2_id
                                ? (m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id
                                    ? pairKey(m.team1_player1_id, m.team1_player2_id)
                                    : pairKey(m.team2_player1_id, m.team2_player2_id))
                                : null;
                            actualWinner = actualWinnerKey === pairKey(m.team1_player1_id ?? "", m.team1_player2_id ?? "") ? t1 : t2;
                            const aligned = predictedWinner && actualWinnerKey && predictedWinner === actualWinnerKey;
                            expected = predictedWinner ? (aligned ? "In line with predictor" : "Against predictor") : expected;
                            return (
                              <div key={m.id} className="rounded-lg border border-slate-200 p-3">
                                <p className="font-medium text-slate-900">{t1} vs {t2}</p>
                                <p className="text-slate-700">Winner: {actualWinner}</p>
                                <p className="text-slate-600">{expected}</p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={`${subCardClass} text-slate-700`}>
                          No recent matches found for this selected head-to-head under the current filters.
                        </div>
                      )}
                    </>
                  )}
                </section>
              ) : null}

              {view === "predictor" ? (
                <section className={`${cardClass} space-y-3`}>
                  {predictor.blocked ? (
                    <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-rose-800">
                      {predictor.title}: {predictor.lines[0]}
                    </div>
                  ) : (
                    <>
                      {mode === "singles" ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <select className={fieldClass} value={playerA} onChange={(e) => setPlayerA(e.target.value)}>
                            <option value="">Player A</option>
                          {locationFilteredPlayers.map((p) => (
                              <option key={p.id} value={p.id} disabled={p.id === playerB}>
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                          <select className={fieldClass} value={playerB} onChange={(e) => setPlayerB(e.target.value)}>
                            <option value="">Player B</option>
                          {locationFilteredPlayers.map((p) => (
                              <option key={p.id} value={p.id} disabled={p.id === playerA}>
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <select className={fieldClass} value={team1Player1} onChange={(e) => setTeam1Player1(e.target.value)}>
                            <option value="">Team 1 Player 1</option>
                            {locationFilteredPlayers.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={[team1Player2, team2Player1, team2Player2].includes(p.id)}
                              >
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                          <select className={fieldClass} value={team1Player2} onChange={(e) => setTeam1Player2(e.target.value)}>
                            <option value="">Team 1 Player 2</option>
                            {locationFilteredPlayers.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={[team1Player1, team2Player1, team2Player2].includes(p.id)}
                              >
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                          <select className={fieldClass} value={team2Player1} onChange={(e) => setTeam2Player1(e.target.value)}>
                            <option value="">Team 2 Player 1</option>
                            {locationFilteredPlayers.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={[team1Player1, team1Player2, team2Player2].includes(p.id)}
                              >
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                          <select className={fieldClass} value={team2Player2} onChange={(e) => setTeam2Player2(e.target.value)}>
                            <option value="">Team 2 Player 2</option>
                            {locationFilteredPlayers.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={[team1Player1, team1Player2, team2Player1].includes(p.id)}
                              >
                                {p.full_name?.trim() ? p.full_name : p.display_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="font-semibold text-slate-900">{predictor.title}</p>
                        {typeof predictor.chance === "number" ? <p className="text-slate-800">Estimated chance: {predictor.chance}%</p> : null}
                        {predictor.confidence ? <p className="text-slate-800">Confidence: {predictor.confidence}</p> : null}
                        {predictor.lines.map((line) => (
                          <p key={line} className="text-slate-700">{line}</p>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              ) : null}
            </>
          )}
        </RequireAuth>
      </div>
    </main>
  );
}
