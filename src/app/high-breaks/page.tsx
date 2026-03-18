"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";

type FormatFilter = "all" | "knockout" | "league";
type ModeFilter = "singles" | "doubles";

type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  location_id?: string | null;
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
};

type Frame = {
  match_id: string;
  is_walkover_award: boolean;
  breaks_over_30_team1_values: number[] | null;
  breaks_over_30_team2_values: number[] | null;
  breaks_over_30_team1: number;
  breaks_over_30_team2: number;
  high_break_team1: number;
  high_break_team2: number;
};

type HighBreakRow = {
  id: string;
  label: string;
  club: string;
  locationIds: string[];
  highBreak: number;
  centuryBreaks: number;
  breaksOver30: number;
  matchesCounted: number;
};

function pairKey(a: string, b: string) {
  return [a, b].sort().join("|");
}

function breakValues(values: number[] | null | undefined): number[] {
  return (values ?? []).filter((v) => Number.isFinite(v) && v > 30);
}

function safeNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export default function HighBreaksPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [format, setFormat] = useState<FormatFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("singles");
  const [locationFilter, setLocationFilter] = useState<string>("all");

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      setMessage("Supabase is not configured.");
      return;
    }

    let active = true;
    const run = async () => {
      setLoading(true);
      const [pRes, cRes, mRes, fRes, lRes] = await Promise.all([
        client.from("players").select("id,display_name,full_name,location_id").eq("is_archived", false).order("display_name"),
        client.from("competitions").select("id,competition_format,sport_type"),
        client
          .from("matches")
          .select("id,competition_id,status,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id")
          .eq("status", "complete"),
        client
          .from("frames")
          .select("match_id,is_walkover_award,breaks_over_30_team1_values,breaks_over_30_team2_values,breaks_over_30_team1,breaks_over_30_team2,high_break_team1,high_break_team2"),
        client.from("locations").select("id,name").order("name"),
      ]);

      if (!active) return;

      if (pRes.error || cRes.error || mRes.error || fRes.error || lRes.error) {
        setMessage(
          pRes.error?.message || cRes.error?.message || mRes.error?.message || fRes.error?.message || lRes.error?.message || "Failed to load high-break data."
        );
        setLoading(false);
        return;
      }

      const loadedMatches = (mRes.data ?? []) as Match[];
      const completedMatchIds = new Set(loadedMatches.map((match) => match.id));

      setPlayers((pRes.data ?? []) as Player[]);
      setCompetitions((cRes.data ?? []) as Competition[]);
      setMatches(loadedMatches);
      setFrames(((fRes.data ?? []) as Frame[]).filter((frame) => completedMatchIds.has(frame.match_id)));
      setLocations((lRes.data ?? []) as Location[]);
      setMessage(null);
      setLoading(false);
    };

    run();
    return () => {
      active = false;
    };
  }, []);

  const playerLabelById = useMemo(
    () =>
      new Map(
        players.map((player) => [
          player.id,
          player.full_name?.trim() ? player.full_name : player.display_name,
        ])
      ),
    [players]
  );

  const locationNameById = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);
  const locationByPlayerId = useMemo(
    () => new Map(players.map((player) => [player.id, player.location_id ?? null])),
    [players]
  );
  const competitionById = useMemo(() => new Map(competitions.map((competition) => [competition.id, competition])), [competitions]);
  const framesByMatchId = useMemo(() => {
    const map = new Map<string, Frame[]>();
    for (const frame of frames) {
      const list = map.get(frame.match_id) ?? [];
      list.push(frame);
      map.set(frame.match_id, list);
    }
    return map;
  }, [frames]);

  const filteredMatches = useMemo(
    () =>
      matches.filter((match) => {
        const competition = competitionById.get(match.competition_id);
        if (!competition || competition.sport_type !== "snooker") return false;
        if (format !== "all" && competition.competition_format !== format) return false;
        return match.match_mode === mode;
      }),
    [matches, competitionById, format, mode]
  );

  const highBreakRows = useMemo(() => {
    const rows = new Map<string, HighBreakRow>();

    for (const match of filteredMatches) {
      if (mode === "singles") {
        if (!match.player1_id || !match.player2_id) continue;
        const playerIds = [match.player1_id, match.player2_id];
        for (const playerId of playerIds) {
          if (!rows.has(playerId)) {
            const locationId = locationByPlayerId.get(playerId) ?? null;
            rows.set(playerId, {
              id: playerId,
              label: playerLabelById.get(playerId) ?? "Unknown",
              club: locationId ? locationNameById.get(locationId) ?? "Unassigned club" : "Unassigned club",
              locationIds: locationId ? [locationId] : [],
              highBreak: 0,
              centuryBreaks: 0,
              breaksOver30: 0,
              matchesCounted: 0,
            });
          }
        }

        const player1Row = rows.get(match.player1_id)!;
        const player2Row = rows.get(match.player2_id)!;
        player1Row.matchesCounted += 1;
        player2Row.matchesCounted += 1;

        for (const frame of (framesByMatchId.get(match.id) ?? []).filter((row) => !row.is_walkover_award)) {
          const breaks1 = breakValues(frame.breaks_over_30_team1_values);
          const breaks2 = breakValues(frame.breaks_over_30_team2_values);
          const high1 = breaks1.length ? Math.max(...breaks1) : safeNumber(frame.high_break_team1);
          const high2 = breaks2.length ? Math.max(...breaks2) : safeNumber(frame.high_break_team2);

          player1Row.breaksOver30 += breaks1.length || safeNumber(frame.breaks_over_30_team1);
          player2Row.breaksOver30 += breaks2.length || safeNumber(frame.breaks_over_30_team2);
          player1Row.highBreak = Math.max(player1Row.highBreak, high1);
          player2Row.highBreak = Math.max(player2Row.highBreak, high2);
          player1Row.centuryBreaks += breaks1.filter((value) => value >= 100).length || (high1 >= 100 ? 1 : 0);
          player2Row.centuryBreaks += breaks2.filter((value) => value >= 100).length || (high2 >= 100 ? 1 : 0);
        }
        continue;
      }

      if (!match.team1_player1_id || !match.team1_player2_id || !match.team2_player1_id || !match.team2_player2_id) continue;
      const team1Ids = [match.team1_player1_id, match.team1_player2_id];
      const team2Ids = [match.team2_player1_id, match.team2_player2_id];
      const team1Key = pairKey(team1Ids[0], team1Ids[1]);
      const team2Key = pairKey(team2Ids[0], team2Ids[1]);
      const team1LocationIds = team1Ids.map((playerId) => locationByPlayerId.get(playerId)).filter(Boolean) as string[];
      const team2LocationIds = team2Ids.map((playerId) => locationByPlayerId.get(playerId)).filter(Boolean) as string[];
      const team1Club =
        team1LocationIds.length === 2 && team1LocationIds[0] === team1LocationIds[1]
          ? locationNameById.get(team1LocationIds[0]) ?? "Unassigned club"
          : "Mixed clubs";
      const team2Club =
        team2LocationIds.length === 2 && team2LocationIds[0] === team2LocationIds[1]
          ? locationNameById.get(team2LocationIds[0]) ?? "Unassigned club"
          : "Mixed clubs";

      if (!rows.has(team1Key)) {
        rows.set(team1Key, {
          id: team1Key,
          label: `${playerLabelById.get(team1Ids[0]) ?? "TBC"} & ${playerLabelById.get(team1Ids[1]) ?? "TBC"}`,
          club: team1Club,
          locationIds: team1LocationIds,
          highBreak: 0,
          centuryBreaks: 0,
          breaksOver30: 0,
          matchesCounted: 0,
        });
      }
      if (!rows.has(team2Key)) {
        rows.set(team2Key, {
          id: team2Key,
          label: `${playerLabelById.get(team2Ids[0]) ?? "TBC"} & ${playerLabelById.get(team2Ids[1]) ?? "TBC"}`,
          club: team2Club,
          locationIds: team2LocationIds,
          highBreak: 0,
          centuryBreaks: 0,
          breaksOver30: 0,
          matchesCounted: 0,
        });
      }

      const team1Row = rows.get(team1Key)!;
      const team2Row = rows.get(team2Key)!;
      team1Row.matchesCounted += 1;
      team2Row.matchesCounted += 1;

      for (const frame of (framesByMatchId.get(match.id) ?? []).filter((row) => !row.is_walkover_award)) {
        const breaks1 = breakValues(frame.breaks_over_30_team1_values);
        const breaks2 = breakValues(frame.breaks_over_30_team2_values);
        const high1 = breaks1.length ? Math.max(...breaks1) : safeNumber(frame.high_break_team1);
        const high2 = breaks2.length ? Math.max(...breaks2) : safeNumber(frame.high_break_team2);

        team1Row.breaksOver30 += breaks1.length || safeNumber(frame.breaks_over_30_team1);
        team2Row.breaksOver30 += breaks2.length || safeNumber(frame.breaks_over_30_team2);
        team1Row.highBreak = Math.max(team1Row.highBreak, high1);
        team2Row.highBreak = Math.max(team2Row.highBreak, high2);
        team1Row.centuryBreaks += breaks1.filter((value) => value >= 100).length || (high1 >= 100 ? 1 : 0);
        team2Row.centuryBreaks += breaks2.filter((value) => value >= 100).length || (high2 >= 100 ? 1 : 0);
      }
    }

    return [...rows.values()]
      .filter((row) => row.highBreak > 0 || row.centuryBreaks > 0 || row.breaksOver30 > 0)
      .filter((row) => locationFilter === "all" || row.locationIds.length > 0 && row.locationIds.every((id) => id === locationFilter))
      .sort(
        (a, b) =>
          b.highBreak - a.highBreak ||
          b.centuryBreaks - a.centuryBreaks ||
          b.breaksOver30 - a.breaksOver30 ||
          a.label.localeCompare(b.label)
      );
  }, [filteredMatches, framesByMatchId, locationByPlayerId, locationFilter, locationNameById, mode, playerLabelById]);

  const topBreak = highBreakRows[0]?.highBreak ?? 0;
  const totalCenturyBreaks = highBreakRows.reduce((sum, row) => sum + row.centuryBreaks, 0);
  const totalBreaksOver30 = highBreakRows.reduce((sum, row) => sum + row.breaksOver30, 0);

  const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const fieldClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900";
  const tableHeaderTextClass = "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500";
  const tableNumericHeaderClass = `${tableHeaderTextClass} text-right tabular-nums whitespace-nowrap`;
  const tableCellTextClass = "px-3 py-2 text-sm text-slate-700";
  const tableNumericCellClass = `${tableCellTextClass} text-right tabular-nums`;

  return (
    <RequireAuth>
      <ScreenHeader title="High Breaks" eyebrow="Stats" subtitle="Dedicated snooker high-break rankings across completed club competitions." />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-10 sm:px-6 lg:px-8">
        {message ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{message}</div> : null}

        <section className={`${cardClass} space-y-4`}>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
            <p className="mt-1 text-sm text-slate-600">High-break data is drawn from completed snooker matches only. Walkover frames are excluded.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Competition format</label>
              <select className={fieldClass} value={format} onChange={(event) => setFormat(event.target.value as FormatFilter)}>
                <option value="all">All formats</option>
                <option value="league">League</option>
                <option value="knockout">Knockout</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</label>
              <select className={fieldClass} value={mode} onChange={(event) => setMode(event.target.value as ModeFilter)}>
                <option value="singles">Singles</option>
                <option value="doubles">Doubles</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Club</label>
              <select className={fieldClass} value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="all">All clubs</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top recorded break</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{topBreak || "—"}</p>
            <p className="mt-2 text-sm text-slate-600">{highBreakRows[0] ? `${highBreakRows[0].label} currently tops the table.` : "No snooker break data yet."}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Century breaks</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{totalCenturyBreaks}</p>
            <p className="mt-2 text-sm text-slate-600">Total centuries recorded in the current filtered view.</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Breaks over 30</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{totalBreaksOver30}</p>
            <p className="mt-2 text-sm text-slate-600">Useful for tracking regular scoring, not just the outright top break.</p>
          </div>
        </section>

        <section className={cardClass}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">High Break Table</h2>
              <p className="mt-1 text-sm text-slate-600">
                {mode === "singles"
                  ? "Ranked by individual high break, then century count and 30+ breaks."
                  : "Ranked by team high break, then century count and 30+ breaks."}
              </p>
            </div>
            <p className="text-sm text-slate-500">{highBreakRows.length} {mode === "singles" ? "players" : "teams"} listed</p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
            <table className="min-w-full text-left align-middle">
              <thead>
                <tr className="text-slate-700">
                  <th className={tableNumericHeaderClass}>Rank</th>
                  <th className={tableHeaderTextClass}>{mode === "singles" ? "Player" : "Team"}</th>
                  <th className={tableHeaderTextClass}>Club</th>
                  <th className={tableNumericHeaderClass}>High Break</th>
                  <th className={tableNumericHeaderClass}>Century Breaks</th>
                  <th className={tableNumericHeaderClass}>Breaks 30+</th>
                  <th className={tableNumericHeaderClass}>Matches Counted</th>
                </tr>
              </thead>
              <tbody>
                {highBreakRows.map((row, index) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className={tableNumericCellClass}>{index + 1}</td>
                    <td className={`${tableCellTextClass} font-medium text-slate-900`}>{row.label}</td>
                    <td className={tableCellTextClass}>{row.club}</td>
                    <td className={tableNumericCellClass}>{row.highBreak}</td>
                    <td className={tableNumericCellClass}>{row.centuryBreaks}</td>
                    <td className={tableNumericCellClass}>{row.breaksOver30}</td>
                    <td className={tableNumericCellClass}>{row.matchesCounted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !highBreakRows.length ? <p className="px-3 py-4 text-sm text-slate-600">No high-break data for the current filters.</p> : null}
            {loading ? <p className="px-3 py-4 text-sm text-slate-600">Loading high-break table...</p> : null}
          </div>
        </section>
      </div>
    </RequireAuth>
  );
}
