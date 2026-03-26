"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";
import useAdminStatus from "@/components/useAdminStatus";
import ConfirmModal from "@/components/ConfirmModal";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";
import { MAX_SNOOKER_START } from "@/lib/snooker-handicap";

type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  avatar_url?: string | null;
  is_archived?: boolean;
  location_id?: string | null;
  claimed_by?: string | null;
  age_band?: string | null;
  guardian_consent?: boolean | null;
  guardian_name?: string | null;
  guardian_email?: string | null;
  guardian_user_id?: string | null;
  rating_pool?: number | null;
  rating_snooker?: number | null;
  peak_rating_pool?: number | null;
  peak_rating_snooker?: number | null;
  rated_matches_pool?: number | null;
  rated_matches_snooker?: number | null;
  snooker_handicap?: number | null;
  snooker_handicap_base?: number | null;
};
type AppUser = { id: string; email: string | null; linked_player_id?: string | null; role?: string | null };
type Location = { id: string; name: string };
type MatchRow = {
  id: string;
  competition_id: string;
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  winner_player_id: string | null;
  status: "pending" | "in_progress" | "complete" | "bye";
  updated_at: string | null;
};
type Competition = {
  id: string;
  name?: string | null;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  competition_format: "knockout" | "league";
  is_archived?: boolean | null;
  is_completed?: boolean | null;
};
type RecentHistoryItem = {
  key: string;
  date: string | null;
  label: string;
  result: "W" | "L";
  sublabel: string;
};
type CompetitionEntry = {
  id: string;
  competition_id: string;
  player_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  created_at: string | null;
};
type Frame = { match_id: string; winner_player_id: string | null; is_walkover_award: boolean };
type LeagueFixtureLite = {
  id: string;
  fixture_date: string | null;
  week_no: number | null;
  home_team_id: string;
  away_team_id: string;
};
type LeagueTeamLite = { id: string; name: string };
type LeagueFrameLite = {
  fixture_id: string;
  slot_no: number;
  slot_type: "singles" | "doubles";
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  winner_side: "home" | "away" | null;
  home_forfeit: boolean;
  away_forfeit: boolean;
};

const LIVE_ACTIVITY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

function pct(w: number, p: number) {
  if (!p) return 0;
  return Math.round((w / p) * 100);
}

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionEntries, setCompetitionEntries] = useState<CompetitionEntry[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [leagueFixtures, setLeagueFixtures] = useState<LeagueFixtureLite[]>([]);
  const [leagueTeams, setLeagueTeams] = useState<LeagueTeamLite[]>([]);
  const [leagueFrames, setLeagueFrames] = useState<LeagueFrameLite[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [requestName, setRequestName] = useState("");
  const [requestLocationId, setRequestLocationId] = useState("");
  const [requestAgeBand, setRequestAgeBand] = useState<string>("18_plus");
  const [requestGuardianConsent, setRequestGuardianConsent] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ created_at: string } | null>(null);
  const [pendingAdminRequest, setPendingAdminRequest] = useState<{ id: string; created_at: string } | null>(null);
  const [adminRequesting, setAdminRequesting] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(false);
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editAgeBand, setEditAgeBand] = useState("18_plus");
  const [editLocationId, setEditLocationId] = useState("");
  const [editGuardianConsent, setEditGuardianConsent] = useState(false);
  const [editGuardianName, setEditGuardianName] = useState("");
  const [editGuardianEmail, setEditGuardianEmail] = useState("");
  const [editGuardianUserId, setEditGuardianUserId] = useState("");
  const [childFirstName, setChildFirstName] = useState("");
  const [childAgeBand, setChildAgeBand] = useState<"under_18">("under_18");
  const [childLocationId, setChildLocationId] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);
  const [showHandicap, setShowHandicap] = useState(true);
  const [showPerformance, setShowPerformance] = useState(true);
  const [showOpponents, setShowOpponents] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const [infoModal, setInfoModal] = useState<{ title: string; description: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    tone?: "default" | "danger";
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [deleteChoiceOpen, setDeleteChoiceOpen] = useState(false);
  const [deleteActionBusy, setDeleteActionBusy] = useState<"archive" | "delete" | null>(null);
  const [deleteDataChoiceOpen, setDeleteDataChoiceOpen] = useState(false);
  const [pendingDeleteRequest, setPendingDeleteRequest] = useState<{ id: string; created_at: string; delete_all_data?: boolean | null } | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const admin = useAdminStatus();
  const hasAdminPower = admin.isAdmin || admin.isSuper;
  const childProfilesEnabled = true;

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const run = async () => {
      try {
        const [authRes, pRes, allPlayersRes, mRes, cRes, ceRes, fRes, locRes, pendingRes, usersRes, pendingDeleteRes, lfRes, ltRes, lfrRes] = await Promise.all([
          client.auth.getUser(),
          client
            .from("players")
            .select(
              "id,display_name,full_name,avatar_url,is_archived,claimed_by,location_id,age_band,guardian_consent,guardian_name,guardian_email,guardian_user_id,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker"
              + ",snooker_handicap,snooker_handicap_base"
            )
            .eq("id", id)
            .maybeSingle(),
          client
            .from("players")
            .select(
              "id,display_name,full_name,avatar_url,claimed_by,location_id,age_band,guardian_consent,guardian_user_id,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker"
              + ",snooker_handicap,snooker_handicap_base"
            )
            .eq("is_archived", false),
          client.from("matches").select("id,competition_id,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,status,updated_at"),
          client.from("competitions").select("id,name,sport_type,competition_format,is_archived,is_completed"),
          client.from("competition_entries").select("id,competition_id,player_id,status,created_at").eq("player_id", id).order("created_at", { ascending: false }),
          client.from("frames").select("match_id,winner_player_id,is_walkover_award"),
          client.from("locations").select("id,name").order("name"),
          client.from("player_update_requests").select("id,created_at").eq("player_id", id).eq("status", "pending").order("created_at", { ascending: false }).limit(1),
          client.from("app_users").select("id,email,linked_player_id,role"),
          client
            .from("player_deletion_requests")
            .select("id,created_at,delete_all_data")
            .eq("player_id", id)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1),
          client.from("league_fixtures").select("id,fixture_date,week_no,home_team_id,away_team_id"),
          client.from("league_teams").select("id,name"),
          client
            .from("league_fixture_frames")
            .select("fixture_id,slot_no,slot_type,home_player1_id,home_player2_id,away_player1_id,away_player2_id,winner_side,home_forfeit,away_forfeit"),
        ]);
        if (!active) return;
        if (pRes.error || allPlayersRes.error) {
          const detail =
            pRes.error?.message ||
            allPlayersRes.error?.message ||
            "Unknown error";
          setMessage(`Failed to load player profile: ${detail}`);
          return;
        }
        setUserId(authRes.data.user?.id ?? null);
        const loadedPlayer = pRes.data
          ? ((pRes.data as unknown) as Player & { claimed_by?: string | null })
          : null;
        setPlayer(loadedPlayer);
        setRequestName(loadedPlayer?.full_name ?? "");
        setRequestLocationId(loadedPlayer?.location_id ?? "");
        setRequestAgeBand(loadedPlayer?.age_band ?? "18_plus");
        setRequestGuardianConsent(Boolean(loadedPlayer?.guardian_consent));
        setEditFullName(loadedPlayer?.full_name ?? loadedPlayer?.display_name ?? "");
        setEditAgeBand(loadedPlayer?.age_band ?? "18_plus");
        setEditLocationId(loadedPlayer?.location_id ?? "");
        setEditGuardianConsent(Boolean(loadedPlayer?.guardian_consent));
        setEditGuardianName(loadedPlayer?.guardian_name ?? "");
        setEditGuardianEmail(loadedPlayer?.guardian_email ?? "");
        setEditGuardianUserId(loadedPlayer?.guardian_user_id ?? "");
        if (loadedPlayer?.claimed_by) {
          const { data: linked } = await client
            .from("app_users")
            .select("email")
            .eq("id", loadedPlayer.claimed_by)
            .maybeSingle();
          setLinkedEmail(linked?.email ?? null);
        } else {
          setLinkedEmail(null);
        }
        setPlayers(((allPlayersRes.data ?? []) as unknown) as Player[]);
        if (!usersRes.error && usersRes.data) setAppUsers((usersRes.data as unknown) as AppUser[]);
        setMatches(((mRes.error ? [] : (mRes.data ?? [])) as unknown) as MatchRow[]);
        setCompetitions(((cRes.error ? [] : (cRes.data ?? [])) as unknown) as Competition[]);
        setCompetitionEntries(((ceRes.error ? [] : (ceRes.data ?? [])) as unknown) as CompetitionEntry[]);
        setFrames(((fRes.error ? [] : (fRes.data ?? [])) as unknown) as Frame[]);
        setLeagueFixtures(((lfRes.error ? [] : (lfRes.data ?? [])) as unknown) as LeagueFixtureLite[]);
        setLeagueTeams(((ltRes.error ? [] : (ltRes.data ?? [])) as unknown) as LeagueTeamLite[]);
        setLeagueFrames(((lfrRes.error ? [] : (lfrRes.data ?? [])) as unknown) as LeagueFrameLite[]);
        if (!locRes.error && locRes.data) {
          setLocations((locRes.data as unknown) as Location[]);
        }
        setPendingUpdate(pendingRes.data?.[0] ?? null);
        setPendingDeleteRequest(pendingDeleteRes.data?.[0] ?? null);
        if (authRes.data.user?.id) {
          const { data: pendingAdmin } = await client
            .from("admin_requests")
            .select("id,created_at,status")
            .eq("requester_user_id", authRes.data.user.id)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1);
          setPendingAdminRequest((pendingAdmin?.[0] as { id: string; created_at: string } | undefined) ?? null);
        } else {
          setPendingAdminRequest(null);
        }
      } catch (error) {
        if (!active) return;
        const detail = error instanceof Error ? error.message : "Load failed";
        setMessage(`Failed to load player profile: ${detail}`);
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("prompt") !== "photo") return;
    params.delete("prompt");
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", next);
    const timer = window.setTimeout(() => {
      setInfoModal({
        title: "Complete your profile",
        description: "You can now review your profile details and optionally upload a profile picture.",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const onEditFullName = async () => {
    const client = supabase;
    if (!client || !player) return;
    const proposed = window.prompt(`Enter first and second name for ${player.display_name}`, player.full_name ?? "");
    if (!proposed) return;
    const cleaned = proposed.trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (player.age_band && player.age_band !== "18_plus") {
      if (parts.length !== 1) {
        setMessage("Minors must use first name or nickname only.");
        return;
      }
    } else if (parts.length < 2) {
      setMessage("Name must include first and second name.");
      return;
    }
    setSavingName(true);
    const updatePayload =
      player.age_band && player.age_band !== "18_plus"
        ? { full_name: parts[0], display_name: parts[0] }
        : { full_name: cleaned };
    const { error } = await client.from("players").update(updatePayload).eq("id", player.id);
    setSavingName(false);
    if (error) {
      setMessage(`Failed to update full name: ${error.message}`);
      return;
    }
    setPlayer((prev) => (prev ? { ...prev, full_name: updatePayload.full_name ?? cleaned, display_name: updatePayload.display_name ?? prev.display_name } : prev));
    setMessage("Name updated.");
  };

  const onRequestUpdate = async () => {
    const client = supabase;
    if (!client || !player || !userId) return;
    const requestedName = requestName.trim();
    const requestedParts = requestedName.split(/\s+/).filter(Boolean);
    if (requestAgeBand !== "18_plus") {
      if (!requestGuardianConsent) {
        setMessage("Guardian consent is required for minors.");
        return;
      }
      if (requestedName && requestedParts.length !== 1) {
        setMessage("Minors must use first name or nickname only.");
        return;
      }
    } else if (requestedName && requestedParts.length < 2) {
      setMessage("Requested name must include first and second name.");
      return;
    }
    if (!requestLocationId) {
      setMessage("Location is required for all profiles.");
      return;
    }
    setRequesting(true);
    const { error } = await client.from("player_update_requests").insert({
      player_id: player.id,
      requester_user_id: userId,
      requested_full_name: requestedName || null,
      requested_location_id: requestLocationId || null,
      requested_age_band: requestAgeBand,
      requested_guardian_consent: requestAgeBand === "18_plus" ? null : requestGuardianConsent,
      requested_guardian_name: requestAgeBand === "18_plus" ? null : null,
      requested_guardian_email: requestAgeBand === "18_plus" ? null : null,
      requested_guardian_user_id: requestAgeBand === "18_plus" ? null : null,
      status: "pending",
    });
    setRequesting(false);
    if (error) {
      setMessage(`Failed to submit update request: ${error.message}`);
      return;
    }
    setMessage("Profile update request submitted for approval.");
  };

  const onUploadAvatar = async (file: File) => {
    const client = supabase;
    if (!client || !player) return;
    if (player.age_band && player.age_band !== "18_plus") {
      setMessage("Profile photos are disabled for minors.");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `avatars/${player.id}-${Date.now()}.${ext}`;
    const uploadRes = await client.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadRes.error) {
      setUploading(false);
      setMessage(`Avatar upload failed: ${uploadRes.error.message}`);
      return;
    }
    const publicUrl = client.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    if (!hasAdminPower) {
      const { error } = await client.from("player_update_requests").insert({
        player_id: player.id,
        requester_user_id: userId,
        requested_full_name: null,
        requested_location_id: null,
        requested_avatar_url: publicUrl,
        status: "pending",
      });
      setUploading(false);
      if (error) {
        setMessage(`Failed to submit avatar update: ${error.message}`);
        return;
      }
      setMessage(null);
      setInfoModal({
        title: "Profile photo submitted",
        description: "Your profile photo has been sent for administrator approval.",
      });
      return;
    }
    const { error } = await client.from("players").update({ avatar_url: publicUrl }).eq("id", player.id);
    setUploading(false);
    if (error) {
      setMessage(`Failed to save avatar: ${error.message}`);
      return;
    }
    setPlayer((prev) => (prev ? { ...prev, avatar_url: publicUrl } : prev));
    setMessage(null);
    setInfoModal({
      title: "Profile photo updated",
      description: "Your new profile photo has been saved.",
    });
    profileRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onRequestAdminAccess = async () => {
    const client = supabase;
    if (!client || !userId || !player) return;
    if (hasAdminPower) {
      setMessage("Administrator accounts do not need to request admin access.");
      return;
    }
    if (player.claimed_by !== userId) {
      setMessage("You can only request admin access from your own profile.");
      return;
    }
    if (!player.location_id) {
      setMessage("Set your location first, then submit admin request.");
      return;
    }
    if (pendingAdminRequest) {
      setMessage("Admin request is already pending Super User approval.");
      return;
    }
    const superEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
    if (!superEmail) {
      setMessage("Super user is not configured.");
      return;
    }
    const { data: superUser, error: superError } = await client
      .from("app_users")
      .select("id,email")
      .ilike("email", superEmail)
      .maybeSingle();
    if (superError || !superUser?.id) {
      setMessage("Unable to find super user account.");
      return;
    }
    setAdminRequesting(true);
    const { data: created, error } = await client
      .from("admin_requests")
      .insert({
        requester_user_id: userId,
        target_admin_user_id: superUser.id,
        location_id: player.location_id,
        status: "pending",
      })
      .select("id,created_at")
      .single();
    setAdminRequesting(false);
    if (error) {
      setMessage(`Failed to submit admin request: ${error.message}`);
      return;
    }
    setPendingAdminRequest((created as { id: string; created_at: string }) ?? { id: `pending-${Date.now()}`, created_at: new Date().toISOString() });
    setInfoModal({
      title: "Admin request submitted",
      description: "Your request has been sent for Super User approval.",
    });
    setMessage(null);
  };

  const onArchiveToggle = async () => {
    const client = supabase;
    if (!client || !player || !admin.isSuper) return;
    const nextArchived = !Boolean(player.is_archived);
    const { error } = await client.from("players").update({ is_archived: nextArchived }).eq("id", player.id);
    if (error) {
      setMessage(`Failed to update archive status: ${error.message}`);
      return;
    }
    setPlayer((prev) => (prev ? { ...prev, is_archived: nextArchived } : prev));
    setMessage(nextArchived ? "Player archived." : "Player restored.");
  };

  const onUnlinkAccount = async () => {
    const client = supabase;
    if (!client || !player || !hasAdminPower) return;
    const linkedUserId =
      player.claimed_by || appUsers.find((entry) => entry.linked_player_id === player.id)?.id || null;
    const playerUnlinkRes = await client.from("players").update({ claimed_by: null }).eq("id", player.id);
    if (playerUnlinkRes.error) {
      setMessage(`Failed to unlink account: ${playerUnlinkRes.error.message}`);
      return;
    }
    if (linkedUserId) {
      const userUnlinkRes = await client.from("app_users").update({ linked_player_id: null }).eq("id", linkedUserId);
      if (userUnlinkRes.error) {
        setMessage(`Failed to unlink account: ${userUnlinkRes.error.message}`);
        return;
      }
    }
    await logAudit("player_account_unlinked", {
      entityType: "player",
      entityId: player.id,
      summary: `${player.full_name?.trim() || player.display_name} account link removed.`,
    });
    setPlayer((prev) => (prev ? { ...prev, claimed_by: null } : prev));
    setAppUsers((prev) =>
      prev.map((entry) => (entry.id === linkedUserId || entry.linked_player_id === player.id ? { ...entry, linked_player_id: null } : entry))
    );
    setLinkedEmail(null);
    setMessage("Account link removed.");
  };

  const onSavePlayerEdits = async () => {
    const client = supabase;
    if (!client || !player || !admin.isSuper) return;
    const trimmedName = editFullName.trim();
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    const isMinorBand = editAgeBand !== "18_plus";
    if (isMinorBand) {
      if (!trimmedName || parts.length !== 1) {
        setInfoModal({ title: "Invalid Name", description: "For minors, use first name or nickname only." });
        setMessage("For minors, use first name or nickname only.");
        return;
      }
      if (!editLocationId) {
        setInfoModal({ title: "Location Required", description: "Location is required for under-18 profiles." });
        setMessage("Location is required for under-18 profiles.");
        return;
      }
      if (!editGuardianName.trim()) {
        setInfoModal({ title: "Guardian Required", description: "Guardian name is required for minors." });
        setMessage("Guardian name is required for minors.");
        return;
      }
      if (!editGuardianEmail.trim()) {
        setInfoModal({ title: "Guardian Required", description: "Guardian email is required for minors." });
        setMessage("Guardian email is required for minors.");
        return;
      }
      if (!editGuardianUserId) {
        setInfoModal({ title: "Guardian Required", description: "Guardian account must be linked for minors." });
        setMessage("Guardian account must be linked for minors.");
        return;
      }
    } else {
      if (!trimmedName || parts.length < 2) {
        setInfoModal({ title: "Invalid Name", description: "Adults must include first and second name." });
        setMessage("Adults must include first and second name.");
        return;
      }
      if (!editLocationId) {
        setInfoModal({ title: "Location Required", description: "Location is required for adults." });
        setMessage("Location is required for adults.");
        return;
      }
    }
    setSavingPlayer(true);
    const payload: Record<string, unknown> = {
      full_name: trimmedName,
      display_name: parts[0] ?? trimmedName,
      age_band: editAgeBand,
      location_id: editLocationId || null,
      guardian_consent: isMinorBand ? editGuardianConsent : false,
      guardian_consent_at: isMinorBand && editGuardianConsent ? new Date().toISOString() : null,
      guardian_name: isMinorBand ? editGuardianName.trim() || null : null,
      guardian_email: isMinorBand ? (editGuardianEmail.trim() || null) : null,
      guardian_user_id: isMinorBand ? editGuardianUserId || null : null,
    };
    const { error } = await client.from("players").update(payload).eq("id", player.id);
    setSavingPlayer(false);
    if (error) {
      if (error.message.includes("players_display_name_lower_uniq")) {
        setMessage(null);
        setInfoModal({
          title: "Name already in use",
          description: "A player profile with this display name already exists. Please choose a different first name/nickname.",
        });
        return;
      }
      setMessage(`Failed to save player: ${error.message}`);
      return;
    }
    setPlayer((prev) =>
      prev
        ? {
            ...prev,
            full_name: payload.full_name as string,
            display_name: payload.display_name as string,
            age_band: payload.age_band as string,
            location_id: (payload.location_id as string | null) ?? null,
            guardian_consent: Boolean(payload.guardian_consent),
            guardian_name: (payload.guardian_name as string | null) ?? null,
            guardian_email: (payload.guardian_email as string | null) ?? null,
            guardian_user_id: (payload.guardian_user_id as string | null) ?? null,
          }
        : prev
    );
    setEditingPlayer(false);
    setMessage("Player profile updated.");
  };

  const playerHasMatchHistory = async (playerId: string) => {
    const client = supabase;
    if (!client) return null;
    const { count, error } = await client
      .from("matches")
      .select("id", { count: "exact", head: true })
      .or(
        [
          `player1_id.eq.${playerId}`,
          `player2_id.eq.${playerId}`,
          `team1_player1_id.eq.${playerId}`,
          `team1_player2_id.eq.${playerId}`,
          `team2_player1_id.eq.${playerId}`,
          `team2_player2_id.eq.${playerId}`,
          `winner_player_id.eq.${playerId}`,
          `opening_break_player_id.eq.${playerId}`,
        ].join(",")
      );
    if (error) return null;
    return (count ?? 0) > 0;
  };

  const onDeletePlayerNow = async () => {
    const client = supabase;
    if (!client || !player || !admin.isSuper) return;
    setDeleteActionBusy("delete");

    const ownerLinked = await client
      .from("app_users")
      .select("id")
      .eq("linked_player_id", player.id)
      .eq("role", "owner")
      .maybeSingle();
    if (ownerLinked.data?.id) {
      setDeleteActionBusy(null);
      setDeleteChoiceOpen(false);
      setInfoModal({
        title: "Cannot Delete",
        description: "This profile is linked to the Super User account and cannot be deleted.",
      });
      return;
    }

    const hasHistory = await playerHasMatchHistory(player.id);
    if (hasHistory === null) {
      setDeleteActionBusy(null);
      setDeleteChoiceOpen(false);
      setInfoModal({
        title: "Delete unavailable",
        description: "Could not verify player match history. Please try again.",
      });
      return;
    }
    if (hasHistory) {
      setDeleteActionBusy(null);
      setDeleteChoiceOpen(false);
      setInfoModal({
        title: "Cannot delete permanently",
        description: "This profile has match history. Use Archive profile to preserve stats.",
      });
      return;
    }

    const unlinkRes = await client.from("app_users").update({ linked_player_id: null }).eq("linked_player_id", player.id);
    if (unlinkRes.error) {
      setDeleteActionBusy(null);
      setMessage(`Failed to unlink account: ${unlinkRes.error.message}`);
      return;
    }
    const delRes = await client.from("players").delete().eq("id", player.id).select("id").maybeSingle();
    if (delRes.error) {
      setDeleteActionBusy(null);
      setMessage(`Failed to delete player: ${delRes.error.message}`);
      return;
    }
    if (!delRes.data) {
      setDeleteActionBusy(null);
      setMessage("Failed to delete player: no profile was deleted.");
      return;
    }
    setDeleteActionBusy(null);
    setDeleteChoiceOpen(false);
    setInfoModal({ title: "Profile Deleted", description: "Player profile deleted permanently." });
    setTimeout(() => {
      if (typeof window !== "undefined") window.location.href = "/players";
    }, 250);
  };

  const onArchivePlayerNow = async () => {
    const client = supabase;
    if (!client || !player || !admin.isSuper) return;
    setDeleteActionBusy("archive");
    const { data, error } = await client
      .from("players")
      .update({ is_archived: true })
      .eq("id", player.id)
      .select("id")
      .maybeSingle();
    if (error) {
      setDeleteActionBusy(null);
      setMessage(`Failed to archive player: ${error.message}`);
      return;
    }
    if (!data) {
      setDeleteActionBusy(null);
      setMessage("Failed to archive player: no profile was updated.");
      return;
    }
    setPlayer((prev) => (prev ? { ...prev, is_archived: true } : prev));
    setDeleteActionBusy(null);
    setDeleteChoiceOpen(false);
    setInfoModal({
      title: "Profile Archived",
      description: "Player profile archived successfully.",
    });
  };

  const onRequestDeleteProfile = async (deleteAllData: boolean) => {
    const client = supabase;
    if (!client || !player || !userId) return;
    if (pendingDeleteRequest) {
      setInfoModal({
        title: "Request Already Pending",
        description: `A deletion request is already pending (${new Date(pendingDeleteRequest.created_at).toLocaleString()}).`,
      });
      return;
    }
    const { data: reqData, error } = await client
      .from("player_deletion_requests")
      .insert({
        player_id: player.id,
        requester_user_id: userId,
        delete_all_data: deleteAllData,
        status: "pending",
      })
      .select("id,created_at,delete_all_data")
      .single();
    if (error) {
      setMessage(null);
      setInfoModal({
        title: "Unable to submit request",
        description: error.message,
      });
      return;
    }
    setPendingDeleteRequest((reqData as { id: string; created_at: string; delete_all_data?: boolean | null }) ?? null);
    setInfoModal({
      title: "Deletion Request Submitted",
      description: deleteAllData
        ? "Your profile deletion request has been sent to the Super User for review, with personal-data deletion requested."
        : "Your profile deletion request has been sent to the Super User for review.",
    });
  };

  const playerName = player?.full_name?.trim() ? player.full_name : player?.display_name ?? "Player";
  const compMap = useMemo(() => new Map(competitions.map((c) => [c.id, c])), [competitions]);
  const nameMap = useMemo(
    () => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])),
    [players]
  );
  const framesByMatch = useMemo(() => {
    const map = new Map<string, Frame[]>();
    for (const f of frames) {
      const prev = map.get(f.match_id) ?? [];
      prev.push(f);
      map.set(f.match_id, prev);
    }
    return map;
  }, [frames]);
  const isMinor = player?.age_band && player.age_band !== "18_plus";
  const appUserById = useMemo(() => new Map(appUsers.map((u) => [u.id, u])), [appUsers]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const guardianUser = player?.guardian_user_id ? appUserById.get(player.guardian_user_id) : null;
  const guardianLinkedPlayer = guardianUser?.linked_player_id ? playerById.get(guardianUser.linked_player_id) : null;
  const guardianProfileId = guardianLinkedPlayer?.id ?? null;
  const guardianLabel =
    guardianLinkedPlayer?.full_name?.trim() || guardianLinkedPlayer?.display_name || player?.guardian_name || null;
  const guardianContact = player?.guardian_email?.trim() || guardianUser?.email || null;
  const currentProfileLinkedUserId =
    !player?.id ? null : player.claimed_by || appUsers.find((u) => u.linked_player_id === player.id)?.id || null;
  const childProfiles = useMemo(() => {
    if (!currentProfileLinkedUserId) return [] as Player[];
    return players.filter((p) => p.guardian_user_id === currentProfileLinkedUserId);
  }, [players, currentProfileLinkedUserId]);
  const livePlayerIdsByDiscipline = useMemo(() => {
    const competitionById = new Map(competitions.map((competition) => [competition.id, competition]));
    const recentCutoff = Date.now() - LIVE_ACTIVITY_WINDOW_MS;
    const result = {
      snooker: new Set<string>(),
      pool: new Set<string>(),
    };
    for (const entry of players) {
      if (entry.claimed_by) {
        result.snooker.add(entry.id);
        result.pool.add(entry.id);
      }
    }
    for (const match of matches) {
      const competition = competitionById.get(match.competition_id);
      if (!competition) continue;
      const participantIds = [
        match.player1_id,
        match.player2_id,
        match.team1_player1_id,
        match.team1_player2_id,
        match.team2_player1_id,
        match.team2_player2_id,
      ].filter((value): value is string => Boolean(value));
      if (participantIds.length === 0) continue;
      const disciplineKey = competition.sport_type === "snooker" ? "snooker" : "pool";
      if (!competition.is_archived && !competition.is_completed) {
        participantIds.forEach((playerId) => result[disciplineKey].add(playerId));
      }
      const playedRecently =
        match.status === "complete" &&
        Boolean(match.updated_at) &&
        new Date(match.updated_at as string).getTime() >= recentCutoff;
      if (playedRecently) {
        participantIds.forEach((playerId) => result[disciplineKey].add(playerId));
      }
    }
    return result;
  }, [competitions, matches, players]);
  const liveSnookerPlayers = useMemo(
    () =>
      players.filter(
        (entry) => livePlayerIdsByDiscipline.snooker.has(entry.id) && Number(entry.rated_matches_snooker ?? 0) > 0
      ),
    [livePlayerIdsByDiscipline, players]
  );
  const livePoolPlayers = useMemo(
    () =>
      players.filter(
        (entry) => livePlayerIdsByDiscipline.pool.has(entry.id) && Number(entry.rated_matches_pool ?? 0) > 0
      ),
    [livePlayerIdsByDiscipline, players]
  );
  const rankingCard = useMemo(() => {
    if (!player) return null;
    const bySnooker = [...liveSnookerPlayers].sort((a, b) => (b.rating_snooker ?? 1000) - (a.rating_snooker ?? 1000));
    const byPool = [...livePoolPlayers].sort((a, b) => (b.rating_pool ?? 1000) - (a.rating_pool ?? 1000));
    const snookerIndex = bySnooker.findIndex((p) => p.id === player.id);
    const poolIndex = byPool.findIndex((p) => p.id === player.id);
    return {
      poolRank: poolIndex >= 0 ? poolIndex + 1 : null,
      poolRating: player.rating_pool ?? 1000,
      poolPeak: player.peak_rating_pool ?? 1000,
      poolMatches: player.rated_matches_pool ?? 0,
      snookerRank: snookerIndex >= 0 ? snookerIndex + 1 : null,
      snookerRating: player.rating_snooker ?? 1000,
      snookerPeak: player.peak_rating_snooker ?? 1000,
      snookerMatches: player.rated_matches_snooker ?? 0,
      snookerLivePlayers: liveSnookerPlayers.length,
      poolLivePlayers: livePoolPlayers.length,
    };
  }, [livePoolPlayers, liveSnookerPlayers, player]);
  const snookerEloLeaderboard = useMemo(
    () =>
      [...liveSnookerPlayers]
        .sort(
          (a, b) =>
            Number(b.rating_snooker ?? 1000) - Number(a.rating_snooker ?? 1000) ||
            (a.full_name?.trim() ? a.full_name : a.display_name).localeCompare(b.full_name?.trim() ? b.full_name : b.display_name)
        )
        .map((entry, index) => ({
          id: entry.id,
          rank: index + 1,
          name: entry.full_name?.trim() ? entry.full_name : entry.display_name,
          rating: Math.round(Number(entry.rating_snooker ?? 1000)),
          handicap: Number(entry.snooker_handicap ?? 0),
        })),
    [liveSnookerPlayers]
  );
  const handicapExplain = useMemo(() => {
    const current = Number(player?.snooker_handicap ?? 0);
    if (current < 0) return `Current handicap after the latest review: this player gives ${Math.abs(current)} points start to a scratch (0) opponent.`;
    if (current > 0) return `Current handicap after the latest review: this player receives ${current} points start from a scratch (0) opponent.`;
    return "Current handicap after the latest review: this player is off scratch and neither gives nor receives points against a 0-handicap opponent.";
  }, [player?.snooker_handicap]);
  const baselineExplain = useMemo(() => {
    const start = Number(player?.snooker_handicap_base ?? 0);
    if (start < 0) return `Baseline handicap set before the season/review cycle: gives ${Math.abs(start)} start.`;
    if (start > 0) return `Baseline handicap set before the season/review cycle: receives ${start} start.`;
    return "Baseline handicap set before the season/review cycle: scratch.";
  }, [player?.snooker_handicap_base]);
  const formatPeakLabel = (peak: number, ratedMatches: number) =>
    ratedMatches > 0 ? `Peak ${Math.round(peak)}` : "Starting rating 1000";
  const formatHandicap = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return value > 0 ? `+${value}` : String(value);
  };
  const snookerHandicapGuide = [
    { elo: 1160, handicap: -32 },
    { elo: 1100, handicap: -20 },
    { elo: 1000, handicap: 0 },
    { elo: 960, handicap: 8 },
    { elo: 900, handicap: 20 },
  ];
  const snookerHandicapExport = useMemo(() => {
    if (!player) return "";
    const name = player.full_name?.trim() ? player.full_name : player.display_name;
    return [
      `${name}`,
      `Snooker Elo: ${Math.round(player.rating_snooker ?? 1000)}`,
      `Current handicap: ${formatHandicap(player.snooker_handicap)}`,
      `Baseline handicap: ${formatHandicap(player.snooker_handicap_base)}`,
      `Rated snooker matches: ${player.rated_matches_snooker ?? 0}`,
    ].join("\n");
  }, [player]);
  const canCreateChildProfile = Boolean(
    player &&
      (player.age_band ?? "18_plus") === "18_plus" &&
      currentProfileLinkedUserId &&
      (hasAdminPower || userId === currentProfileLinkedUserId)
  );

  const onCreateChildProfile = async () => {
    const client = supabase;
    if (!client || !player) return;
    if (!canCreateChildProfile || !currentProfileLinkedUserId) {
      setInfoModal({
        title: "Cannot create child profile",
        description: "The parent/guardian profile must be linked to a user account first.",
      });
      return;
    }
    const first = childFirstName.trim();
    if (!first) {
      setInfoModal({
        title: "Missing child name",
        description: "Enter the child full name or preferred playing name.",
      });
      return;
    }
    if (!childLocationId) {
      setInfoModal({
        title: "Location required",
        description: "Select a location for this child profile.",
      });
      return;
    }
    const guardianUser = appUserById.get(currentProfileLinkedUserId);
    const guardianName = player.full_name?.trim() ? player.full_name : player.display_name;
    setCreatingChild(true);
    const { data, error } = await client
      .from("players")
      .insert({
      display_name: first,
      first_name: first,
      nickname: null,
      full_name: first,
      location_id: childLocationId,
      age_band: childAgeBand,
      guardian_consent: false,
      guardian_consent_at: null,
      guardian_user_id: currentProfileLinkedUserId,
      guardian_name: guardianName,
      guardian_email: guardianUser?.email ?? null,
      is_archived: true,
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      setCreatingChild(false);
      if (error?.message?.includes("players_display_name_lower_uniq")) {
        const suggestion = `${first}-${Math.floor(Math.random() * 90 + 10)}`;
        setChildFirstName(suggestion);
        setMessage(null);
        setInfoModal({
          title: "Name already in use",
          description: `"${first}" already exists as a player display name. We suggested "${suggestion}" as a unique nickname. You can edit it and try again.`,
        });
        return;
      }
      setMessage(null);
      setInfoModal({
        title: "Unable to create child profile",
        description: error?.message ?? "Child profile could not be created.",
      });
      return;
    }
    const requestRes = await client.from("player_update_requests").insert({
      player_id: data.id,
      requester_user_id: currentProfileLinkedUserId,
      requested_full_name: first,
      requested_location_id: childLocationId,
      requested_age_band: childAgeBand,
      requested_guardian_consent: true,
      requested_guardian_name: guardianName,
      requested_guardian_email: guardianUser?.email ?? null,
      requested_guardian_user_id: currentProfileLinkedUserId,
      status: "pending",
    });
    setCreatingChild(false);
    if (requestRes.error) {
      await client.from("players").delete().eq("id", data.id);
      setMessage(null);
      setInfoModal({
        title: "Unable to submit child profile request",
        description: requestRes.error.message,
      });
      return;
    }
    setChildFirstName("");
    setChildAgeBand("under_18");
    setChildLocationId("");
    setMessage(null);
    setInfoModal({
      title: "Child profile request submitted",
      description:
        "The under-18 profile has been submitted to the approval queue. A club admin can approve it for this location, or the Super User can approve it if no club admin is in place yet. The request stores the child name, location, and linked parent or guardian details only.",
    });
    const reload = await client
      .from("players")
      .select("id,display_name,full_name,avatar_url,location_id,age_band,guardian_consent,guardian_user_id")
      .eq("is_archived", false);
    if (!reload.error && reload.data) {
      setPlayers(reload.data as Player[]);
    }
  };
  const isWalkoverMatch = (m: MatchRow) => {
    const rows = framesByMatch.get(m.id) ?? [];
    return rows.length > 0 && rows.every((f) => f.is_walkover_award);
  };
  const leagueFixtureById = useMemo(() => new Map(leagueFixtures.map((f) => [f.id, f])), [leagueFixtures]);
  const leagueTeamById = useMemo(() => new Map(leagueTeams.map((t) => [t.id, t.name])), [leagueTeams]);
  const leagueRelevant = useMemo(
    () =>
      leagueFrames.filter((s) => {
        const inHome = s.home_player1_id === id || s.home_player2_id === id;
        const inAway = s.away_player1_id === id || s.away_player2_id === id;
        if (!inHome && !inAway) return false;
        const noShowBoth = s.home_forfeit && s.away_forfeit;
        if (noShowBoth) return false;
        return s.winner_side !== null;
      }),
    [leagueFrames, id]
  );
  const relevant = matches.filter((m) => {
    if (m.status !== "complete") return false;
    if (isWalkoverMatch(m)) return false;
    if (m.match_mode === "singles") return m.player1_id === id || m.player2_id === id;
    return m.team1_player1_id === id || m.team1_player2_id === id || m.team2_player1_id === id || m.team2_player2_id === id;
  });

  const summary = useMemo(() => {
    let played = 0;
    let won = 0;
    let lost = 0;
    let framesFor = 0;
    let framesAgainst = 0;
    let snookerPlayed = 0;
    let snookerWon = 0;
    let poolPlayed = 0;
    let poolWon = 0;

    for (const m of relevant) {
      played += 1;
      const c = compMap.get(m.competition_id);
      const inTeam1 = m.team1_player1_id === id || m.team1_player2_id === id;
      const winnerIsTeam1 = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
      const winnerIsTeam2 = m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id;
      const isWin = m.match_mode === "singles" ? m.winner_player_id === id : inTeam1 ? winnerIsTeam1 : winnerIsTeam2;
      if (isWin) won += 1;
      else lost += 1;
      if (c?.sport_type === "snooker") {
        snookerPlayed += 1;
        if (isWin) snookerWon += 1;
      } else if (c?.sport_type === "pool_8_ball" || c?.sport_type === "pool_9_ball") {
        poolPlayed += 1;
        if (isWin) poolWon += 1;
      }

      const ff = frames.filter((f) => f.match_id === m.id && !f.is_walkover_award);
      for (const f of ff) {
        if (m.match_mode === "singles") {
          if (f.winner_player_id === id) framesFor += 1;
          else framesAgainst += 1;
        } else {
          const frameTeam1 = f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id;
          const frameTeam2 = f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id;
          if ((inTeam1 && frameTeam1) || (!inTeam1 && frameTeam2)) framesFor += 1;
          if ((inTeam1 && frameTeam2) || (!inTeam1 && frameTeam1)) framesAgainst += 1;
        }
      }
    }

    return { played, won, lost, framesFor, framesAgainst, snookerPlayed, snookerWon, poolPlayed, poolWon };
  }, [relevant, compMap, frames, id]);
  const leagueSummary = useMemo(() => {
    let played = 0;
    let won = 0;
    let lost = 0;
    for (const s of leagueRelevant) {
      const inHome = s.home_player1_id === id || s.home_player2_id === id;
      played += 1;
      if ((inHome && s.winner_side === "home") || (!inHome && s.winner_side === "away")) won += 1;
      else lost += 1;
    }
    return {
      played,
      won,
      lost,
      framesFor: won,
      framesAgainst: lost,
      snookerPlayed: played,
      snookerWon: won,
      poolPlayed: 0,
      poolWon: 0,
    };
  }, [leagueRelevant, id]);
  const effectiveSummary = summary.played > 0 ? summary : leagueSummary;
  const disciplineBreakdown = useMemo(() => {
    const rows = new Map<"snooker" | "pool_8_ball" | "pool_9_ball", { label: string; played: number; won: number; framesFor: number; framesAgainst: number }>([
      ["snooker", { label: "Snooker", played: 0, won: 0, framesFor: 0, framesAgainst: 0 }],
      ["pool_8_ball", { label: "8-ball Pool", played: 0, won: 0, framesFor: 0, framesAgainst: 0 }],
      ["pool_9_ball", { label: "9-ball Pool", played: 0, won: 0, framesFor: 0, framesAgainst: 0 }],
    ]);

    for (const m of relevant) {
      const comp = compMap.get(m.competition_id);
      if (!comp) continue;
      const row = rows.get(comp.sport_type);
      if (!row) continue;
      row.played += 1;

      const inTeam1 = m.team1_player1_id === id || m.team1_player2_id === id;
      const winnerIsTeam1 = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
      const winnerIsTeam2 = m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id;
      const isWin = m.match_mode === "singles" ? m.winner_player_id === id : inTeam1 ? winnerIsTeam1 : winnerIsTeam2;
      if (isWin) row.won += 1;

      const ff = frames.filter((f) => f.match_id === m.id && !f.is_walkover_award);
      for (const f of ff) {
        if (m.match_mode === "singles") {
          if (f.winner_player_id === id) row.framesFor += 1;
          else row.framesAgainst += 1;
        } else {
          const frameTeam1 = f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id;
          const frameTeam2 = f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id;
          if ((inTeam1 && frameTeam1) || (!inTeam1 && frameTeam2)) row.framesFor += 1;
          if ((inTeam1 && frameTeam2) || (!inTeam1 && frameTeam1)) row.framesAgainst += 1;
        }
      }
    }

    if (summary.played > 0) {
      return Array.from(rows.values()).filter((row) => row.played > 0);
    }

    const snookerLeagueRow = rows.get("snooker");
    if (snookerLeagueRow) {
      snookerLeagueRow.played = leagueSummary.played;
      snookerLeagueRow.won = leagueSummary.won;
      snookerLeagueRow.framesFor = leagueSummary.framesFor;
      snookerLeagueRow.framesAgainst = leagueSummary.framesAgainst;
    }
    return Array.from(rows.values()).filter((row) => row.played > 0);
  }, [relevant, compMap, frames, id, summary.played, leagueSummary]);

  const formGuide = useMemo(() => {
    const chars: string[] = [];
    const sorted = [...relevant].sort((a, b) => Date.parse(b.updated_at ?? "0") - Date.parse(a.updated_at ?? "0"));
    for (const m of sorted) {
      const ff = frames.filter((f) => f.match_id === m.id && !f.is_walkover_award);
      if (ff.length) {
        for (const f of ff) {
          if (m.match_mode === "singles") chars.push(f.winner_player_id === id ? "W" : "L");
          else {
            const inTeam1 = m.team1_player1_id === id || m.team1_player2_id === id;
            const frameTeam1 = f.winner_player_id === m.team1_player1_id || f.winner_player_id === m.team1_player2_id;
            const frameTeam2 = f.winner_player_id === m.team2_player1_id || f.winner_player_id === m.team2_player2_id;
            chars.push((inTeam1 ? frameTeam1 : frameTeam2) ? "W" : "L");
          }
          if (chars.length >= 10) return chars.join("");
        }
      } else {
        const inTeam1 = m.team1_player1_id === id || m.team1_player2_id === id;
        const winnerIsTeam1 = m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id;
        chars.push(m.match_mode === "singles" ? (m.winner_player_id === id ? "W" : "L") : (inTeam1 ? winnerIsTeam1 : !winnerIsTeam1) ? "W" : "L");
        if (chars.length >= 10) return chars.join("");
      }
    }
    return chars.length ? chars.join("") : "-";
  }, [relevant, frames, id]);
  const leagueFormGuide = useMemo(() => {
    const chars: string[] = [];
    const sorted = [...leagueRelevant].sort((a, b) => {
      const da = Date.parse(leagueFixtureById.get(a.fixture_id)?.fixture_date ?? "0");
      const db = Date.parse(leagueFixtureById.get(b.fixture_id)?.fixture_date ?? "0");
      return db - da;
    });
    for (const s of sorted) {
      const inHome = s.home_player1_id === id || s.home_player2_id === id;
      chars.push((inHome && s.winner_side === "home") || (!inHome && s.winner_side === "away") ? "W" : "L");
      if (chars.length >= 10) break;
    }
    return chars.length ? chars.join("") : "-";
  }, [leagueRelevant, leagueFixtureById, id]);
  const effectiveFormGuide = formGuide !== "-" ? formGuide : leagueFormGuide;
  const recentFormItems = useMemo(
    () =>
      effectiveFormGuide === "-"
        ? []
        : effectiveFormGuide.split("").map((result, index) => ({
            key: `${result}-${index}`,
            result,
          })),
    [effectiveFormGuide]
  );

  const opponents = useMemo(() => {
    const map = new Map<string, { played: number; won: number; lost: number }>();
    for (const m of relevant) {
      if (m.match_mode !== "singles") continue;
      const oppId = m.player1_id === id ? m.player2_id : m.player1_id;
      if (!oppId) continue;
      const row = map.get(oppId) ?? { played: 0, won: 0, lost: 0 };
      row.played += 1;
      if (m.winner_player_id === id) row.won += 1;
      else row.lost += 1;
      map.set(oppId, row);
    }
    return [...map.entries()]
      .map(([oppId, s]) => ({ opponentId: oppId, opponent: nameMap.get(oppId) ?? "Unknown", ...s }))
      .sort((a, b) => b.played - a.played || a.opponent.localeCompare(b.opponent));
  }, [relevant, id, nameMap]);
  const leagueOpponents = useMemo(() => {
    const map = new Map<string, { played: number; won: number; lost: number }>();
    for (const s of leagueRelevant) {
      if (s.slot_type !== "singles") continue;
      const inHome = s.home_player1_id === id || s.home_player2_id === id;
      const oppId = inHome ? s.away_player1_id : s.home_player1_id;
      if (!oppId) continue;
      const row = map.get(oppId) ?? { played: 0, won: 0, lost: 0 };
      row.played += 1;
      const isWin = (inHome && s.winner_side === "home") || (!inHome && s.winner_side === "away");
      if (isWin) row.won += 1;
      else row.lost += 1;
      map.set(oppId, row);
    }
    return [...map.entries()]
      .map(([oppId, s]) => ({ opponentId: oppId, opponent: nameMap.get(oppId) ?? "Unknown", ...s }))
      .sort((a, b) => b.played - a.played || a.opponent.localeCompare(b.opponent));
  }, [leagueRelevant, id, nameMap]);
  const effectiveOpponents = opponents.length > 0 ? opponents : leagueOpponents;
  const opponentRecentById = useMemo(() => {
    const map = new Map<string, Array<{ key: string; date: string | null; result: "W" | "L"; label: string }>>();
    const sorted = [...relevant].sort((a, b) => Date.parse(b.updated_at ?? "0") - Date.parse(a.updated_at ?? "0"));
    for (const match of sorted) {
      if (match.match_mode !== "singles") continue;
      const opponentId = match.player1_id === id ? match.player2_id : match.player1_id;
      if (!opponentId) continue;
      const result: "W" | "L" = match.winner_player_id === id ? "W" : "L";
      const entry = {
        key: match.id,
        date: match.updated_at,
        result,
        label: `${nameMap.get(opponentId) ?? "Unknown"} · ${result}`,
      };
      const prev = map.get(opponentId) ?? [];
      if (prev.length < 3) {
        prev.push(entry);
        map.set(opponentId, prev);
      }
    }
    return map;
  }, [relevant, id, nameMap]);
  const enhancedOpponents = useMemo(
    () =>
      effectiveOpponents.map((opp) => {
        const recent = opp.opponentId ? opponentRecentById.get(opp.opponentId) ?? [] : [];
        const frameDiff = opp.won - opp.lost;
        return { ...opp, frameDiff, recent };
      }),
    [effectiveOpponents, opponentRecentById]
  );

  const favoriteDiscipline = useMemo(() => {
    if (!disciplineBreakdown.length) return null;
    return [...disciplineBreakdown].sort((a, b) => b.played - a.played || b.won - a.won)[0];
  }, [disciplineBreakdown]);

  const seasonSummary = useMemo(() => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let played = 0;
    let won = 0;
    for (const match of relevant) {
      const playedAt = Date.parse(match.updated_at ?? "0");
      if (!playedAt || playedAt < cutoff) continue;
      played += 1;
      const inTeam1 = match.team1_player1_id === id || match.team1_player2_id === id;
      const winnerIsTeam1 = match.winner_player_id === match.team1_player1_id || match.winner_player_id === match.team1_player2_id;
      const winnerIsTeam2 = match.winner_player_id === match.team2_player1_id || match.winner_player_id === match.team2_player2_id;
      const isWin = match.match_mode === "singles" ? match.winner_player_id === id : inTeam1 ? winnerIsTeam1 : winnerIsTeam2;
      if (isWin) won += 1;
    }
    return { played, won };
  }, [relevant, id]);

  const achievements = useMemo(() => {
    const items: string[] = [];
    if (effectiveSummary.won > 0) items.push("First win recorded");
    if (effectiveSummary.played >= 10) items.push("10 matches played");
    if (effectiveSummary.played >= 25) items.push("25 matches played");
    if (effectiveSummary.played >= 50) items.push("50 matches played");

    let bestStreak = 0;
    let currentStreak = 0;
    for (const item of recentFormItems) {
      if (item.result === "W") {
        currentStreak += 1;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    if (bestStreak >= 3) items.push(`${bestStreak} match win streak`);
    return items;
  }, [effectiveSummary.won, effectiveSummary.played, recentFormItems]);
  const recognitionBadges = useMemo(() => {
    const items: string[] = [];
    const linkedAccount = currentProfileLinkedUserId ? appUserById.get(currentProfileLinkedUserId) ?? null : null;
    const linkedRole = (linkedAccount?.role ?? "").toLowerCase();

    if (effectiveSummary.played >= 10) items.push("Quick Match Regular");
    if (relevant.some((match) => Boolean(match.competition_id)) || competitionEntries.some((entry) => entry.status === "approved" || entry.status === "pending")) {
      items.push("Competition Player");
    }
    if (disciplineBreakdown.find((row) => row.label === "Snooker" && row.played >= 5)) items.push("Snooker Specialist");
    if (disciplineBreakdown.find((row) => row.label === "8-ball Pool" && row.played >= 5)) items.push("8-ball Regular");
    if (disciplineBreakdown.find((row) => row.label === "9-ball Pool" && row.played >= 5)) items.push("9-ball Regular");
    if (recentFormItems.filter((item) => item.result === "W").length >= 3) items.push("Win Streak");
    if (linkedRole === "admin") items.push("Club Admin");
    if (linkedRole === "owner") items.push("Super User");
    if ((player?.age_band ?? "18_plus") !== "18_plus") items.push("Under 18s");
    if (childProfiles.length > 0) items.push("Parent / Guardian Linked");

    return items;
  }, [
    appUserById,
    childProfiles.length,
    currentProfileLinkedUserId,
    disciplineBreakdown,
    effectiveSummary.played,
    competitionEntries,
    player?.age_band,
    recentFormItems,
    relevant,
  ]);
  const competitionById = useMemo(() => new Map(competitions.map((competition) => [competition.id, competition])), [competitions]);
  const playerCompetitionEntries = useMemo(
    () =>
      competitionEntries
        .filter((entry) => entry.status !== "rejected" && entry.status !== "withdrawn")
        .map((entry) => {
          const competition = competitionById.get(entry.competition_id) ?? null;
          return { entry, competition };
        }),
    [competitionEntries, competitionById]
  );
  const approvedCompetitionEntryCount = useMemo(
    () => playerCompetitionEntries.filter(({ entry }) => entry.status === "approved").length,
    [playerCompetitionEntries]
  );
  const pendingCompetitionEntryCount = useMemo(
    () => playerCompetitionEntries.filter(({ entry }) => entry.status === "pending").length,
    [playerCompetitionEntries]
  );

  const competitionSportLabel = (sportType: Competition["sport_type"] | null | undefined) => {
    if (sportType === "snooker") return "Snooker";
    if (sportType === "pool_8_ball") return "8-ball Pool";
    if (sportType === "pool_9_ball") return "9-ball Pool";
    return "Competition";
  };

  const leagueHistory = useMemo<RecentHistoryItem[]>(() => {
    return leagueRelevant
      .flatMap((s) => {
        const fixture = leagueFixtureById.get(s.fixture_id);
        if (!fixture) return [];
        const homeTeam = leagueTeamById.get(fixture.home_team_id) ?? "Home";
        const awayTeam = leagueTeamById.get(fixture.away_team_id) ?? "Away";
        const inHome = s.home_player1_id === id || s.home_player2_id === id;
        const result: "W" | "L" = (inHome && s.winner_side === "home") || (!inHome && s.winner_side === "away") ? "W" : "L";
        return [{
          key: `${s.fixture_id}-${s.slot_no}`,
          date: fixture.fixture_date,
          label: `Week ${fixture.week_no ?? "?"} · ${homeTeam} vs ${awayTeam} · ${s.slot_type} ${s.slot_no}`,
          result,
          sublabel: "League fixture",
        }];
      })
      .sort((a, b) => Date.parse(b?.date ?? "0") - Date.parse(a?.date ?? "0"))
      .slice(0, 20);
  }, [leagueRelevant, leagueFixtureById, leagueTeamById, id]);
  const competitionHistory = useMemo<RecentHistoryItem[]>(() => {
    return relevant.flatMap((match) => {
      const competition = compMap.get(match.competition_id);
      const inTeam1 = match.team1_player1_id === id || match.team1_player2_id === id;
      const winnerIsTeam1 = match.winner_player_id === match.team1_player1_id || match.winner_player_id === match.team1_player2_id;
      const winnerIsTeam2 = match.winner_player_id === match.team2_player1_id || match.winner_player_id === match.team2_player2_id;
      const result: "W" | "L" = match.match_mode === "singles" ? (match.winner_player_id === id ? "W" : "L") : (inTeam1 ? winnerIsTeam1 : winnerIsTeam2) ? "W" : "L";
      const opponentLabel =
        match.match_mode === "singles"
          ? nameMap.get(match.player1_id === id ? (match.player2_id ?? "") : (match.player1_id ?? "")) ?? "Opponent"
          : [
              match.team1_player1_id,
              match.team1_player2_id,
              match.team2_player1_id,
              match.team2_player2_id,
            ]
              .filter((playerId) => Boolean(playerId) && playerId !== id)
              .map((playerId) => nameMap.get(playerId as string) ?? "Opponent")
              .join(" / ") || "Opponent";
      return [{
        key: `match-${match.id}`,
        date: match.updated_at ?? null,
        label: `${competition?.name?.trim() || competitionSportLabel(competition?.sport_type)} · ${opponentLabel}`,
        result,
        sublabel: competition?.competition_format === "knockout" ? "Competition match" : "Match record",
      }];
    });
  }, [relevant, compMap, id, nameMap]);
  const recentHistory = useMemo<RecentHistoryItem[]>(
    () => [...competitionHistory, ...leagueHistory].sort((a, b) => Date.parse(b.date ?? "0") - Date.parse(a.date ?? "0")).slice(0, 20),
    [competitionHistory, leagueHistory]
  );

  const ageBandLabel =
    player?.age_band === "under_13"
      ? "Under 13"
      : player?.age_band === "under_18"
        ? "Under 18s"
        : player?.age_band === "13_15"
          ? "13-15"
          : player?.age_band === "16_17"
            ? "16-17"
            : "18+";
  const profileLocationName = player?.location_id ? locations.find((l) => l.id === player.location_id)?.name ?? "Assigned" : "Not set";
  const profileHeaderPills = [
    { label: `Location: ${profileLocationName}`, tone: "slate" as const },
    { label: `Age band: ${ageBandLabel}`, tone: "slate" as const },
    favoriteDiscipline ? { label: `Favorite: ${favoriteDiscipline.label}`, tone: "teal" as const } : null,
    rankingCard ? { label: rankingCard.snookerRank ? `Snooker #${rankingCard.snookerRank}` : "Snooker unranked", tone: "indigo" as const } : null,
    rankingCard ? { label: rankingCard.poolRank ? `Pool #${rankingCard.poolRank}` : "Pool unranked", tone: "indigo" as const } : null,
    player?.age_band && player.age_band !== "18_plus"
      ? { label: player.guardian_consent ? "Guardian consent on file" : "Guardian consent pending", tone: "amber" as const }
      : null,
  ].filter(Boolean) as Array<{ label: string; tone: "slate" | "teal" | "indigo" | "amber" }>;

  const pillClass = (tone: "slate" | "teal" | "indigo" | "amber") => {
    if (tone === "teal") return "rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800";
    if (tone === "indigo") return "rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800";
    if (tone === "amber") return "rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900";
    return "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700";
  };
  const disciplineCardClass = (label: string) => {
    if (label === "Snooker") return "rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-3";
    if (label === "8-ball Pool") return "rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-3";
    if (label === "9-ball Pool") return "rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-3";
    return "rounded-xl border border-slate-200 bg-slate-50 p-3";
  };
  const achievementClass = (item: string) => {
    if (item.includes("win streak")) return "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800";
    if (item.includes("matches played")) return "rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800";
    return "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900";
  };
  const recognitionClass = (item: string) => {
    if (item === "Super User") return "rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900";
    if (item === "Club Admin") return "rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800";
    if (item === "Under 18s" || item === "Parent / Guardian Linked") {
      return "rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800";
    }
    if (item.includes("Specialist") || item.includes("Regular")) {
      return "rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800";
    }
    if (item === "Win Streak") return "rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800";
    return "rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700";
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Player Profile"
            eyebrow="Players"
            subtitle="Profile details, club history, and player stats."
          />
          {loading ? <p className="rounded-xl border border-slate-200 bg-white p-4">Loading profile...</p> : null}
          <MessageModal message={message} onClose={() => setMessage(null)} />
          {pendingUpdate ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Profile update request is waiting for approval (submitted {new Date(pendingUpdate.created_at).toLocaleString()}).
            </p>
          ) : null}
          {pendingDeleteRequest ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Profile deletion request is waiting for Super User approval (submitted {new Date(pendingDeleteRequest.created_at).toLocaleString()}).
            </p>
          ) : null}

          {!loading ? (
            <>
              {player ? (
                <section
                  ref={profileRef}
                  className="rounded-[2rem] border border-cyan-200 bg-gradient-to-br from-white via-cyan-50 to-sky-50 p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start gap-5">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border-2 border-cyan-200 bg-slate-100 shadow-sm">
                      {player.avatar_url ? (
                        <img src={player.avatar_url} alt={playerName} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-[220px] flex-1 space-y-3">
                      <div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-950">{playerName}</h1>
                        <p className="mt-1 text-sm font-medium text-slate-600">
                          Match history, Elo-style ratings, recognition badges, and club profile details.
                        </p>
                      </div>
                      {linkedEmail ? <p className="mt-2 text-base text-slate-700">{linkedEmail}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        {profileHeaderPills.map((item) => (
                          <span key={item.label} className={pillClass(item.tone)}>
                            {item.label}
                          </span>
                        ))}
                      </div>
                      {(guardianLabel || guardianContact) ? (
                        <p className="text-sm text-slate-600">
                          Guardian: {guardianLabel ?? "Name missing"}
                          {hasAdminPower ? ` · ${guardianContact ?? "Email missing"}` : ""}
                          {guardianProfileId ? (
                            <>
                              {" "}
                              ·{" "}
                              <Link href={`/players/${guardianProfileId}`} className="font-medium text-teal-700 underline">
                                View profile
                              </Link>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      <p className="text-sm text-slate-500">
                        Current handicap reflects the latest review. Baseline handicap is the original pre-season or review-cycle starting point.
                      </p>
                      {!isMinor ? (
                        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) onUploadAvatar(file);
                            }}
                            disabled={uploading}
                          />
                          <span className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700">
                            {uploading ? "Uploading..." : "Upload profile photo"}
                          </span>
                        </label>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">Profile photos are disabled for minors.</p>
                      )}
                      {childProfiles.length > 0 ? (
                        <div className="mt-2 text-sm text-slate-600">
                          <p>Linked child profiles:</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {childProfiles.map((c) => (
                              <Link
                                key={c.id}
                                href={`/players/${c.id}`}
                                className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-teal-700 underline"
                              >
                                {c.full_name?.trim() ? c.full_name : c.display_name}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall record</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{pct(effectiveSummary.won, effectiveSummary.played)}%</p>
                      <p className="text-sm text-slate-600">
                        {effectiveSummary.won} wins from {effectiveSummary.played} matches
                      </p>
                    </div>
                    <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Snooker Elo</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{rankingCard ? Math.round(rankingCard.snookerRating) : 1000}</p>
                      <p className="text-sm text-slate-600">
                        Rank #{rankingCard?.snookerRank ?? "-"} · {rankingCard ? formatPeakLabel(rankingCard.snookerPeak, rankingCard.snookerMatches) : "Starting rating 1000"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Current {formatHandicap(player?.snooker_handicap)} · Baseline {formatHandicap(player?.snooker_handicap_base)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pool Elo</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{rankingCard ? Math.round(rankingCard.poolRating) : 1000}</p>
                      <p className="text-sm text-slate-600">
                        Rank #{rankingCard?.poolRank ?? "-"} · {rankingCard ? formatPeakLabel(rankingCard.poolPeak, rankingCard.poolMatches) : "Starting rating 1000"}
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
              {player && rankingCard ? (
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Current Elo</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{Math.round(rankingCard.snookerRating)}</p>
                    <p className="mt-1 text-sm text-slate-600">Live snooker rating after approved results.</p>
                  </div>
                  <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Rank</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{rankingCard.snookerRank ? `#${rankingCard.snookerRank}` : "—"}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {rankingCard.snookerRank
                        ? `Out of ${rankingCard.snookerLivePlayers} live snooker players.`
                        : "Not currently included in live snooker rankings."}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Current Handicap</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{formatHandicap(player?.snooker_handicap)}</p>
                    <p className="mt-1 text-sm text-slate-600">Live points-start figure after latest review.</p>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Frames Won %</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{pct(effectiveSummary.won, effectiveSummary.played)}%</p>
                    <p className="mt-1 text-sm text-slate-600">{effectiveSummary.won} wins from {effectiveSummary.played} recorded frames.</p>
                  </div>
                </section>
              ) : null}
              {rankingCard ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">Ranking Card</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/rankings"
                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        View full rankings
                      </Link>
                      <button
                        type="button"
                        onClick={() => window.open(`/display/ranking/${id}`, "_blank", "noopener,noreferrer,width=900,height=600")}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Open display card
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Current rating and rank against other active players.</p>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">How ranking is calculated</p>
                    <p className="mt-1">
                      Ratings use an Elo-style model. Expected result is based on current ratings, then updated when approved singles results complete.
                      Upsets move ratings more than expected wins. K-factor is higher for newer players and lower for experienced players.
                    </p>
                    <p className="mt-1">BYE, walkover, void, and doubles outcomes are excluded from ratings.</p>
                    <p className="mt-1">
                      Snooker handicap is reviewed from Elo rather than moved automatically after every result. Negative values give start; positive values receive start.
                    </p>
                    <p className="mt-1">
                      Actual match starts are capped at {MAX_SNOOKER_START}. The cap keeps frames competitive and understandable while Elo continues to track the full strength gap in the background.
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">Snooker Rating</p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">{Math.round(rankingCard.snookerRating)}</p>
                      <p className="text-sm text-slate-600">
                        {rankingCard.snookerRank
                          ? `Rank #${rankingCard.snookerRank} of ${rankingCard.snookerLivePlayers}`
                          : "Not currently included in live snooker rankings"}
                      </p>
                      <p className="text-xs text-slate-500">Peak {Math.round(rankingCard.snookerPeak)} · Rated matches {rankingCard.snookerMatches}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">Live Elo and Handicap Table</p>
                        <p className="text-xs text-slate-500">All active players</p>
                      </div>
                      <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200">
                        <table className="min-w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                              <th className="px-3 py-2">#</th>
                              <th className="px-3 py-2">Player</th>
                              <th className="px-3 py-2">Elo</th>
                              <th className="px-3 py-2">Handicap</th>
                            </tr>
                          </thead>
                          <tbody>
                            {snookerEloLeaderboard.map((row) => (
                              <tr
                                key={row.id}
                                className={`border-b border-slate-100 text-slate-800 last:border-b-0 ${row.id === player?.id ? "bg-cyan-50" : "bg-white"}`}
                              >
                                <td className="px-3 py-2 font-semibold">{row.rank}</td>
                                <td className="px-3 py-2">{row.name}</td>
                                <td className="px-3 py-2">{row.rating}</td>
                                <td className="px-3 py-2">{formatHandicap(row.handicap)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
              {rankingCard ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setShowHandicap((v) => !v)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <h2 className="text-lg font-semibold text-slate-900">Handicap</h2>
                    <span className="text-sm text-slate-600">{showHandicap ? "Hide" : "Show"}</span>
                  </button>
                  {showHandicap ? (
                    <div className="mt-3">
                      <div className="mb-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-xs leading-6 text-fuchsia-950">
                        <p className="font-semibold">How your handicap is adjusted</p>
                        <p className="mt-1">
                          Your snooker Elo rating updates after every valid competitive frame. Handicap is then reviewed from Elo rather than changed automatically after every win or loss.
                        </p>
                        <p className="mt-1">
                          Target handicap matches the current Elo guide and the live start is capped at {MAX_SNOOKER_START}. No-show, nominated-player, and void frames are excluded.
                        </p>
                      </div>
                      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-700">
                        <p className="font-semibold text-slate-900">What your handicap means in points start</p>
                        <p className="mt-1">{handicapExplain}</p>
                        <p className="mt-1">{baselineExplain}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current</p>
                          <p className="mt-2 text-2xl font-bold text-slate-900">{formatHandicap(player?.snooker_handicap)}</p>
                          <p className="text-xs text-slate-500">after latest review</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Baseline</p>
                          <p className="mt-2 text-2xl font-bold text-slate-900">{formatHandicap(player?.snooker_handicap_base)}</p>
                          <p className="text-xs text-slate-500">original starting handicap</p>
                        </div>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rated snooker matches</p>
                          <p className="mt-2 text-2xl font-bold text-slate-900">{player?.rated_matches_snooker ?? 0}</p>
                          <p className="text-xs text-slate-500">approved singles results only</p>
                        </div>
                      </div>
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Why the maximum start is capped at {MAX_SNOOKER_START}</p>
                        <p className="mt-1 text-sm text-slate-700">
                          Large handicap gaps can be mathematically consistent with Elo but still produce frames that feel pre-decided. The cap protects weaker players without turning the opening scoreline into the whole contest.
                        </p>
                        <p className="mt-1 text-sm text-slate-700">
                          In practice, the reviewed handicap still reflects the longer-term strength gap, but the live fixture uses a capped start so the match remains playable, recognisable, and easier for players to trust.
                        </p>
                      </div>
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Elo to handicap guide</p>
                            <p className="text-xs text-slate-500">Quick reference for how snooker Elo maps toward reviewed handicap. Live starts are capped at {MAX_SNOOKER_START}.</p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!snookerHandicapExport) return;
                              await navigator.clipboard.writeText(snookerHandicapExport);
                              setInfoModal({ title: "Copied", description: "Snooker Elo and handicap summary copied for WhatsApp or email." });
                            }}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            Copy handicap summary
                          </button>
                        </div>
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="py-2 pr-4 font-medium">Elo</th>
                                <th className="py-2 pr-4 font-medium">Current</th>
                              </tr>
                            </thead>
                            <tbody>
                              {snookerHandicapGuide.map((row) => (
                                <tr key={row.elo} className="border-t border-slate-100">
                                  <td className="py-2 pr-4 font-medium text-slate-900">{row.elo}</td>
                                  <td className="py-2 pr-4 text-slate-700">{formatHandicap(row.handicap)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowPerformance((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <h2 className="text-lg font-semibold text-slate-900">Performance Snapshot</h2>
                  <span className="text-sm text-slate-600">{showPerformance ? "Hide" : "Show"}</span>
                </button>
                {showPerformance ? (
                  <>
                    <div className="mt-3 grid gap-2 sm:grid-cols-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Frames Played</p>
                        <p className="text-xl font-semibold text-slate-900">{effectiveSummary.played}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Win %</p>
                        <p className="text-xl font-semibold text-slate-900">{pct(effectiveSummary.won, effectiveSummary.played)}%</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Frames For</p>
                        <p className="text-xl font-semibold text-slate-900">{effectiveSummary.framesFor}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Frames Against</p>
                        <p className="text-xl font-semibold text-slate-900">{effectiveSummary.framesAgainst}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Snooker Wins</p>
                        <p className="text-xl font-semibold text-slate-900">{effectiveSummary.snookerWon}/{effectiveSummary.snookerPlayed}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Recent form</p>
                        <p className="mt-1 text-xs text-slate-500">Last {recentFormItems.length || 0} completed results</p>
                        {recentFormItems.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {recentFormItems.map((item) => (
                              <span
                                key={item.key}
                                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                                  item.result === "W" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                                }`}
                              >
                                {item.result}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-600">No recent form yet.</p>
                        )}
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100 p-3">
                        <p className="text-sm font-semibold text-slate-900">Overall summary</p>
                        <p className="mt-2 text-slate-800">
                          Matches/Frames: {effectiveSummary.played} · Won: {effectiveSummary.won} · Lost: {effectiveSummary.lost} · Win%: {pct(effectiveSummary.won, effectiveSummary.played)}%
                        </p>
                        <p className="mt-1 text-slate-800">
                          Frames: For {effectiveSummary.framesFor} · Against {effectiveSummary.framesAgainst}
                        </p>
                      </div>
                    </div>
                  </>
                ) : null}
              </section>
              {childProfilesEnabled && player && (player.age_band ?? "18_plus") === "18_plus" ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-lg font-semibold text-slate-900">Create child profile</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Create an under-18 player profile linked to this parent or guardian. The request will be reviewed by a club admin, or by the Super User if no club admin exists yet.
                  </p>
                  {!currentProfileLinkedUserId ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      This parent or guardian profile must be linked to a user account before child profiles can be created.
                    </p>
                  ) : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="Child full name or preferred playing name"
                      value={childFirstName}
                      onChange={(e) => setChildFirstName(e.target.value)}
                      disabled={!canCreateChildProfile || creatingChild}
                    />
                    <select
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      value={childLocationId}
                      onChange={(e) => setChildLocationId(e.target.value)}
                      disabled={!canCreateChildProfile || creatingChild}
                    >
                      <option value="">Select location (required)</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Age band: Under 18s</p>
                  <p className="mt-1 text-xs text-slate-500">After submission, this request appears in the profile update approval queue rather than the live player list.</p>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={onCreateChildProfile}
                      disabled={!canCreateChildProfile || creatingChild}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {creatingChild ? "Creating..." : "Create child profile"}
                    </button>
                  </div>
                </section>
              ) : null}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">
                    Profile details and edit controls
                  </p>
                  {hasAdminPower ? (
                    <div className="flex items-center gap-2">
                      {admin.isSuper ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: player?.is_archived ? "Restore Player" : "Archive Player",
                              description: player?.is_archived
                                ? "Are you sure you want to restore this player?"
                                : "Are you sure you want to archive this player?",
                              confirmLabel: player?.is_archived ? "Restore" : "Archive",
                              onConfirm: async () => {
                                await onArchiveToggle();
                                setConfirmModal(null);
                              },
                            })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
                        >
                          {player?.is_archived ? "Restore" : "Archive"}
                        </button>
                      ) : null}
                      {admin.isSuper ? (
                        <button
                          type="button"
                          onClick={() => setDeleteChoiceOpen(true)}
                          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-sm text-rose-800"
                        >
                          Delete profile
                        </button>
                      ) : null}
                      {admin.isSuper ? (
                        <button
                          type="button"
                          onClick={() => setEditingPlayer((v) => !v)}
                          className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1 text-sm text-teal-800"
                        >
                          {editingPlayer ? "Close editor" : "Edit player"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={onEditFullName}
                        disabled={savingName}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 disabled:opacity-60"
                      >
                        {savingName ? "Saving..." : player?.full_name ? "Edit name" : "Add name"}
                      </button>
                      {linkedEmail ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Unlink Account",
                              description: "Remove the linked user account from this player profile? This keeps the player record, results, and stats, and only removes the account link.",
                              confirmLabel: "Unlink account",
                              tone: "danger",
                              onConfirm: async () => {
                                await onUnlinkAccount();
                                setConfirmModal(null);
                              },
                            })
                          }
                          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-sm text-rose-800"
                        >
                          Unlink account
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {!admin.isSuper && player?.claimed_by === userId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          title: "Request profile deletion",
                          description:
                            "Submit a request to the Super User to delete your player profile? If match history exists, the profile may be archived instead.",
                          confirmLabel: "Submit Request",
                          tone: "danger",
                          onConfirm: async () => {
                            setDeleteDataChoiceOpen(true);
                            setConfirmModal(null);
                          },
                        })
                      }
                      className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-sm text-rose-800"
                    >
                      Request profile deletion
                    </button>
                  ) : null}
                </div>
                {admin.isSuper && editingPlayer ? (
                  <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Super User editor</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={editFullName}
                        onChange={(e) => setEditFullName(e.target.value)}
                        placeholder="Full name (or nickname for minors)"
                      />
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={editAgeBand}
                        onChange={(e) => {
                          const nextBand = e.target.value;
                          setEditAgeBand(nextBand);
                        }}
                      >
                        <option value="18_plus">18+</option>
                        <option value="under_18">Under 18s</option>
                      </select>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={editLocationId}
                        onChange={(e) => setEditLocationId(e.target.value)}
                      >
                        <option value="">Select location</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                      {editAgeBand !== "18_plus" ? (
                        <select
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={editGuardianUserId}
                          onChange={(e) => {
                            const nextUserId = e.target.value;
                            setEditGuardianUserId(nextUserId);
                            const nextUser = appUsers.find((u) => u.id === nextUserId) ?? null;
                            const linked = nextUser?.linked_player_id ? players.find((p) => p.id === nextUser.linked_player_id) : null;
                            const labelName = linked?.full_name?.trim() ? linked.full_name : linked?.display_name;
                            setEditGuardianName(labelName ?? "");
                            setEditGuardianEmail(nextUser?.email ?? "");
                          }}
                        >
                          <option value="">Select registered guardian</option>
                          {appUsers.map((u) => {
                            const linked = players.find((p) => p.id === u.linked_player_id);
                            const labelName = linked?.full_name?.trim() ? linked.full_name : linked?.display_name;
                            const label = labelName ? `${labelName} (${u.email ?? "no email"})` : u.email ?? u.id;
                            return (
                              <option key={u.id} value={u.id}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-500">Adult location is mandatory.</span>
                      )}
                    </div>
                    {editAgeBand !== "18_plus" ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={editGuardianName}
                          onChange={(e) => setEditGuardianName(e.target.value)}
                          placeholder="Guardian full name"
                        />
                        <input
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={editGuardianEmail}
                          onChange={(e) => setEditGuardianEmail(e.target.value)}
                          placeholder="Guardian email"
                          required={editAgeBand !== "18_plus"}
                          readOnly
                        />
                        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={editGuardianConsent}
                            onChange={(e) => setEditGuardianConsent(e.target.checked)}
                          />
                          Guardian consent confirmed
                        </label>
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={onSavePlayerEdits}
                        disabled={savingPlayer}
                        className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {savingPlayer ? "Saving..." : "Save Player"}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="text-slate-800">Location</span>
                  <span className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {player?.location_id ? locations.find((loc) => loc.id === player.location_id)?.name ?? "Assigned" : "Not set"}
                  </span>
                  <span className="text-xs text-slate-500">
                    Location changes are managed in Team Management → Transfer player.
                  </span>
                </div>
                {!hasAdminPower && userId && player?.claimed_by === userId ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Request profile update</p>
                    <p className="text-xs text-slate-600">Changes require administrator approval.</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        placeholder={requestAgeBand === "18_plus" ? "Full name" : "First name or nickname"}
                        value={requestName}
                        onChange={(e) => setRequestName(e.target.value)}
                      />
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={requestAgeBand}
                        onChange={(e) => setRequestAgeBand(e.target.value)}
                      >
                        <option value="18_plus">18+</option>
                        <option value="under_18">Under 18s</option>
                      </select>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={requestLocationId}
                        onChange={(e) => setRequestLocationId(e.target.value)}
                      >
                        <option value="">Select location</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                      {requestAgeBand !== "18_plus" ? (
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={requestGuardianConsent}
                            onChange={(e) => setRequestGuardianConsent(e.target.checked)}
                          />
                          Guardian consent confirmed
                        </label>
                      ) : (
                        <span className="text-xs text-slate-500">Location required for all profiles.</span>
                      )}
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={onRequestUpdate}
                        disabled={requesting}
                        className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {requesting ? "Submitting..." : "Submit update request"}
                      </button>
                    </div>
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="text-sm font-semibold text-slate-900">Request club admin access</p>
                      <p className="text-xs text-slate-600">
                        Club admins run competitions, review results, and manage player activity for their club. Requests are reviewed by the Super User.
                      </p>
                      {pendingAdminRequest ? (
                        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Club admin request pending since{" "}
                          {new Date(pendingAdminRequest.created_at).toLocaleString()}.
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={onRequestAdminAccess}
                        disabled={Boolean(pendingAdminRequest) || adminRequesting}
                        className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingAdminRequest ? "Request pending" : adminRequesting ? "Submitting..." : "Request club admin access"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">Discipline Breakdown</h2>
                <p className="mt-1 text-sm text-slate-600">How this player is performing across snooker and pool disciplines.</p>
                {disciplineBreakdown.length === 0 ? (
                  <p className="mt-3 text-slate-600">No discipline data yet.</p>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {disciplineBreakdown.map((row) => (
                      <div key={row.label} className={disciplineCardClass(row.label)}>
                        <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                        <p className="mt-2 text-sm text-slate-800">
                          Played {row.played} · Won {row.won} · Win% {pct(row.won, row.played)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Frames: {row.framesFor} for · {row.framesAgainst} against
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">Profile Highlights</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Favorite discipline</p>
                    <p className="mt-2 text-sm text-slate-800">
                      {favoriteDiscipline ? favoriteDiscipline.label : "Not enough data yet"}
                    </p>
                    {favoriteDiscipline ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Most played: {favoriteDiscipline.played} matches
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Last 30 days</p>
                    <p className="mt-2 text-sm text-slate-800">
                      Played {seasonSummary.played} · Won {seasonSummary.won}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Win% {pct(seasonSummary.won, seasonSummary.played)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-rose-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Achievements</p>
                    {achievements.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {achievements.map((item) => (
                          <span key={item} className={achievementClass(item)}>
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">More results are needed to unlock achievements.</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">Recognition badges</p>
                  {recognitionBadges.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {recognitionBadges.map((item) => (
                        <span key={item} className={recognitionClass(item)}>
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">Recognition badges will appear as this profile builds up activity.</p>
                  )}
                </div>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Competition entries</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Approved: {approvedCompetitionEntryCount} · Pending: {pendingCompetitionEntryCount}
                      </p>
                    </div>
                    {playerCompetitionEntries.length ? (
                      <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800">
                        {playerCompetitionEntries.length} active entr{playerCompetitionEntries.length === 1 ? "y" : "ies"}
                      </span>
                    ) : null}
                  </div>
                  {playerCompetitionEntries.length ? (
                    <div className="mt-3 space-y-2">
                      {playerCompetitionEntries.slice(0, 5).map(({ entry, competition }) => (
                        <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {competition?.name?.trim()
                                ? competition.name
                                : competition
                                  ? `${competitionSportLabel(competition.sport_type)} ${competition.competition_format}`
                                  : "Competition entry"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {entry.created_at ? `Entered ${new Date(entry.created_at).toLocaleString()}` : "Entry recorded"}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              entry.status === "approved"
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border border-amber-200 bg-amber-50 text-amber-900"
                            }`}
                          >
                            {entry.status === "approved" ? "Approved" : "Pending"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">No competition entries recorded yet.</p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowOpponents((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <h2 className="text-xl font-semibold text-slate-900">Vs Opponents (Singles)</h2>
                  <span className="text-sm text-slate-600">{showOpponents ? "Hide" : "Show"}</span>
                </button>
                {showOpponents ? (
                  <>
                    {enhancedOpponents.length === 0 ? <p className="mt-2 text-slate-600">No singles head-to-head data yet.</p> : null}
                    <div className="mt-2 space-y-2">
                      {enhancedOpponents.map((o) => (
                        <div key={o.opponentId} className="rounded-lg border border-slate-200 px-3 py-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-slate-900">{o.opponent}</p>
                              <p className="text-slate-700">P {o.played} · W {o.won} · L {o.lost} · Diff {o.frameDiff > 0 ? "+" : ""}{o.frameDiff}</p>
                            </div>
                            {o.recent.length ? (
                              <div className="flex gap-1">
                                {o.recent.map((item) => (
                                  <span
                                    key={item.key}
                                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                                      item.result === "W" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                                    }`}
                                  >
                                    {item.result}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowHistory((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <h2 className="text-xl font-semibold text-slate-900">Recent History</h2>
                  <span className="text-sm text-slate-600">{showHistory ? "Hide" : "Show"}</span>
                </button>
                {showHistory ? (
                  <>
                    {recentHistory.length === 0 ? (
                      <p className="mt-2 text-slate-600">No completed history yet.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {recentHistory.map((h) => (
                          <div key={h.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                            <div>
                              <p className="font-medium text-slate-900">{h.label}</p>
                              <p className="text-xs font-medium text-slate-600">{h.sublabel}</p>
                              <p className="text-xs text-slate-500">{h.date ? new Date(h.date).toLocaleDateString() : "Date not set"}</p>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${h.result === "W" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                              {h.result}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : null}
              </section>
            </>
          ) : null}
        </RequireAuth>
        <InfoModal
          open={Boolean(infoModal)}
          title={infoModal?.title ?? ""}
          description={infoModal?.description ?? ""}
          onClose={() => setInfoModal(null)}
        />
        <ConfirmModal
          open={Boolean(confirmModal)}
          title={confirmModal?.title ?? ""}
          description={confirmModal?.description ?? ""}
          confirmLabel={confirmModal?.confirmLabel ?? "Confirm"}
          tone={confirmModal?.tone ?? "default"}
          onCancel={() => setConfirmModal(null)}
          onConfirm={() => confirmModal?.onConfirm()}
        />
        <ConfirmModal
          open={deleteDataChoiceOpen}
          title="Delete Personal Data Too?"
          description="If selected, we will remove personal profile data where possible. If match history exists, match outcomes are retained for opponents and your profile will be anonymized and archived."
          confirmLabel="Yes, delete personal data"
          cancelLabel="No, keep match-linked data"
          onCancel={async () => {
            setDeleteDataChoiceOpen(false);
            await onRequestDeleteProfile(false);
          }}
          onConfirm={async () => {
            setDeleteDataChoiceOpen(false);
            await onRequestDeleteProfile(true);
          }}
        />
        {deleteChoiceOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-900">Delete Player Profile</h2>
              <p className="mt-2 text-sm text-slate-700">
                Choose how to remove this profile. Archiving keeps historical stats. Permanent delete removes the profile
                and unlinks any account.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteChoiceOpen(false)}
                  disabled={Boolean(deleteActionBusy)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onArchivePlayerNow}
                  disabled={Boolean(deleteActionBusy)}
                  className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {deleteActionBusy === "archive" ? "Archiving..." : "Archive profile"}
                </button>
                <button
                  type="button"
                  onClick={onDeletePlayerNow}
                  disabled={Boolean(deleteActionBusy)}
                  className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {deleteActionBusy === "delete" ? "Deleting..." : "Delete permanently"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
