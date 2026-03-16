"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import usePremiumStatus from "@/components/usePremiumStatus";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import ConfirmModal from "@/components/ConfirmModal";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";

type Match = {
  id: string;
  competition_id: string;
  round_no: number | null;
  match_no: number | null;
  best_of: number;
  status: "pending" | "in_progress" | "complete" | "bye";
  match_mode: "singles" | "doubles";
  is_archived?: boolean | null;
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  winner_player_id: string | null;
  opening_break_player_id?: string | null;
  rating_applied_at?: string | null;
  scheduled_for?: string | null;
  team1_handicap_start?: number | null;
  team2_handicap_start?: number | null;
};

type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  avatar_url?: string | null;
  rating_pool?: number | null;
  rating_snooker?: number | null;
  peak_rating_pool?: number | null;
  peak_rating_snooker?: number | null;
  rated_matches_pool?: number | null;
  rated_matches_snooker?: number | null;
  snooker_handicap?: number | null;
};
type KnockoutRoundBestOf = {
  round1?: number;
  semi_final?: number;
  final?: number;
};

type CompetitionSettings = {
  id: string;
  name: string;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  location_id?: string | null;
  competition_format: "knockout" | "league";
  app_assign_opening_break: boolean;
  knockout_round_best_of: KnockoutRoundBestOf | null;
  handicap_enabled?: boolean;
};

type FrameRow = {
  frame_number: number;
  winner_player_id: string | null;
  break_and_run: boolean;
  run_out_against_break: boolean;
  is_walkover_award: boolean;
  team1_points: number | null;
  team2_points: number | null;
  breaks_over_30_team1_values: number[] | null;
  breaks_over_30_team2_values: number[] | null;
  high_break_team1: number | null;
  high_break_team2: number | null;
};

type FrameInput = {
  frame_number: number;
  winner_side: 0 | 1 | 2;
  break_and_run: boolean;
  run_out_against_break: boolean;
  team1_points: number;
  team2_points: number;
  breaks_over_30_team1_values_text: string;
  breaks_over_30_team2_values_text: string;
};

type ResultSubmission = {
  id: string;
  match_id: string;
  submitted_by_user_id: string;
  submitted_at: string;
  team1_score: number;
  team2_score: number;
  break_and_run: boolean;
  run_out_against_break: boolean;
  break_and_run_team1: number | null;
  break_and_run_team2: number | null;
  run_out_against_break_team1: number | null;
  run_out_against_break_team2: number | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  note: string | null;
};

type LeagueRescheduleRequest = {
  id: string;
  match_id: string;
  requester_user_id: string;
  requester_player_id: string | null;
  original_scheduled_for: string;
  requested_scheduled_for: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  note: string | null;
  created_at: string;
};

const REJECTION_REASONS = [
  "Incorrect final score",
  "Wrong match or players selected",
  "Duplicate submission",
  "Other",
] as const;

function firstToWin(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

function normalizeCount(value: number | null | undefined): number {
  return Math.max(0, value ?? 0);
}

function createEmptyFrame(frameNumber: number): FrameInput {
  return {
    frame_number: frameNumber,
    winner_side: 0,
    break_and_run: false,
    run_out_against_break: false,
    team1_points: 0,
    team2_points: 0,
    breaks_over_30_team1_values_text: "",
    breaks_over_30_team2_values_text: "",
  };
}

function parseBreakValues(raw: string): { ok: true; values: number[] } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, values: [] };
  const tokens = trimmed.split(/[,\s]+/).filter(Boolean);
  const values: number[] = [];
  for (const token of tokens) {
    const n = Number.parseInt(token, 10);
    if (!Number.isFinite(n)) return { ok: false, error: `Invalid break value "${token}". Use whole numbers only.` };
    if (n <= 30) return { ok: false, error: `Break value "${n}" must be over 30.` };
    values.push(n);
  }
  return { ok: true, values };
}

function validateBreaksAgainstPoints(
  teamLabel: string,
  points: number,
  values: number[]
): { ok: true } | { ok: false; error: string } {
  const total = values.reduce((acc, n) => acc + n, 0);
  const max = values.length ? Math.max(...values) : 0;
  if (total > points) {
    return {
      ok: false,
      error: `${teamLabel} has ${points} points in this frame, so break values totaling ${total} are not possible.`,
    };
  }
  if (max > points) {
    return {
      ok: false,
      error: `${teamLabel} has ${points} points in this frame, so break value ${max} is not possible.`,
    };
  }
  return { ok: true };
}

type RatingKeys = {
  rating: "rating_pool" | "rating_snooker";
  peak: "peak_rating_pool" | "peak_rating_snooker";
  matches: "rated_matches_pool" | "rated_matches_snooker";
};

function ratingKeysForSport(sport: "snooker" | "pool_8_ball" | "pool_9_ball"): RatingKeys {
  return sport === "snooker"
    ? { rating: "rating_snooker", peak: "peak_rating_snooker", matches: "rated_matches_snooker" }
    : { rating: "rating_pool", peak: "peak_rating_pool", matches: "rated_matches_pool" };
}

function expectedScore(teamA: number, teamB: number) {
  return 1 / (1 + Math.pow(10, (teamB - teamA) / 400));
}

function stableIndexFromSeed(seed: string, size: number): number {
  if (size <= 1) return 0;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % size;
}

function getLeagueFixtureWindow(scheduledFor: string | null | undefined) {
  if (!scheduledFor) return null;
  const [year, month, day] = scheduledFor.split("-").map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return null;
  const opensAt = new Date(year, month - 1, day, 0, 1, 0, 0);
  const dueAt = new Date(year, month - 1, day + 6, 21, 0, 0, 0);
  return { opensAt, dueAt };
}

function addDaysToIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return isoDate;
  const next = new Date(year, month - 1, day + days, 12, 0, 0, 0);
  return next.toISOString().slice(0, 10);
}

function calculateSnookerHandicapStarts(playerOneHandicap: number | null | undefined, playerTwoHandicap: number | null | undefined) {
  const h1 = playerOneHandicap ?? 0;
  const h2 = playerTwoHandicap ?? 0;
  const baseline = Math.min(h1, h2);
  return {
    team1: h1 - baseline,
    team2: h2 - baseline,
  };
}

function getMatchStatusLabel(match: Match | null) {
  if (!match) return "";
  if (match.status === "bye") return "Locked";
  if (match.status === "complete" && !match.winner_player_id) return "Void";
  return match.status.replace("_", " ");
}

function kFactor(avgRating: number, avgMatches: number) {
  if (avgMatches < 30) return 32;
  if (avgRating >= 1800) return 16;
  return 20;
}

function getNextRoundBestOf(
  totalRounds: number,
  roundNo: number,
  fallbackBestOf: number,
  custom: KnockoutRoundBestOf | null | undefined
): number {
  if (!custom) return fallbackBestOf;
  if (roundNo >= totalRounds) return custom.final ?? fallbackBestOf;
  if (roundNo === totalRounds - 1) return custom.semi_final ?? fallbackBestOf;
  return custom.round1 ?? fallbackBestOf;
}

function resolveWinningSideForMatch(m: Match): 1 | 2 | 0 {
  if (!m.winner_player_id) return 0;
  if (m.match_mode === "singles") {
    if (m.winner_player_id === m.player1_id) return 1;
    if (m.winner_player_id === m.player2_id) return 2;
    return 0;
  }
  const t1 = [m.team1_player1_id, m.team1_player2_id];
  const t2 = [m.team2_player1_id, m.team2_player2_id];
  if (t1.includes(m.winner_player_id)) return 1;
  if (t2.includes(m.winner_player_id)) return 2;
  return 0;
}

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

export default function MatchPage() {
  const params = useParams();
  const router = useRouter();
  const premium = usePremiumStatus();
  const admin = useAdminStatus();
  const matchId = String(params.id ?? "");

  const [match, setMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [competition, setCompetition] = useState<CompetitionSettings | null>(null);
  const [frames, setFrames] = useState<FrameInput[]>([]);
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(() => (supabase ? null : "Supabase is not configured."));
  const [confirmEditComplete, setConfirmEditComplete] = useState(false);
  const [submissions, setSubmissions] = useState<ResultSubmission[]>([]);
  const [rescheduleRequests, setRescheduleRequests] = useState<LeagueRescheduleRequest[]>([]);
  const [requesterPendingReschedules, setRequesterPendingReschedules] = useState<LeagueRescheduleRequest[]>([]);
  const [adminLocationId, setAdminLocationId] = useState<string | null>(null);
  const [viewerLinkedPlayerId, setViewerLinkedPlayerId] = useState<string | null>(null);
  const [assigningBreaker, setAssigningBreaker] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    tone?: "default" | "danger";
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; description: string } | null>(null);
  const [redirectAfterInfo, setRedirectAfterInfo] = useState(false);
  const [reviewNowMs] = useState(() => Date.now());
  const [requestingReschedule, setRequestingReschedule] = useState(false);
  const [rejectModal, setRejectModal] = useState<{
    submission: ResultSubmission;
    reason: string;
    comment: string;
  } | null>(null);

  const openDisplay = () => {
    if (!matchId) return;
    const url = `/display/quick/${matchId}`;
    window.open(url, "_blank", "noopener,noreferrer,width=1280,height=720");
  };

  const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const subtleCardClass = "rounded-xl border border-slate-200 bg-slate-50 p-3";
  const buttonBaseClass = "rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-60";
  const buttonSecondaryClass = `${buttonBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const buttonSuccessClass = `${buttonBaseClass} border-emerald-700 bg-emerald-700 text-white`;
  const buttonDangerClass = `${buttonBaseClass} border-rose-300 bg-rose-50 text-rose-900`;

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let active = true;
    const load = async () => {
      setLoading(true);

      const mRes = await client
        .from("matches")
        .select("id,competition_id,round_no,match_no,best_of,status,match_mode,is_archived,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,rating_applied_at,scheduled_for,team1_handicap_start,team2_handicap_start")
        .eq("id", matchId)
        .maybeSingle();

      if (!active) return;
      if (mRes.error || !mRes.data) {
        setLoading(false);
        setMessage(mRes.error?.message ?? "Match not found.");
        return;
      }
      const loadedMatch = mRes.data as Match;
      setMatch(loadedMatch);
      setConfirmEditComplete(loadedMatch.status !== "complete");

      const authRes = await client.auth.getUser();
      const signedInUserId = authRes.data.user?.id ?? null;
      let linkedPlayerId: string | null = null;
      if (signedInUserId) {
        const linkRes = await client.from("app_users").select("linked_player_id").eq("id", signedInUserId).maybeSingle();
        linkedPlayerId = (linkRes.data?.linked_player_id as string | null) ?? null;
      }

      const [adminLocRes, playersRes, competitionRes, framesRes, submissionsRes] = await Promise.all([
        (async () => {
          if (!signedInUserId || admin.isSuper || !admin.isAdmin) return null;
          const linked = linkedPlayerId;
          if (!linked) return null;
          const p = await client.from("players").select("location_id").eq("id", linked).maybeSingle();
          return (p.data?.location_id as string | null) ?? null;
        })(),
        client
          .from("players")
          .select("id,display_name,full_name,avatar_url,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker,snooker_handicap"),
        client
          .from("competitions")
          .select("id,name,sport_type,location_id,competition_format,app_assign_opening_break,knockout_round_best_of,handicap_enabled")
          .eq("id", loadedMatch.competition_id)
          .maybeSingle(),
        client
          .from("frames")
          .select(
            "frame_number,winner_player_id,break_and_run,run_out_against_break,is_walkover_award,team1_points,team2_points,breaks_over_30_team1_values,breaks_over_30_team2_values,high_break_team1,high_break_team2"
          )
          .eq("match_id", matchId)
          .order("frame_number", { ascending: true }),
        client
          .from("result_submissions")
          .select("id,match_id,submitted_by_user_id,submitted_at,team1_score,team2_score,break_and_run,run_out_against_break,break_and_run_team1,break_and_run_team2,run_out_against_break_team1,run_out_against_break_team2,status,reviewed_by_user_id,reviewed_at,note")
          .eq("match_id", matchId)
          .order("submitted_at", { ascending: false }),
      ]);

      if (!active) return;
      if (playersRes.error || competitionRes.error || framesRes.error || submissionsRes.error || !playersRes.data || !competitionRes.data || !framesRes.data) {
        setLoading(false);
        setMessage(
          [
            playersRes.error?.message && `Players: ${playersRes.error.message}`,
            competitionRes.error?.message && `Competition: ${competitionRes.error.message}`,
            framesRes.error?.message && `Frames: ${framesRes.error.message}`,
            submissionsRes.error?.message && `Submissions: ${submissionsRes.error.message}`,
            !playersRes.data && "Players: missing data",
            !competitionRes.data && "Competition: missing data",
            !framesRes.data && "Frames: missing data",
          ]
            .filter(Boolean)
            .join(" · ") || "Failed to load match dependencies."
        );
        return;
      }

      let effectiveMatch = loadedMatch;
      let effectiveFrameRows = ((framesRes.data ?? []) as unknown) as FrameRow[];
      let effectiveSubmissionRows = ((submissionsRes.data ?? []) as unknown) as ResultSubmission[];
      let effectiveRescheduleRows: LeagueRescheduleRequest[] = [];
      let effectiveRequesterPendingRows: LeagueRescheduleRequest[] = [];
      const sessionRes = await client.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? null;
      if (accessToken && competitionRes.data.competition_format === "league") {
        await fetch("/api/admin/auto-void-league-fixtures", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ competitionId: loadedMatch.competition_id }),
        }).catch(() => null);
        const [refreshedMatchRes, refreshedFramesRes, refreshedSubmissionsRes] = await Promise.all([
          client
            .from("matches")
            .select("id,competition_id,round_no,match_no,best_of,status,match_mode,is_archived,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,rating_applied_at,scheduled_for,team1_handicap_start,team2_handicap_start")
            .eq("id", matchId)
            .maybeSingle(),
          client
            .from("frames")
            .select(
              "frame_number,winner_player_id,break_and_run,run_out_against_break,is_walkover_award,team1_points,team2_points,breaks_over_30_team1_values,breaks_over_30_team2_values,high_break_team1,high_break_team2"
            )
            .eq("match_id", matchId)
            .order("frame_number", { ascending: true }),
          client
            .from("result_submissions")
            .select("id,match_id,submitted_by_user_id,submitted_at,team1_score,team2_score,break_and_run,run_out_against_break,break_and_run_team1,break_and_run_team2,run_out_against_break_team1,run_out_against_break_team2,status,reviewed_by_user_id,reviewed_at,note")
            .eq("match_id", matchId)
            .order("submitted_at", { ascending: false }),
        ]);
        if (refreshedMatchRes.data) effectiveMatch = (refreshedMatchRes.data as unknown) as Match;
        if (!refreshedFramesRes.error) effectiveFrameRows = ((refreshedFramesRes.data ?? []) as unknown) as FrameRow[];
        if (!refreshedSubmissionsRes.error) effectiveSubmissionRows = ((refreshedSubmissionsRes.data ?? []) as unknown) as ResultSubmission[];
      }

      if (competitionRes.data.competition_format === "league") {
        const [matchRescheduleRes, requesterPendingRes] = await Promise.all([
          client
            .from("league_reschedule_requests")
            .select("id,match_id,requester_user_id,requester_player_id,original_scheduled_for,requested_scheduled_for,status,reviewed_by_user_id,reviewed_at,note,created_at")
            .eq("match_id", matchId)
            .order("created_at", { ascending: false }),
          signedInUserId
            ? client
                .from("league_reschedule_requests")
                .select("id,match_id,requester_user_id,requester_player_id,original_scheduled_for,requested_scheduled_for,status,reviewed_by_user_id,reviewed_at,note,created_at")
                .eq("requester_user_id", signedInUserId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (matchRescheduleRes.error || requesterPendingRes.error) {
          setLoading(false);
          setMessage(matchRescheduleRes.error?.message || requesterPendingRes.error?.message || "Failed to load reschedule requests.");
          return;
        }
        effectiveRescheduleRows = ((matchRescheduleRes.data ?? []) as unknown) as LeagueRescheduleRequest[];
        effectiveRequesterPendingRows = ((requesterPendingRes.data ?? []) as unknown) as LeagueRescheduleRequest[];
      }

      const loadedPlayers = (playersRes.data as unknown) as Player[];
      const names = new Map(loadedPlayers.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name]));
      const teams = getTeamInfo(effectiveMatch, names);

      const existing = effectiveFrameRows
        .filter((x) => !x.is_walkover_award)
        .map((x) => ({
          frame_number: x.frame_number,
          winner_side:
            x.winner_player_id === teams.team1Rep
              ? (1 as const)
              : x.winner_player_id === teams.team2Rep
                ? (2 as const)
                : (x.team1_points ?? 0) > (x.team2_points ?? 0)
                  ? (1 as const)
                  : (x.team2_points ?? 0) > (x.team1_points ?? 0)
                    ? (2 as const)
                    : (0 as const),
          break_and_run: x.break_and_run,
          run_out_against_break: x.run_out_against_break,
          team1_points: normalizeCount(x.team1_points),
          team2_points: normalizeCount(x.team2_points),
          breaks_over_30_team1_values_text: (x.breaks_over_30_team1_values ?? []).join(", "),
          breaks_over_30_team2_values_text: (x.breaks_over_30_team2_values ?? []).join(", "),
        }));

      setMatch(effectiveMatch);
      setPlayers(loadedPlayers);
      setAdminLocationId(adminLocRes ?? null);
      setViewerLinkedPlayerId(linkedPlayerId);
      setCompetition((competitionRes.data as unknown) as CompetitionSettings);
      setFrames(existing.length > 0 ? existing : [createEmptyFrame(1)]);
      setSubmissions(effectiveSubmissionRows);
      setRescheduleRequests(effectiveRescheduleRows);
      setRequesterPendingReschedules(effectiveRequesterPendingRows);
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, [matchId, admin.loading, admin.isSuper]);

  const nameMap = useMemo(() => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])), [players]);
  const avatarMap = useMemo(() => new Map(players.map((p) => [p.id, p.avatar_url ?? null])), [players]);
  const teams = useMemo(() => (match ? getTeamInfo(match, nameMap) : null), [match, nameMap]);
  const isSnooker = competition?.sport_type === "snooker";
  const isHandicappedSnookerMatch = Boolean(isSnooker && competition?.handicap_enabled && match?.match_mode === "singles");
  const openingBreakerName = match?.opening_break_player_id ? nameMap.get(match.opening_break_player_id) ?? null : null;
  const isByeMatch = useMemo(
    () => !!(match && match.match_mode === "singles" && match.status === "bye" && match.player1_id && match.player1_id === match.player2_id),
    [match]
  );
  const isArchived = Boolean(match?.is_archived);
  const isVoidedMatch = Boolean(match?.status === "complete" && !match?.winner_player_id);

  const wins = useMemo(() => {
    return {
      team1: frames.filter((f) => f.winner_side === 1).length,
      team2: frames.filter((f) => f.winner_side === 2).length,
    };
  }, [frames]);

  const canSaveResult = useMemo(() => {
    if (!match) return false;
    const target = firstToWin(match.best_of);
    return wins.team1 >= target || wins.team2 >= target;
  }, [match, wins.team1, wins.team2]);
  const matchWinnerLabel = useMemo(() => {
    if (!match || !teams) return null;
    const target = firstToWin(match.best_of);
    if (wins.team1 >= target) return teams.team1Label;
    if (wins.team2 >= target) return teams.team2Label;
    return null;
  }, [match, teams, wins.team1, wins.team2]);
  const userPendingSubmission = useMemo(() => {
    if (!admin.userId) return null;
    return submissions.find((s) => s.submitted_by_user_id === admin.userId && s.status === "pending") ?? null;
  }, [admin.userId, submissions]);
  const canAdminManageMatch = admin.isAdmin || admin.isSuper;
  const hasPendingSubmission = useMemo(() => submissions.some((s) => s.status === "pending"), [submissions]);
  const pendingSubmissionForReview = useMemo(() => submissions.find((s) => s.status === "pending") ?? null, [submissions]);
  const adminReviewOnly = Boolean(canAdminManageMatch && hasPendingSubmission && !isArchived && !isByeMatch && match?.status !== "complete");
  const userApprovedSubmission = useMemo(() => {
    if (!admin.userId) return null;
    return submissions.find((s) => s.submitted_by_user_id === admin.userId && s.status === "approved") ?? null;
  }, [admin.userId, submissions]);
  const userLatestRejectedSubmission = useMemo(() => {
    if (!admin.userId) return null;
    return (
      submissions
        .filter((s) => s.submitted_by_user_id === admin.userId && s.status === "rejected")
        .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))[0] ?? null
    );
  }, [admin.userId, submissions]);
  const userSubmissionLocked = Boolean(userPendingSubmission || userApprovedSubmission || match?.status === "complete");
  const viewerCanEditThisMatch = useMemo(() => {
    if (!match || !viewerLinkedPlayerId) return false;
    if (match.match_mode === "singles") {
      return match.player1_id === viewerLinkedPlayerId || match.player2_id === viewerLinkedPlayerId;
    }
    return [
      match.team1_player1_id,
      match.team1_player2_id,
      match.team2_player1_id,
      match.team2_player2_id,
    ].includes(viewerLinkedPlayerId);
  }, [match, viewerLinkedPlayerId]);
  const leagueFixtureWindow = useMemo(() => {
    if (!match || competition?.competition_format !== "league") return null;
    return getLeagueFixtureWindow(match.scheduled_for);
  }, [competition?.competition_format, match]);
  const playerLeagueWindowOpen = useMemo(() => {
    if (!leagueFixtureWindow) return true;
    const now = new Date();
    return now >= leagueFixtureWindow.opensAt && now <= leagueFixtureWindow.dueAt;
  }, [leagueFixtureWindow]);
  const pendingRescheduleForMatch = useMemo(
    () => rescheduleRequests.find((request) => request.status === "pending") ?? null,
    [rescheduleRequests]
  );
  const latestRescheduleForMatch = useMemo(() => rescheduleRequests[0] ?? null, [rescheduleRequests]);
  const requesterPendingElsewhere = useMemo(
    () => requesterPendingReschedules.find((request) => request.match_id !== matchId) ?? null,
    [requesterPendingReschedules, matchId]
  );
  const rescheduleTargetDate = useMemo(
    () => (match?.scheduled_for ? addDaysToIsoDate(match.scheduled_for, 7) : null),
    [match?.scheduled_for]
  );
  const canAdminEditFrames = Boolean(!isByeMatch && !isArchived && canAdminManageMatch && !adminReviewOnly);
  const canParticipantEditFrames = Boolean(
    !admin.loading &&
      !canAdminManageMatch &&
      viewerCanEditThisMatch &&
      !userSubmissionLocked &&
      !isByeMatch &&
      !isArchived &&
      playerLeagueWindowOpen
  );
  const canEditFrames = canAdminEditFrames || canParticipantEditFrames;
  const canRequestReschedule = Boolean(
    competition?.competition_format === "league" &&
      !admin.isSuper &&
      viewerCanEditThisMatch &&
      !isByeMatch &&
      !isArchived &&
      !isVoidedMatch &&
      match?.status !== "complete" &&
      match?.scheduled_for &&
      !userPendingSubmission &&
      !userApprovedSubmission &&
      !pendingRescheduleForMatch &&
      !requesterPendingElsewhere
  );

  const requestLeagueReschedule = async () => {
    const client = supabase;
    if (!client || !admin.userId || !viewerLinkedPlayerId || !match?.scheduled_for || !rescheduleTargetDate) return;
    setRequestingReschedule(true);
    const insert = await client.from("league_reschedule_requests").insert({
      match_id: match.id,
      competition_id: match.competition_id,
      requester_user_id: admin.userId,
      requester_player_id: viewerLinkedPlayerId,
      original_scheduled_for: match.scheduled_for,
      requested_scheduled_for: rescheduleTargetDate,
      status: "pending",
    });
    setRequestingReschedule(false);
    if (insert.error) {
      const normalized = insert.error.message.toLowerCase();
      if (normalized.includes("one_pending_per_requester") || normalized.includes("one_pending_per_match") || normalized.includes("duplicate key")) {
        setMessage("Only one outstanding reschedule request is allowed at a time.");
        return;
      }
      setMessage(insert.error.message);
      return;
    }
    const refresh = await client
      .from("league_reschedule_requests")
      .select("id,match_id,requester_user_id,requester_player_id,original_scheduled_for,requested_scheduled_for,status,reviewed_by_user_id,reviewed_at,note,created_at")
      .eq("match_id", match.id)
      .order("created_at", { ascending: false });
    if (!refresh.error) {
      setRescheduleRequests(((refresh.data ?? []) as unknown) as LeagueRescheduleRequest[]);
    }
    const refreshPending = await client
      .from("league_reschedule_requests")
      .select("id,match_id,requester_user_id,requester_player_id,original_scheduled_for,requested_scheduled_for,status,reviewed_by_user_id,reviewed_at,note,created_at")
      .eq("requester_user_id", admin.userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (!refreshPending.error) {
      setRequesterPendingReschedules(((refreshPending.data ?? []) as unknown) as LeagueRescheduleRequest[]);
    }
    setInfoModal({
      title: "Reschedule requested",
      description: `Your request has been sent to the Super User. If approved, this fixture will move to the following week (${new Date(`${rescheduleTargetDate}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}).`,
    });
  };

  const assignOpeningBreaker = async (playerId: string) => {
    const client = supabase;
    if (!client || !match) return;
    setAssigningBreaker(true);
    const { data, error } = await client
      .from("matches")
      .update({ opening_break_player_id: playerId })
      .eq("id", match.id)
      .select("opening_break_player_id")
      .single();
    if (error) {
      setMessage(error.message);
    } else if (data) {
      setMatch((prev) => (prev ? { ...prev, opening_break_player_id: data.opening_break_player_id } : prev));
    }
    setAssigningBreaker(false);
  };

  const setWinner = (idx: number, side: 0 | 1 | 2) => {
    setFrames((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], winner_side: side };
      if (!match) return next;
      if (side !== 0 && idx === next.length - 1) {
        const t1 = next.filter((f) => f.winner_side === 1).length;
        const t2 = next.filter((f) => f.winner_side === 2).length;
        const target = firstToWin(match.best_of);
        const hasWinner = t1 >= target || t2 >= target;
        const hasUnfilled = next.some((f) => f.winner_side === 0);
        if (!hasWinner && !hasUnfilled) {
          next.push(createEmptyFrame(next.length + 1));
        }
      }
      return next;
    });
  };

  const setFlag = (idx: number, field: "break_and_run" | "run_out_against_break", value: boolean) => {
    if (isSnooker) return;
    if (!premium.loading && !premium.unlocked) {
      setMessage("Break & Run and Run Out are Premium features.");
      return;
    }
    setFrames((prev) => {
      const next = [...prev];
      const other = field === "break_and_run" ? "run_out_against_break" : "break_and_run";
      next[idx] = {
        ...next[idx],
        [field]: value,
        [other]: value ? false : next[idx][other],
      };
      return next;
    });
  };

  const setSnookerNumberField = (
    idx: number,
    field: "team1_points" | "team2_points",
    rawValue: string
  ) => {
    const safe = Math.max(0, Number.parseInt(rawValue || "0", 10) || 0);
    setFrames((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: safe };
      return next;
    });
  };

  const setSnookerBreakValuesField = (
    idx: number,
    field: "breaks_over_30_team1_values_text" | "breaks_over_30_team2_values_text",
    rawValue: string
  ) => {
    setFrames((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: rawValue };
      return next;
    });
  };

  const endSnookerFrame = (idx: number) => {
    if (!match || !teams) return;
    setFrames((prev) => {
      const next = [...prev];
      const frame = next[idx];
      const parsed1 = parseBreakValues(frame.breaks_over_30_team1_values_text);
      if (!parsed1.ok) {
        setInfoModal({ title: "Invalid Break Values", description: parsed1.error });
        return prev;
      }
      const parsed2 = parseBreakValues(frame.breaks_over_30_team2_values_text);
      if (!parsed2.ok) {
        setInfoModal({ title: "Invalid Break Values", description: parsed2.error });
        return prev;
      }
      const valid1 = validateBreaksAgainstPoints(teams.team1Label, frame.team1_points, parsed1.values);
      if (!valid1.ok) {
        setInfoModal({ title: "Invalid Break Values", description: valid1.error });
        return prev;
      }
      const valid2 = validateBreaksAgainstPoints(teams.team2Label, frame.team2_points, parsed2.values);
      if (!valid2.ok) {
        setInfoModal({ title: "Invalid Break Values", description: valid2.error });
        return prev;
      }
      if (frame.team1_points === frame.team2_points) {
        setInfoModal({
          title: "Frame Score Needed",
          description: "Frame points are level. Enter a winning score before ending this frame.",
        });
        return prev;
      }
      const winnerSide: 1 | 2 = frame.team1_points > frame.team2_points ? 1 : 2;
      next[idx] = { ...frame, winner_side: winnerSide };
      if (idx === next.length - 1) {
        const t1 = next.filter((f) => f.winner_side === 1).length;
        const t2 = next.filter((f) => f.winner_side === 2).length;
        const target = firstToWin(match.best_of);
        const hasWinner = t1 >= target || t2 >= target;
        if (!hasWinner) next.push(createEmptyFrame(next.length + 1));
      }
      return next;
    });
  };

  const addFrame = () => {
    if (isByeMatch || isArchived) return;
    setFrames((prev) => [...prev, createEmptyFrame(prev.length + 1)]);
  };

  const clearFrames = () => {
    if (isByeMatch || isArchived) return;
    setFrames([createEmptyFrame(1)]);
  };

  const buildFullResultRows = () => {
    if (!match || !teams) return { ok: false as const, error: "Match is not ready." };
    let rows: Array<{
      match_id: string;
      frame_number: number;
      winner_player_id: string | null;
      break_and_run: boolean;
      run_out_against_break: boolean;
      is_walkover_award: boolean;
      team1_points: number;
      team2_points: number;
      breaks_over_30_team1_values: number[];
      breaks_over_30_team2_values: number[];
      breaks_over_30_team1: number;
      breaks_over_30_team2: number;
      high_break_team1: number;
      high_break_team2: number;
    }> = [];
    let breakRunTeam1 = 0;
    let breakRunTeam2 = 0;
    let runOutTeam1 = 0;
    let runOutTeam2 = 0;

    for (const f of frames) {
      if (f.winner_side === 0) continue;
      const parsed1 = parseBreakValues(f.breaks_over_30_team1_values_text);
      if (!parsed1.ok) return { ok: false as const, error: parsed1.error };
      const parsed2 = parseBreakValues(f.breaks_over_30_team2_values_text);
      if (!parsed2.ok) return { ok: false as const, error: parsed2.error };
      const valid1 = validateBreaksAgainstPoints(teams.team1Label, f.team1_points, parsed1.values);
      if (!valid1.ok) return { ok: false as const, error: valid1.error };
      const valid2 = validateBreaksAgainstPoints(teams.team2Label, f.team2_points, parsed2.values);
      if (!valid2.ok) return { ok: false as const, error: valid2.error };
      if (f.break_and_run) {
        if (f.winner_side === 1) breakRunTeam1 += 1;
        if (f.winner_side === 2) breakRunTeam2 += 1;
      }
      if (f.run_out_against_break) {
        if (f.winner_side === 1) runOutTeam1 += 1;
        if (f.winner_side === 2) runOutTeam2 += 1;
      }
      rows.push({
        match_id: match.id,
        frame_number: f.frame_number,
        winner_player_id: f.winner_side === 1 ? teams.team1Rep : f.winner_side === 2 ? teams.team2Rep : null,
        break_and_run: isSnooker ? false : f.break_and_run,
        run_out_against_break: isSnooker ? false : f.run_out_against_break,
        is_walkover_award: false,
        team1_points: isSnooker ? f.team1_points : 0,
        team2_points: isSnooker ? f.team2_points : 0,
        breaks_over_30_team1_values: isSnooker ? parsed1.values : [],
        breaks_over_30_team2_values: isSnooker ? parsed2.values : [],
        breaks_over_30_team1: isSnooker ? parsed1.values.length : 0,
        breaks_over_30_team2: isSnooker ? parsed2.values.length : 0,
        high_break_team1: isSnooker && parsed1.values.length ? Math.max(...parsed1.values) : 0,
        high_break_team2: isSnooker && parsed2.values.length ? Math.max(...parsed2.values) : 0,
      });
    }

    return {
      ok: true as const,
      rows,
      summary: {
        team1Score: rows.filter((r) => r.winner_player_id === teams.team1Rep).length,
        team2Score: rows.filter((r) => r.winner_player_id === teams.team2Rep).length,
        breakRunTeam1,
        breakRunTeam2,
        runOutTeam1,
        runOutTeam2,
      },
    };
  };

  const persistFrames = async (
    rows: Array<{
      match_id: string;
      frame_number: number;
      winner_player_id: string | null;
      break_and_run: boolean;
      run_out_against_break: boolean;
      is_walkover_award: boolean;
      team1_points: number;
      team2_points: number;
      breaks_over_30_team1_values: number[];
      breaks_over_30_team2_values: number[];
      breaks_over_30_team1: number;
      breaks_over_30_team2: number;
      high_break_team1: number;
      high_break_team2: number;
    }>
  ) => {
    const client = supabase;
    if (!client || !match) return { ok: false as const, error: "Not ready." };
    const wipe = await client.from("frames").delete().eq("match_id", match.id);
    if (wipe.error) return { ok: false as const, error: wipe.error.message };
    const write = await client.from("frames").insert(rows);
    if (write.error) return { ok: false as const, error: write.error.message };
    return { ok: true as const };
  };

  const refreshCompetitionCompletion = async () => {
    const client = supabase;
    if (!client || !match) return false;
    const allMatches = await client
      .from("matches")
      .select("status")
      .eq("competition_id", match.competition_id)
      .eq("is_archived", false);
    if (allMatches.error || !allMatches.data) return false;
    const done = (allMatches.data as Array<{ status: Match["status"] }>).every((m) => m.status === "complete" || m.status === "bye");
    await client.from("competitions").update({ is_completed: done }).eq("id", match.competition_id);
    return done;
  };

  const advanceKnockoutWinner = async (winnerId: string) => {
    const client = supabase;
    if (!client || !match || !competition) return;
    if (competition.competition_format !== "knockout") return;
    if (!match.round_no || !match.match_no) return;

    const currentRound = match.round_no;
    const currentMatchNo = match.match_no;
    const siblingMatchNo = currentMatchNo % 2 === 1 ? currentMatchNo + 1 : currentMatchNo - 1;

    const siblingRes = await client
      .from("matches")
      .select("id,status,winner_player_id,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id")
      .eq("competition_id", match.competition_id)
      .eq("round_no", currentRound)
      .eq("match_no", siblingMatchNo)
      .maybeSingle();
    if (siblingRes.error) return;

    const sibling = siblingRes.data as Match | null;
    if (!sibling) return; // No sibling means this was final round.
    if ((sibling.status !== "complete" && sibling.status !== "bye") || !sibling.winner_player_id) return;

    const nextRound = currentRound + 1;
    const nextMatchNo = Math.ceil(currentMatchNo / 2);
    const currentWinnerSide = resolveWinningSideForMatch({ ...match, winner_player_id: winnerId });
    const siblingWinnerSide = resolveWinningSideForMatch(sibling);

    if (!currentWinnerSide || !siblingWinnerSide) return;

    const round1CountRes = await client
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", match.competition_id)
      .eq("round_no", 1);
    const round1MatchCount = round1CountRes.count ?? 1;
    const bracketSize = round1MatchCount * 2;
    const totalRounds = Math.max(1, Math.log2(bracketSize));
    const bestOfNext = getNextRoundBestOf(totalRounds, nextRound, match.best_of, competition.knockout_round_best_of);

    const currentWinnerSinglesId = currentWinnerSide === 1 ? match.player1_id : match.player2_id;
    const siblingWinnerSinglesId = siblingWinnerSide === 1 ? sibling.player1_id : sibling.player2_id;

    const currentWinnerTeam = currentWinnerSide === 1
      ? { p1: match.team1_player1_id, p2: match.team1_player2_id }
      : { p1: match.team2_player1_id, p2: match.team2_player2_id };
    const siblingWinnerTeam = siblingWinnerSide === 1
      ? { p1: sibling.team1_player1_id, p2: sibling.team1_player2_id }
      : { p1: sibling.team2_player1_id, p2: sibling.team2_player2_id };

    const isCurrentFirst = currentMatchNo % 2 === 1;
    const teamA = isCurrentFirst ? currentWinnerTeam : siblingWinnerTeam;
    const teamB = isCurrentFirst ? siblingWinnerTeam : currentWinnerTeam;
    const singlesA = isCurrentFirst ? currentWinnerSinglesId : siblingWinnerSinglesId;
    const singlesB = isCurrentFirst ? siblingWinnerSinglesId : currentWinnerSinglesId;

    const openingBreakSeed = `${match.competition_id}:${nextRound}:${nextMatchNo}`;
    const openingBreakerCandidates = match.match_mode === "doubles"
      ? [teamA.p1, teamA.p2, teamB.p1, teamB.p2].filter((playerId): playerId is string => Boolean(playerId))
      : [singlesA, singlesB].filter((playerId): playerId is string => Boolean(playerId));
    const openingBreaker = competition.app_assign_opening_break && openingBreakerCandidates.length
      ? openingBreakerCandidates[stableIndexFromSeed(openingBreakSeed, openingBreakerCandidates.length)] ?? null
      : null;
    const handicapStarts = competition.handicap_enabled && competition.sport_type === "snooker" && singlesA && singlesB
      ? calculateSnookerHandicapStarts(
          players.find((player) => player.id === singlesA)?.snooker_handicap,
          players.find((player) => player.id === singlesB)?.snooker_handicap
        )
      : { team1: 0, team2: 0 };

    const nextRowPayload = match.match_mode === "doubles"
      ? {
          competition_id: match.competition_id,
          round_no: nextRound,
          match_no: nextMatchNo,
          best_of: bestOfNext,
          status: "pending" as const,
          match_mode: "doubles" as const,
          player1_id: null,
          player2_id: null,
          team1_player1_id: teamA.p1,
          team1_player2_id: teamA.p2,
          team2_player1_id: teamB.p1,
          team2_player2_id: teamB.p2,
          winner_player_id: null,
          opening_break_player_id: openingBreaker,
          team1_handicap_start: 0,
          team2_handicap_start: 0,
        }
      : {
          competition_id: match.competition_id,
          round_no: nextRound,
          match_no: nextMatchNo,
          best_of: bestOfNext,
          status: "pending" as const,
          match_mode: "singles" as const,
          player1_id: singlesA,
          player2_id: singlesB,
          team1_player1_id: null,
          team1_player2_id: null,
          team2_player1_id: null,
          team2_player2_id: null,
          winner_player_id: null,
          opening_break_player_id: openingBreaker,
          team1_handicap_start: handicapStarts.team1,
          team2_handicap_start: handicapStarts.team2,
        };

    const existingRes = await client
      .from("matches")
      .select("id,status")
      .eq("competition_id", match.competition_id)
      .eq("round_no", nextRound)
      .eq("match_no", nextMatchNo)
      .maybeSingle();
    if (existingRes.error) return;

    if (existingRes.data?.id) {
      await client.from("matches").update(nextRowPayload).eq("id", existingRes.data.id);
      return;
    }
    await client.from("matches").insert(nextRowPayload);
  };

  const applyRatingsIfNeeded = async (winnerSide: 1 | 2, options?: { isWalkover?: boolean }) => {
    const client = supabase;
    if (!client || !match || !competition || options?.isWalkover) return;
    if (isByeMatch) return;
    if (match.match_mode === "doubles") return;

    const keys = ratingKeysForSport(competition.sport_type);
    const matchRead = await client
      .from("matches")
      .select(
        "id,status,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,rating_applied_at"
      )
      .eq("id", match.id)
      .maybeSingle();
    if (matchRead.error || !matchRead.data) return;
    if (matchRead.data.rating_applied_at) return;
    if (matchRead.data.status === "bye") return;

    const walkoverCheck = await client
      .from("frames")
      .select("frame_number", { count: "exact", head: true })
      .eq("match_id", match.id)
      .eq("is_walkover_award", true);
    if ((walkoverCheck.count ?? 0) > 0) return;

    const team1Ids =
      matchRead.data.match_mode === "doubles"
        ? [matchRead.data.team1_player1_id, matchRead.data.team1_player2_id].filter(Boolean) as string[]
        : [matchRead.data.player1_id].filter(Boolean) as string[];
    const team2Ids =
      matchRead.data.match_mode === "doubles"
        ? [matchRead.data.team2_player1_id, matchRead.data.team2_player2_id].filter(Boolean) as string[]
        : [matchRead.data.player2_id].filter(Boolean) as string[];

    if (!team1Ids.length || !team2Ids.length) return;

    const uniqueIds = [...new Set([...team1Ids, ...team2Ids])];
    const playerRes = await client
      .from("players")
      .select("id,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker")
      .in("id", uniqueIds);
    if (playerRes.error || !playerRes.data) return;

    const playerMapById = new Map((playerRes.data as Player[]).map((p) => [p.id, p]));
    const team1Ratings = team1Ids.map((id) => playerMapById.get(id)?.[keys.rating] ?? 1000);
    const team2Ratings = team2Ids.map((id) => playerMapById.get(id)?.[keys.rating] ?? 1000);
    const team1Matches = team1Ids.map((id) => playerMapById.get(id)?.[keys.matches] ?? 0);
    const team2Matches = team2Ids.map((id) => playerMapById.get(id)?.[keys.matches] ?? 0);

    const team1AvgRating = team1Ratings.reduce((a, b) => a + b, 0) / team1Ratings.length;
    const team2AvgRating = team2Ratings.reduce((a, b) => a + b, 0) / team2Ratings.length;
    const team1AvgMatches = team1Matches.reduce((a, b) => a + b, 0) / team1Matches.length;
    const team2AvgMatches = team2Matches.reduce((a, b) => a + b, 0) / team2Matches.length;

    const expectedTeam1 = expectedScore(team1AvgRating, team2AvgRating);
    const actualTeam1 = winnerSide === 1 ? 1 : 0;
    const k = Math.max(kFactor(team1AvgRating, team1AvgMatches), kFactor(team2AvgRating, team2AvgMatches));
    const deltaTeam1 = Math.round(k * (actualTeam1 - expectedTeam1));
    const deltaTeam2 = -deltaTeam1;

    for (const pid of team1Ids) {
      const p = playerMapById.get(pid);
      if (!p) continue;
      const current = p[keys.rating] ?? 1000;
      const next = Math.max(100, current + deltaTeam1);
      const peak = Math.max(p[keys.peak] ?? 1000, next);
      const played = (p[keys.matches] ?? 0) + 1;
      await client.from("players").update({ [keys.rating]: next, [keys.peak]: peak, [keys.matches]: played }).eq("id", pid);
    }

    for (const pid of team2Ids) {
      const p = playerMapById.get(pid);
      if (!p) continue;
      const current = p[keys.rating] ?? 1000;
      const next = Math.max(100, current + deltaTeam2);
      const peak = Math.max(p[keys.peak] ?? 1000, next);
      const played = (p[keys.matches] ?? 0) + 1;
      await client.from("players").update({ [keys.rating]: next, [keys.peak]: peak, [keys.matches]: played }).eq("id", pid);
    }

    await client
      .from("matches")
      .update({ rating_applied_at: new Date().toISOString(), rating_delta_team1: deltaTeam1, rating_delta_team2: deltaTeam2 })
      .eq("id", match.id);

    await logAudit("rating_applied", {
      entityType: "match",
      entityId: match.id,
      summary: `Ratings updated (${competition.sport_type === "snooker" ? "snooker" : "pool"}): team1 ${deltaTeam1 >= 0 ? "+" : ""}${deltaTeam1}, team2 ${
        deltaTeam2 >= 0 ? "+" : ""
      }${deltaTeam2}.`,
      meta: { competitionId: match.competition_id, sport: competition.sport_type, deltaTeam1, deltaTeam2 },
    });
  };

  const saveProgress = async (goBack: boolean, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (isArchived) {
      if (!silent) setMessage("This match is archived. Restore it to edit.");
      return;
    }
    if (isByeMatch) {
      if (goBack && match) router.push(`/competitions/${match.competition_id}`);
      return;
    }
    const client = supabase;
    if (!client || !match || !teams) return;
    if (!silent) setSaving(true);
    if (!silent) setMessage(null);

    const rows = [];
    for (const f of frames) {
      const parsed1 = parseBreakValues(f.breaks_over_30_team1_values_text);
      const parsed2 = parseBreakValues(f.breaks_over_30_team2_values_text);
      if (!parsed1.ok) {
        if (!silent) {
          setSaving(false);
          setInfoModal({
            title: "Invalid Break Values",
            description: parsed1.error,
          });
        }
        return;
      }
      if (!parsed2.ok) {
        if (!silent) {
          setSaving(false);
          setInfoModal({
            title: "Invalid Break Values",
            description: parsed2.error,
          });
        }
        return;
      }
      const valid1 = validateBreaksAgainstPoints(teams.team1Label, f.team1_points, parsed1.values);
      if (!valid1.ok) {
        if (!silent) {
          setSaving(false);
          setInfoModal({ title: "Invalid Break Values", description: valid1.error });
        }
        return;
      }
      const valid2 = validateBreaksAgainstPoints(teams.team2Label, f.team2_points, parsed2.values);
      if (!valid2.ok) {
        if (!silent) {
          setSaving(false);
          setInfoModal({ title: "Invalid Break Values", description: valid2.error });
        }
        return;
      }
      rows.push({
      match_id: match.id,
      frame_number: f.frame_number,
      winner_player_id: f.winner_side === 1 ? teams.team1Rep : f.winner_side === 2 ? teams.team2Rep : null,
      break_and_run: isSnooker ? false : f.break_and_run,
      run_out_against_break: isSnooker ? false : f.run_out_against_break,
      is_walkover_award: false,
      team1_points: isSnooker ? f.team1_points : 0,
      team2_points: isSnooker ? f.team2_points : 0,
      breaks_over_30_team1_values: isSnooker ? parsed1.values : [],
      breaks_over_30_team2_values: isSnooker ? parsed2.values : [],
      breaks_over_30_team1: isSnooker ? parsed1.values.length : 0,
      breaks_over_30_team2: isSnooker ? parsed2.values.length : 0,
      high_break_team1: isSnooker && parsed1.values.length ? Math.max(...parsed1.values) : 0,
      high_break_team2: isSnooker && parsed2.values.length ? Math.max(...parsed2.values) : 0,
      });
    }

    const save = await persistFrames(rows);
    if (!save.ok) {
      if (!silent) {
        setSaving(false);
        setMessage(save.error);
      }
      return;
    }

    const update = await client.from("matches").update({ status: "in_progress", winner_player_id: null }).eq("id", match.id);
    if (update.error) {
      if (!silent) {
        setSaving(false);
        setMessage(update.error.message);
      }
      return;
    }

    await refreshCompetitionCompletion();
    await logAudit("match_progress_saved", {
      entityType: "match",
      entityId: match.id,
      summary: `Progress saved at ${wins.team1}-${wins.team2}.`,
      meta: { competitionId: match.competition_id },
    });
    if (!silent) setSaving(false);
    if (goBack) router.push(`/competitions/${match.competition_id}`);
    else if (!silent) setMessage("Progress saved.");
  };

  const saveResult = async () => {
    if (isArchived) {
      setMessage("This match is archived. Restore it to edit.");
      return;
    }
    if (isByeMatch) return;
    const client = supabase;
    if (!client || !match || !teams || !competition) return;
    const target = firstToWin(match.best_of);
    const winnerSide: 0 | 1 | 2 = wins.team1 >= target ? 1 : wins.team2 >= target ? 2 : 0;
    if (winnerSide === 0) {
      setMessage(`Best of ${match.best_of}: first to ${target} wins.`);
      return;
    }

    setSaving(true);
    setMessage(null);
    const rows = [];
    for (const f of frames) {
      const parsed1 = parseBreakValues(f.breaks_over_30_team1_values_text);
      const parsed2 = parseBreakValues(f.breaks_over_30_team2_values_text);
      if (!parsed1.ok) {
        setSaving(false);
        setInfoModal({
          title: "Invalid Break Values",
          description: parsed1.error,
        });
        return;
      }
      if (!parsed2.ok) {
        setSaving(false);
        setInfoModal({
          title: "Invalid Break Values",
          description: parsed2.error,
        });
        return;
      }
      const valid1 = validateBreaksAgainstPoints(teams.team1Label, f.team1_points, parsed1.values);
      if (!valid1.ok) {
        setSaving(false);
        setInfoModal({ title: "Invalid Break Values", description: valid1.error });
        return;
      }
      const valid2 = validateBreaksAgainstPoints(teams.team2Label, f.team2_points, parsed2.values);
      if (!valid2.ok) {
        setSaving(false);
        setInfoModal({ title: "Invalid Break Values", description: valid2.error });
        return;
      }
      rows.push({
      match_id: match.id,
      frame_number: f.frame_number,
      winner_player_id: f.winner_side === 1 ? teams.team1Rep : f.winner_side === 2 ? teams.team2Rep : null,
      break_and_run: isSnooker ? false : f.break_and_run,
      run_out_against_break: isSnooker ? false : f.run_out_against_break,
      is_walkover_award: false,
      team1_points: isSnooker ? f.team1_points : 0,
      team2_points: isSnooker ? f.team2_points : 0,
      breaks_over_30_team1_values: isSnooker ? parsed1.values : [],
      breaks_over_30_team2_values: isSnooker ? parsed2.values : [],
      breaks_over_30_team1: isSnooker ? parsed1.values.length : 0,
      breaks_over_30_team2: isSnooker ? parsed2.values.length : 0,
      high_break_team1: isSnooker && parsed1.values.length ? Math.max(...parsed1.values) : 0,
      high_break_team2: isSnooker && parsed2.values.length ? Math.max(...parsed2.values) : 0,
      });
    }
    const save = await persistFrames(rows);
    if (!save.ok) {
      setSaving(false);
      setMessage(save.error);
      return;
    }

    const winnerId = winnerSide === 1 ? teams.team1Rep : teams.team2Rep;
    const winnerName = winnerSide === 1 ? teams.team1Label : teams.team2Label;
    const update = await client.from("matches").update({ status: "complete", winner_player_id: winnerId }).eq("id", match.id);
    if (update.error) {
      setSaving(false);
      setMessage(update.error.message);
      return;
    }

    await applyRatingsIfNeeded(winnerSide);
    if (winnerId) await advanceKnockoutWinner(winnerId);
    const competitionDone = await refreshCompetitionCompletion();
    await logAudit("match_completed", {
      entityType: "match",
      entityId: match.id,
      summary: `Match completed. Winner: ${winnerName}.`,
      meta: { competitionId: match.competition_id, score: `${wins.team1}-${wins.team2}` },
    });
    setSaving(false);
    if (competitionDone) {
      const params = new URLSearchParams({
        complete: "1",
        event: competition.name,
        winner: winnerName,
      });
      router.push(`/?${params.toString()}`);
      return;
    }
    router.push(`/competitions/${match.competition_id}`);
  };

  const awardWalkover = async (winnerSide: 1 | 2) => {
    if (isArchived) {
      setMessage("This match is archived. Restore it to edit.");
      return;
    }
    if (isByeMatch) return;
    const client = supabase;
    if (!client || !match || !teams || !competition) return;
    const winnerName = winnerSide === 1 ? teams.team1Label : teams.team2Label;

    const winnerId = winnerSide === 1 ? teams.team1Rep : teams.team2Rep;
    if (!winnerId) {
      setMessage("Unable to resolve winner player.");
      return;
    }

    setSaving(true);
    setMessage(null);

    const save = await persistFrames([{
      match_id: match.id,
      frame_number: 1,
      winner_player_id: winnerId,
      break_and_run: false,
      run_out_against_break: false,
      is_walkover_award: true,
      team1_points: 0,
      team2_points: 0,
      breaks_over_30_team1_values: [],
      breaks_over_30_team2_values: [],
      breaks_over_30_team1: 0,
      breaks_over_30_team2: 0,
      high_break_team1: 0,
      high_break_team2: 0,
    }]);
    if (!save.ok) {
      setSaving(false);
      setMessage(save.error);
      return;
    }

    const update = await client.from("matches").update({ status: "complete", winner_player_id: winnerId }).eq("id", match.id);
    if (update.error) {
      setSaving(false);
      setMessage(update.error.message);
      return;
    }

    await advanceKnockoutWinner(winnerId);
    const competitionDone = await refreshCompetitionCompletion();
    await logAudit("match_walkover_awarded", {
      entityType: "match",
      entityId: match.id,
      summary: `Walkover awarded to ${winnerName}.`,
      meta: { competitionId: match.competition_id },
    });
    setSaving(false);
    if (competitionDone) {
      const params = new URLSearchParams({
        complete: "1",
        event: competition.name,
        winner: winnerSide === 1 ? teams.team1Label : teams.team2Label,
      });
      router.push(`/?${params.toString()}`);
      return;
    }
    router.push(`/competitions/${match.competition_id}`);
  };

  const voidFixtureAsSuperUser = async () => {
    const client = supabase;
    if (!client || !match || !admin.isSuper || !admin.userId) return;
    setSaving(true);
    setMessage(null);
    const wipeFrames = await client.from("frames").delete().eq("match_id", match.id);
    if (wipeFrames.error) {
      setSaving(false);
      setMessage(wipeFrames.error.message);
      return;
    }
    const rejectSubmissions = await client
      .from("result_submissions")
      .update({
        status: "rejected",
        reviewed_by_user_id: admin.userId,
        reviewed_at: new Date().toISOString(),
        note: "Fixture voided by Super User override.",
      })
      .eq("match_id", match.id)
      .neq("status", "rejected");
    if (rejectSubmissions.error) {
      setSaving(false);
      setMessage(rejectSubmissions.error.message);
      return;
    }
    const update = await client.from("matches").update({ status: "complete", winner_player_id: null }).eq("id", match.id);
    if (update.error) {
      setSaving(false);
      setMessage(update.error.message);
      return;
    }
    await logAudit("match_voided_by_super_user", {
      entityType: "match",
      entityId: match.id,
      summary: "Fixture voided by Super User override.",
      meta: { competitionId: match.competition_id },
    });
    setFrames([createEmptyFrame(1)]);
    setSubmissions((prev) =>
      prev.map((submission) =>
        submission.status === "rejected"
          ? submission
          : {
              ...submission,
              status: "rejected",
              reviewed_by_user_id: admin.userId,
              reviewed_at: new Date().toISOString(),
              note: "Fixture voided by Super User override.",
            }
      )
    );
    setMatch((prev) => (prev ? { ...prev, status: "complete", winner_player_id: null } : prev));
    setSaving(false);
    setInfoModal({ title: "Fixture Voided", description: "This fixture has been marked void. No points are awarded." });
  };

  const reopenFixtureAsSuperUser = async () => {
    const client = supabase;
    if (!client || !match || !admin.isSuper || !admin.userId) return;
    setSaving(true);
    setMessage(null);
    const wipeFrames = await client.from("frames").delete().eq("match_id", match.id);
    if (wipeFrames.error) {
      setSaving(false);
      setMessage(wipeFrames.error.message);
      return;
    }
    const rejectSubmissions = await client
      .from("result_submissions")
      .update({
        status: "rejected",
        reviewed_by_user_id: admin.userId,
        reviewed_at: new Date().toISOString(),
        note: "Fixture reopened by Super User override.",
      })
      .eq("match_id", match.id)
      .neq("status", "rejected");
    if (rejectSubmissions.error) {
      setSaving(false);
      setMessage(rejectSubmissions.error.message);
      return;
    }
    const update = await client.from("matches").update({ status: "pending", winner_player_id: null }).eq("id", match.id);
    if (update.error) {
      setSaving(false);
      setMessage(update.error.message);
      return;
    }
    await logAudit("match_reopened_by_super_user", {
      entityType: "match",
      entityId: match.id,
      summary: "Fixture reopened by Super User override.",
      meta: { competitionId: match.competition_id },
    });
    setFrames([createEmptyFrame(1)]);
    setSubmissions((prev) =>
      prev.map((submission) =>
        submission.status === "rejected"
          ? submission
          : {
              ...submission,
              status: "rejected",
              reviewed_by_user_id: admin.userId,
              reviewed_at: new Date().toISOString(),
              note: "Fixture reopened by Super User override.",
            }
      )
    );
    setMatch((prev) => (prev ? { ...prev, status: "pending", winner_player_id: null } : prev));
    setConfirmEditComplete(true);
    setSaving(false);
    setInfoModal({ title: "Fixture Reopened", description: "This fixture has been reopened for correction." });
  };

  const archiveMatch = async () => {
    const client = supabase;
    if (!client || !match) return;
    const res = await client.from("matches").update({ is_archived: true }).eq("id", match.id);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    await logAudit("match_archived", {
      entityType: "match",
      entityId: match.id,
      summary: "Match archived.",
      meta: { competitionId: match.competition_id },
    });
    setMatch({ ...match, is_archived: true });
  };

  const restoreMatch = async () => {
    const client = supabase;
    if (!client || !match) return;
    const res = await client.from("matches").update({ is_archived: false }).eq("id", match.id);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    await logAudit("match_restored", {
      entityType: "match",
      entityId: match.id,
      summary: "Match restored.",
      meta: { competitionId: match.competition_id },
    });
    setMatch({ ...match, is_archived: false });
  };

  const deleteMatch = async () => {
    const client = supabase;
    if (!client || !match) return;
    const clearSubmissions = await client.from("result_submissions").delete().eq("match_id", match.id);
    if (clearSubmissions.error) {
      setMessage(clearSubmissions.error.message);
      return;
    }
    const wipe = await client.from("frames").delete().eq("match_id", match.id);
    if (wipe.error) {
      setMessage(wipe.error.message);
      return;
    }
    const del = await client.from("matches").delete().eq("id", match.id).select("id").maybeSingle();
    if (del.error) {
      setMessage(del.error.message);
      return;
    }
    if (!del.data?.id) {
      setMessage("Match was not deleted. Check role permissions for this account.");
      return;
    }
    await logAudit("match_deleted", {
      entityType: "match",
      entityId: match.id,
      summary: "Match deleted permanently.",
      meta: { competitionId: match.competition_id },
    });
    router.push(`/competitions/${match.competition_id}`);
  };

  const submitDetailedResult = async () => {
    const showSubmitModal = (description: string, title = "Submit Result") => setInfoModal({ title, description });
    if (admin.isAdmin) return;
    if (!match || !teams) return;
    if (!viewerCanEditThisMatch) {
      showSubmitModal("You can only submit the full result for your own fixture. Other fixtures are view only.");
      return;
    }
    if (!playerLeagueWindowOpen) {
      showSubmitModal(
        leagueFixtureWindow
          ? `This weekly fixture is only live from ${leagueFixtureWindow.opensAt.toLocaleString()} until ${leagueFixtureWindow.dueAt.toLocaleString()}.`
          : "This fixture is not currently open for result entry."
      );
      return;
    }
    if (match.status === "complete") {
      showSubmitModal("This match is already complete and locked.");
      return;
    }
    if (userPendingSubmission) {
      showSubmitModal("You already have a pending submission for this match. This match is locked until an administrator reviews it.");
      return;
    }
    if (hasPendingSubmission) {
      showSubmitModal("A result for this fixture is already pending review. This match is locked until an administrator reviews it.");
      return;
    }
    if (userApprovedSubmission) {
      showSubmitModal("Your submitted result has already been approved. This match is locked.");
      return;
    }
    if (!canSaveResult) {
      showSubmitModal(`Best of ${match.best_of}: first to ${firstToWin(match.best_of)} wins.`);
      return;
    }
    const built = buildFullResultRows();
    if (!built.ok) {
      showSubmitModal(built.error, "Invalid Result");
      return;
    }
    const client = supabase;
    if (!client || !admin.userId) {
      showSubmitModal("You must be signed in.");
      return;
    }
    const save = await persistFrames(built.rows);
    if (!save.ok) {
      showSubmitModal(save.error);
      return;
    }
    const update = await client.from("matches").update({ status: "in_progress", winner_player_id: null }).eq("id", match.id);
    if (update.error) {
      showSubmitModal(update.error.message || "Unable to save the submitted result.");
      return;
    }
    const res = await client
      .from("result_submissions")
      .insert({
        match_id: match.id,
        submitted_by_user_id: admin.userId,
        team1_score: built.summary.team1Score,
        team2_score: built.summary.team2Score,
        break_and_run: built.summary.breakRunTeam1 + built.summary.breakRunTeam2 > 0,
        run_out_against_break: built.summary.runOutTeam1 + built.summary.runOutTeam2 > 0,
        break_and_run_team1: built.summary.breakRunTeam1,
        break_and_run_team2: built.summary.breakRunTeam2,
        run_out_against_break_team1: built.summary.runOutTeam1,
        run_out_against_break_team2: built.summary.runOutTeam2,
        status: "pending",
      })
      .select("*")
      .single();
    if (res.error || !res.data) {
      showSubmitModal(res.error?.message ?? "Failed to submit result.");
      return;
    }
    setSubmissions((prev) => [res.data as ResultSubmission, ...prev]);
    await logAudit("result_submitted_for_approval", {
      entityType: "match",
      entityId: match.id,
      summary: `Full result submitted ${teams.team1Label} ${built.summary.team1Score}-${built.summary.team2Score} ${teams.team2Label}.`,
      meta: { competitionId: match.competition_id },
    });
    setRedirectAfterInfo(true);
    showSubmitModal("Full result submitted for approval.", "Submitted");
  };

  const applySubmission = async (submission: ResultSubmission) => {
    const showReviewModal = (description: string, title = "Review Submission") => setInfoModal({ title, description });
    if (!match || !teams || !competition) return;
    if (admin.isAdmin && !admin.isSuper && !canAdminReviewThisMatch) {
      showReviewModal("You can only approve submissions for your location.");
      return;
    }
    if (admin.isAdmin && !admin.isSuper && isSubmissionEscalated(submission.submitted_at)) {
      showReviewModal("This submission is older than 72 hours and has been escalated to the Super User.");
      return;
    }
    const client = supabase;
    if (!client || !admin.userId || !match) return;
    const winnerSide: 1 | 2 = submission.team1_score > submission.team2_score ? 1 : 2;
    const winnerId = winnerSide === 1 ? teams.team1Rep : teams.team2Rep;
    if (!winnerId) {
      showReviewModal("Unable to resolve winner.");
      return;
    }
    const existingFrameRows = await client
      .from("frames")
      .select("frame_number,winner_player_id,is_walkover_award")
      .eq("match_id", match.id)
      .order("frame_number", { ascending: true });
    if (existingFrameRows.error) {
      showReviewModal(existingFrameRows.error.message || "Unable to read submitted frame detail.");
      return;
    }
    const existingFrames = (existingFrameRows.data ?? []).filter((r) => !r.is_walkover_award);
    let rows: Array<{
      match_id: string;
      frame_number: number;
      winner_player_id: string | null;
      break_and_run: boolean;
      run_out_against_break: boolean;
      is_walkover_award: boolean;
      team1_points: number;
      team2_points: number;
      breaks_over_30_team1_values: number[];
      breaks_over_30_team2_values: number[];
      breaks_over_30_team1: number;
      breaks_over_30_team2: number;
      high_break_team1: number;
      high_break_team2: number;
    }> = [];
    if (!existingFrames.length) {
      let idx = 1;
      const br1 = Math.min(submission.break_and_run_team1 ?? 0, submission.team1_score);
      const br2 = Math.min(submission.break_and_run_team2 ?? 0, submission.team2_score);
      const ro1 = Math.min(submission.run_out_against_break_team1 ?? 0, submission.team1_score);
      const ro2 = Math.min(submission.run_out_against_break_team2 ?? 0, submission.team2_score);
      for (let i = 0; i < submission.team1_score; i += 1) {
        rows.push({
          match_id: match.id,
          frame_number: idx++,
          winner_player_id: teams.team1Rep,
          break_and_run: isSnooker ? false : i < br1,
          run_out_against_break: isSnooker ? false : i < ro1,
          is_walkover_award: false,
          team1_points: 0,
          team2_points: 0,
          breaks_over_30_team1_values: [],
          breaks_over_30_team2_values: [],
          breaks_over_30_team1: 0,
          breaks_over_30_team2: 0,
          high_break_team1: 0,
          high_break_team2: 0,
        });
      }
      for (let i = 0; i < submission.team2_score; i += 1) {
        rows.push({
          match_id: match.id,
          frame_number: idx++,
          winner_player_id: teams.team2Rep,
          break_and_run: isSnooker ? false : i < br2,
          run_out_against_break: isSnooker ? false : i < ro2,
          is_walkover_award: false,
          team1_points: 0,
          team2_points: 0,
          breaks_over_30_team1_values: [],
          breaks_over_30_team2_values: [],
          breaks_over_30_team1: 0,
          breaks_over_30_team2: 0,
          high_break_team1: 0,
          high_break_team2: 0,
        });
      }
      const save = await persistFrames(rows);
      if (!save.ok) {
        showReviewModal(save.error);
        return;
      }
    } else {
      rows = existingFrames.map((r) => ({
        match_id: match.id,
        frame_number: r.frame_number,
        winner_player_id: r.winner_player_id,
        break_and_run: false,
        run_out_against_break: false,
        is_walkover_award: false,
        team1_points: 0,
        team2_points: 0,
        breaks_over_30_team1_values: [],
        breaks_over_30_team2_values: [],
        breaks_over_30_team1: 0,
        breaks_over_30_team2: 0,
        high_break_team1: 0,
        high_break_team2: 0,
      }));
    }
    const update = await client
      .from("matches")
      .update({ status: "complete", winner_player_id: winnerId })
      .eq("id", match.id);
    if (update.error) {
      showReviewModal(update.error.message || "Unable to update match status. This submission was not applied.");
      return;
    }
    const verifyMatch = await client
      .from("matches")
      .select("id,status,winner_player_id")
      .eq("id", match.id)
      .maybeSingle();
    if (verifyMatch.error || !verifyMatch.data || verifyMatch.data.status !== "complete") {
      showReviewModal("Submission could not be finalized on the match record. Please try again.");
      return;
    }
    const approvedSubmission = await client
      .from("result_submissions")
      .update({
        status: "approved",
        reviewed_by_user_id: admin.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", submission.id);
    if (approvedSubmission.error) {
      showReviewModal(approvedSubmission.error.message || "Unable to mark submission approved.");
      return;
    }
    const verifySubmission = await client
      .from("result_submissions")
      .select("id,status")
      .eq("id", submission.id)
      .maybeSingle();
    if (verifySubmission.error || !verifySubmission.data || verifySubmission.data.status !== "approved") {
      showReviewModal("Submission approval could not be verified. Please refresh and try again.");
      return;
    }
    await applyRatingsIfNeeded(winnerSide);
    if (winnerId) await advanceKnockoutWinner(winnerId);
    await refreshCompetitionCompletion();
    if (!existingFrames.length) {
      setFrames(
        rows.map((r) => ({
          frame_number: r.frame_number,
          winner_side: r.winner_player_id === teams.team1Rep ? 1 : r.winner_player_id === teams.team2Rep ? 2 : 0,
          break_and_run: r.break_and_run,
          run_out_against_break: r.run_out_against_break,
          team1_points: r.team1_points,
          team2_points: r.team2_points,
          breaks_over_30_team1_values_text: (r.breaks_over_30_team1_values ?? []).join(", "),
          breaks_over_30_team2_values_text: (r.breaks_over_30_team2_values ?? []).join(", "),
        }))
      );
    }
    setMatch((prev) => (prev ? { ...prev, status: "complete", winner_player_id: winnerId } : prev));
    setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, status: "approved" } : s)));
    await logAudit("result_approved", {
      entityType: "result_submission",
      entityId: submission.id,
      summary: `Submission approved for match ${match.id}.`,
      meta: { matchId: match.id, competitionId: match.competition_id },
    });
    router.push("/results");
  };

  const rejectSubmission = async (submission: ResultSubmission, reason: string, comment: string) => {
    const showReviewModal = (description: string, title = "Review Submission") => setInfoModal({ title, description });
    const client = supabase;
    if (!client || !admin.userId || !match) return;
    if (admin.isAdmin && !admin.isSuper && !canAdminReviewThisMatch) {
      showReviewModal("You can only reject submissions for your location.");
      return;
    }
    if (admin.isAdmin && !admin.isSuper && isSubmissionEscalated(submission.submitted_at)) {
      showReviewModal("This submission is older than 72 hours and has been escalated to the Super User.");
      return;
    }
    const note = comment.trim() ? `${reason}: ${comment.trim()}` : reason;
    const rejected = await client
      .from("result_submissions")
      .update({
        status: "rejected",
        reviewed_by_user_id: admin.userId,
        reviewed_at: new Date().toISOString(),
        note,
      })
      .eq("id", submission.id);
    if (rejected.error) {
      showReviewModal(rejected.error.message || "Unable to reject submission.");
      return;
    }
    setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, status: "rejected" } : s)));
    await logAudit("result_rejected", {
      entityType: "result_submission",
      entityId: submission.id,
      summary: `Submission rejected for match ${match.id}.`,
      meta: { matchId: match.id, competitionId: match.competition_id },
    });
    router.push("/results");
  };

  const isSubmissionEscalated = (submittedAt: string) => reviewNowMs - Date.parse(submittedAt) > 72 * 60 * 60 * 1000;
  const canAdminReviewThisMatch = admin.isSuper || !competition?.location_id || (adminLocationId && competition.location_id === adminLocationId);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Match"
            eyebrow="Match"
            subtitle="Live scoring and result submission."
            warnOnNavigate={!isByeMatch && !isArchived && canEditFrames}
            warnMessage="Progress may be lost if not saved. Leave this match anyway?"
            actions={
              <button
                type="button"
                onClick={openDisplay}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
              >
                Open Display
              </button>
            }
          />

          {loading ? <p className="rounded-xl border border-slate-200 bg-white p-4">Loading match...</p> : null}
          <MessageModal message={message} onClose={() => setMessage(null)} />

          {match && competition && teams ? (
            <>
              <div className={`${cardClass} flex flex-wrap items-center gap-2`}>
                <button
                  type="button"
                  onClick={openDisplay}
                  className={buttonSecondaryClass}
                >
                  Open Display (TV Mode)
                </button>
                {canAdminManageMatch ? (
                  <>
                    {isArchived ? (
                      <button
                        type="button"
                        onClick={restoreMatch}
                        disabled={adminReviewOnly}
                        className={buttonSuccessClass}
                      >
                        Restore Match
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmModal({
                            title: "Archive Match",
                            description: "Archive this match? It will be hidden from fixtures and live views, but all stats are retained.",
                            confirmLabel: "Archive",
                            onConfirm: async () => {
                              await archiveMatch();
                              setConfirmModal(null);
                            },
                          })
                        }
                        disabled={adminReviewOnly}
                        className={buttonSecondaryClass}
                      >
                        Archive Match
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          title: "Delete Match Permanently",
                          description: "This will delete all frames and permanently remove stats tied to this match. Continue?",
                          confirmLabel: "Delete Match",
                          tone: "danger",
                          onConfirm: async () => {
                            await deleteMatch();
                            setConfirmModal(null);
                          },
                        })
                      }
                      disabled={adminReviewOnly}
                      className={buttonDangerClass}
                    >
                      Delete Match
                    </button>
                  </>
                ) : null}
              </div>
              {isArchived ? (
                <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
                  This match is archived. Stats are retained, but the match is hidden from fixtures and live views.
                </section>
              ) : null}
              {match.status === "complete" && !confirmEditComplete ? (
                <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
                  <p className="text-amber-900">
                    This match is already complete. Are you sure you want to edit it?
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/competitions/${match.competition_id}`)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmEditComplete(true)}
                      className="rounded-xl bg-amber-700 px-3 py-2 text-sm font-medium text-white"
                    >
                      Yes, edit match
                    </button>
                  </div>
                </section>
              ) : null}

              {match.status !== "complete" || confirmEditComplete ? (
                <>
              <section className={cardClass}>
                <p className="text-sm text-slate-600">Round {match.round_no ?? 1} · Match {match.match_no ?? 1}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-3xl font-semibold text-slate-900">
                  <div className="flex items-center gap-2">
                    {teams.team1Rep && avatarMap.get(teams.team1Rep) ? (
                      <Image src={avatarMap.get(teams.team1Rep) ?? ""} alt={teams.team1Label} width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
                    ) : null}
                    <span>{teams.team1Label}</span>
                  </div>
                  <span>vs</span>
                  <div className="flex items-center gap-2">
                    {teams.team2Rep && avatarMap.get(teams.team2Rep) ? (
                      <Image src={avatarMap.get(teams.team2Rep) ?? ""} alt={teams.team2Label} width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
                    ) : null}
                    <span>{teams.team2Label}</span>
                  </div>
                </div>
                <p className="mt-1 text-slate-700">Best of {match.best_of} {competition.sport_type === "snooker" ? "frames" : "racks"}</p>
                <p className="mt-1 text-slate-700">Status: {getMatchStatusLabel(match)}</p>
                {isHandicappedSnookerMatch ? (
                  <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                    Handicapped fixture. Each frame starts at {teams.team1Label} {match.team1_handicap_start ?? 0} - {match.team2_handicap_start ?? 0} {teams.team2Label}. Enter the final adjusted frame scores including that handicap start, not the raw points scored from scratch.
                  </div>
                ) : null}
                {competition.app_assign_opening_break || openingBreakerName ? (
                  <p className="mt-1 text-slate-700">
                    Opening breaker: {openingBreakerName ? `${openingBreakerName} *` : "App assigned"}
                  </p>
                ) : (
                  <div className={`mt-2 ${subtleCardClass}`}>
                    <p className="text-sm font-medium text-slate-700">Select opening breaker</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={assigningBreaker || adminReviewOnly}
                        onClick={() => teams?.team1Rep && assignOpeningBreaker(teams.team1Rep)}
                        className={buttonSecondaryClass}
                      >
                        {teams?.team1Label ?? "Team 1"}
                      </button>
                      <button
                        type="button"
                        disabled={assigningBreaker || adminReviewOnly}
                        onClick={() => teams?.team2Rep && assignOpeningBreaker(teams.team2Rep)}
                        className={buttonSecondaryClass}
                      >
                        {teams?.team2Label ?? "Team 2"}
                      </button>
                    </div>
                  </div>
                )}
                {isByeMatch ? (
                  <p className="mt-2 text-sm text-slate-700">This match is a BYE. The Winner auto-advanced.</p>
                ) : (
                  canAdminManageMatch ? (
                    adminReviewOnly && pendingSubmissionForReview ? (
                      <p className="mt-1 text-slate-700">
                        Submitted score (awaiting review): {pendingSubmissionForReview.team1_score} - {pendingSubmissionForReview.team2_score}
                      </p>
                    ) : (
                      <p className="mt-1 text-slate-700">Current score: {wins.team1} - {wins.team2}</p>
                    )
                  ) : null
                )}
                {adminReviewOnly ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Review mode: this match has a pending submission. Approve or reject below. Match scoring is locked.
                  </p>
                ) : null}
                {isVoidedMatch ? (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                    This fixture is void. No points are awarded unless the Super User reopens or overrides it.
                  </p>
                ) : null}
              </section>

              {canEditFrames ? (
                <>
                  {matchWinnerLabel ? (
                    <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                      Winner: <strong>{matchWinnerLabel}</strong>. Save and complete the match.
                    </p>
                  ) : null}
                  <section className="space-y-3">
                    {frames.map((frame, idx) => (
                      <article key={frame.frame_number} className={cardClass}>
                        <p className="text-xl font-semibold text-slate-900">{competition.sport_type === "snooker" ? "Frame" : "Rack"} {frame.frame_number}</p>
                        {isSnooker ? (
                          <>
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                              <label className="text-sm text-slate-700">
                                {teams.team1Label} points
                                <input
                                  type="number"
                                  min={0}
                                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                                  value={frame.team1_points}
                                  onChange={(e) => setSnookerNumberField(idx, "team1_points", e.target.value)}
                                />
                              </label>
                              <label className="text-sm text-slate-700">
                                {teams.team2Label} points
                                <input
                                  type="number"
                                  min={0}
                                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                                  value={frame.team2_points}
                                  onChange={(e) => setSnookerNumberField(idx, "team2_points", e.target.value)}
                                />
                              </label>
                              <label className="text-sm text-slate-700">
                                {teams.team1Label} breaks over 30 values
                                <input
                                  type="text"
                                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                                  placeholder="e.g. 34, 57, 102"
                                  value={frame.breaks_over_30_team1_values_text}
                                  onChange={(e) => setSnookerBreakValuesField(idx, "breaks_over_30_team1_values_text", e.target.value)}
                                />
                              </label>
                              <label className="text-sm text-slate-700">
                                {teams.team2Label} breaks over 30 values
                                <input
                                  type="text"
                                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                                  placeholder="e.g. 41, 68"
                                  value={frame.breaks_over_30_team2_values_text}
                                  onChange={(e) => setSnookerBreakValuesField(idx, "breaks_over_30_team2_values_text", e.target.value)}
                                />
                              </label>
                            </div>
                            <p className="mt-2 text-xs text-slate-600">
                              Enter each break over 30 as comma-separated values. The highest break cannot exceed that player&apos;s frame points.
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                              <button type="button" onClick={() => endSnookerFrame(idx)} className={buttonSecondaryClass}>
                                End frame
                              </button>
                              {frame.winner_side !== 0 ? (
                                <span className="text-sm text-slate-600">
                                  Winner: {frame.winner_side === 1 ? teams.team1Label : teams.team2Label}
                                </span>
                              ) : (
                                <span className="text-sm text-slate-600">Enter points and end the frame.</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <label className="flex items-center gap-2">
                                <input type="checkbox" checked={frame.winner_side === 1} onChange={(e) => setWinner(idx, e.target.checked ? 1 : 0)} />
                                <span>{teams.team1Label}</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" checked={frame.winner_side === 2} onChange={(e) => setWinner(idx, e.target.checked ? 2 : 0)} />
                                <span>{teams.team2Label}</span>
                              </label>
                            </div>

                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={frame.break_and_run}
                                  disabled={frame.run_out_against_break}
                                  onChange={(e) => setFlag(idx, "break_and_run", e.target.checked)}
                                />
                                <span>Break &amp; Run</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={frame.run_out_against_break}
                                  disabled={frame.break_and_run}
                                  onChange={(e) => setFlag(idx, "run_out_against_break", e.target.checked)}
                                />
                                <span>Run Out (Against Break)</span>
                              </label>
                            </div>
                            {!premium.loading && !premium.unlocked ? (
                              <p className="mt-2 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
                                Premium: Break &amp; Run / Run Out tracking
                              </p>
                            ) : null}
                          </>
                        )}
                      </article>
                    ))}
                  </section>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={addFrame} className={buttonSecondaryClass}>
                      Add {competition.sport_type === "snooker" ? "frame" : "rack"}
                    </button>
                    {admin.isAdmin ? (
                      <>
                        <button type="button" onClick={() => saveProgress(false)} disabled={saving} className={buttonSecondaryClass}>
                          Save
                        </button>
                        <button type="button" onClick={() => saveProgress(true)} disabled={saving} className={buttonSecondaryClass}>
                          Save &amp; Back
                        </button>
                        <button type="button" onClick={saveResult} disabled={saving || !canSaveResult} className={buttonSuccessClass}>
                          {saving ? "Saving..." : "Save result"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Award Walkover",
                              description: `Award walkover to ${teams.team1Label}?`,
                              confirmLabel: "Award",
                              onConfirm: async () => {
                                await awardWalkover(1);
                                setConfirmModal(null);
                              },
                            })
                          }
                          disabled={saving}
                          className={buttonSecondaryClass}
                        >
                          Award walkover ({teams.team1Label})
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Award Walkover",
                              description: `Award walkover to ${teams.team2Label}?`,
                              confirmLabel: "Award",
                              onConfirm: async () => {
                                await awardWalkover(2);
                                setConfirmModal(null);
                              },
                            })
                          }
                          disabled={saving}
                          className={buttonSecondaryClass}
                        >
                          Award walkover ({teams.team2Label})
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmModal({
                            title: "Submit Full Result For Approval",
                            description: `Submit the full ${competition.sport_type === "snooker" ? "frame" : "rack"} result for ${teams.team1Label} vs ${teams.team2Label}? This will lock the fixture until an administrator reviews it.`,
                            confirmLabel: "Submit result",
                            onConfirm: async () => {
                              setConfirmModal(null);
                              await submitDetailedResult();
                            },
                          })
                        }
                        disabled={saving || !canSaveResult}
                        className={buttonSuccessClass}
                      >
                        Submit full result for approval
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          title: "Clear Entries",
                          description: "Clear all current rack/frame entries?",
                          confirmLabel: "Clear",
                          tone: "danger",
                          onConfirm: () => {
                            clearFrames();
                            setConfirmModal(null);
                          },
                        })
                      }
                      disabled={saving}
                      className={buttonSecondaryClass}
                    >
                      Clear
                    </button>
                  </div>

                  {admin.isSuper ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Super User override</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Override an incorrect approval, reopen a voided fixture, or mark a fixture void in error cases.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: isVoidedMatch ? "Reopen Voided Fixture" : "Reopen Fixture",
                              description: "This will clear stored frames, reject any existing submissions, and reopen the fixture for correction.",
                              confirmLabel: "Reopen fixture",
                              onConfirm: async () => {
                                setConfirmModal(null);
                                await reopenFixtureAsSuperUser();
                              },
                            })
                          }
                          disabled={saving}
                          className={buttonSecondaryClass}
                        >
                          Reopen fixture
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Void Fixture",
                              description: "This will void the fixture, clear frames, and reject any submissions. No points will be awarded.",
                              confirmLabel: "Void fixture",
                              tone: "danger",
                              onConfirm: async () => {
                                setConfirmModal(null);
                                await voidFixtureAsSuperUser();
                              },
                            })
                          }
                          disabled={saving}
                          className={buttonDangerClass}
                        >
                          Void fixture
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {!canSaveResult ? (
                    <p className="text-sm text-slate-600">
                      Best of {match.best_of}: first to {firstToWin(match.best_of)} wins.
                    </p>
                  ) : null}
                </>
              ) : null}
              {!admin.loading && !canAdminManageMatch && !isByeMatch && !isArchived ? (
                <section className={`${cardClass} space-y-3`}>
                  <h3 className="text-xl font-semibold text-slate-900">Fixture access</h3>
                  {!viewerCanEditThisMatch ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                      View only. You can only submit the full result for your own fixture.
                    </div>
                  ) : !playerLeagueWindowOpen ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                      This fixture is locked outside its live window.
                      {leagueFixtureWindow
                        ? ` It opens ${leagueFixtureWindow.opensAt.toLocaleString()} and closes ${leagueFixtureWindow.dueAt.toLocaleString()}.`
                        : ""}
                    </div>
                  ) : !userPendingSubmission && !userApprovedSubmission ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Pending. Enter the full {competition.sport_type === "snooker" ? "frame" : "rack"} result above, then submit it for approval.
                      {isHandicappedSnookerMatch ? " Use the final adjusted score including the handicap start shown on this fixture." : ""}
                    </div>
                  ) : null}
                  {userPendingSubmission ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Submitted. Pending review since {new Date(userPendingSubmission.submitted_at).toLocaleString()}. Match is locked until reviewed.
                    </div>
                  ) : null}
                  {isVoidedMatch ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                      Void. This fixture was not completed in time or was voided by an administrator. No points are awarded.
                    </div>
                  ) : null}
                  {!isVoidedMatch && userApprovedSubmission ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      Approved. Submission approved on {userApprovedSubmission.reviewed_at ? new Date(userApprovedSubmission.reviewed_at).toLocaleString() : "review"}. Match is locked.
                    </div>
                  ) : null}
                  {!userSubmissionLocked && userLatestRejectedSubmission ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                      Previous submission was rejected.
                      {userLatestRejectedSubmission.note ? ` Reason: ${userLatestRejectedSubmission.note}` : ""}
                      {" "}Please correct and resubmit.
                    </div>
                  ) : null}
                </section>
              ) : null}
              {!admin.loading &&
              !admin.isSuper &&
              viewerCanEditThisMatch &&
              competition?.competition_format === "league" &&
              match?.scheduled_for &&
              !isByeMatch &&
              !isArchived ? (
                <section className={`${cardClass} space-y-3`}>
                  <h3 className="text-xl font-semibold text-slate-900">Reschedule</h3>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">Need one extra week?</p>
                    <p className="mt-1">
                      One reschedule request can be submitted per player at a time. If approved by the Super User, this fixture will move to the following week only.
                    </p>
                    {pendingRescheduleForMatch ? (
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                        Reschedule requested for {new Date(`${pendingRescheduleForMatch.requested_scheduled_for}T12:00:00`).toLocaleDateString("en-GB", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}. Waiting for Super User review.
                      </p>
                    ) : null}
                    {!pendingRescheduleForMatch && latestRescheduleForMatch?.status === "approved" ? (
                      <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                        Reschedule approved. This fixture now plays by {leagueFixtureWindow?.dueAt.toLocaleString("en-GB", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          hour: "numeric",
                          minute: "2-digit",
                        }) ?? "the updated weekly deadline"}.
                      </p>
                    ) : null}
                    {!pendingRescheduleForMatch && latestRescheduleForMatch?.status === "rejected" ? (
                      <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
                        Latest reschedule request was not approved.
                      </p>
                    ) : null}
                    {requesterPendingElsewhere ? (
                      <p className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">
                        You already have another outstanding reschedule request. That must be reviewed before you can request another.
                      </p>
                    ) : null}
                    {canRequestReschedule ? (
                      <button
                        type="button"
                        disabled={requestingReschedule}
                        onClick={() =>
                          setConfirmModal({
                            title: "Request one-week reschedule?",
                            description: `This will ask the Super User to move this fixture from ${new Date(`${match.scheduled_for}T12:00:00`).toLocaleDateString("en-GB", {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            })} to ${rescheduleTargetDate ? new Date(`${rescheduleTargetDate}T12:00:00`).toLocaleDateString("en-GB", {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            }) : "the following week"}. Only one outstanding reschedule request is allowed at a time.`,
                            confirmLabel: "Request reschedule",
                            onConfirm: async () => {
                              setConfirmModal(null);
                              await requestLeagueReschedule();
                            },
                          })
                        }
                        className={buttonSecondaryClass}
                      >
                        Request one-week reschedule
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {canAdminManageMatch && submissions.length ? (
                <section className={`${cardClass} space-y-3`}>
                  <h3 className="text-xl font-semibold text-slate-900">Result submissions</h3>
                  {admin.isAdmin && !admin.isSuper && !canAdminReviewThisMatch ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      This match is outside your location. Only the Super User can review these submissions.
                    </p>
                  ) : null}
                  {submissions.map((s) => (
                    <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm text-slate-700">
                        Score: {teams.team1Label} {s.team1_score} - {s.team2_score} {teams.team2Label}
                      </p>
                      {isSnooker && s.status === "pending" && frames.length ? (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-sm font-semibold text-slate-900">Submitted frame detail</p>
                          <div className="mt-2 space-y-2">
                            {frames.map((frame) => {
                              const winnerLabel =
                                frame.winner_side === 1
                                  ? teams.team1Label
                                  : frame.winner_side === 2
                                    ? teams.team2Label
                                    : "No winner set";
                              return (
                                <div key={frame.frame_number} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-medium text-slate-900">Frame {frame.frame_number}</p>
                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                                      {winnerLabel}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-slate-700">
                                    {teams.team1Label} {frame.team1_points} - {frame.team2_points} {teams.team2Label}
                                  </p>
                                  {(frame.breaks_over_30_team1_values_text || frame.breaks_over_30_team2_values_text) ? (
                                    <p className="mt-1 text-xs text-slate-500">
                                      Breaks over 30: {teams.team1Label} {frame.breaks_over_30_team1_values_text || "—"} · {teams.team2Label} {frame.breaks_over_30_team2_values_text || "—"}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {!isSnooker ? (
                        <>
                          <p className="text-xs text-slate-500">
                            Break &amp; Run: {teams.team1Label} {s.break_and_run_team1 ?? 0} · {teams.team2Label} {s.break_and_run_team2 ?? 0}
                          </p>
                          <p className="text-xs text-slate-500">
                            Run Out: {teams.team1Label} {s.run_out_against_break_team1 ?? 0} · {teams.team2Label} {s.run_out_against_break_team2 ?? 0}
                          </p>
                        </>
                      ) : null}
                      <p className="text-xs text-slate-500">Status: {s.status}</p>
                      {isSubmissionEscalated(s.submitted_at) ? (
                        <p className="text-xs font-medium text-amber-700">Escalated to Super User (72h)</p>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        {s.status === "pending" ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Approve Submitted Result",
                                  description: "Are you sure you want to approve this result?",
                                  confirmLabel: "Approve",
                                  onConfirm: async () => {
                                    await applySubmission(s);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setRejectModal({
                                  submission: s,
                                  reason: REJECTION_REASONS[0],
                                  comment: "",
                                })
                              }
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </RequireAuth>
        <ConfirmModal
          open={Boolean(confirmModal)}
          title={confirmModal?.title ?? ""}
          description={confirmModal?.description ?? ""}
          confirmLabel={confirmModal?.confirmLabel ?? "Confirm"}
          tone={confirmModal?.tone ?? "default"}
          onCancel={() => setConfirmModal(null)}
          onConfirm={() => confirmModal?.onConfirm()}
        />
        {rejectModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900">Reject submission</h2>
              <p className="mt-1 text-sm text-slate-600">
                Choose a reason and optional note. The user will see this and can correct/resubmit.
              </p>
              <div className="mt-4 space-y-3">
                <label className="block text-sm text-slate-700">
                  Reason
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    value={rejectModal.reason}
                    onChange={(e) => setRejectModal((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
                  >
                    {REJECTION_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-700">
                  Note (optional)
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    value={rejectModal.comment}
                    onChange={(e) => setRejectModal((prev) => (prev ? { ...prev, comment: e.target.value } : prev))}
                  />
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectModal(null)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const payload = rejectModal;
                    if (!payload) return;
                    setRejectModal(null);
                    await rejectSubmission(payload.submission, payload.reason, payload.comment);
                  }}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900"
                >
                  Reject submission
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <InfoModal
          open={Boolean(infoModal)}
          title={infoModal?.title ?? ""}
          description={infoModal?.description ?? ""}
          onClose={() => {
            setInfoModal(null);
            if (redirectAfterInfo) {
              setRedirectAfterInfo(false);
              router.push("/");
            }
          }}
        />
      </div>
    </main>
  );
}
