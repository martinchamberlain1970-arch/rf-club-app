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
};
type AppUser = { id: string; email: string | null; linked_player_id?: string | null };
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
type Competition = { id: string; sport_type: "snooker" | "pool_8_ball" | "pool_9_ball"; competition_format: "knockout" | "league" };
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
        const [authRes, pRes, allPlayersRes, mRes, cRes, fRes, locRes, pendingRes, usersRes, pendingDeleteRes, lfRes, ltRes, lfrRes] = await Promise.all([
          client.auth.getUser(),
          client
            .from("players")
            .select(
              "id,display_name,full_name,avatar_url,is_archived,claimed_by,location_id,age_band,guardian_consent,guardian_name,guardian_email,guardian_user_id,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker"
            )
            .eq("id", id)
            .maybeSingle(),
          client
            .from("players")
            .select(
              "id,display_name,full_name,avatar_url,location_id,age_band,guardian_consent,guardian_user_id,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker"
            )
            .eq("is_archived", false),
          client.from("matches").select("id,competition_id,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,status,updated_at"),
          client.from("competitions").select("id,sport_type,competition_format"),
          client.from("frames").select("match_id,winner_player_id,is_walkover_award"),
          client.from("locations").select("id,name").order("name"),
          client.from("player_update_requests").select("id,created_at").eq("player_id", id).eq("status", "pending").order("created_at", { ascending: false }).limit(1),
          client.from("app_users").select("id,email,linked_player_id"),
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
        const loadedPlayer = (pRes.data as Player & { claimed_by?: string | null }) ?? null;
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
        setPlayers((allPlayersRes.data ?? []) as Player[]);
        if (!usersRes.error && usersRes.data) setAppUsers(usersRes.data as AppUser[]);
        setMatches((mRes.error ? [] : (mRes.data ?? [])) as MatchRow[]);
        setCompetitions((cRes.error ? [] : (cRes.data ?? [])) as Competition[]);
        setFrames((fRes.error ? [] : (fRes.data ?? [])) as Frame[]);
        setLeagueFixtures((lfRes.error ? [] : (lfRes.data ?? [])) as LeagueFixtureLite[]);
        setLeagueTeams((ltRes.error ? [] : (ltRes.data ?? [])) as LeagueTeamLite[]);
        setLeagueFrames((lfrRes.error ? [] : (lfrRes.data ?? [])) as LeagueFrameLite[]);
        if (!locRes.error && locRes.data) {
          setLocations(locRes.data as Location[]);
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
  const rankingCard = useMemo(() => {
    if (!player) return null;
    const bySnooker = [...players].sort((a, b) => (b.rating_snooker ?? 1000) - (a.rating_snooker ?? 1000));
    const snookerRank = Math.max(1, bySnooker.findIndex((p) => p.id === player.id) + 1);
    return {
      snookerRank,
      snookerRating: player.rating_snooker ?? 1000,
      snookerPeak: player.peak_rating_snooker ?? 1000,
      snookerMatches: player.rated_matches_snooker ?? 0,
      totalPlayers: players.length,
    };
  }, [player, players]);
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
      .map(([oppId, s]) => ({ opponent: nameMap.get(oppId) ?? "Unknown", ...s }))
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
      .map(([oppId, s]) => ({ opponent: nameMap.get(oppId) ?? "Unknown", ...s }))
      .sort((a, b) => b.played - a.played || a.opponent.localeCompare(b.opponent));
  }, [leagueRelevant, id, nameMap]);
  const effectiveOpponents = opponents.length > 0 ? opponents : leagueOpponents;
  const leagueHistory = useMemo(() => {
    return leagueRelevant
      .map((s) => {
        const fixture = leagueFixtureById.get(s.fixture_id);
        if (!fixture) return null;
        const homeTeam = leagueTeamById.get(fixture.home_team_id) ?? "Home";
        const awayTeam = leagueTeamById.get(fixture.away_team_id) ?? "Away";
        const inHome = s.home_player1_id === id || s.home_player2_id === id;
        const result = (inHome && s.winner_side === "home") || (!inHome && s.winner_side === "away") ? "W" : "L";
        return {
          key: `${s.fixture_id}-${s.slot_no}`,
          date: fixture.fixture_date,
          label: `Week ${fixture.week_no ?? "?"} · ${homeTeam} vs ${awayTeam} · ${s.slot_type} ${s.slot_no}`,
          result,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Date.parse(b?.date ?? "0") - Date.parse(a?.date ?? "0"))
      .slice(0, 20) as { key: string; date: string | null; label: string; result: "W" | "L" }[];
  }, [leagueRelevant, leagueFixtureById, leagueTeamById, id]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title={playerName}
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
                <section ref={profileRef} className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="h-20 w-20 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                    {player.avatar_url ? (
                      <img src={player.avatar_url} alt={playerName} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-slate-900">{playerName}</p>
                    {linkedEmail ? <p className="text-sm text-slate-600">{linkedEmail}</p> : null}
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
                    <p className="text-sm text-slate-600">
                      Age band:{" "}
                      {player?.age_band === "under_13"
                        ? "Under 13"
                        : player?.age_band === "under_18"
                          ? "Under 18s"
                        : player?.age_band === "13_15"
                          ? "13–15"
                          : player?.age_band === "16_17"
                            ? "16–17"
                            : "18+"}
                      {player?.age_band && player.age_band !== "18_plus" ? (
                        <span className="ml-2 text-xs text-slate-500">{player.guardian_consent ? "Guardian consent on file" : "Guardian consent pending"}</span>
                      ) : null}
                    </p>
                    {player?.location_id ? (
                      <p className="text-sm text-slate-600">
                        Location: {locations.find((l) => l.id === player.location_id)?.name ?? "Assigned"}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-500">Location: Not set</p>
                    )}
                    <p className="text-sm text-slate-500">Handicap details are not available in this profile view.</p>
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
                </section>
              ) : null}
              {rankingCard ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">Player ranking</h2>
                    <button
                      type="button"
                      onClick={() => window.open(`/display/ranking/${id}`, "_blank", "noopener,noreferrer,width=900,height=600")}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Open display card
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Current rating and rank against other active players.</p>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">How ranking is calculated</p>
                    <p className="mt-1">
                      Ratings use an Elo-style model. Expected result is based on current ratings, then updated when approved matches complete.
                      Upsets move ratings more than expected wins. K-factor is higher for newer players and lower for experienced players.
                    </p>
                    <p className="mt-1">BYE and walkover outcomes are excluded from ratings.</p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-1">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Snooker Rating</p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">{Math.round(rankingCard.snookerRating)}</p>
                      <p className="text-sm text-slate-600">Rank #{rankingCard.snookerRank} of {rankingCard.totalPlayers}</p>
                      <p className="text-xs text-slate-500">Peak {Math.round(rankingCard.snookerPeak)} · Rated matches {rankingCard.snookerMatches}</p>
                    </div>
                  </div>
                </section>
              ) : null}
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
                  <p className="text-slate-800">
                    Full name: <span className="font-medium text-slate-900">{player?.full_name ?? "Not set"}</span>
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
                        <option value="16_17">16–17</option>
                        <option value="13_15">13–15</option>
                        <option value="under_13">Under 13</option>
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
                        <option value="16_17">16–17</option>
                        <option value="13_15">13–15</option>
                        <option value="under_13">Under 13</option>
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Overall summary</p>
                    <p className="mt-2 text-slate-800">
                      Matches/Frames: {effectiveSummary.played} · Won: {effectiveSummary.won} · Lost: {effectiveSummary.lost} · Win%: {pct(effectiveSummary.won, effectiveSummary.played)}%
                    </p>
                    <p className="mt-1 text-slate-800">
                      Frames: For {effectiveSummary.framesFor} · Against {effectiveSummary.framesAgainst}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">Discipline Breakdown</h2>
                <p className="mt-1 text-sm text-slate-600">How this player is performing across snooker and pool disciplines.</p>
                {disciplineBreakdown.length === 0 ? (
                  <p className="mt-3 text-slate-600">No discipline data yet.</p>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {disciplineBreakdown.map((row) => (
                      <div key={row.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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
                <h2 className="text-xl font-semibold text-slate-900">Vs Opponents (Singles)</h2>
                {effectiveOpponents.length === 0 ? <p className="mt-2 text-slate-600">No singles head-to-head data yet.</p> : null}
                <div className="mt-2 space-y-2">
                  {effectiveOpponents.map((o) => (
                    <div key={o.opponent} className="rounded-lg border border-slate-200 px-3 py-2">
                      <p className="font-medium text-slate-900">{o.opponent}</p>
                      <p className="text-slate-700">P {o.played} · W {o.won} · L {o.lost}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-xl font-semibold text-slate-900">Recent History</h2>
                {leagueHistory.length === 0 ? (
                  <p className="mt-2 text-slate-600">No completed history yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {leagueHistory.map((h) => (
                      <div key={h.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                        <div>
                          <p className="font-medium text-slate-900">{h.label}</p>
                          <p className="text-xs text-slate-500">{h.date ? new Date(h.date).toLocaleDateString() : "Date not set"}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${h.result === "W" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                          {h.result}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
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
