"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";
import useAdminStatus from "@/components/useAdminStatus";
import MessageModal from "@/components/MessageModal";
import ConfirmModal from "@/components/ConfirmModal";

type Competition = {
  id: string;
  name: string;
  venue: string | null;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  competition_format: "knockout" | "league";
  match_mode?: "singles" | "doubles";
  app_assign_opening_break?: boolean;
  best_of: number;
  knockout_round_best_of?: {
    round1?: number;
    semi_final?: number;
    final?: number;
  } | null;
  signup_open?: boolean;
  signup_deadline?: string | null;
  max_entries?: number | null;
  league_meetings?: number | null;
  league_start_date?: string | null;
};
type Match = {
  id: string;
  round_no: number | null;
  match_no: number | null;
  best_of: number;
  status: "pending" | "in_progress" | "complete" | "bye";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id?: string | null;
  team1_player2_id?: string | null;
  team2_player1_id?: string | null;
  team2_player2_id?: string | null;
  winner_player_id: string | null;
  scheduled_for?: string | null;
};
type Player = { id: string; display_name: string; full_name: string | null };
type Entry = {
  id: string;
  competition_id: string;
  requester_user_id: string;
  player_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  created_at: string;
};
type View = "fixtures" | "bracket";
type BracketNode = {
  id: string;
  roundNo: number;
  matchNo: number;
  bestOf: number;
  status: Match["status"] | "tbc";
  p1: string;
  p2: string;
  winnerId: string | null;
};
type FixtureRow = {
  id: string | null;
  roundNo: number;
  matchNo: number;
  bestOf: number;
  label: string;
  status: string;
  isPlaceholder: boolean;
  displayMatchNo: number;
};
const BRACKET_CARD_HEIGHT = 112;
const BRACKET_STEP = 136;

function getRoundLabel(roundNo: number, totalRounds: number): string {
  if (totalRounds <= 1) return "Final";
  if (roundNo === totalRounds) return "Final";
  if (roundNo === totalRounds - 1) return "Semi-final";
  if (roundNo === totalRounds - 2) return "Quarter-final";
  if (roundNo === totalRounds - 3) return "Last 16";
  return `Round ${roundNo}`;
}

function resolveWinnerSide(m: Match): 1 | 2 | 0 {
  if (!m.winner_player_id) return 0;
  if (m.team1_player1_id || m.team1_player2_id || m.team2_player1_id || m.team2_player2_id) {
    if (m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id) return 1;
    if (m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id) return 2;
    return 0;
  }
  if (m.winner_player_id === m.player1_id) return 1;
  if (m.winner_player_id === m.player2_id) return 2;
  return 0;
}

function getDisplayMatchNo(competition: Competition | null, round1MatchCount: number, roundNo: number, roundMatchNo: number) {
  if (!competition || competition.competition_format !== "knockout") return roundMatchNo;
  let offset = 0;
  for (let r = 1; r < roundNo; r += 1) {
    offset += Math.max(1, Math.floor(round1MatchCount / Math.pow(2, r - 1)));
  }
  return offset + roundMatchNo;
}

function getRoundBestOf(competition: Competition | null, roundNo: number, totalRounds: number, fallback: number) {
  const cfg = competition?.knockout_round_best_of;
  if (!cfg) return fallback;
  if (roundNo >= totalRounds) return cfg.final ?? fallback;
  if (roundNo === totalRounds - 1) return cfg.semi_final ?? fallback;
  return cfg.round1 ?? fallback;
}

function getSinglesWinner(m: Match): string | null {
  if (!(m.status === "complete" || m.status === "bye")) return null;
  if (m.winner_player_id && (m.winner_player_id === m.player1_id || m.winner_player_id === m.player2_id)) return m.winner_player_id;
  return null;
}

function getDoublesWinnerTeam(m: Match): { p1: string; p2: string } | null {
  if (!(m.status === "complete" || m.status === "bye") || !m.winner_player_id) return null;
  if (!m.team1_player1_id || !m.team1_player2_id || !m.team2_player1_id || !m.team2_player2_id) return null;
  if (m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id) {
    return { p1: m.team1_player1_id, p2: m.team1_player2_id };
  }
  if (m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id) {
    return { p1: m.team2_player1_id, p2: m.team2_player2_id };
  }
  return null;
}

async function ensureKnockoutNextRoundMatches(
  client: NonNullable<typeof supabase>,
  comp: Competition,
  loadedMatches: Match[]
): Promise<boolean> {
  if (comp.competition_format !== "knockout") return false;
  const byKey = new Map<string, Match>();
  loadedMatches.forEach((m) => byKey.set(`${m.round_no ?? 1}-${m.match_no ?? 1}`, m));
  const round1Count = Math.max(
    1,
    loadedMatches.filter((m) => (m.round_no ?? 1) === 1).reduce((max, m) => Math.max(max, m.match_no ?? 1), 1)
  );
  const totalRounds = Math.max(1, Math.log2(round1Count * 2));
  let changed = false;

  for (let roundNo = 1; roundNo < totalRounds; roundNo += 1) {
    const feederCount = Math.max(1, Math.floor(round1Count / Math.pow(2, roundNo - 1)));
    const nextCount = Math.max(1, Math.floor(feederCount / 2));
    for (let nextMatchNo = 1; nextMatchNo <= nextCount; nextMatchNo += 1) {
      const feederA = byKey.get(`${roundNo}-${(nextMatchNo * 2) - 1}`);
      const feederB = byKey.get(`${roundNo}-${nextMatchNo * 2}`);
      if (!feederA || !feederB) continue;
      if (byKey.has(`${roundNo + 1}-${nextMatchNo}`)) continue;

      if ((comp.match_mode ?? "singles") === "doubles") {
        const aTeam = getDoublesWinnerTeam(feederA);
        const bTeam = getDoublesWinnerTeam(feederB);
        if (!aTeam || !bTeam) continue;
        const breakerChoices = [aTeam.p1, aTeam.p2, bTeam.p1, bTeam.p2];
        const openingBreaker = comp.app_assign_opening_break
          ? breakerChoices[(roundNo + nextMatchNo - 2) % breakerChoices.length]
          : null;
        const payload = {
          competition_id: comp.id,
          round_no: roundNo + 1,
          match_no: nextMatchNo,
          best_of: getRoundBestOf(comp, roundNo + 1, totalRounds, comp.best_of),
          status: "pending" as const,
          match_mode: "doubles" as const,
          player1_id: null,
          player2_id: null,
          team1_player1_id: aTeam.p1,
          team1_player2_id: aTeam.p2,
          team2_player1_id: bTeam.p1,
          team2_player2_id: bTeam.p2,
          winner_player_id: null,
          opening_break_player_id: openingBreaker,
        };
        const ins = await client.from("matches").insert(payload).select("id").single();
        if (!ins.error && ins.data) {
          changed = true;
          byKey.set(`${roundNo + 1}-${nextMatchNo}`, { ...payload, id: ins.data.id } as Match);
        }
      } else {
        const aWinner = getSinglesWinner(feederA);
        const bWinner = getSinglesWinner(feederB);
        if (!aWinner || !bWinner) continue;
        const openingBreaker = comp.app_assign_opening_break ? ((roundNo + nextMatchNo) % 2 === 0 ? aWinner : bWinner) : null;
        const payload = {
          competition_id: comp.id,
          round_no: roundNo + 1,
          match_no: nextMatchNo,
          best_of: getRoundBestOf(comp, roundNo + 1, totalRounds, comp.best_of),
          status: "pending" as const,
          match_mode: "singles" as const,
          player1_id: aWinner,
          player2_id: bWinner,
          team1_player1_id: null,
          team1_player2_id: null,
          team2_player1_id: null,
          team2_player2_id: null,
          winner_player_id: null,
          opening_break_player_id: openingBreaker,
        };
        const ins = await client.from("matches").insert(payload).select("id").single();
        if (!ins.error && ins.data) {
          changed = true;
          byKey.set(`${roundNo + 1}-${nextMatchNo}`, { ...payload, id: ins.data.id } as Match);
        }
      }
    }
  }
  return changed;
}

function getMatchLabel(m: Match, shortMap: Map<string, string>) {
  if (m.team1_player1_id || m.team1_player2_id || m.team2_player1_id || m.team2_player2_id) {
    const t1a = shortMap.get(m.team1_player1_id ?? "") ?? "TBC";
    const t1b = shortMap.get(m.team1_player2_id ?? "") ?? "TBC";
    const t2a = shortMap.get(m.team2_player1_id ?? "") ?? "TBC";
    const t2b = shortMap.get(m.team2_player2_id ?? "") ?? "TBC";
    return `${t1a} & ${t1b} vs ${t2a} & ${t2b}`;
  }
  if (m.status === "bye" && m.player1_id && m.player1_id === m.player2_id) {
    return `${shortMap.get(m.player1_id) ?? "TBC"} vs BYE`;
  }
  return `${shortMap.get(m.player1_id ?? "") ?? "TBC"} vs ${shortMap.get(m.player2_id ?? "") ?? "TBC"}`;
}

function generateLeagueRounds(playerIds: string[], meetings: number) {
  if (playerIds.length < 2) return [] as Array<Array<{ player1: string; player2: string }>>;
  let rotation = [...playerIds];
  let hasBye = false;
  if (rotation.length % 2 === 1) {
    rotation = [...rotation, "__BYE__"];
    hasBye = true;
  }

  const rounds: Array<Array<{ player1: string; player2: string }>> = [];
  const roundCount = rotation.length - 1;

  for (let cycle = 0; cycle < meetings; cycle += 1) {
    let order = [...rotation];
    for (let round = 0; round < roundCount; round += 1) {
      const pairings: Array<{ player1: string; player2: string }> = [];
      for (let i = 0; i < order.length / 2; i += 1) {
        const a = order[i];
        const b = order[order.length - 1 - i];
        if (hasBye && (a === "__BYE__" || b === "__BYE__")) continue;
        if ((cycle + round) % 2 === 0) {
          pairings.push({ player1: a, player2: b });
        } else {
          pairings.push({ player1: b, player2: a });
        }
      }
      rounds.push(pairings);
      const fixed = order[0];
      const rest = order.slice(1);
      rest.unshift(rest.pop() as string);
      order = [fixed, ...rest];
    }
  }

  return rounds;
}

export default function CompetitionPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const admin = useAdminStatus();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [signupDeadlineInput, setSignupDeadlineInput] = useState("");
  const [signupMaxEntriesInput, setSignupMaxEntriesInput] = useState("");
  const [leagueMeetingsInput, setLeagueMeetingsInput] = useState("2");
  const [leagueStartDateInput, setLeagueStartDateInput] = useState("");
  const [view, setView] = useState<View>("fixtures");
  const [message, setMessage] = useState<string | null>(null);
  const [generatingLeagueFixtures, setGeneratingLeagueFixtures] = useState(false);
  const [confirmLeagueGenerationOpen, setConfirmLeagueGenerationOpen] = useState(false);

  const openBracketDisplay = () => {
    if (!id) return;
    const url = `/display/bracket/${id}`;
    window.open(url, "_blank", "noopener,noreferrer,width=1400,height=900");
  };
  const openMatchDisplay = () => {
    if (!matches.length) return;
    const inProgress = matches.find((m) => m.status === "in_progress");
    const pending = matches.find((m) => m.status === "pending");
    const target = inProgress ?? pending ?? matches[0];
    if (!target) return;
    const url = `/display/quick/${target.id}`;
    window.open(url, "_blank", "noopener,noreferrer,width=1280,height=720");
  };

  const updateSignupSettings = async (patch: Partial<Competition>) => {
    const client = supabase;
    if (!client || !competition) return;
    const res = await client.from("competitions").update(patch).eq("id", competition.id);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    setCompetition({ ...competition, ...patch });
  };

  const reviewEntry = async (entryId: string, status: "approved" | "rejected") => {
    const client = supabase;
    if (!client || !admin.userId) return;
    const res = await client
      .from("competition_entries")
      .update({ status, reviewed_by_user_id: admin.userId, reviewed_at: new Date().toISOString() })
      .eq("id", entryId);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status } : e)));
  };

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const load = async () => {
      const [cRes, mRes, pRes] = await Promise.all([
        client
          .from("competitions")
          .select("id,name,venue,sport_type,competition_format,match_mode,app_assign_opening_break,best_of,knockout_round_best_of,signup_open,signup_deadline,max_entries,league_meetings,league_start_date")
          .eq("id", id)
          .single(),
        client
          .from("matches")
          .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,scheduled_for")
          .eq("competition_id", id)
          .eq("is_archived", false)
          .order("round_no")
          .order("match_no"),
        client.from("players").select("id,display_name,full_name"),
      ]);
      if (!active) return;
      if (cRes.error || !cRes.data) {
        setMessage(cRes.error?.message ?? "Failed to load competition.");
        return;
      }
      const comp = cRes.data as Competition;
      let loadedMatches = (mRes.data ?? []) as Match[];
      setCompetition(comp);
      const changed = await ensureKnockoutNextRoundMatches(client, comp, loadedMatches);
      if (changed) {
        const refreshed = await client
          .from("matches")
          .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,scheduled_for")
          .eq("competition_id", id)
          .eq("is_archived", false)
          .order("round_no")
          .order("match_no");
        if (refreshed.data) loadedMatches = refreshed.data as Match[];
      }
      setMatches(loadedMatches);
      setPlayers((pRes.data ?? []) as Player[]);
      const entryRes = await client
        .from("competition_entries")
        .select("id,competition_id,requester_user_id,player_id,status,created_at")
        .eq("competition_id", id)
        .neq("status", "withdrawn")
        .order("created_at", { ascending: false });
      if (entryRes.data) setEntries(entryRes.data as Entry[]);
      setSignupDeadlineInput(comp.signup_deadline ? new Date(comp.signup_deadline).toISOString().slice(0, 16) : "");
      setSignupMaxEntriesInput(comp.max_entries ? String(comp.max_entries) : "");
      setLeagueMeetingsInput(String(comp.league_meetings ?? 2));
      setLeagueStartDateInput(comp.league_start_date ? String(comp.league_start_date) : "");
    };
    load();
    return () => {
      active = false;
    };
  }, [id]);

  const shortMap = useMemo(() => new Map(players.map((p) => [p.id, p.display_name])), [players]);
  const fullMap = useMemo(
    () => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])),
    [players]
  );
  const round1MatchCount = useMemo(
    () => Math.max(1, matches.filter((m) => (m.round_no ?? 1) === 1).reduce((max, m) => Math.max(max, m.match_no ?? 1), 1)),
    [matches]
  );
  const pendingEntries = useMemo(() => entries.filter((e) => e.status === "pending"), [entries]);
  const approvedEntries = useMemo(() => entries.filter((e) => e.status === "approved"), [entries]);
  const approvedLeaguePlayerIds = useMemo(() => approvedEntries.map((entry) => entry.player_id), [approvedEntries]);
  const projectedLeagueRounds = useMemo(() => {
    const meetings = Number.parseInt(leagueMeetingsInput, 10);
    if (!Number.isInteger(meetings) || meetings < 1 || meetings > 4) return [];
    return generateLeagueRounds(approvedLeaguePlayerIds, meetings);
  }, [approvedLeaguePlayerIds, leagueMeetingsInput]);
  const projectedLeagueFixtureCount = useMemo(
    () => projectedLeagueRounds.reduce((total, round) => total + round.length, 0),
    [projectedLeagueRounds]
  );

  const generateLeagueFixtures = async () => {
    const client = supabase;
    if (!client || !competition || competition.competition_format !== "league") return;
    if (!admin.isAdmin) return;
    if (matches.length > 0) {
      setMessage("League fixtures have already been generated for this competition.");
      return;
    }
    if (approvedLeaguePlayerIds.length < 2) {
      setMessage("Approve at least 2 player entries before generating league fixtures.");
      return;
    }
    const meetings = Number.parseInt(leagueMeetingsInput, 10);
    if (!Number.isInteger(meetings) || meetings < 1 || meetings > 4) {
      setMessage("Meet each opponent must be between 1 and 4.");
      return;
    }
    if (!leagueStartDateInput) {
      setMessage("Choose a start date before generating weekly fixtures.");
      return;
    }

    const rounds = generateLeagueRounds(approvedLeaguePlayerIds, meetings);
    const start = new Date(`${leagueStartDateInput}T12:00:00`);
    if (Number.isNaN(start.getTime())) {
      setMessage("Choose a valid start date.");
      return;
    }

    const fixtureRows = rounds.flatMap((round, roundIndex) =>
      round.map((pairing, matchIndex) => {
        const scheduled = new Date(start);
        scheduled.setDate(start.getDate() + (roundIndex * 7));
        return {
          competition_id: competition.id,
          round_no: roundIndex + 1,
          match_no: matchIndex + 1,
          best_of: competition.best_of,
          status: "pending" as const,
          match_mode: "singles" as const,
          player1_id: pairing.player1,
          player2_id: pairing.player2,
          winner_player_id: null,
          opening_break_player_id: null,
          scheduled_for: scheduled.toISOString().slice(0, 10),
        };
      })
    );

    setGeneratingLeagueFixtures(true);
    const updateRes = await client
      .from("competitions")
      .update({
        league_meetings: meetings,
        league_start_date: leagueStartDateInput,
      })
      .eq("id", competition.id);
    if (updateRes.error) {
      setGeneratingLeagueFixtures(false);
      setMessage(updateRes.error.message);
      return;
    }

    const insertRes = await client.from("matches").insert(fixtureRows);
    setGeneratingLeagueFixtures(false);
    if (insertRes.error) {
      setMessage(insertRes.error.message);
      return;
    }
    setMessage(`League fixtures generated for ${rounds.length} week${rounds.length === 1 ? "" : "s"}.`);
    setCompetition({ ...competition, league_meetings: meetings, league_start_date: leagueStartDateInput });
    const reload = await client
      .from("matches")
      .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,scheduled_for")
      .eq("competition_id", competition.id)
      .eq("is_archived", false)
      .order("round_no")
      .order("match_no");
    if (reload.data) setMatches(reload.data as Match[]);
  };

  const bracketRounds = useMemo(() => {
    if (!competition || competition.competition_format !== "knockout") return [];

    const byKey = new Map<string, Match>();
    matches.forEach((m) => {
      byKey.set(`${m.round_no ?? 1}-${m.match_no ?? 1}`, m);
    });

    const totalRounds = Math.max(1, Math.log2(round1MatchCount * 2));

    const out: BracketNode[][] = [];
    for (let roundNo = 1; roundNo <= totalRounds; roundNo += 1) {
      const matchCount = Math.max(1, Math.floor(round1MatchCount / Math.pow(2, roundNo - 1)));
      const row: BracketNode[] = [];
      for (let matchNo = 1; matchNo <= matchCount; matchNo += 1) {
        const live = byKey.get(`${roundNo}-${matchNo}`);
        let p1 = shortMap.get(live?.player1_id ?? "") ?? "TBC";
        let p2 = shortMap.get(live?.player2_id ?? "") ?? "TBC";
        const status: BracketNode["status"] = live?.status ?? "tbc";
        const winnerId = live?.winner_player_id ?? null;

        if (!live && roundNo > 1) {
          const prevA = byKey.get(`${roundNo - 1}-${(matchNo * 2) - 1}`);
          const prevB = byKey.get(`${roundNo - 1}-${matchNo * 2}`);
          const prevASide = prevA ? resolveWinnerSide(prevA) : 0;
          const prevBSide = prevB ? resolveWinnerSide(prevB) : 0;
          const prevAWinner = prevA && (prevA.status === "complete" || prevA.status === "bye") && prevASide
            ? (
                prevA.team1_player1_id || prevA.team2_player1_id
                  ? (
                      prevASide === 1
                        ? `${shortMap.get(prevA.team1_player1_id ?? "") ?? "TBC"} & ${shortMap.get(prevA.team1_player2_id ?? "") ?? "TBC"}`
                        : `${shortMap.get(prevA.team2_player1_id ?? "") ?? "TBC"} & ${shortMap.get(prevA.team2_player2_id ?? "") ?? "TBC"}`
                    )
                  : (shortMap.get(prevA.winner_player_id ?? "") ?? "TBC")
              )
            : "TBC";
          const prevBWinner = prevB && (prevB.status === "complete" || prevB.status === "bye") && prevBSide
            ? (
                prevB.team1_player1_id || prevB.team2_player1_id
                  ? (
                      prevBSide === 1
                        ? `${shortMap.get(prevB.team1_player1_id ?? "") ?? "TBC"} & ${shortMap.get(prevB.team1_player2_id ?? "") ?? "TBC"}`
                        : `${shortMap.get(prevB.team2_player1_id ?? "") ?? "TBC"} & ${shortMap.get(prevB.team2_player2_id ?? "") ?? "TBC"}`
                    )
                  : (shortMap.get(prevB.winner_player_id ?? "") ?? "TBC")
              )
            : "TBC";
          p1 = prevAWinner;
          p2 = prevBWinner;
        }

        if (status === "bye" && live?.player1_id && live.player1_id === live.player2_id) {
          p2 = "BYE";
        }
        if (live && (live.team1_player1_id || live.team2_player1_id)) {
          const t1a = shortMap.get(live.team1_player1_id ?? "") ?? "TBC";
          const t1b = shortMap.get(live.team1_player2_id ?? "") ?? "TBC";
          const t2a = shortMap.get(live.team2_player1_id ?? "") ?? "TBC";
          const t2b = shortMap.get(live.team2_player2_id ?? "") ?? "TBC";
          p1 = `${t1a} & ${t1b}`;
          p2 = `${t2a} & ${t2b}`;
        }

        row.push({
          id: live?.id ?? `tbc-${roundNo}-${matchNo}`,
          roundNo,
          matchNo,
          bestOf: live?.best_of ?? getRoundBestOf(competition, roundNo, totalRounds, competition.best_of),
          status,
          p1,
          p2,
          winnerId,
        });
      }
      out.push(row);
    }
    return out;
  }, [competition, matches, shortMap, round1MatchCount]);
  const totalBracketRounds = bracketRounds.length;
  const matchesByKey = useMemo(() => {
    const m = new Map<string, Match>();
    for (const match of matches) m.set(`${match.round_no ?? 1}-${match.match_no ?? 1}`, match);
    return m;
  }, [matches]);

  const getStatusLabel = (m: Match) => (m.status === "bye" ? "Locked" : m.status.replace("_", " "));
  const fixtureRowsByRound = useMemo(() => {
    if (!competition) return [] as Array<{ roundNo: number; title: string; bestOf: number; rows: FixtureRow[] }>;
    const roundCount = Math.max(1, totalBracketRounds);
    const out: Array<{ roundNo: number; title: string; bestOf: number; rows: FixtureRow[] }> = [];
    for (let roundNo = 1; roundNo <= roundCount; roundNo += 1) {
      const count = Math.max(1, Math.floor(round1MatchCount / Math.pow(2, roundNo - 1)));
      const bestOf = getRoundBestOf(competition, roundNo, roundCount, competition.best_of);
      const rows: FixtureRow[] = [];
      for (let matchNo = 1; matchNo <= count; matchNo += 1) {
        const live = matchesByKey.get(`${roundNo}-${matchNo}`);
        const displayMatchNo = getDisplayMatchNo(competition, round1MatchCount, roundNo, matchNo);
        if (live) {
          rows.push({
            id: live.id,
            roundNo,
            matchNo,
            bestOf: live.best_of,
            label: getMatchLabel(live, shortMap),
            status: getStatusLabel(live),
            isPlaceholder: false,
            displayMatchNo,
          });
        } else if (roundNo > 1) {
          const leftDisplay = getDisplayMatchNo(competition, round1MatchCount, roundNo - 1, (matchNo * 2) - 1);
          const rightDisplay = getDisplayMatchNo(competition, round1MatchCount, roundNo - 1, matchNo * 2);
          rows.push({
            id: null,
            roundNo,
            matchNo,
            bestOf,
            label: `Winner of Match ${leftDisplay} vs Winner of Match ${rightDisplay}`,
            status: "Pending",
            isPlaceholder: true,
            displayMatchNo,
          });
        } else {
          rows.push({
            id: null,
            roundNo,
            matchNo,
            bestOf,
            label: "TBC vs TBC",
            status: "Pending",
            isPlaceholder: true,
            displayMatchNo,
          });
        }
      }
      out.push({
        roundNo,
        title: getRoundLabel(roundNo, roundCount),
        bestOf,
        rows,
      });
    }
    return out;
  }, [competition, totalBracketRounds, round1MatchCount, matchesByKey, shortMap]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Competition"
            eyebrow="Event"
            subtitle={competition?.competition_format === "league" ? "Player field, sign-ups, and league status." : "Fixtures, bracket, and live status."}
            actions={
              <>
                {competition?.competition_format === "knockout" ? (
                  <button
                    type="button"
                    onClick={openBracketDisplay}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-slate-700"
                  >
                    Open Bracket Display
                  </button>
                ) : null}
                {admin.isAdmin && competition?.competition_format === "knockout" ? (
                  <button
                    type="button"
                    onClick={openMatchDisplay}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-slate-700"
                  >
                    Open Match Display
                  </button>
                ) : null}
              </>
            }
          />
          <MessageModal message={message ?? (!supabase ? "Supabase is not configured." : null)} onClose={() => setMessage(null)} />
          {competition ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-3xl font-semibold text-slate-900">{competition.name}</h2>
                <p className="mt-1 text-slate-700">Venue: {competition.venue || "-"}</p>
                <p className="mt-1 text-slate-700">Format: {competition.competition_format}</p>
                <p className="mt-1 text-slate-700">Best of {competition.best_of}</p>
                {competition.competition_format === "league" ? (
                  <>
                    <p className="mt-2 text-sm text-slate-600">
                      This is a club league competition. Use sign-ups and approved entries to manage the field.
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {competition.league_meetings ? `Each opponent: ${competition.league_meetings} time${competition.league_meetings === 1 ? "" : "s"}` : "Fixtures not generated yet."}
                      {competition.league_start_date ? ` · Start date: ${competition.league_start_date}` : ""}
                    </p>
                  </>
                ) : null}
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-semibold text-slate-900">Competition Sign-ups</p>
                  <Link href="/signups" className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50">
                    Enter or review sign-ups
                  </Link>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Status: {competition.signup_open ? "Open" : "Closed"} · Pending {pendingEntries.length} · Approved {approvedEntries.length}
                  {competition.max_entries ? ` / Max ${competition.max_entries}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Players enter through the Competition Sign-ups page. Super User entries are approved automatically.
                </p>
                {competition.signup_deadline ? (
                  <p className="mt-1 text-sm text-slate-600">Deadline: {new Date(competition.signup_deadline).toLocaleString()}</p>
                ) : null}
                {admin.isAdmin ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void updateSignupSettings({ signup_open: !competition.signup_open })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {competition.signup_open ? "Close Sign-ups" : "Open Sign-ups"}
                    </button>
                    <input
                      type="datetime-local"
                      value={signupDeadlineInput}
                      onChange={(e) => setSignupDeadlineInput(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    />
                    <input
                      type="number"
                      min={1}
                      placeholder="Max entries (optional)"
                      value={signupMaxEntriesInput}
                      onChange={(e) => setSignupMaxEntriesInput(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void updateSignupSettings({
                          signup_deadline: signupDeadlineInput ? new Date(signupDeadlineInput).toISOString() : null,
                          max_entries: signupMaxEntriesInput ? Number.parseInt(signupMaxEntriesInput, 10) : null,
                        })
                      }
                      className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      Save Sign-up Settings
                    </button>
                  </div>
                ) : null}
                {entries.length > 0 ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {entries.map((entry) => (
                      <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-sm text-slate-800">
                          {fullMap.get(entry.player_id) ?? shortMap.get(entry.player_id) ?? "Unknown player"}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">{entry.status}</span>
                          {admin.isAdmin && entry.status === "pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void reviewEntry(entry.id, "approved")}
                                className="rounded-lg bg-emerald-700 px-2 py-1 text-xs text-white"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void reviewEntry(entry.id, "rejected")}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                              >
                                Reject
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">No entries yet.</p>
                )}
              </section>
              {competition.competition_format === "league" ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-lg font-semibold text-slate-900">League field</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Approved and pending player entries are shown above. Knockout-only bracket and fixture views are not used for league competitions.
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Weekly fixtures should be played by 21:00 on Sunday. If a fixture is not played in time it should normally be voided, with admin awarding the frame or rack only for a genuine no-show.
                  </p>
                  {admin.isAdmin ? (
                    <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
                      <label className="flex flex-col gap-1 text-sm text-slate-700">
                        Meet each opponent
                        <select
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={leagueMeetingsInput}
                          onChange={(e) => setLeagueMeetingsInput(e.target.value)}
                        >
                          {[1, 2, 3, 4].map((value) => (
                            <option key={value} value={value}>
                              {value} time{value === 1 ? "" : "s"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-slate-700">
                        First week start date
                        <input
                          type="date"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={leagueStartDateInput}
                          onChange={(e) => setLeagueStartDateInput(e.target.value)}
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => setConfirmLeagueGenerationOpen(true)}
                          disabled={generatingLeagueFixtures || matches.length > 0}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                        >
                          {generatingLeagueFixtures ? "Generating..." : matches.length > 0 ? "Fixtures Generated" : "Create Weekly Fixtures"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {matches.length ? (
                    <div className="mt-4 space-y-2">
                      {matches.map((match) => (
                        <article key={match.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-sm font-semibold text-slate-900">
                            Week {match.round_no ?? "?"} · Match {match.match_no ?? "?"}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">{getMatchLabel(match, shortMap)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {match.scheduled_for ? `Scheduled for ${match.scheduled_for}` : "Weekly fixture"} · {match.status.replace("_", " ")}
                          </p>
                          <Link href={`/matches/${match.id}`} className="mt-2 inline-block text-sm font-medium text-teal-700 underline">
                            {admin.isAdmin ? (match.status === "complete" ? "Edit match" : "Open match") : "Submit result"}
                          </Link>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">No weekly fixtures generated yet.</p>
                  )}
                </section>
              ) : (
              <section className="space-y-2">
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setView("fixtures")}
                    className={`rounded-md px-3 py-1 text-sm ${view === "fixtures" ? "bg-teal-600 text-white" : "text-slate-700"}`}
                  >
                    Fixture List
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("bracket")}
                    className={`rounded-md px-3 py-1 text-sm ${view === "bracket" ? "bg-teal-600 text-white" : "text-slate-700"}`}
                  >
                    Bracket
                  </button>
                </div>

                {view === "fixtures" ? (
                  <div className="space-y-2">
                    {fixtureRowsByRound.map((round) => (
                      <div key={`fixtures-round-${round.roundNo}`} className="space-y-2">
                        <div className="rounded-xl border border-teal-300 bg-teal-50 px-4 py-2">
                          <p className="text-sm font-semibold text-teal-900">
                            {round.title} · Best of {round.bestOf}{" "}
                            {competition.sport_type === "snooker" ? "frames" : "racks"}
                          </p>
                        </div>
                        {round.rows.map((m) => (
                          <article key={`${round.roundNo}-${m.matchNo}-${m.id ?? "placeholder"}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <p className="text-sm text-slate-600">
                              Round {m.roundNo} · Match {m.displayMatchNo}
                            </p>
                            <p className="mt-1 text-2xl font-semibold text-slate-900">{m.label}</p>
                            <p className="mt-1 text-slate-700">Status: {m.status}</p>
                            {m.id ? (
                              <Link href={`/matches/${m.id}`} className="mt-2 inline-block text-sm font-medium text-teal-700 underline">
                                {admin.isAdmin ? (m.status === "complete" ? "Edit match" : "Open match") : "Submit result"}
                              </Link>
                            ) : (
                              <p className="mt-2 text-sm text-slate-500">Match will auto-create when feeder results are ready.</p>
                            )}
                          </article>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex min-w-max gap-6 py-2">
                      {bracketRounds.map((round, roundIndex) => (
                        <div key={roundIndex} className="w-72 shrink-0">
                          <h3 className="mb-2 h-5 text-sm font-medium text-slate-600">
                            {getRoundLabel(roundIndex + 1, totalBracketRounds)}
                          </h3>
                          <div
                            className="relative"
                            style={{ height: `${Math.max(1, bracketRounds[0]?.length ?? 1) * BRACKET_STEP}px` }}
                          >
                            {round.map((node) => {
                              const block = Math.pow(2, roundIndex);
                              const centerY = ((node.matchNo - 0.5) * block * BRACKET_STEP);
                              const top = centerY - (BRACKET_CARD_HEIGHT / 2);
                              return (
                                <div key={`${node.roundNo}-${node.matchNo}`} className="absolute left-0 right-0" style={{ top: `${top}px` }}>
                                  <article className="h-28 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-xs text-slate-600">
                                      Match {getDisplayMatchNo(competition, round1MatchCount, node.roundNo, node.matchNo)}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">{node.p1} vs {node.p2}</p>
                                    <p className="mt-1 text-xs text-slate-700">Best of {node.bestOf}</p>
                                    <p className="mt-1 text-xs text-slate-700">
                                      Status: {node.status === "bye" ? "Locked" : node.status === "tbc" ? "TBC" : node.status.replace("_", " ")}
                                    </p>
                                  </article>
                                  {roundIndex < bracketRounds.length - 1 ? (
                                    <div className="pointer-events-none absolute -right-6 top-1/2 h-px w-6 -translate-y-1/2 bg-amber-300" />
                                  ) : null}
                                </div>
                              );
                            })}
                            {roundIndex < bracketRounds.length - 1
                              ? Array.from({ length: Math.floor(round.length / 2) }, (_, pairIdx) => {
                                  const a = (pairIdx * 2) + 1;
                                  const b = a + 1;
                                  const block = Math.pow(2, roundIndex);
                                  const centerA = ((a - 0.5) * block * BRACKET_STEP);
                                  const centerB = ((b - 0.5) * block * BRACKET_STEP);
                                  return (
                                    <div
                                      key={`join-${roundIndex}-${pairIdx}`}
                                      className="pointer-events-none absolute -right-6 w-px bg-amber-300"
                                      style={{ top: `${centerA}px`, height: `${centerB - centerA}px` }}
                                    />
                                  );
                                })
                              : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
              )}
            </>
          ) : null}
        </RequireAuth>
        <ConfirmModal
          open={confirmLeagueGenerationOpen}
          title="Generate weekly league fixtures?"
          description={
            projectedLeagueFixtureCount > 0
              ? `This will generate ${projectedLeagueFixtureCount} weekly fixture${projectedLeagueFixtureCount === 1 ? "" : "s"} for the approved league field.`
              : "This will generate weekly fixtures for the approved league field."
          }
          confirmLabel="Generate Fixtures"
          cancelLabel="Cancel"
          onCancel={() => setConfirmLeagueGenerationOpen(false)}
          onConfirm={async () => {
            setConfirmLeagueGenerationOpen(false);
            await generateLeagueFixtures();
          }}
        />
      </div>
    </main>
  );
}
