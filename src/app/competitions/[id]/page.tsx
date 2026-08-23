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
import { calculateSnookerHandicapStarts, MAX_SNOOKER_START } from "@/lib/snooker-handicap";
import { isLegionMastersLeague } from "@/lib/legion-masters";

type Competition = {
  id: string;
  name: string;
  venue: string | null;
  location_id: string | null;
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
  league_break_weeks?: string[] | null;
  league_schedule_mode?: "weekly" | "one_day";
  league_finals_size?: number | null;
  league_semi_final_best_of?: number | null;
  league_final_best_of?: number | null;
  handicap_enabled?: boolean;
  entry_fee_pence?: number | null;
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
  opening_break_player_id?: string | null;
  scheduled_for?: string | null;
  team1_handicap_start?: number | null;
  team2_handicap_start?: number | null;
};
type Player = { id: string; display_name: string; full_name: string | null; snooker_handicap?: number | null };
type AppUserLink = { id: string; linked_player_id: string | null };
type CompetitionContact = { entryId: string; playerId: string; name: string; email: string | null; phone: string | null; fixtureAccessToken: string | null };
type AdminCompetitionTab = "overview" | "entrants" | "fixtures" | "table" | "settings";
type Entry = {
  id: string;
  competition_id: string;
  requester_user_id: string;
  player_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  payment_status: "not_required" | "pending" | "paid" | "failed";
  payment_method: "stripe" | "cash" | null;
  payment_amount_pence: number | null;
  paid_at: string | null;
  public_signup_id: string | null;
  created_at: string;
};
type GuestEntry = {
  id: string;
  competition_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  status: "pending" | "added" | "rejected";
  payment_status: "not_required" | "pending" | "paid" | "failed";
  payment_method: "stripe" | "cash" | null;
  payment_amount_pence: number | null;
  paid_at: string | null;
  created_at: string;
  suggestions?: Array<{ id: string; display_name: string; full_name: string | null; claimed_by: string | null; score: number }>;
};
type ResultSubmission = {
  id: string;
  match_id: string;
  submitted_by_user_id: string;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
};
type Frame = {
  match_id: string;
  winner_player_id: string | null;
};

const paidDateTime = (value: string) => new Date(value).toLocaleString("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});
const paidMethodLabel = (method: Entry["payment_method"] | GuestEntry["payment_method"]) =>
  method === "cash" ? " cash" : method === "stripe" ? " by Stripe" : "";
type LeaguePairing = {
  player1: string;
  player2: string | null;
  isBye: boolean;
  pairKey: string | null;
  meetingNumber: number;
};
type View = "fixtures" | "bracket";
type LeagueFixtureFilterMode = "all" | "week" | "player";
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
const BEST_OF_OPTIONS = [1, 3, 5, 7, 9, 11, 13, 15];

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
  loadedMatches: Match[],
  playerHandicapById: Map<string, number>
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
          team1_handicap_start: 0,
          team2_handicap_start: 0,
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
        const handicapStarts = comp.handicap_enabled && comp.sport_type === "snooker"
          ? calculateSnookerHandicapStarts(playerHandicapById.get(aWinner), playerHandicapById.get(bWinner))
          : { team1: 0, team2: 0 };
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
          team1_handicap_start: handicapStarts.team1,
          team2_handicap_start: handicapStarts.team2,
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
  if (playerIds.length < 2) return [] as LeaguePairing[][];
  let rotation = [...playerIds];
  let hasBye = false;
  if (rotation.length % 2 === 1) {
    rotation = [...rotation, "__BYE__"];
    hasBye = true;
  }

  const rounds: LeaguePairing[][] = [];
  const roundCount = rotation.length - 1;
  const meetingCounts = new Map<string, number>();

  for (let cycle = 0; cycle < meetings; cycle += 1) {
    let order = [...rotation];
    for (let round = 0; round < roundCount; round += 1) {
      const pairings: LeaguePairing[] = [];
      for (let i = 0; i < order.length / 2; i += 1) {
        const a = order[i];
        const b = order[order.length - 1 - i];
        if (hasBye && (a === "__BYE__" || b === "__BYE__")) {
          const playerId = a === "__BYE__" ? b : a;
          if (playerId !== "__BYE__") {
            pairings.push({
              player1: playerId,
              player2: null,
              isBye: true,
              pairKey: null,
              meetingNumber: 1,
            });
          }
          continue;
        }
        const pairKey = [a, b].sort().join(":");
        const meetingNumber = (meetingCounts.get(pairKey) ?? 0) + 1;
        meetingCounts.set(pairKey, meetingNumber);
        if ((cycle + round) % 2 === 0) {
          pairings.push({ player1: a, player2: b, isBye: false, pairKey, meetingNumber });
        } else {
          pairings.push({ player1: b, player2: a, isBye: false, pairKey, meetingNumber });
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

function getLeagueFixtureWindow(scheduledFor: string | null | undefined, scheduleMode: "weekly" | "one_day" = "weekly") {
  if (!scheduledFor) return null;
  const [year, month, day] = scheduledFor.split("-").map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return null;
  const opensAt = new Date(year, month - 1, day, scheduleMode === "one_day" ? 0 : 13, 0, 0, 0);
  const dueAt = scheduleMode === "one_day"
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day + 6, 21, 0, 0, 0);
  return { opensAt, dueAt };
}

function formatLeagueFixtureDeadline(scheduledFor: string | null | undefined, scheduleMode: "weekly" | "one_day" = "weekly") {
  const window = getLeagueFixtureWindow(scheduledFor, scheduleMode);
  if (!window) return null;
  return window.dueAt.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

function mondayOfWeek(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function formatBreakWeek(dateValue: string) {
  return new Date(`${dateValue}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function CompetitionPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const admin = useAdminStatus();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [appUserLinks, setAppUserLinks] = useState<AppUserLink[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [guestEntries, setGuestEntries] = useState<GuestEntry[]>([]);
  const [guestActionId, setGuestActionId] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [resultSubmissions, setResultSubmissions] = useState<ResultSubmission[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [viewerLinkedPlayerId, setViewerLinkedPlayerId] = useState<string | null>(null);
  const [signupDeadlineInput, setSignupDeadlineInput] = useState("");
  const [signupMaxEntriesInput, setSignupMaxEntriesInput] = useState("");
  const [leagueMeetingsInput, setLeagueMeetingsInput] = useState("2");
  const [leagueStartDateInput, setLeagueStartDateInput] = useState("");
  const [leagueBreakWeekInput, setLeagueBreakWeekInput] = useState("");
  const [leagueBreakWeeksInput, setLeagueBreakWeeksInput] = useState<string[]>([]);
  const [leagueSemiBestOfInput, setLeagueSemiBestOfInput] = useState("3");
  const [leagueFinalBestOfInput, setLeagueFinalBestOfInput] = useState("5");
  const [view, setView] = useState<View>("fixtures");
  const [leagueFixtureFilterMode, setLeagueFixtureFilterMode] = useState<LeagueFixtureFilterMode>("all");
  const [leagueFixtureFilterWeek, setLeagueFixtureFilterWeek] = useState<string>("all");
  const [leagueFixtureFilterPlayer, setLeagueFixtureFilterPlayer] = useState<string>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [generatingLeagueFixtures, setGeneratingLeagueFixtures] = useState(false);
  const [savingLeagueBreakWeeks, setSavingLeagueBreakWeeks] = useState(false);
  const [confirmBreakScheduleOpen, setConfirmBreakScheduleOpen] = useState(false);
  const [refreshingFutureHandicaps, setRefreshingFutureHandicaps] = useState(false);
  const [confirmLeagueGenerationOpen, setConfirmLeagueGenerationOpen] = useState(false);
  const [entriesExpanded, setEntriesExpanded] = useState(false);
  const [guestEntriesExpanded, setGuestEntriesExpanded] = useState(false);
  const [superEntryPlayerId, setSuperEntryPlayerId] = useState("");
  const [addingSuperEntry, setAddingSuperEntry] = useState(false);
  const [cashPaymentTarget, setCashPaymentTarget] = useState<{ entry: Entry; reset: boolean } | null>(null);
  const [cashPaymentEntryId, setCashPaymentEntryId] = useState<string | null>(null);
  const [creatingMastersCup, setCreatingMastersCup] = useState(false);
  const [competitionContacts, setCompetitionContacts] = useState<CompetitionContact[]>([]);
  const [savingContactEntryId, setSavingContactEntryId] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [adminCompetitionTab, setAdminCompetitionTab] = useState<AdminCompetitionTab>(() => {
    if (typeof window === "undefined") return "overview";
    const saved = window.localStorage.getItem(`competition-admin-tab:${id}`);
    return (["overview", "entrants", "fixtures", "table", "settings"] as AdminCompetitionTab[]).includes(saved as AdminCompetitionTab)
      ? (saved as AdminCompetitionTab)
      : "overview";
  });

  const selectAdminCompetitionTab = (tab: AdminCompetitionTab) => {
    setAdminCompetitionTab(tab);
    if (typeof window !== "undefined") window.localStorage.setItem(`competition-admin-tab:${id}`, tab);
  };
  const showAdminArea = (tab: AdminCompetitionTab) => !admin.isAdmin || competition?.competition_format !== "league" || adminCompetitionTab === tab;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(`competition-admin-tab:${id}`);
      setAdminCompetitionTab(
        (["overview", "entrants", "fixtures", "table", "settings"] as AdminCompetitionTab[]).includes(saved as AdminCompetitionTab)
          ? (saved as AdminCompetitionTab)
          : "overview"
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id]);

  const shareGuestSignup = async () => {
    if (!competition) return;
    const url = `${window.location.origin}/join/${competition.id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Enter ${competition.name}`,
          text: `Sign up for ${competition.name}. No app account is needed.`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await navigator.clipboard.writeText(url);
    setMessage("Public sign-up link copied. You can now paste it into WhatsApp.");
  };

  const copyGuestFixtureLink = async (contact: CompetitionContact) => {
    if (!contact.fixtureAccessToken) return;
    await navigator.clipboard.writeText(`${window.location.origin}/entrant/${contact.fixtureAccessToken}`);
    setMessage(`${contact.name}'s private fixture link was copied. Send it only to that entrant.`);
  };

  const copyPublicLeagueLink = async (section: "fixtures" | "table") => {
    if (!competition) return;
    const url = `${window.location.origin}/league/${competition.id}#${section}`;
    await navigator.clipboard.writeText(url);
    setMessage(`Public league ${section === "fixtures" ? "fixture" : "table"} link copied. You can paste it into WhatsApp.`);
  };

  const addLeagueBreakWeek = () => {
    const monday = mondayOfWeek(leagueBreakWeekInput);
    if (!monday) {
      setMessage("Choose a valid break-week date.");
      return;
    }
    setLeagueBreakWeeksInput((current) => [...new Set([...current, monday])].sort());
    setLeagueBreakWeekInput("");
  };

  const saveLeagueBreakSchedule = async () => {
    const client = supabase;
    if (!client || !competition || !admin.isAdmin || isOneDayLeague) return;
    const sessionResult = await client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      setMessage("Please sign in again.");
      return;
    }
    setSavingLeagueBreakWeeks(true);
    const response = await fetch("/api/admin/competition-break-weeks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ competitionId: competition.id, breakWeeks: leagueBreakWeeksInput }),
    });
    const data = await response.json().catch(() => ({}));
    setSavingLeagueBreakWeeks(false);
    if (!response.ok) {
      setMessage(data.error ?? "Break weeks could not be saved.");
      return;
    }
    const savedBreaks = (data.breakWeeks ?? []) as string[];
    setLeagueBreakWeeksInput(savedBreaks);
    setCompetition({ ...competition, league_break_weeks: savedBreaks });
    const reload = await client
      .from("matches")
      .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start")
      .eq("competition_id", competition.id)
      .eq("is_archived", false)
      .order("round_no")
      .order("match_no");
    if (reload.data) setMatches(reload.data as Match[]);
    setMessage(`Break weeks saved. ${Number(data.movedFixtures ?? 0)} future fixture${Number(data.movedFixtures ?? 0) === 1 ? " was" : "s were"} rescheduled; started and past fixtures were left unchanged.`);
  };

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

  const updateCashPayment = async (entry: Entry, reset: boolean) => {
    const client = supabase;
    if (!client || !admin.isAdmin) return;
    const sessionResult = await client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      setMessage("Please sign in again.");
      return;
    }
    setCashPaymentEntryId(entry.id);
    const response = await fetch("/api/admin/competition-entry-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ entryId: entry.id, action: reset ? "reset_cash_payment" : "mark_cash_paid" }),
    });
    const data = await response.json().catch(() => ({}));
    setCashPaymentEntryId(null);
    if (!response.ok) {
      setMessage(data.error ?? "The payment could not be updated.");
      return;
    }
    const payment = data.payment as Pick<Entry, "payment_status" | "payment_method" | "payment_amount_pence" | "paid_at">;
    setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, ...payment } : item));
    if (entry.public_signup_id) {
      setGuestEntries((current) => current.map((item) => item.id === entry.public_signup_id ? { ...item, ...payment } : item));
    }
    setMessage(reset ? "Cash payment reset to pending." : "Cash payment recorded with the current date and time.");
  };

  const saveCompetitionContact = async (contact: CompetitionContact) => {
    const client = supabase;
    if (!client || !admin.isAdmin) return;
    const sessionResult = await client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      setMessage("Please sign in again.");
      return;
    }
    setSavingContactEntryId(contact.entryId);
    const response = await fetch("/api/admin/competition-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ entryId: contact.entryId, email: contact.email, phone: contact.phone }),
    });
    const data = await response.json().catch(() => ({}));
    setSavingContactEntryId(null);
    if (!response.ok) {
      setMessage(data.error ?? "Contact details could not be saved.");
      return;
    }
    setCompetitionContacts((current) => current.map((item) => item.entryId === contact.entryId ? { ...item, email: data.email, phone: data.phone } : item));
    setMessage(`${contact.name}'s fixture contact details were saved.`);
  };

  const reviewGuestEntry = async (entryId: string, status: "added" | "rejected") => {
    const client = supabase;
    if (!client || !admin.isAdmin) return;
    const res = await client
      .from("public_competition_signups")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", entryId);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    setGuestEntries((prev) => prev.map((entry) => (entry.id === entryId ? { ...entry, status } : entry)));
  };

  const addGuestToCompetition = async (entry: GuestEntry, options: { playerId?: string; createProfile?: boolean; ageBand?: "18_plus" | "under_18" }) => {
    const client = supabase;
    if (!client) return;
    const sessionResult = await client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      setMessage("Please sign in again.");
      return;
    }
    setGuestActionId(entry.id);
    const response = await fetch("/api/admin/public-competition-signups", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ signupId: entry.id, ...options }),
    });
    const data = await response.json().catch(() => ({}));
    setGuestActionId(null);
    if (!response.ok) {
      setMessage(data.error ?? "The guest could not be added.");
      return;
    }
    setGuestEntries((current) => current.map((item) => item.id === entry.id ? { ...item, status: "added" } : item));
    setMessage(`${entry.full_name} was added to the competition.${data.invitationSent ? " A Rack & Frame registration invitation was emailed to them." : data.invitationError ? ` The profile was added, but the invitation email failed: ${data.invitationError}` : ""}`);
  };

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const load = async () => {
      const authRes = await client.auth.getUser();
      const signedInUserId = authRes.data.user?.id ?? null;
      let linkedPlayerId: string | null = null;
      if (signedInUserId) {
        const linkedRes = await client.from("app_users").select("linked_player_id").eq("id", signedInUserId).maybeSingle();
        linkedPlayerId = (linkedRes.data?.linked_player_id as string | null) ?? null;
      }
      const [cRes, mRes, pRes, fRes, appUserLinkRes] = await Promise.all([
        client
          .from("competitions")
          .select("id,name,venue,location_id,sport_type,competition_format,match_mode,app_assign_opening_break,best_of,knockout_round_best_of,signup_open,signup_deadline,max_entries,entry_fee_pence,league_meetings,league_start_date,league_break_weeks,league_schedule_mode,league_finals_size,league_semi_final_best_of,league_final_best_of,handicap_enabled")
          .eq("id", id)
          .single(),
        client
          .from("matches")
          .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start")
          .eq("competition_id", id)
          .eq("is_archived", false)
          .order("round_no")
          .order("match_no"),
        client.from("players").select("id,display_name,full_name,snooker_handicap").eq("is_archived", false),
        client.from("frames").select("match_id,winner_player_id"),
        client.from("app_users").select("id,linked_player_id").not("linked_player_id", "is", null),
      ]);
      if (!active) return;
      if (cRes.error || !cRes.data) {
        setMessage(cRes.error?.message ?? "Failed to load competition.");
        return;
      }
      const comp = (cRes.data as unknown) as Competition;
      const sessionRes = await client.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? null;
      if (accessToken && comp.competition_format === "league") {
        await fetch("/api/admin/auto-void-league-fixtures", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ competitionId: id }),
        }).catch(() => null);
      }
      const refreshedMatchRes = await client
        .from("matches")
        .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start")
        .eq("competition_id", id)
        .eq("is_archived", false)
        .order("round_no")
        .order("match_no");
      let loadedMatches = ((mRes.data ?? []) as unknown) as Match[];
      if (refreshedMatchRes.data) {
        loadedMatches = (refreshedMatchRes.data as unknown) as Match[];
      }
      setCompetition(comp);
      setCurrentUserId(signedInUserId);
      setViewerLinkedPlayerId(linkedPlayerId);
      const playerHandicapById = new Map((((pRes.data ?? []) as unknown) as Player[]).map((player) => [player.id, player.snooker_handicap ?? 0]));
      const changed = await ensureKnockoutNextRoundMatches(client, comp, loadedMatches, playerHandicapById);
      if (changed) {
        const refreshed = await client
          .from("matches")
          .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start")
          .eq("competition_id", id)
          .eq("is_archived", false)
          .order("round_no")
          .order("match_no");
        if (refreshed.data) loadedMatches = refreshed.data as Match[];
      }
      setMatches(loadedMatches);
      setPlayers(((pRes.data ?? []) as unknown) as Player[]);
      setAppUserLinks(((appUserLinkRes.data ?? []) as unknown) as AppUserLink[]);
      setFrames(((fRes.data ?? []) as unknown) as Frame[]);
      const entryRes = await client
        .from("competition_entries")
        .select("id,competition_id,requester_user_id,player_id,status,payment_status,payment_method,payment_amount_pence,paid_at,public_signup_id,created_at")
        .eq("competition_id", id)
        .neq("status", "withdrawn")
        .order("created_at", { ascending: false });
      if (entryRes.data) setEntries((entryRes.data as unknown) as Entry[]);
      if (admin.isAdmin) {
        if (accessToken) {
          const [guestResponse, contactResponse] = await Promise.all([
            fetch("/api/admin/public-competition-signups", { headers: { Authorization: `Bearer ${accessToken}` } }),
            fetch(`/api/admin/competition-contacts?competitionId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
          ]);
          if (guestResponse.ok) {
            const guestData = await guestResponse.json();
            setGuestEntries(((guestData.entries ?? []) as GuestEntry[]).filter((entry) => entry.competition_id === id));
          }
          if (contactResponse.ok) {
            const contactData = await contactResponse.json();
            setCompetitionContacts((contactData.contacts ?? []) as CompetitionContact[]);
          }
        }
      }
      const submissionRes = loadedMatches.length
        ? await client
            .from("result_submissions")
            .select("id,match_id,submitted_by_user_id,status,submitted_at")
            .in("match_id", loadedMatches.map((m) => m.id))
            .order("submitted_at", { ascending: false })
        : { data: [] as ResultSubmission[] };
      if ("data" in submissionRes && submissionRes.data) setResultSubmissions((submissionRes.data as unknown) as ResultSubmission[]);
      setSignupDeadlineInput(comp.signup_deadline ? new Date(comp.signup_deadline).toISOString().slice(0, 16) : "");
      setSignupMaxEntriesInput(comp.max_entries ? String(comp.max_entries) : "");
      setLeagueMeetingsInput(String(comp.league_meetings ?? 2));
      setLeagueStartDateInput(comp.league_start_date ? String(comp.league_start_date) : "");
      setLeagueBreakWeeksInput((comp.league_break_weeks ?? []).map(String).sort());
      setLeagueSemiBestOfInput(String(comp.league_semi_final_best_of ?? 3));
      setLeagueFinalBestOfInput(String(comp.league_final_best_of ?? 5));
    };
    load();
    return () => {
      active = false;
    };
  }, [admin.isAdmin, id]);

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
  const pendingGuestEntries = useMemo(() => guestEntries.filter((entry) => entry.status === "pending"), [guestEntries]);
  const visibleGuestEntries = guestEntriesExpanded ? guestEntries : pendingGuestEntries;
  const approvedLeaguePlayerIds = useMemo(() => approvedEntries.map((entry) => entry.player_id), [approvedEntries]);
  const activeEntryByPlayerId = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const entry of entries) {
      if (entry.status !== "approved" && entry.status !== "pending") continue;
      map.set(entry.player_id, entry);
    }
    return map;
  }, [entries]);
  const superEntryOptions = useMemo(() => {
    return [...players]
      .filter((player) => !activeEntryByPlayerId.has(player.id))
      .sort((a, b) => (a.full_name?.trim() || a.display_name).localeCompare(b.full_name?.trim() || b.display_name));
  }, [activeEntryByPlayerId, players]);
  const addSuperUserEntry = async () => {
    const client = supabase;
    if (!client || !competition || !admin.isSuper || !admin.userId) return;
    if (!competition.signup_open) {
      setMessage("Sign-ups are closed for this competition.");
      return;
    }
    if (!superEntryPlayerId) {
      setMessage("Choose a player to add.");
      return;
    }
    if (competition.signup_deadline && new Date(competition.signup_deadline).getTime() < Date.now()) {
      setMessage("The sign-up deadline has passed for this competition.");
      return;
    }
    if (competition.max_entries && approvedEntries.length + pendingEntries.length >= competition.max_entries) {
      setMessage("This competition is currently full.");
      return;
    }
    if (activeEntryByPlayerId.has(superEntryPlayerId)) {
      setMessage("That player is already entered for this competition.");
      return;
    }

    const existingEntry = entries.find((entry) => entry.player_id === superEntryPlayerId) ?? null;
    const linkedAppUserId = appUserLinks.find((row) => row.linked_player_id === superEntryPlayerId)?.id ?? admin.userId;
    setAddingSuperEntry(true);
    const payload = {
      competition_id: competition.id,
      requester_user_id: linkedAppUserId,
      player_id: superEntryPlayerId,
      status: "approved" as const,
      reviewed_by_user_id: admin.userId,
      reviewed_at: new Date().toISOString(),
    };

    const res = existingEntry
      ? await client.from("competition_entries").update(payload).eq("id", existingEntry.id)
      : await client.from("competition_entries").insert(payload);

    setAddingSuperEntry(false);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    setSuperEntryPlayerId("");
    setEntriesExpanded(true);
    setMessage("Player added to the competition and approved.");

    const refreshedEntries = await client
      .from("competition_entries")
      .select("id,competition_id,requester_user_id,player_id,status,payment_status,payment_method,payment_amount_pence,paid_at,public_signup_id,created_at")
      .eq("competition_id", competition.id)
      .neq("status", "withdrawn")
      .order("created_at", { ascending: false });
    if (refreshedEntries.error) {
      setMessage(refreshedEntries.error.message);
      return;
    }
    setEntries((refreshedEntries.data ?? []) as Entry[]);
  };

  const projectedLeagueRounds = useMemo(() => {
    const meetings = Number.parseInt(leagueMeetingsInput, 10);
    if (!Number.isInteger(meetings) || meetings < 1 || meetings > 4) return [];
    return generateLeagueRounds(approvedLeaguePlayerIds, meetings);
  }, [approvedLeaguePlayerIds, leagueMeetingsInput]);
  const projectedLeagueFixtureCount = useMemo(
    () => projectedLeagueRounds.reduce((total, round) => total + round.length, 0),
    [projectedLeagueRounds]
  );
  const isOneDayLeague = competition?.competition_format === "league" && competition.league_schedule_mode === "one_day";
  const sportLabel = competition?.sport_type === "snooker" ? "Snooker" : competition?.sport_type === "pool_9_ball" ? "9-ball pool" : "8-ball pool";
  const scoringUnit = competition?.sport_type === "snooker" ? "frame" : "rack";
  const selectedLeagueMeetings = competition?.league_meetings ?? Number.parseInt(leagueMeetingsInput, 10);
  const leagueScheduleLabel = isOneDayLeague ? "One-day round robin" : "Weekly league";
  const leagueMatchLength = competition?.competition_format === "league" && competition.sport_type !== "snooker"
    ? `All ${competition.best_of} racks played`
    : `Best of ${competition?.best_of ?? 1} ${scoringUnit}${(competition?.best_of ?? 1) === 1 ? "" : "s"}`;
  const leagueForfeitText = competition?.sport_type === "snooker"
    ? "A genuine no-show may be awarded as a walkover; the organiser can void an unplayed fixture when no result should stand."
    : `A genuine no-show may be awarded ${competition?.best_of ?? 1}–0; the organiser can void an unplayed fixture when no result should stand.`;
  const roundRobinRoundCount = projectedLeagueRounds.length;
  const leagueSemiFinalRound = roundRobinRoundCount + 1;
  const leagueFinalRound = roundRobinRoundCount + 2;

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
    const isOneDay = competition.league_schedule_mode === "one_day";
    if (!leagueStartDateInput) {
      setMessage(isOneDay ? "Choose the competition date before generating fixtures." : "Choose a start date before generating weekly fixtures.");
      return;
    }
    if (isOneDay && Number(competition.league_finals_size ?? 0) === 4 && approvedLeaguePlayerIds.length <= 4) {
      setMessage("Top-four finals require more than 4 approved players.");
      return;
    }

    const rounds = generateLeagueRounds(approvedLeaguePlayerIds, meetings);
    const start = new Date(`${leagueStartDateInput}T12:00:00`);
    if (Number.isNaN(start.getTime())) {
      setMessage("Choose a valid start date.");
      return;
    }

    const breakWeekSet = new Set(leagueBreakWeeksInput.map((dateValue) => mondayOfWeek(dateValue)).filter(Boolean) as string[]);
    const scheduledDatesByRound: string[] = [];
    const scheduleCursor = new Date(start);
    for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
      if (roundIndex > 0 && !isOneDay) scheduleCursor.setDate(scheduleCursor.getDate() + 7);
      if (!isOneDay) {
        while (breakWeekSet.has(mondayOfWeek(scheduleCursor.toISOString().slice(0, 10)) ?? "")) {
          scheduleCursor.setDate(scheduleCursor.getDate() + 7);
        }
      }
      scheduledDatesByRound.push(scheduleCursor.toISOString().slice(0, 10));
    }

    const openingBreakBaseByPair = new Map<string, string>();
    const playerHandicapById = new Map(players.map((player) => [player.id, player.snooker_handicap ?? 0]));
    const fixtureRows = rounds.flatMap((round, roundIndex) =>
      round.map((pairing, matchIndex) => {
        let openingBreaker: string | null = null;
        if (competition.app_assign_opening_break && !pairing.isBye && pairing.player2 && pairing.pairKey) {
          let baseBreaker = openingBreakBaseByPair.get(pairing.pairKey) ?? null;
          if (!baseBreaker) {
            baseBreaker = Math.random() < 0.5 ? pairing.player1 : pairing.player2;
            openingBreakBaseByPair.set(pairing.pairKey, baseBreaker);
          }
          openingBreaker = pairing.meetingNumber % 2 === 1
            ? baseBreaker
            : (baseBreaker === pairing.player1 ? pairing.player2 : pairing.player1);
        }
        const handicapStarts = competition.handicap_enabled && competition.sport_type === "snooker"
          ? calculateSnookerHandicapStarts(playerHandicapById.get(pairing.player1), playerHandicapById.get(pairing.player2 ?? ""))
          : { team1: 0, team2: 0 };
        return {
          competition_id: competition.id,
          round_no: roundIndex + 1,
          match_no: matchIndex + 1,
          best_of: competition.best_of,
          status: (pairing.isBye ? "bye" : "pending") as Match["status"],
          match_mode: "singles" as const,
          player1_id: pairing.player1,
          player2_id: pairing.player2 ?? pairing.player1,
          winner_player_id: pairing.isBye ? pairing.player1 : null,
          opening_break_player_id: openingBreaker,
          scheduled_for: scheduledDatesByRound[roundIndex],
          team1_handicap_start: handicapStarts.team1,
          team2_handicap_start: handicapStarts.team2,
        };
      })
    );

    setGeneratingLeagueFixtures(true);
    const updateRes = await client
      .from("competitions")
      .update({
        league_meetings: meetings,
        league_start_date: leagueStartDateInput,
        league_break_weeks: isOneDay ? [] : [...breakWeekSet].sort(),
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
    setMessage(
      isOneDay
        ? `One-day round-robin fixtures generated across ${rounds.length} round${rounds.length === 1 ? "" : "s"}.`
        : `League fixtures generated for ${rounds.length} playing week${rounds.length === 1 ? "" : "s"}${breakWeekSet.size ? `, skipping ${breakWeekSet.size} break week${breakWeekSet.size === 1 ? "" : "s"}` : ""}.`
    );
    setCompetition({ ...competition, league_meetings: meetings, league_start_date: leagueStartDateInput, league_break_weeks: isOneDay ? [] : [...breakWeekSet].sort() });
    const reload = await client
      .from("matches")
      .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start")
      .eq("competition_id", competition.id)
      .eq("is_archived", false)
      .order("round_no")
      .order("match_no");
    if (reload.data) setMatches(reload.data as Match[]);
    const frameReload = await client.from("frames").select("match_id,winner_player_id");
    if (frameReload.data) setFrames(frameReload.data as Frame[]);
  };

  const refreshFutureLeagueHandicapStarts = async () => {
    const client = supabase;
    if (!client || !competition || competition.competition_format !== "league") return;
    if (!competition.handicap_enabled || competition.sport_type !== "snooker" || (competition.match_mode ?? "singles") === "doubles") {
      setMessage("This option is only available for handicapped snooker singles leagues.");
      return;
    }

    const now = new Date();
    const todayLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const playerHandicapById = new Map(players.map((player) => [player.id, player.snooker_handicap ?? 0]));
    const futureMatches = matches.filter(
      (match) =>
        match.status === "pending" &&
        Boolean(match.scheduled_for) &&
        String(match.scheduled_for) > todayLabel &&
        !match.team1_player1_id &&
        !match.team2_player1_id
    );

    if (!futureMatches.length) {
      setMessage("No future pending singles fixtures were found to refresh.");
      return;
    }

    setRefreshingFutureHandicaps(true);
    for (const match of futureMatches) {
      const handicapStarts = calculateSnookerHandicapStarts(playerHandicapById.get(match.player1_id ?? ""), playerHandicapById.get(match.player2_id ?? ""));
      const updateRes = await client
        .from("matches")
        .update({
          team1_handicap_start: handicapStarts.team1,
          team2_handicap_start: handicapStarts.team2,
        })
        .eq("id", match.id);
      if (updateRes.error) {
        setRefreshingFutureHandicaps(false);
        setMessage(updateRes.error.message);
        return;
      }
    }

    const reload = await client
      .from("matches")
      .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start")
      .eq("competition_id", competition.id)
      .eq("is_archived", false)
      .order("round_no")
      .order("match_no");
    setRefreshingFutureHandicaps(false);
    if (reload.error) {
      setMessage(reload.error.message);
      return;
    }
    if (reload.data) setMatches(reload.data as Match[]);
    setMessage(`Future handicap starts refreshed for ${futureMatches.length} fixture${futureMatches.length === 1 ? "" : "s"}.`);
  };

  const saveOneDayFinalLengths = async () => {
    const client = supabase;
    if (!client || !competition || !isOneDayLeague || !admin.isAdmin) return;
    const semiBestOf = Number.parseInt(leagueSemiBestOfInput, 10);
    const finalBestOf = Number.parseInt(leagueFinalBestOfInput, 10);
    if (![semiBestOf, finalBestOf].every((value) => Number.isInteger(value) && value > 0 && value % 2 === 1)) {
      setMessage("Semi-final and final Best Of values must be positive odd numbers.");
      return;
    }
    const updateCompetition = await client
      .from("competitions")
      .update({ league_semi_final_best_of: semiBestOf, league_final_best_of: finalBestOf })
      .eq("id", competition.id);
    if (updateCompetition.error) {
      setMessage(updateCompetition.error.message);
      return;
    }
    const pendingSemis = matches.filter((match) => (match.round_no ?? 1) === leagueSemiFinalRound && match.status === "pending");
    const pendingFinals = matches.filter((match) => (match.round_no ?? 1) === leagueFinalRound && match.status === "pending");
    if (pendingSemis.length) await client.from("matches").update({ best_of: semiBestOf }).in("id", pendingSemis.map((match) => match.id));
    if (pendingFinals.length) await client.from("matches").update({ best_of: finalBestOf }).in("id", pendingFinals.map((match) => match.id));
    setCompetition({ ...competition, league_semi_final_best_of: semiBestOf, league_final_best_of: finalBestOf });
    setMatches((current) => current.map((match) => {
      if (match.status !== "pending") return match;
      if ((match.round_no ?? 1) === leagueSemiFinalRound) return { ...match, best_of: semiBestOf };
      if ((match.round_no ?? 1) === leagueFinalRound) return { ...match, best_of: finalBestOf };
      return match;
    }));
    setMessage("Finals match lengths saved. Existing pending finals were updated.");
  };

  const createOneDaySemiFinals = async () => {
    const client = supabase;
    if (!client || !competition || !isOneDayLeague || !admin.isAdmin) return;
    if (Number(competition.league_finals_size ?? 0) !== 4 || approvedLeaguePlayerIds.length <= 4) return;
    const roundRobinMatches = matches.filter((match) => (match.round_no ?? 1) <= roundRobinRoundCount && match.status !== "bye");
    if (!roundRobinMatches.length || roundRobinMatches.some((match) => match.status !== "complete")) {
      setMessage("Complete every round-robin match before creating the semi-finals.");
      return;
    }
    if (matches.some((match) => (match.round_no ?? 1) === leagueSemiFinalRound)) {
      setMessage("Semi-finals have already been created.");
      return;
    }
    const topFour = leagueTableRows.slice(0, 4);
    if (topFour.length < 4) return;
    const semiBestOf = Number(competition.league_semi_final_best_of ?? 3);
    const seeds = [[topFour[0], topFour[3]], [topFour[1], topFour[2]]];
    const playerHandicapById = new Map(players.map((player) => [player.id, player.snooker_handicap ?? 0]));
    const rows = seeds.map(([left, right], index) => {
      const starts = competition.handicap_enabled && competition.sport_type === "snooker"
        ? calculateSnookerHandicapStarts(playerHandicapById.get(left.playerId), playerHandicapById.get(right.playerId))
        : { team1: 0, team2: 0 };
      return {
        competition_id: competition.id,
        round_no: leagueSemiFinalRound,
        match_no: index + 1,
        best_of: semiBestOf,
        status: "pending" as const,
        match_mode: "singles" as const,
        player1_id: left.playerId,
        player2_id: right.playerId,
        winner_player_id: null,
        opening_break_player_id: competition.app_assign_opening_break ? (index % 2 === 0 ? left.playerId : right.playerId) : null,
        scheduled_for: competition.league_start_date,
        team1_handicap_start: starts.team1,
        team2_handicap_start: starts.team2,
      };
    });
    const insert = await client.from("matches").insert(rows).select("id,round_no,match_no,best_of,status,player1_id,player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start");
    if (insert.error) {
      setMessage(insert.error.message);
      return;
    }
    setMatches((current) => [...current, ...((insert.data ?? []) as Match[])]);
    setMessage("Semi-finals created: 1st vs 4th and 2nd vs 3rd.");
  };

  const createOneDayFinal = async () => {
    const client = supabase;
    if (!client || !competition || !isOneDayLeague || !admin.isAdmin) return;
    const semis = matches.filter((match) => (match.round_no ?? 1) === leagueSemiFinalRound).sort((a, b) => (a.match_no ?? 0) - (b.match_no ?? 0));
    if (semis.length !== 2 || semis.some((match) => match.status !== "complete" || !match.winner_player_id)) {
      setMessage("Complete both semi-finals before creating the final.");
      return;
    }
    if (matches.some((match) => (match.round_no ?? 1) === leagueFinalRound)) {
      setMessage("The final has already been created.");
      return;
    }
    const left = semis[0].winner_player_id as string;
    const right = semis[1].winner_player_id as string;
    const playerHandicapById = new Map(players.map((player) => [player.id, player.snooker_handicap ?? 0]));
    const starts = competition.handicap_enabled && competition.sport_type === "snooker"
      ? calculateSnookerHandicapStarts(playerHandicapById.get(left), playerHandicapById.get(right))
      : { team1: 0, team2: 0 };
    const row = {
      competition_id: competition.id,
      round_no: leagueFinalRound,
      match_no: 1,
      best_of: Number(competition.league_final_best_of ?? 5),
      status: "pending" as const,
      match_mode: "singles" as const,
      player1_id: left,
      player2_id: right,
      winner_player_id: null,
      opening_break_player_id: competition.app_assign_opening_break ? left : null,
      scheduled_for: competition.league_start_date,
      team1_handicap_start: starts.team1,
      team2_handicap_start: starts.team2,
    };
    const insert = await client.from("matches").insert(row).select("id,round_no,match_no,best_of,status,player1_id,player2_id,winner_player_id,opening_break_player_id,scheduled_for,team1_handicap_start,team2_handicap_start").single();
    if (insert.error || !insert.data) {
      setMessage(insert.error?.message ?? "Final could not be created.");
      return;
    }
    setMatches((current) => [...current, insert.data as Match]);
    setMessage("Final created from the two semi-final winners.");
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
  const getStatusLabel = (m: Match) => {
    if (m.status === "bye") return "Locked";
    if (m.status === "complete" && !m.winner_player_id) return "Void";
    return m.status.replace("_", " ");
  };
  const leagueFixturesByWeek = useMemo(() => {
    if (!competition || competition.competition_format !== "league") return [] as Array<{
      week: number;
      scheduledFor: string | null;
      matches: Array<{
        id: string;
        label: string;
        status: string;
        isBye: boolean;
        deadlineLabel: string | null;
        handicapLabel: string | null;
        openingBreakerLabel: string | null;
        chip: {
          label: string;
          className: string;
        };
      }>;
    }>;
    const grouped = new Map<number, Match[]>();
    matches.filter((match) => !isOneDayLeague || (match.round_no ?? 1) <= roundRobinRoundCount).forEach((match) => {
      const roundNo = match.round_no ?? 1;
      const prev = grouped.get(roundNo) ?? [];
      prev.push(match);
      grouped.set(roundNo, prev);
    });
    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, weekMatches]) => ({
        week,
        scheduledFor: weekMatches[0]?.scheduled_for ?? null,
        matches: weekMatches
          .sort((a, b) => (a.match_no ?? 0) - (b.match_no ?? 0))
          .map((match) => {
            const isParticipant = Boolean(
              viewerLinkedPlayerId &&
                (
                  match.player1_id === viewerLinkedPlayerId ||
                  match.player2_id === viewerLinkedPlayerId ||
                  match.team1_player1_id === viewerLinkedPlayerId ||
                  match.team1_player2_id === viewerLinkedPlayerId ||
                  match.team2_player1_id === viewerLinkedPlayerId ||
                  match.team2_player2_id === viewerLinkedPlayerId
                )
            );
            const ownLatestSubmission = currentUserId
              ? resultSubmissions.find((submission) => submission.match_id === match.id && submission.submitted_by_user_id === currentUserId) ?? null
              : null;
            const window = getLeagueFixtureWindow(match.scheduled_for, isOneDayLeague ? "one_day" : "weekly");
            const now = new Date();
            const isWeekOpenForPlayer = !window ? true : now >= window.opensAt && now <= window.dueAt;
            let chip = {
              label: getStatusLabel(match),
              className: "border-slate-200 bg-slate-50 text-slate-600",
            };
            if (!admin.isAdmin) {
              if (match.status === "complete" && !match.winner_player_id) {
                chip = { label: "Void", className: "border-slate-200 bg-slate-100 text-slate-600" };
              } else if (match.status === "complete" || ownLatestSubmission?.status === "approved") {
                chip = { label: "Approved", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
              } else if (ownLatestSubmission?.status === "pending") {
                chip = { label: "Submitted", className: "border-amber-200 bg-amber-50 text-amber-700" };
              } else if (ownLatestSubmission?.status === "rejected") {
                chip = { label: "Update needed", className: "border-rose-200 bg-rose-50 text-rose-700" };
              } else if (isParticipant && !isWeekOpenForPlayer) {
                chip = {
                  label: window && now < window.opensAt ? "Locked" : "Window closed",
                  className: "border-slate-200 bg-slate-100 text-slate-600",
                };
              } else if (isParticipant) {
                chip = { label: "Pending", className: "border-amber-200 bg-amber-50 text-amber-700" };
              } else {
                chip = { label: "View only", className: "border-rose-200 bg-rose-50 text-rose-700" };
              }
            }
            let handicapLabel: string | null = null;
            if (!match.status || match.status !== "bye") {
            if (competition.handicap_enabled && competition.sport_type === "snooker" && (competition.match_mode ?? "singles") !== "doubles") {
              const team1Start = match.team1_handicap_start ?? 0;
              const team2Start = match.team2_handicap_start ?? 0;
              if (team1Start > team2Start) {
                handicapLabel = `${fullMap.get(match.player1_id ?? "") ?? shortMap.get(match.player1_id ?? "") ?? "Player 1"} receives ${team1Start} start`;
              } else if (team2Start > team1Start) {
                handicapLabel = `${fullMap.get(match.player2_id ?? "") ?? shortMap.get(match.player2_id ?? "") ?? "Player 2"} receives ${team2Start} start`;
              } else {
                handicapLabel = "Level start";
              }
            }
            }
            const openingBreakerLabel = match.status === "bye" || !match.opening_break_player_id
              ? null
              : fullMap.get(match.opening_break_player_id) ?? shortMap.get(match.opening_break_player_id) ?? "Assigned player";
            return {
              id: match.id,
              label: getMatchLabel(match, fullMap),
              status: getStatusLabel(match),
              isBye: match.status === "bye",
              deadlineLabel: formatLeagueFixtureDeadline(match.scheduled_for, isOneDayLeague ? "one_day" : "weekly"),
              handicapLabel,
              openingBreakerLabel,
              chip,
            };
          }),
      }));
  }, [competition, matches, fullMap, shortMap, viewerLinkedPlayerId, currentUserId, resultSubmissions, admin.isAdmin, isOneDayLeague, roundRobinRoundCount]);
  const leagueFixtureWeekOptions = useMemo(
    () => leagueFixturesByWeek.map((week) => ({ value: String(week.week), label: `${isOneDayLeague ? "Round" : "Week"} ${week.week}` })),
    [isOneDayLeague, leagueFixturesByWeek]
  );
  const leagueFixturePlayerOptions = useMemo(
    () =>
      approvedLeaguePlayerIds.map((playerId) => ({
        value: playerId,
        label: fullMap.get(playerId) ?? shortMap.get(playerId) ?? "Unknown player",
      })),
    [approvedLeaguePlayerIds, fullMap, shortMap]
  );
  const filteredLeagueFixturesByWeek = useMemo(() => {
    if (leagueFixtureFilterMode === "week" && leagueFixtureFilterWeek !== "all") {
      return leagueFixturesByWeek.filter((week) => String(week.week) === leagueFixtureFilterWeek);
    }
    if (leagueFixtureFilterMode === "player" && leagueFixtureFilterPlayer !== "all") {
      const selectedLabel = fullMap.get(leagueFixtureFilterPlayer) ?? shortMap.get(leagueFixtureFilterPlayer) ?? "";
      return leagueFixturesByWeek
        .map((week) => ({
          ...week,
          matches: week.matches.filter((match) => match.label.includes(selectedLabel)),
        }))
        .filter((week) => week.matches.length > 0);
    }
    return leagueFixturesByWeek;
  }, [leagueFixturesByWeek, leagueFixtureFilterMode, leagueFixtureFilterWeek, leagueFixtureFilterPlayer, fullMap, shortMap]);
  const hasTopEightFinals = isLegionMastersLeague(competition?.name);
  const leagueTableRows = (() => {
    if (!competition || competition.competition_format !== "league") return [] as Array<{
      playerId: string;
      playerName: string;
      played: number;
      won: number;
      lost: number;
      voided: number;
      byes: number;
        points: number;
        framesFor: number;
      }>;
    const stats = new Map<string, {
      playerId: string;
      playerName: string;
      played: number;
      won: number;
      lost: number;
      voided: number;
      byes: number;
      points: number;
      framesFor: number;
    }>();
    const ensureRow = (playerId: string) => {
      const existing = stats.get(playerId);
      if (existing) return existing;
      const row = {
        playerId,
        playerName: fullMap.get(playerId) ?? shortMap.get(playerId) ?? "Unknown player",
        played: 0,
        won: 0,
        lost: 0,
        voided: 0,
        byes: 0,
        points: 0,
        framesFor: 0,
      };
      stats.set(playerId, row);
      return row;
    };

    approvedLeaguePlayerIds.forEach((playerId) => ensureRow(playerId));

    const framesByMatch = new Map<string, Frame[]>();
    frames.forEach((frame) => {
      const prev = framesByMatch.get(frame.match_id) ?? [];
      prev.push(frame);
      framesByMatch.set(frame.match_id, prev);
    });

    matches.filter((match) => !isOneDayLeague || (match.round_no ?? 1) <= roundRobinRoundCount).forEach((match) => {
      if (!match.player1_id) return;
      const row1 = ensureRow(match.player1_id);
      const row2 = match.player2_id && match.player2_id !== match.player1_id ? ensureRow(match.player2_id) : null;
      if (match.status === "bye") {
        row1.byes += 1;
        return;
      }
      if (match.status !== "complete") return;
      row1.played += 1;
      if (row2) row2.played += 1;
      const matchFrames = framesByMatch.get(match.id) ?? [];
      let player1Frames = 0;
      let player2Frames = 0;
      for (const frame of matchFrames) {
        if (frame.winner_player_id === match.player1_id) player1Frames += 1;
        if (row2 && frame.winner_player_id === match.player2_id) player2Frames += 1;
      }
      if (!matchFrames.length && match.winner_player_id) {
        if (match.winner_player_id === match.player1_id) player1Frames = 1;
        if (row2 && match.winner_player_id === match.player2_id) player2Frames = 1;
      }
      row1.framesFor += player1Frames;
      row1.points += player1Frames;
      if (row2) {
        row2.framesFor += player2Frames;
        row2.points += player2Frames;
      }
      if (!match.winner_player_id) {
        row1.voided += 1;
        if (row2) row2.voided += 1;
        return;
      }
      if (match.winner_player_id === match.player1_id) {
        row1.won += 1;
        if (row2) row2.lost += 1;
      } else if (row2 && match.winner_player_id === match.player2_id) {
        row2.won += 1;
        row1.lost += 1;
      }
    });

    return [...stats.values()].sort((a, b) =>
      b.points - a.points ||
      b.won - a.won ||
      a.lost - b.lost ||
      a.playerName.localeCompare(b.playerName)
    );
  })();
  const leagueStageComplete = matches.some((match) => match.status !== "bye") && matches
    .filter((match) => match.status !== "bye")
    .every((match) => match.status === "complete");
  const openOrCreateMastersCup = async () => {
    const client = supabase;
    if (!client || !competition || !admin.isAdmin || !hasTopEightFinals) return;
    const sessionResult = await client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      setMessage("Please sign in again.");
      return;
    }
    setCreatingMastersCup(true);
    const response = await fetch("/api/admin/legion-masters-cup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ competitionId: competition.id }),
    });
    const data = await response.json().catch(() => ({}));
    setCreatingMastersCup(false);
    if (!response.ok || !data.competitionId) {
      setMessage(data.error ?? "The Legion Masters Cup could not be created.");
      return;
    }
    window.location.assign(`/competitions/${data.competitionId}`);
  };
  const totalBracketRounds = bracketRounds.length;
  const matchesByKey = useMemo(() => {
    const m = new Map<string, Match>();
    for (const match of matches) m.set(`${match.round_no ?? 1}-${match.match_no ?? 1}`, match);
    return m;
  }, [matches]);
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
  const paymentOutstandingCount = competition?.entry_fee_pence
    ? entries.filter((entry) => entry.status !== "rejected" && !["paid", "not_required"].includes(entry.payment_status ?? "pending")).length
    : 0;
  const linkedGuestEntryIds = new Set(entries.map((entry) => entry.public_signup_id).filter(Boolean));
  const paymentRows = [
    ...entries.filter((entry) => entry.status !== "rejected" && entry.status !== "withdrawn"),
    ...guestEntries.filter((entry) => entry.status !== "rejected" && !linkedGuestEntryIds.has(entry.id)),
  ];
  const collectedPence = paymentRows
    .filter((entry) => entry.payment_status === "paid")
    .reduce((total, entry) => total + (entry.payment_amount_pence ?? competition?.entry_fee_pence ?? 0), 0);
  const cashCollectedPence = paymentRows
    .filter((entry) => entry.payment_status === "paid" && entry.payment_method === "cash")
    .reduce((total, entry) => total + (entry.payment_amount_pence ?? competition?.entry_fee_pence ?? 0), 0);
  const stripeCollectedPence = paymentRows
    .filter((entry) => entry.payment_status === "paid" && entry.payment_method === "stripe")
    .reduce((total, entry) => total + (entry.payment_amount_pence ?? competition?.entry_fee_pence ?? 0), 0);
  const filteredCompetitionContacts = competitionContacts.filter((contact) =>
    !contactSearch.trim() || contact.name.toLowerCase().includes(contactSearch.trim().toLowerCase())
  );
  const runningMatchCount = matches.filter((match) => match.status === "in_progress").length;
  const firstUnfinishedRound = matches
    .filter((match) => !["complete", "bye"].includes(match.status))
    .sort((left, right) => (left.round_no ?? 1) - (right.round_no ?? 1))[0]?.round_no ?? null;
  const activeRoundFixtureCount = firstUnfinishedRound === null
    ? 0
    : matches.filter((match) => (match.round_no ?? 1) === firstUnfinishedRound && match.status !== "bye").length;
  const openActiveFixtures = () => {
    if (firstUnfinishedRound !== null) {
      setLeagueFixtureFilterMode("week");
      setLeagueFixtureFilterWeek(String(firstUnfinishedRound));
    }
    selectAdminCompetitionTab("fixtures");
  };
  const adminTabs: Array<{ id: AdminCompetitionTab; label: string; badge?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "entrants", label: "Entrants & payments", badge: pendingEntries.length + pendingGuestEntries.length + paymentOutstandingCount },
    { id: "fixtures", label: "Fixtures", badge: runningMatchCount },
    { id: "table", label: "League table" },
    { id: "settings", label: "Settings" },
  ];

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
          {competition && admin.isAdmin && competition.competition_format === "league" ? (
            <nav className="sticky top-2 z-20 overflow-x-auto rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur" aria-label="Competition management sections">
              <div className="flex min-w-max gap-2">
                {adminTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        if (tab.id === "fixtures" && firstUnfinishedRound !== null) {
                          setLeagueFixtureFilterMode("week");
                          setLeagueFixtureFilterWeek(String(firstUnfinishedRound));
                        }
                        selectAdminCompetitionTab(tab.id);
                      }}
                      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${adminCompetitionTab === tab.id ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      {tab.label}
                      {tab.badge ? <span className={`rounded-full px-2 py-0.5 text-xs ${adminCompetitionTab === tab.id ? "bg-white text-slate-950" : "bg-amber-100 text-amber-900"}`}>{tab.badge}</span> : null}
                    </button>
                  ))}
              </div>
            </nav>
          ) : null}
          {competition ? (
            <>
              {admin.isAdmin && showAdminArea("overview") ? (
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <button type="button" onClick={() => selectAdminCompetitionTab("entrants")} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-300">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Approved</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{approvedEntries.length}</p>
                    <p className="text-xs text-slate-500">entrants</p>
                  </button>
                  <button type="button" onClick={() => selectAdminCompetitionTab("entrants")} className={`rounded-2xl border p-4 text-left shadow-sm transition ${pendingEntries.length + pendingGuestEntries.length ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pending</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{pendingEntries.length + pendingGuestEntries.length}</p>
                    <p className="text-xs text-slate-500">sign-ups</p>
                  </button>
                  <button type="button" onClick={() => selectAdminCompetitionTab("entrants")} className={`rounded-2xl border p-4 text-left shadow-sm transition ${paymentOutstandingCount ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Outstanding</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{paymentOutstandingCount}</p>
                    <p className="text-xs text-slate-500">payments</p>
                  </button>
                  <button type="button" onClick={openActiveFixtures} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-300">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{isOneDayLeague ? "Active round" : "Current week"}</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{firstUnfinishedRound ?? "—"}</p>
                    <p className="text-xs text-slate-500">{activeRoundFixtureCount} fixtures</p>
                  </button>
                  <button type="button" onClick={openActiveFixtures} className={`rounded-2xl border p-4 text-left shadow-sm transition ${runningMatchCount ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Live</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">{runningMatchCount}</p>
                    <p className="text-xs text-slate-500">matches running</p>
                  </button>
                </section>
              ) : null}
              {showAdminArea("overview") ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-3xl font-semibold text-slate-900">{competition.name}</h2>
                <p className="mt-1 text-slate-700">Venue: {competition.venue || "-"}</p>
                <p className="mt-1 text-slate-700">Sport: {sportLabel}</p>
                <p className="mt-1 text-slate-700">Format: {competition.competition_format === "league" ? `${leagueScheduleLabel} · singles` : `${competition.match_mode ?? "singles"} knockout`}</p>
                <p className="mt-1 text-slate-700">
                  Match length: {competition.competition_format === "league" ? leagueMatchLength : `Best of ${competition.best_of} ${scoringUnit}${competition.best_of === 1 ? "" : "s"}`}
                </p>
                <p className="mt-1 text-slate-700">Scoring: {competition.handicap_enabled ? "Handicapped" : "Scratch"}{competition.competition_format === "league" ? ` · one league point per ${scoringUnit} won` : ""}</p>
                {competition.competition_format === "league" ? (
                  <>
                    <p className="mt-2 text-sm text-slate-600">
                      This is a club league competition. Use sign-ups and approved entries to manage the field.
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {competition.league_meetings ? `Each opponent: ${competition.league_meetings} time${competition.league_meetings === 1 ? "" : "s"}` : "Fixtures not generated yet."}
                      {competition.league_start_date ? ` · Start date: ${competition.league_start_date}` : ""}
                    </p>
                    {competition.league_break_weeks?.length ? (
                      <p className="mt-1 text-sm text-amber-700">
                        Break week{competition.league_break_weeks.length === 1 ? "" : "s"}: {competition.league_break_weeks.map(formatBreakWeek).join(", ")}
                      </p>
                    ) : null}
                    {competition.app_assign_opening_break ? (
                      <p className="mt-1 text-sm text-slate-600">
                        Opening break alternates across each opponent series. First meeting is assigned at fixture generation, then alternates on repeat meetings.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </section> : null}
              {showAdminArea("entrants") ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {admin.isAdmin && competition.entry_fee_pence ? (
                  <div className="mb-4 grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:grid-cols-4">
                    <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Collected</p><p className="mt-1 text-xl font-black text-emerald-950">£{(collectedPence / 100).toFixed(2)}</p></div>
                    <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Stripe</p><p className="mt-1 text-xl font-black text-emerald-950">£{(stripeCollectedPence / 100).toFixed(2)}</p></div>
                    <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Cash</p><p className="mt-1 text-xl font-black text-emerald-950">£{(cashCollectedPence / 100).toFixed(2)}</p></div>
                    <div className={paymentOutstandingCount ? "text-amber-900" : "text-emerald-950"}><p className="text-xs font-bold uppercase tracking-wide">Outstanding</p><p className="mt-1 text-xl font-black">{paymentOutstandingCount}</p></div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-semibold text-slate-900">Competition Sign-ups</p>
                  <div className="flex flex-wrap gap-2">
                    {admin.isAdmin ? (
                      <button
                        type="button"
                        onClick={() => void shareGuestSignup()}
                        className="rounded-full bg-emerald-700 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-800"
                      >
                        Share public sign-up link
                      </button>
                    ) : null}
                    <Link href="/signups" className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50">
                      Enter or review sign-ups
                    </Link>
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Status: {competition.signup_open ? "Open" : "Closed"} · Registered pending {pendingEntries.length} · Approved {approvedEntries.length}
                  {admin.isAdmin ? ` · Guest entries ${pendingGuestEntries.length}` : ""}
                  {competition.max_entries ? ` / Max ${competition.max_entries}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Registered players use Competition Sign-ups. The public link lets guests enter without creating an app account.
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
                {admin.isSuper ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-medium text-amber-950">Super User add player</p>
                    <p className="mt-1 text-sm text-amber-900">Add a player directly into this open competition and approve them immediately.</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        value={superEntryPlayerId}
                        onChange={(e) => setSuperEntryPlayerId(e.target.value)}
                        className="min-w-[260px] rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value="">Select player…</option>
                        {superEntryOptions.map((player) => (
                          <option key={player.id} value={player.id}>
                            {fullMap.get(player.id) ?? shortMap.get(player.id) ?? "Unknown player"}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void addSuperUserEntry()}
                        disabled={addingSuperEntry || !competition.signup_open || superEntryOptions.length === 0}
                        className="rounded-lg bg-amber-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {addingSuperEntry ? "Adding..." : "Add player to competition"}
                      </button>
                    </div>
                    {!competition.signup_open ? (
                      <p className="mt-2 text-xs text-amber-800">Open sign-ups first before adding players.</p>
                    ) : null}
                    {competition.signup_open && superEntryOptions.length === 0 ? (
                      <p className="mt-2 text-xs text-amber-800">Everyone currently available is already entered.</p>
                    ) : null}
                  </div>
                ) : null}
                {entries.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <button
                      type="button"
                      onClick={() => setEntriesExpanded((current) => !current)}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {entriesExpanded ? "Hide entrants" : `Show entrants (${entries.length})`}
                    </button>
                    {entriesExpanded ? (
                      <div className="mt-3 space-y-2">
                        {entries.map((entry) => (
                          <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div>
                              <p className="text-sm text-slate-800">
                                {fullMap.get(entry.player_id) ?? shortMap.get(entry.player_id) ?? "Unknown player"}
                              </p>
                              <p className={`mt-1 text-xs font-medium ${entry.payment_status === "paid" ? "text-emerald-700" : entry.payment_status === "not_required" ? "text-slate-500" : "text-amber-700"}`}>
                                {entry.payment_status === "paid"
                                  ? `Paid${paidMethodLabel(entry.payment_method)}${entry.payment_amount_pence ? ` £${(entry.payment_amount_pence / 100).toFixed(2)}` : ""}${entry.paid_at ? ` · ${paidDateTime(entry.paid_at)}` : ""}`
                                  : entry.payment_status === "not_required" ? "No payment required" : entry.payment_status === "failed" ? "Payment failed" : "Payment pending"}
                              </p>
                            </div>
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
                              {admin.isAdmin && competition.entry_fee_pence && entry.payment_status !== "paid" ? (
                                <button
                                  type="button"
                                  onClick={() => setCashPaymentTarget({ entry, reset: false })}
                                  disabled={cashPaymentEntryId === entry.id}
                                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 disabled:opacity-50"
                                >
                                  {cashPaymentEntryId === entry.id ? "Saving…" : "Mark cash paid"}
                                </button>
                              ) : null}
                              {admin.isAdmin && entry.payment_status === "paid" && entry.payment_method === "cash" ? (
                                <button
                                  type="button"
                                  onClick={() => setCashPaymentTarget({ entry, reset: true })}
                                  disabled={cashPaymentEntryId === entry.id}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 disabled:opacity-50"
                                >
                                  Undo cash payment
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">No registered-player entries yet.</p>
                )}
                {admin.isAdmin && guestEntries.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-emerald-950">Public guest entries · {pendingGuestEntries.length} pending</p>
                      {guestEntries.length > pendingGuestEntries.length ? (
                        <button type="button" onClick={() => setGuestEntriesExpanded((current) => !current)} className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-900">
                          {guestEntriesExpanded ? "Hide processed" : `Show processed (${guestEntries.length - pendingGuestEntries.length})`}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-emerald-900">
                      Create or find each player yourself, add them above, then mark the guest entry as added.
                    </p>
                    <div className="mt-3 space-y-2">
                      {visibleGuestEntries.map((entry) => (
                        <div key={entry.id} className="rounded-lg border border-emerald-200 bg-white px-3 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-slate-900">{entry.full_name}</p>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                                {entry.phone ? <a href={`tel:${entry.phone}`} className="underline">{entry.phone}</a> : null}
                                {entry.email ? <a href={`mailto:${entry.email}`} className="underline">{entry.email}</a> : null}
                              </div>
                              {entry.note ? <p className="mt-2 text-sm text-slate-600">Note: {entry.note}</p> : null}
                              <p className="mt-2 text-sm">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${entry.payment_status === "paid" ? "bg-emerald-100 text-emerald-900" : entry.payment_status === "failed" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>
                                  {entry.payment_status === "paid"
                                    ? `Paid${paidMethodLabel(entry.payment_method)}${entry.payment_amount_pence ? ` £${(entry.payment_amount_pence / 100).toFixed(2)}` : ""}${entry.paid_at ? ` · ${paidDateTime(entry.paid_at)}` : ""}`
                                    : entry.payment_status === "pending"
                                      ? "Payment pending"
                                      : entry.payment_status === "failed"
                                        ? "Payment failed"
                                        : "No payment required"}
                                </span>
                              </p>
                              <p className="mt-1 text-xs text-slate-500">{new Date(entry.created_at).toLocaleString("en-GB")}</p>
                              {entry.status === "pending" && (entry.suggestions?.length ?? 0) > 0 ? (
                                <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Possible existing profiles</p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {entry.suggestions?.map((player) => (
                                      <button key={player.id} type="button" disabled={guestActionId === entry.id} onClick={() => void addGuestToCompetition(entry, { playerId: player.id })} className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm text-indigo-950 disabled:opacity-50">
                                        Link and add: {player.full_name?.trim() || player.display_name}{player.claimed_by ? " · app account" : ""}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {entry.status === "pending" ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button type="button" disabled={guestActionId === entry.id} onClick={() => void addGuestToCompetition(entry, { createProfile: true, ageBand: "18_plus" })} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                                    {guestActionId === entry.id ? "Adding…" : "Create adult profile and add"}
                                  </button>
                                  <button type="button" disabled={guestActionId === entry.id} onClick={() => void addGuestToCompetition(entry, { createProfile: true, ageBand: "under_18" })} className="rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50">
                                    Create junior profile and add
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">{entry.status}</span>
                              {entry.status === "pending" ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void reviewGuestEntry(entry.id, "rejected")}
                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section> : null}
              {competition.competition_format === "league" ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  {showAdminArea("overview") ? <div>
                    <p className="text-lg font-semibold text-slate-900">{sportLabel} league format</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {leagueScheduleLabel} · {leagueMatchLength} · {competition.handicap_enabled ? "Handicapped" : "Scratch"} scoring · meet each opponent {selectedLeagueMeetings} time{selectedLeagueMeetings === 1 ? "" : "s"}.
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {isOneDayLeague
                        ? `All round-robin fixtures are played on the competition date. Each ${scoringUnit} won adds one league point.${Number(competition.league_finals_size ?? 0) === 4 ? ` The top four advance to best-of-${competition.league_semi_final_best_of ?? 3} semi-finals and a best-of-${competition.league_final_best_of ?? 5} final.` : ""}`
                        : `Each fixture week runs from Monday 13:00 to Sunday 21:00. Each ${scoringUnit} won adds one league point. ${leagueForfeitText}`}
                    </p>
                  </div> : null}
                  {showAdminArea("settings") ? <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="w-full text-sm text-emerald-950">
                      <p className="font-semibold">Public WhatsApp links</p>
                      <p className="text-xs text-emerald-800">Read-only and open without an app account. Contact details are never included.</p>
                    </div>
                    <button type="button" onClick={() => void copyPublicLeagueLink("fixtures")} className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-medium text-white">Copy fixtures link</button>
                    <button type="button" onClick={() => void copyPublicLeagueLink("table")} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900">Copy league table link</button>
                    <Link href={`/league/${competition.id}`} target="_blank" className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900">Preview public page</Link>
                  </div> : null}
                  {showAdminArea("entrants") && admin.isAdmin && competitionContacts.length ? (
                    <details className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3">
                      <summary className="cursor-pointer font-semibold text-sky-950">
                        Fixture contact readiness · {competitionContacts.filter((contact) => contact.email && contact.phone).length}/{competitionContacts.length} have phone and email
                      </summary>
                      <p className="mt-1 text-xs text-sky-800">These private details are shown only to that player&apos;s fixture opponents and competition managers. Every entrant can use their private link, including players who also use the app.</p>
                      <input
                        type="search"
                        value={contactSearch}
                        onChange={(event) => setContactSearch(event.target.value)}
                        placeholder="Find an entrant"
                        className="mt-3 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 sm:max-w-sm"
                      />
                      <div className="mt-3 space-y-2">
                        {filteredCompetitionContacts.map((contact) => (
                          <div key={contact.entryId} className={`grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-[1fr_1fr_1fr_auto] ${contact.email && contact.phone ? "border-sky-200" : "border-amber-300"}`}>
                            <div>
                              <p className="font-medium text-slate-950">{contact.name}</p>
                              {contact.email && contact.phone ? <span className="text-xs text-emerald-700">Ready</span> : <span className="text-xs font-medium text-amber-700">Contact details incomplete</span>}
                            </div>
                            <input
                              type="tel"
                              value={contact.phone ?? ""}
                              onChange={(event) => setCompetitionContacts((current) => current.map((item) => item.entryId === contact.entryId ? { ...item, phone: event.target.value || null } : item))}
                              placeholder="Mobile number"
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            <input
                              type="email"
                              value={contact.email ?? ""}
                              onChange={(event) => setCompetitionContacts((current) => current.map((item) => item.entryId === contact.entryId ? { ...item, email: event.target.value || null } : item))}
                              placeholder="Email address"
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => void saveCompetitionContact(contact)}
                              disabled={savingContactEntryId === contact.entryId || (!contact.email && !contact.phone)}
                              className="rounded-lg bg-sky-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                              {savingContactEntryId === contact.entryId ? "Saving..." : "Save"}
                            </button>
                            {contact.fixtureAccessToken ? (
                              <button
                                type="button"
                                onClick={() => void copyGuestFixtureLink(contact)}
                                className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900 sm:col-start-2 sm:col-span-3"
                              >
                                Copy {contact.name}&apos;s private fixture/result link
                              </button>
                            ) : (
                              <p className="text-xs text-slate-500 sm:col-start-2 sm:col-span-3">Uses their registered app account for fixtures and results.</p>
                            )}
                          </div>
                        ))}
                        {!filteredCompetitionContacts.length ? <p className="rounded-lg bg-white p-3 text-sm text-slate-600">No entrants match that search.</p> : null}
                      </div>
                    </details>
                  ) : null}
                  {showAdminArea("settings") && admin.isAdmin ? (
                    <>
                    {!matches.length ? <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
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
                        {isOneDayLeague ? "Competition date" : "First week start date"}
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
                          {generatingLeagueFixtures ? "Generating..." : matches.length > 0 ? "Fixtures Generated" : isOneDayLeague ? "Create One-day Fixtures" : "Create Weekly Fixtures"}
                        </button>
                      </div>
                    </div> : <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><span><strong>Fixtures generated</strong> · {matches.filter((match) => match.status !== "bye").length} matches</span><button type="button" onClick={() => selectAdminCompetitionTab("fixtures")} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 font-semibold">View fixtures</button></div>}
                    {!isOneDayLeague ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-semibold text-amber-950">Fixture break weeks</p>
                        <p className="mt-1 text-xs text-amber-800">
                          {matches.length
                            ? "Add or remove break weeks at any time. Saving moves only future pending rounds; current, completed and in-progress fixtures stay fixed."
                            : "Optional: choose any date in a week to pause fixtures. The app records the Monday of that week and moves every later round back by seven days."}
                        </p>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <input
                            type="date"
                            value={leagueBreakWeekInput}
                            onChange={(event) => setLeagueBreakWeekInput(event.target.value)}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
                            aria-label="Choose a fixture break week"
                          />
                          <button
                            type="button"
                            onClick={addLeagueBreakWeek}
                            disabled={!leagueBreakWeekInput}
                            className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-950 disabled:opacity-50"
                          >
                            Add break week
                          </button>
                        </div>
                        {leagueBreakWeeksInput.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {leagueBreakWeeksInput.map((dateValue) => (
                              <span key={dateValue} className="inline-flex items-center gap-2 rounded-full bg-amber-200 px-3 py-1 text-xs font-medium text-amber-950">
                                Week beginning {formatBreakWeek(dateValue)}
                                <button
                                  type="button"
                                  onClick={() => setLeagueBreakWeeksInput((current) => current.filter((item) => item !== dateValue))}
                                  className="rounded-full px-1 hover:bg-amber-300"
                                  aria-label={`Remove break week beginning ${formatBreakWeek(dateValue)}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : <p className="mt-2 text-xs text-amber-800">No break weeks selected.</p>}
                        {matches.length ? (
                          <button
                            type="button"
                            onClick={() => setConfirmBreakScheduleOpen(true)}
                            disabled={savingLeagueBreakWeeks}
                            className="mt-3 rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {savingLeagueBreakWeeks ? "Updating calendar..." : "Save Break Weeks & Move Future Fixtures"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    </>
                  ) : null}
                  {showAdminArea("settings") && admin.isAdmin && isOneDayLeague && Number(competition.league_finals_size ?? 0) === 4 ? (
                    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
                      <p className="text-sm font-semibold text-violet-950">Top-four finals</p>
                      <p className="mt-1 text-xs text-violet-800">Adjust these lengths at any point; pending semi-finals or final will update when saved.</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <label className="text-sm text-slate-700">Semi-finals<select className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={leagueSemiBestOfInput} onChange={(e) => setLeagueSemiBestOfInput(e.target.value)}>{BEST_OF_OPTIONS.map((value) => <option key={value} value={value}>Best of {value}</option>)}</select></label>
                        <label className="text-sm text-slate-700">Final<select className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={leagueFinalBestOfInput} onChange={(e) => setLeagueFinalBestOfInput(e.target.value)}>{BEST_OF_OPTIONS.map((value) => <option key={value} value={value}>Best of {value}</option>)}</select></label>
                        <div className="flex items-end"><button type="button" onClick={() => void saveOneDayFinalLengths()} className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm text-violet-900">Save lengths</button></div>
                      </div>
                    </div>
                  ) : null}
                  {showAdminArea("settings") && admin.isAdmin && competition.handicap_enabled && competition.sport_type === "snooker" && (competition.match_mode ?? "singles") !== "doubles" && matches.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm text-amber-900">
                        Handicap starts are stored when fixtures are generated and capped at {MAX_SNOOKER_START}. If player handicaps change later, refresh future pending fixtures here.
                      </p>
                      <button
                        type="button"
                        onClick={() => void refreshFutureLeagueHandicapStarts()}
                        disabled={refreshingFutureHandicaps}
                        className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900 disabled:opacity-60"
                      >
                        {refreshingFutureHandicaps ? "Refreshing..." : "Refresh Future Handicap Starts"}
                      </button>
                    </div>
                  ) : null}
                  {matches.length ? (
                    <div className="mt-4 space-y-4">
                      {showAdminArea("table") ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">League table</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Every {competition.sport_type === "snooker" ? "frame" : "rack"} won is one point. Completed void fixtures score no points.
                          {hasTopEightFinals ? " The top 8 positions qualify for the end-of-season knockout." : ""}
                          {isOneDayLeague && Number(competition.league_finals_size ?? 0) === 4 ? " The top four qualify for the semi-finals." : ""}
                        </p>
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead className="text-slate-500">
                              <tr>
                                <th className="px-2 py-2 text-center">#</th>
                                <th className="px-2 py-2 text-left">Player</th>
                                <th className="px-2 py-2 text-center">P</th>
                                <th className="px-2 py-2 text-center">W</th>
                                <th className="px-2 py-2 text-center">L</th>
                                <th className="px-2 py-2 text-center">Void</th>
                                <th className="px-2 py-2 text-center">Bye</th>
                                <th className="px-2 py-2 text-center">Pts</th>
                                {hasTopEightFinals || (isOneDayLeague && Number(competition.league_finals_size ?? 0) === 4) ? <th className="px-2 py-2 text-center">Finals</th> : null}
                              </tr>
                            </thead>
                            <tbody>
                              {leagueTableRows.map((row, index) => (
                                <tr
                                  key={row.playerId}
                                  className={`border-t text-slate-800 ${hasTopEightFinals && index < 8 ? "border-lime-300 bg-lime-50" : "border-slate-200"} ${hasTopEightFinals && index === 7 ? "border-b-4 border-b-lime-500" : ""}`}
                                >
                                  <td className="px-2 py-2 text-center tabular-nums">{index + 1}</td>
                                  <td className="px-2 py-2 font-medium">{row.playerName}</td>
                                  <td className="px-2 py-2 text-center tabular-nums">{row.played}</td>
                                  <td className="px-2 py-2 text-center tabular-nums">{row.won}</td>
                                  <td className="px-2 py-2 text-center tabular-nums">{row.lost}</td>
                                  <td className="px-2 py-2 text-center tabular-nums">{row.voided}</td>
                                  <td className="px-2 py-2 text-center tabular-nums">{row.byes}</td>
                                  <td className="px-2 py-2 text-center font-semibold tabular-nums">{row.points}</td>
                                  {hasTopEightFinals || (isOneDayLeague && Number(competition.league_finals_size ?? 0) === 4) ? (
                                    <td className="px-2 py-2 text-center">
                                      {index < (hasTopEightFinals ? 8 : 4) ? <span className="rounded-full bg-lime-200 px-2 py-0.5 text-xs font-semibold text-lime-950">{hasTopEightFinals ? "Cup place" : "Top 4"}</span> : "—"}
                                    </td>
                                  ) : null}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div> : null}
                      {showAdminArea("table") && hasTopEightFinals ? (
                        <div className="rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 to-lime-50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-950">Legion Masters Cup qualification</p>
                              <p className="mt-1 text-xs text-slate-700">
                                The highlighted top eight qualify. Once every league fixture is completed or voided, create the seeded knockout: 1st v 8th, 4th v 5th, 2nd v 7th and 3rd v 6th.
                              </p>
                            </div>
                            {admin.isAdmin ? (
                              <button
                                type="button"
                                onClick={() => void openOrCreateMastersCup()}
                                disabled={!leagueStageComplete || leagueTableRows.length < 8 || creatingMastersCup}
                                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                {creatingMastersCup ? "Preparing Cup..." : leagueStageComplete ? "Create or Open Masters Cup" : "Available after league stage"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {showAdminArea("table") && isOneDayLeague && Number(competition.league_finals_size ?? 0) === 4 ? (
                        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                          <p className="text-sm font-semibold text-violet-950">Finals stage</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => void createOneDaySemiFinals()} disabled={matches.some((match) => (match.round_no ?? 1) === leagueSemiFinalRound)} className="rounded-lg bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50">{matches.some((match) => (match.round_no ?? 1) === leagueSemiFinalRound) ? "Semi-finals created" : "Create semi-finals from top 4"}</button>
                            <button type="button" onClick={() => void createOneDayFinal()} disabled={matches.some((match) => (match.round_no ?? 1) === leagueFinalRound)} className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm text-violet-900 disabled:opacity-50">{matches.some((match) => (match.round_no ?? 1) === leagueFinalRound) ? "Final created" : "Create final from winners"}</button>
                          </div>
                          <div className="mt-3 space-y-2">
                            {matches.filter((match) => (match.round_no ?? 1) > roundRobinRoundCount).sort((a, b) => (a.round_no ?? 0) - (b.round_no ?? 0) || (a.match_no ?? 0) - (b.match_no ?? 0)).map((match) => (
                              <Link key={match.id} href={`/matches/${match.id}`} className="flex items-center justify-between rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800">
                                <span><strong>{(match.round_no ?? 1) === leagueFinalRound ? "Final" : `Semi-final ${match.match_no}`}</strong> · {getMatchLabel(match, fullMap)}</span>
                                <span>Best of {match.best_of} · {getStatusLabel(match)}</span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {showAdminArea("fixtures") ? <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-sm font-semibold text-slate-900">Fixture filter</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setLeagueFixtureFilterMode("all")}
                              className={`rounded-lg border px-3 py-2 text-sm ${leagueFixtureFilterMode === "all" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                            >
                              All fixtures
                            </button>
                            <button
                              type="button"
                              onClick={() => setLeagueFixtureFilterMode("week")}
                              className={`rounded-lg border px-3 py-2 text-sm ${leagueFixtureFilterMode === "week" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                            >
                              {isOneDayLeague ? "By round" : "By week"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setLeagueFixtureFilterMode("player")}
                              className={`rounded-lg border px-3 py-2 text-sm ${leagueFixtureFilterMode === "player" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                            >
                              By player
                            </button>
                          </div>
                          {leagueFixtureFilterMode === "week" ? (
                            <label className="mt-3 flex max-w-xs flex-col gap-1 text-sm text-slate-700">
                              {isOneDayLeague ? "Select round" : "Select week"}
                              <select
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                value={leagueFixtureFilterWeek}
                                onChange={(e) => setLeagueFixtureFilterWeek(e.target.value)}
                              >
                                <option value="all">All {isOneDayLeague ? "rounds" : "weeks"}</option>
                                {leagueFixtureWeekOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {leagueFixtureFilterMode === "player" ? (
                            <label className="mt-3 flex max-w-sm flex-col gap-1 text-sm text-slate-700">
                              Select player
                              <select
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                value={leagueFixtureFilterPlayer}
                                onChange={(e) => setLeagueFixtureFilterPlayer(e.target.value)}
                              >
                                <option value="all">All players</option>
                                {leagueFixturePlayerOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                        </div>
                        {filteredLeagueFixturesByWeek.map((week) => (
                          <div key={`week-${week.week}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-sm font-semibold text-slate-900">
                              {isOneDayLeague ? "Round" : "Week"} {week.week}
                              {week.scheduledFor ? ` · ${week.scheduledFor}` : ""}
                            </p>
                            {week.matches.some((match) => Boolean(match.deadlineLabel)) ? (
                              <p className="mt-1 text-xs text-slate-500">
                                Play by {week.matches.find((match) => match.deadlineLabel)?.deadlineLabel}. Unresolved fixtures then go to the Super User for a Monday decision. {competition.sport_type === "snooker" ? "A walkover is only for a genuine no-show" : `A ${competition.best_of}–0 award is only for a genuine no-show`}; otherwise the fixture may be voided.
                              </p>
                            ) : null}
                            <div className="mt-2 space-y-2">
                              {week.matches.map((match) =>
                                match.isBye ? (
                                <div
                                    key={`${week.week}-${match.id}`}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                  >
                                    <div>{match.label.replace(" vs BYE", " vs BYE week")}</div>
                                    {match.handicapLabel ? (
                                      <p className="mt-1 text-xs text-sky-700">{match.handicapLabel}</p>
                                    ) : null}
                                  </div>
                                ) : (
                                  <Link
                                    key={`${week.week}-${match.id}`}
                                    href={`/matches/${match.id}`}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 transition hover:border-teal-300 hover:bg-teal-50"
                                  >
                                    <span>
                                      <span className="block">{match.label}</span>
                                      {match.handicapLabel ? (
                                        <span className="mt-1 block text-xs text-sky-700">{match.handicapLabel}</span>
                                      ) : null}
                                      {match.openingBreakerLabel ? (
                                        <span className="mt-1 block text-xs font-semibold text-emerald-700">
                                          Opening break: {match.openingBreakerLabel}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className={`rounded-full border px-2 py-0.5 text-xs ${match.chip.className}`}>
                                      {match.chip.label}
                                    </span>
                                  </Link>
                                )
                              )}
                            </div>
                          </div>
                        ))}
                        {!filteredLeagueFixturesByWeek.length ? (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                            No fixtures match the current filter.
                          </div>
                        ) : null}
                      </div> : null}
                    </div>
                  ) : (
                    showAdminArea("fixtures") || showAdminArea("settings") ? <p className="mt-3 text-sm text-slate-600">No {isOneDayLeague ? "one-day" : "weekly"} fixtures generated yet.</p> : null
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
          open={cashPaymentTarget !== null}
          title={cashPaymentTarget?.reset ? "Undo cash payment?" : "Confirm cash received"}
          description={cashPaymentTarget?.reset
            ? "This will return the entrant to payment pending."
            : `Only confirm after you have received the £${((cashPaymentTarget?.entry.payment_amount_pence ?? competition?.entry_fee_pence ?? 0) / 100).toFixed(2)} cash payment.`}
          confirmLabel={cashPaymentTarget?.reset ? "Undo Payment" : "Mark Cash Paid"}
          cancelLabel="Cancel"
          onCancel={() => setCashPaymentTarget(null)}
          onConfirm={async () => {
            const target = cashPaymentTarget;
            setCashPaymentTarget(null);
            if (target) await updateCashPayment(target.entry, target.reset);
          }}
        />
        <ConfirmModal
          open={confirmBreakScheduleOpen}
          title="Update fixture break weeks?"
          description="This recalculates only future pending rounds. Current, completed, in-progress and past fixtures remain on their existing dates. Pending player reschedule requests for fixtures that move will be closed as superseded."
          confirmLabel="Save & Move Future Fixtures"
          cancelLabel="Cancel"
          onCancel={() => setConfirmBreakScheduleOpen(false)}
          onConfirm={async () => {
            setConfirmBreakScheduleOpen(false);
            await saveLeagueBreakSchedule();
          }}
        />
        <ConfirmModal
          open={confirmLeagueGenerationOpen}
          title="Generate weekly league fixtures?"
          description={
            projectedLeagueFixtureCount > 0
              ? `This will generate ${projectedLeagueFixtureCount} fixture${projectedLeagueFixtureCount === 1 ? "" : "s"} over ${projectedLeagueRounds.length} ${isOneDayLeague ? "round" : "playing week"}${projectedLeagueRounds.length === 1 ? "" : "s"} for the approved league field${isOneDayLeague ? " on one day" : ""}.${!isOneDayLeague && leagueBreakWeeksInput.length ? ` ${leagueBreakWeeksInput.length} selected break week${leagueBreakWeeksInput.length === 1 ? "" : "s"} will be skipped where they fall within the schedule.` : ""}`
              : `This will generate ${isOneDayLeague ? "one-day" : "weekly"} fixtures for the approved league field.`
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
