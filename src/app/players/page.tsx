"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  is_archived: boolean;
  claimed_by: string | null;
  location_id?: string | null;
  age_band?: string | null;
  guardian_consent?: boolean | null;
  guardian_user_id?: string | null;
};

type ClaimRequest = {
  id: string;
  player_id: string;
  requester_user_id: string;
  requested_full_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};
type PlayerUpdateRequest = {
  id: string;
  player_id: string;
  requester_user_id: string;
  requested_full_name: string | null;
  requested_location_id: string | null;
  requested_avatar_url?: string | null;
  requested_age_band?: string | null;
  requested_guardian_consent?: boolean | null;
  requested_guardian_name?: string | null;
  requested_guardian_email?: string | null;
  requested_guardian_user_id?: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};
type PremiumRequest = {
  id: string;
  requester_user_id: string;
  status: "pending" | "approved" | "rejected";
  admin_approved?: boolean | null;
  guardian_consent?: boolean | null;
  approved_by_admin_at?: string | null;
  approved_by_super_at?: string | null;
  created_at: string;
};
type AdminRequest = {
  id: string;
  requester_user_id: string;
  target_admin_user_id: string;
  location_id: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};
type LocationRequest = {
  id: string;
  requester_user_id: string | null;
  requester_email: string;
  requester_full_name: string;
  requested_location_name: string;
  target_super_user_id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};
type ProfileMergeRequest = {
  id: string;
  requester_user_id: string;
  target_player_id: string;
  requested_display_name: string;
  requested_full_name: string;
  requested_age_band: string;
  requested_location_id: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};
type PlayerDeletionRequest = {
  id: string;
  player_id: string;
  requester_user_id: string;
  delete_all_data: boolean;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

type PlayerTab = "register" | "profiles" | "claims" | "archived";
type AppUser = {
  id: string;
  email: string | null;
  linked_player_id: string | null;
  created_at: string;
  role?: string | null;
  premium_unlocked?: boolean | null;
  quick_match_enabled?: boolean | null;
  competition_create_enabled?: boolean | null;
};
type Location = { id: string; name: string };

export default function PlayersPage() {
  const admin = useAdminStatus();
  const [players, setPlayers] = useState<Player[]>([]);
  const [claims, setClaims] = useState<ClaimRequest[]>([]);
  const [updateRequests, setUpdateRequests] = useState<PlayerUpdateRequest[]>([]);
  const [premiumRequests, setPremiumRequests] = useState<PremiumRequest[]>([]);
  const [adminRequests, setAdminRequests] = useState<AdminRequest[]>([]);
  const [locationRequests, setLocationRequests] = useState<LocationRequest[]>([]);
  const [mergeRequests, setMergeRequests] = useState<ProfileMergeRequest[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<PlayerDeletionRequest[]>([]);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [newLocationId, setNewLocationId] = useState("");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignPlayerId, setAssignPlayerId] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newSecondName, setNewSecondName] = useState("");
  const [infoModal, setInfoModal] = useState<{ title: string; body: string } | null>(null);
  const [mergePrompt, setMergePrompt] = useState<{
    targetPlayerId: string;
    displayName: string;
    fullName: string;
    ageBand: string;
    locationId: string | null;
  } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    body: string;
    confirmLabel?: string;
    tone?: "default" | "danger";
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [claimFirstName, setClaimFirstName] = useState("");
  const [claimSecondName, setClaimSecondName] = useState("");
  const [tab, setTab] = useState<PlayerTab>("register");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "super" | "admin" | "user">("all");
  const [premiumFilter, setPremiumFilter] = useState<"all" | "premium" | "free">("all");
  const [profileLocationFilter, setProfileLocationFilter] = useState("all");
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const isSuperAdmin = Boolean(superAdminEmail && userEmail && userEmail.toLowerCase() === superAdminEmail);
  const isStandardUser = !admin.isAdmin && !isSuperAdmin;
  const canRegisterPlayers = admin.isAdmin || isSuperAdmin;
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillActiveClass = `${pillBaseClass} border-teal-700 bg-teal-700 text-white`;
  const pillInactiveClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const buttonPrimaryClass = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800";
  const buttonSuccessSmClass = "rounded-lg bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-800";
  const buttonSuccessClass = "rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";
  const buttonSecondarySmClass = "rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50";
  const buttonSecondaryClass = "rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50";
  const buttonDangerOutlineSmClass = "rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50";

  const activePlayers = useMemo(() => players.filter((p) => !p.is_archived), [players]);
  const archivedPlayers = useMemo(() => players.filter((p) => p.is_archived), [players]);
  const unclaimedPlayers = useMemo(() => activePlayers.filter((p) => !p.claimed_by), [activePlayers]);
  const unclaimedAdultPlayers = useMemo(
    () => unclaimedPlayers.filter((p) => (p.age_band ?? "18_plus") === "18_plus"),
    [unclaimedPlayers]
  );
  const hasClaimedProfile = useMemo(() => Boolean(userId && players.some((p) => p.claimed_by === userId)), [players, userId]);
  const unlinkedUsers = useMemo(
    () =>
      appUsers.filter((u) => {
        if (u.linked_player_id) return false;
        const email = (u.email ?? "").toLowerCase();
        const role = (u.role ?? "").toLowerCase();
        if (superAdminEmail && email === superAdminEmail) return false;
        if (role === "owner" || role === "super") return false;
        return true;
      }),
    [appUsers, superAdminEmail]
  );
  const locationById = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach((loc) => map.set(loc.id, loc.name));
    return map;
  }, [locations]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const appUserById = useMemo(() => new Map(appUsers.map((u) => [u.id, u])), [appUsers]);
  const filteredRoleUsers = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    return appUsers.filter((u) => {
      const isSuper = Boolean(u.email && u.email.toLowerCase() === superAdminEmail);
      const role = (u.role ?? "user").toLowerCase();
      const rolePass =
        roleFilter === "all" ||
        (roleFilter === "super" && isSuper) ||
        (roleFilter === "admin" && !isSuper && role === "admin") ||
        (roleFilter === "user" && !isSuper && role !== "admin");
      const premiumPass =
        premiumFilter === "all" ||
        (premiumFilter === "premium" && Boolean(u.premium_unlocked)) ||
        (premiumFilter === "free" && !u.premium_unlocked);
      if (!rolePass || !premiumPass) return false;
      if (!q) return true;
      const linked = players.find((p) => p.id === u.linked_player_id);
      const linkedName = linked?.full_name?.trim() ? linked.full_name : linked?.display_name ?? "";
      const haystack = `${linkedName} ${u.email ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [appUsers, roleSearch, roleFilter, premiumFilter, superAdminEmail, players]);
  const filteredActivePlayers = useMemo(() => {
    if (profileLocationFilter === "all") return activePlayers;
    if (profileLocationFilter === "__none") return activePlayers.filter((p) => !p.location_id);
    return activePlayers.filter((p) => p.location_id === profileLocationFilter);
  }, [activePlayers, profileLocationFilter]);
  const loadPlayers = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured. Add env values in .env.local first.");
      return;
    }
    setLoading(true);
    const { data, error } = await client
      .from("players")
      .select("id,display_name,full_name,is_archived,claimed_by,location_id,age_band,guardian_consent,guardian_user_id")
      .order("display_name", { ascending: true });
    setLoading(false);
    if (error || !data) {
      setMessage(`Failed to load players: ${error?.message ?? "Unknown error"}`);
      return;
    }
    setPlayers(data as Player[]);
  };

  const loadClaims = async () => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client
      .from("player_claim_requests")
      .select("id,player_id,requester_user_id,requested_full_name,status,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return;
    setClaims(data as ClaimRequest[]);
  };

  const loadUpdateRequests = async () => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client
      .from("player_update_requests")
      .select("id,player_id,requester_user_id,requested_full_name,requested_location_id,requested_avatar_url,requested_age_band,requested_guardian_consent,requested_guardian_name,requested_guardian_email,requested_guardian_user_id,status,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return;
    setUpdateRequests(data as PlayerUpdateRequest[]);
  };

  const loadPremiumRequests = async () => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client
      .from("premium_requests")
      .select("id,requester_user_id,status,admin_approved,guardian_consent,approved_by_admin_at,approved_by_super_at,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return;
    setPremiumRequests(data as PremiumRequest[]);
  };

  const loadAdminRequests = async () => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client
      .from("admin_requests")
      .select("id,requester_user_id,target_admin_user_id,location_id,status,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return;
    setAdminRequests(data as AdminRequest[]);
  };

  const loadLocationRequests = async () => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client
      .from("location_requests")
      .select("id,requester_user_id,requester_email,requester_full_name,requested_location_name,target_super_user_id,status,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return;
    setLocationRequests(data as LocationRequest[]);
  };

  const loadMergeRequests = async () => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client
      .from("profile_merge_requests")
      .select("id,requester_user_id,target_player_id,requested_display_name,requested_full_name,requested_age_band,requested_location_id,status,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return;
    setMergeRequests(data as ProfileMergeRequest[]);
  };

  const loadUsers = async () => {
    const client = supabase;
    if (!client) return;
    const withRole = await client
      .from("app_users")
      .select("id,email,linked_player_id,created_at,role,premium_unlocked,quick_match_enabled,competition_create_enabled")
      .order("created_at", { ascending: false });
    if (!withRole.error && withRole.data) {
      setAppUsers(withRole.data as AppUser[]);
      return;
    }
    const { data, error } = await client
      .from("app_users")
      .select("id,email,linked_player_id,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return;
    setAppUsers(data as AppUser[]);
  };

  const loadDeletionRequests = async () => {
    const client = supabase;
    if (!client) return;
    const withFlag = await client
      .from("player_deletion_requests")
      .select("id,player_id,requester_user_id,delete_all_data,status,created_at")
      .order("created_at", { ascending: false });
    if (!withFlag.error && withFlag.data) {
      setDeletionRequests(withFlag.data as PlayerDeletionRequest[]);
      return;
    }
    const fallback = await client
      .from("player_deletion_requests")
      .select("id,player_id,requester_user_id,status,created_at")
      .order("created_at", { ascending: false });
    if (fallback.error || !fallback.data) return;
    setDeletionRequests((fallback.data as PlayerDeletionRequest[]).map((r) => ({ ...r, delete_all_data: false })));
  };

  const loadLocations = async () => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client.from("locations").select("id,name").order("name");
    if (error || !data) return;
    setLocations(data as Location[]);
  };

  useEffect(() => {
    const run = async () => {
      const client = supabase;
      if (client) {
        const { data } = await client.auth.getUser();
        setUserId(data.user?.id ?? null);
        setUserEmail(data.user?.email ?? null);
      }
      await loadPlayers();
      await loadClaims();
      await loadUpdateRequests();
      await loadPremiumRequests();
      await loadAdminRequests();
      await loadLocationRequests();
      await loadMergeRequests();
      await loadDeletionRequests();
      await loadUsers();
      await loadLocations();
    };
    run();
  }, []);

  const visibleTab: PlayerTab = isStandardUser ? "register" : tab;

  const onRegister = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const firstName = newFirstName.trim();
    const secondName = newSecondName.trim();
    if (!firstName) {
      setMessage("Enter first name.");
      return;
    }
    if (!secondName) {
      setMessage("Enter a second name for adult profiles.");
      return;
    }
    if (!newLocationId) {
      setMessage("Select a location.");
      return;
    }
    const displayName = firstName;
    const fullName = `${firstName} ${secondName}`;
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }

    setSaving(true);
    const { error } = await client.from("players").insert({
      display_name: displayName,
      first_name: firstName,
      nickname: null,
      full_name: fullName,
      is_archived: false,
      location_id: newLocationId,
      age_band: "18_plus",
      guardian_consent: false,
      guardian_consent_at: null,
      guardian_user_id: null,
      guardian_email: null,
    });
    setSaving(false);

    if (error) {
      if (error.message.includes("players_display_name_lower_uniq")) {
        const existing = players.find((p) => p.display_name.toLowerCase() === displayName.toLowerCase());
        if (existing) {
          if (existing.is_archived) {
            setConfirmModal({
              title: "Archived Profile Found",
              body: `A previously archived profile exists for "${existing.full_name ?? existing.display_name}". Do you want to restore it instead of creating a duplicate?`,
              confirmLabel: "Restore Profile",
              onConfirm: async () => {
                const restorePayload: Record<string, string | boolean | null> = {
                  is_archived: false,
                  claimed_by: null,
                };
                if (!existing.location_id && newLocationId) restorePayload.location_id = newLocationId;
                if (!existing.full_name?.trim()) restorePayload.full_name = fullName;
                const restoreRes = await client.from("players").update(restorePayload).eq("id", existing.id);
                if (restoreRes.error) {
                  setMessage(`Failed to restore archived profile: ${restoreRes.error.message}`);
                } else {
                  setMessage(null);
                  setInfoModal({
                    title: "Profile Restored",
                    body: `Archived profile "${existing.full_name ?? existing.display_name}" was restored. You can now link it to a user account if required.`,
                  });
                  setNewFirstName("");
                  setNewSecondName("");
                  setNewLocationId("");
                  await loadPlayers();
                }
                setConfirmModal(null);
              },
            });
            return;
          }
          setMergePrompt({
            targetPlayerId: existing.id,
            displayName,
            fullName,
            ageBand: "18_plus",
            locationId: newLocationId || null,
          });
          return;
        }
        setMessage("Duplicate detected but existing profile could not be resolved.");
        return;
      }
      setMessage(`Failed to register player: ${error.message}`);
      return;
    }

    setNewFirstName("");
    setNewSecondName("");
    setNewLocationId("");
    setMessage(null);
    setInfoModal({
      title: "Player registered",
      body: "Player profile registered successfully.",
    });
    await loadPlayers();
  };

  const onSubmitMergeRequest = async () => {
    if (!mergePrompt) return;
    const client = supabase;
    if (!client || !userId) {
      setMessage("Unable to submit merge request: no signed-in user.");
      setMergePrompt(null);
      return;
    }
    const mergeRes = await client.from("profile_merge_requests").insert({
      requester_user_id: userId,
      target_player_id: mergePrompt.targetPlayerId,
      requested_display_name: mergePrompt.displayName,
      requested_full_name: mergePrompt.fullName,
      requested_age_band: mergePrompt.ageBand,
      requested_location_id: mergePrompt.locationId,
      status: "pending",
    });
    if (mergeRes.error) {
      setMessage(`Failed to submit merge request: ${mergeRes.error.message}`);
      setMergePrompt(null);
      return;
    }
    setMergePrompt(null);
    setMessage("Merge request submitted for Super User review.");
    setInfoModal({
      title: "Merge Request Submitted",
      body: `A duplicate profile appears to exist for "${mergePrompt.displayName}". Your merge request has been sent to the Super User for review.`,
    });
    await loadMergeRequests();
  };

  const onReviewMergeRequest = async (req: ProfileMergeRequest, approve: boolean) => {
    const client = supabase;
    if (!client || !isSuperAdmin || !userId) return;
    const { error } = await client
      .from("profile_merge_requests")
      .update({
        status: approve ? "approved" : "rejected",
        reviewed_by_user_id: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", req.id);
    if (error) {
      setMessage(`Failed to review merge request: ${error.message}`);
      return;
    }
    setMessage(approve ? "Merge request approved." : "Merge request rejected.");
    await loadMergeRequests();
  };

  const playerHasMatchHistory = async (playerId: string) => {
    const client = supabase;
    if (!client) return false;
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
    if (error) return true;
    return (count ?? 0) > 0;
  };

  const deleteLinkedUserAccount = async (
    targetUserId: string,
    options?: { reason?: string; context?: Record<string, unknown> }
  ) => {
    const client = supabase;
    if (!client) return { ok: false as const, message: "Supabase is not configured." };
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) return { ok: false as const, message: "You must be signed in." };

    const resp = await fetch("/api/admin/user-delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: targetUserId,
        reason: options?.reason ?? null,
        context: options?.context ?? null,
      }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return { ok: false as const, message: data?.error ?? "Failed to delete linked user account." };
    }
    return { ok: true as const };
  };

  const deletePlayerWithSafety = async (playerId: string, options?: { deleteAllData?: boolean }) => {
    const client = supabase;
    if (!client) return { ok: false, message: "Supabase is not configured." };

    const linkedUsersRes = await client.from("app_users").select("id,email,role").eq("linked_player_id", playerId);
    if (linkedUsersRes.error) {
      return { ok: false, message: `Failed to load linked user account: ${linkedUsersRes.error.message}` };
    }
    const linkedUsers = linkedUsersRes.data ?? [];
    const ownerLinkedUser = linkedUsers.find((u) => (u.role ?? "").toLowerCase() === "owner");

    const ownerLinked = await client
      .from("app_users")
      .select("id")
      .eq("linked_player_id", playerId)
      .eq("role", "owner")
      .maybeSingle();
    if (ownerLinked.data?.id || ownerLinkedUser?.id) {
      return { ok: false, message: "This profile is linked to the Super User account and cannot be deleted." };
    }

    const playerRes = await client.from("players").select("claimed_by").eq("id", playerId).maybeSingle();
    if (playerRes.error) {
      return { ok: false, message: `Failed to read player profile: ${playerRes.error.message}` };
    }
    const claimedByUserId = playerRes.data?.claimed_by ?? null;

    const hasHistory = await playerHasMatchHistory(playerId);
    if (hasHistory) {
      const deleteAllData = Boolean(options?.deleteAllData);
      const archivePayload: Record<string, string | boolean | null> = deleteAllData
        ? {
            is_archived: true,
            claimed_by: null,
            full_name: null,
            display_name: `Deleted Player ${String(playerId).slice(0, 6)}`,
            first_name: null,
            nickname: null,
            avatar_url: null,
            guardian_name: null,
            guardian_email: null,
            guardian_user_id: null,
            guardian_consent: false,
            location_id: null,
          }
        : { is_archived: true, claimed_by: null };
      const archiveRes = await client.from("players").update(archivePayload).eq("id", playerId).select("id").maybeSingle();
      if (archiveRes.error) return { ok: false, message: `Failed to archive profile: ${archiveRes.error.message}` };
      if (!archiveRes.data) return { ok: false, message: "Failed to archive profile: no profile was updated." };
      return {
        ok: true,
        archived: true,
        message: deleteAllData
          ? "Player has match history, so full deletion is not possible. Personal profile data was anonymized and archived; match outcomes are retained for opponent records."
          : "Player has match history. Profile was archived instead of deleted.",
        linkedUserIds: Array.from(
          new Set([...(linkedUsers.map((u) => u.id)), ...(claimedByUserId ? [claimedByUserId] : [])])
        ),
      };
    }

    const unlinkRes = await client.from("app_users").update({ linked_player_id: null }).eq("linked_player_id", playerId);
    if (unlinkRes.error) return { ok: false, message: `Failed to unlink account: ${unlinkRes.error.message}` };
    const delRes = await client.from("players").delete().eq("id", playerId).select("id").maybeSingle();
    if (delRes.error) return { ok: false, message: `Failed to delete player: ${delRes.error.message}` };
    if (!delRes.data) return { ok: false, message: "Failed to delete player: no profile was deleted." };
    return {
      ok: true,
      archived: false,
      message: "Player profile deleted permanently.",
      linkedUserIds: Array.from(
        new Set([...(linkedUsers.map((u) => u.id)), ...(claimedByUserId ? [claimedByUserId] : [])])
      ),
    };
  };

  const onReviewDeletionRequest = async (req: PlayerDeletionRequest, approve: boolean) => {
    const client = supabase;
    if (!client || !isSuperAdmin || !userId) {
      setMessage("Only the Super User can review deletion requests.");
      return;
    }

    if (!approve) {
      const rejectRes = await client
        .from("player_deletion_requests")
        .update({ status: "rejected", reviewed_by_user_id: userId, reviewed_at: new Date().toISOString() })
        .eq("id", req.id)
        .eq("status", "pending");
      if (rejectRes.error) {
        setMessage(`Failed to reject deletion request: ${rejectRes.error.message}`);
        return;
      }
      setMessage("Deletion request rejected.");
      await loadDeletionRequests();
      return;
    }

    const outcome = await deletePlayerWithSafety(req.player_id, { deleteAllData: req.delete_all_data });
    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }
    const approveRes = await client
      .from("player_deletion_requests")
      .update({ status: "approved", reviewed_by_user_id: userId, reviewed_at: new Date().toISOString() })
      .eq("id", req.id)
      .eq("status", "pending");
    if (approveRes.error) {
      setMessage(`Profile updated, but request status failed: ${approveRes.error.message}`);
    } else {
      const linkedUserIds = Array.from(new Set([...(outcome.linkedUserIds ?? []), req.requester_user_id]));
      for (const linkedUserId of linkedUserIds) {
        const deleteUserRes = await deleteLinkedUserAccount(linkedUserId, {
          reason: "profile_deletion_approved",
          context: { playerId: req.player_id, deletionRequestId: req.id },
        });
        if (!deleteUserRes.ok) {
          setMessage(null);
          setInfoModal({
            title: "Linked Login Not Deleted",
            body: `Profile updated, but linked login was not deleted: ${deleteUserRes.message}`,
          });
          await loadPlayers();
          await loadUsers();
          await loadDeletionRequests();
          return;
        }
      }
      setMessage(null);
      setInfoModal({
        title: outcome.archived ? "Profile Archived" : "Profile Deleted",
        body: outcome.message,
      });
    }
    await loadPlayers();
    await loadUsers();
    await loadDeletionRequests();
  };

  const onRequestClaim = async (player: Player) => {
    const client = supabase;
    if (!client || !userId) return;
    const fullName = window.prompt(`Confirm your first and second name for claiming "${player.display_name}"`, player.full_name ?? "");
    if (!fullName || !fullName.trim()) return;
    const { error } = await client.from("player_claim_requests").insert({
      player_id: player.id,
      requester_user_id: userId,
      requested_full_name: fullName.trim(),
      status: "pending",
    });
    if (error) {
      setMessage(`Failed to submit claim: ${error.message}`);
      return;
    }
    setMessage("Claim request submitted for review.");
    await loadClaims();
  };

  const onCreateProfileClaim = async () => {
    const client = supabase;
    if (!client || !userId) return;
    const firstName = claimFirstName.trim();
    const secondName = claimSecondName.trim();
    if (!firstName || !secondName) {
      setMessage("Enter a first name and second name.");
      return;
    }
    const displayName = firstName;
    const fullName = `${firstName} ${secondName}`;
    setSaving(true);
    const { data, error } = await client
      .from("players")
      .insert({
        display_name: displayName,
        first_name: firstName,
        nickname: null,
        full_name: fullName,
        is_archived: false,
        claimed_by: null,
      })
      .select("id")
      .single();
    if (error || !data) {
      setSaving(false);
      if (error?.message?.includes("players_display_name_lower_uniq")) {
        setMessage(null);
        setInfoModal({
          title: "Name already in use",
          body: "A player profile with this display name already exists. Use Claim Profile if this is your existing profile, or choose a different first name.",
        });
        return;
      }
      setMessage(`Failed to create profile: ${error?.message ?? "Unknown error"}`);
      return;
    }
    const claimRes = await client.from("player_claim_requests").insert({
      player_id: data.id,
      requester_user_id: userId,
      requested_full_name: fullName,
      status: "pending",
    });
    setSaving(false);
    if (claimRes.error) {
      setMessage(`Profile created, but claim request failed: ${claimRes.error.message}`);
    } else {
      setMessage("Profile created. Claim request submitted for approval.");
    }
    setClaimFirstName("");
    setClaimSecondName("");
    await loadPlayers();
    await loadClaims();
  };

  const onReviewClaim = async (claim: ClaimRequest, approve: boolean) => {
    const client = supabase;
    if (!client || !userId) return;
    if (!isSuperAdmin && !admin.isAdmin) {
      setMessage("Only administrators can review claim requests.");
      return;
    }
    if (!isSuperAdmin) {
      if (!adminLocationId) {
        setMessage("Admin location is not set.");
        return;
      }
      const requesterLocation = requesterLocationByUser.get(claim.requester_user_id) ?? null;
      if (requesterLocation !== adminLocationId) {
        setMessage("You can only review claim requests for users at your location.");
        return;
      }
    }
    const { error } = await client
      .from("player_claim_requests")
      .update({
        status: approve ? "approved" : "rejected",
        reviewed_by_user_id: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", claim.id)
      .eq("status", "pending");
    if (error) {
      setMessage(`Failed to review claim: ${error.message}`);
      return;
    }
    if (approve) {
      const claimPlayer = players.find((p) => p.id === claim.player_id);
      await client
        .from("players")
        .update({
          claimed_by: claim.requester_user_id,
          full_name: claim.requested_full_name || claimPlayer?.full_name,
          is_archived: false,
        })
        .eq("id", claim.player_id);
      await client.from("app_users").update({ linked_player_id: claim.player_id }).eq("id", claim.requester_user_id);
    }
    await loadPlayers();
    await loadClaims();
  };

  const onReviewUpdateRequest = async (req: PlayerUpdateRequest, approve: boolean) => {
    const client = supabase;
    if (!client || !userId) return;
    if (!isSuperAdmin && !admin.isAdmin) {
      setMessage("Only club admins or the Super User can review profile update requests.");
      return;
    }
    if (!isSuperAdmin) {
      if (!adminLocationId) {
        setMessage("Admin location is not set.");
        return;
      }
      const requesterLocation = requesterLocationByUser.get(req.requester_user_id) ?? null;
      if (requesterLocation !== adminLocationId) {
        setMessage("You can only review profile update requests for users at your location.");
        return;
      }
    }
    if (approve) {
      const updatePayload: Record<string, string | boolean | null> = {};
      if (req.requested_full_name !== null && req.requested_full_name !== undefined) {
        updatePayload.full_name = req.requested_full_name;
      }
      if (req.requested_age_band) {
        updatePayload.age_band = req.requested_age_band;
        if (req.requested_age_band !== "18_plus") {
          const firstOnly = (req.requested_full_name ?? "").split(/\s+/).filter(Boolean)[0];
          if (firstOnly) updatePayload.display_name = firstOnly;
          updatePayload.avatar_url = null;
          updatePayload.guardian_consent = Boolean(req.requested_guardian_consent);
          updatePayload.guardian_consent_at = req.requested_guardian_consent ? new Date().toISOString() : null;
          if (req.requested_guardian_name) updatePayload.guardian_name = req.requested_guardian_name;
          if (req.requested_guardian_email) updatePayload.guardian_email = req.requested_guardian_email;
          if (req.requested_guardian_user_id) updatePayload.guardian_user_id = req.requested_guardian_user_id;
        }
      }
      if (req.requested_location_id !== undefined) {
        updatePayload.location_id = req.requested_location_id;
      }
      if (req.requested_avatar_url && (req.requested_age_band ?? "18_plus") === "18_plus") {
        updatePayload.avatar_url = req.requested_avatar_url;
      }
      updatePayload.is_archived = false;
      if (Object.keys(updatePayload).length) {
        const { error } = await client.from("players").update(updatePayload).eq("id", req.player_id);
        if (error) {
          setMessage(`Failed to update player: ${error.message}`);
          return;
        }
      }
    }
    const { error } = await client
      .from("player_update_requests")
      .update({ status: approve ? "approved" : "rejected" })
      .eq("id", req.id)
      .eq("status", "pending");
    if (error) {
      setMessage(`Failed to review update request: ${error.message}`);
      return;
    }
    setMessage(approve ? "Profile update approved." : "Profile update rejected.");
    await loadPlayers();
    await loadUpdateRequests();
  };

  const pendingClaims = claims.filter((c) => c.status === "pending");
  const pendingUpdateRequests = updateRequests.filter((r) => r.status === "pending");
  const myPendingByPlayer = new Set(claims.filter((c) => c.status === "pending" && c.requester_user_id === userId).map((c) => c.player_id));
  const adminLocationId = players.find((p) => p.claimed_by === userId)?.location_id ?? null;
  const requesterLocationByUser = new Map(
    players.filter((p) => p.claimed_by).map((p) => [p.claimed_by as string, p.location_id ?? null])
  );
  const visibleClaims = isSuperAdmin || !admin.isAdmin
    ? pendingClaims
    : !adminLocationId
      ? []
      : pendingClaims.filter((c) => requesterLocationByUser.get(c.requester_user_id) === adminLocationId);
  const visibleUpdates = isSuperAdmin || !admin.isAdmin
    ? pendingUpdateRequests
    : !adminLocationId
      ? []
      : pendingUpdateRequests.filter((r) => requesterLocationByUser.get(r.requester_user_id) === adminLocationId);
  const pendingPremiumRequests = premiumRequests.filter((r) => r.status === "pending");
  const visiblePremiumRequests = isSuperAdmin
    ? pendingPremiumRequests
    : !admin.isAdmin || !adminLocationId
      ? []
      : pendingPremiumRequests.filter((r) => requesterLocationByUser.get(r.requester_user_id) === adminLocationId);
  const visibleAdminRequests = useMemo(() => adminRequests.filter((r) => r.status === "pending"), [adminRequests]);
  const visibleLocationRequests = useMemo(
    () => (isSuperAdmin ? locationRequests.filter((r) => r.status === "pending") : []),
    [locationRequests, isSuperAdmin]
  );
  const visibleMergeRequests = useMemo(
    () => (isSuperAdmin ? mergeRequests.filter((r) => r.status === "pending") : []),
    [mergeRequests, isSuperAdmin]
  );
  const visibleDeletionRequests = useMemo(
    () => (isSuperAdmin ? deletionRequests.filter((r) => r.status === "pending") : []),
    [deletionRequests, isSuperAdmin]
  );
  const systemRequestCount =
    unlinkedUsers.length +
    visiblePremiumRequests.length +
    visibleAdminRequests.length +
    visibleLocationRequests.length +
    visibleDeletionRequests.length;

  const onRestore = async (player: Player) => {
    const client = supabase;
    if (!client) return;
    if (!isSuperAdmin) {
      setMessage("Only the Super User can restore archived players.");
      return;
    }
    const { error } = await client.from("players").update({ is_archived: false }).eq("id", player.id);
    if (error) {
      setMessage(`Failed to restore player: ${error.message}`);
      return;
    }
    await loadPlayers();
  };

  const onAssignProfile = async () => {
    const client = supabase;
    if (!client) return;
    if (!isSuperAdmin) {
      setMessage("Only the Super User can link registered users to player profiles.");
      return;
    }
    if (!assignUserId || !assignPlayerId) {
      setMessage("Select a user and a player profile.");
      return;
    }
    const selectedPlayer = unclaimedAdultPlayers.find((p) => p.id === assignPlayerId);
    if (!selectedPlayer) {
      setMessage("Select an unclaimed adult (18+) player profile.");
      return;
    }
    const { error: playerError } = await client
      .from("players")
      .update({ claimed_by: assignUserId })
      .eq("id", assignPlayerId);
    if (playerError) {
      setMessage(`Failed to link player: ${playerError.message}`);
      return;
    }
    const { error: userError } = await client
      .from("app_users")
      .update({ linked_player_id: assignPlayerId })
      .eq("id", assignUserId);
    if (userError) {
      setMessage(`Linked player, but failed to update user: ${userError.message}`);
      return;
    }
    setAssignUserId("");
    setAssignPlayerId("");
    setMessage("User linked to player profile.");
    await loadPlayers();
    await loadUsers();
  };

  const onSetRole = async (targetUserId: string, role: "admin" | "user") => {
    const client = supabase;
    if (!client) return;
    const targetUser = appUsers.find((u) => u.id === targetUserId);
    if (targetUser?.email?.toLowerCase() === superAdminEmail) {
      setMessage("The Super User account is protected and cannot be changed here.");
      return;
    }
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/role", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: targetUserId, role }),
    });
    if (!resp.ok) {
      const data = await resp.json();
      setMessage(data?.error ?? "Failed to update role.");
      return;
    }
    setMessage(`Role updated to ${role}.`);
    await loadUsers();
  };

  const onSetPremium = async (targetUserId: string, enabled: boolean) => {
    const client = supabase;
    if (!client) return;
    const targetUser = appUsers.find((u) => u.id === targetUserId);
    if (targetUser?.email?.toLowerCase() === superAdminEmail) {
      setMessage("The Super User account is protected and premium settings do not apply.");
      return;
    }
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/premium", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: targetUserId, enabled }),
    });
    if (!resp.ok) {
      const data = await resp.json();
      setMessage(data?.error ?? "Failed to update premium.");
      return;
    }
    setMessage(`Premium ${enabled ? "enabled" : "disabled"}.`);
    await loadUsers();
  };

  const onSetFeatureAccess = async (
    targetUserId: string,
    feature: "quick_match" | "competition_create",
    enabled: boolean
  ) => {
    const client = supabase;
    if (!client) return;
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/feature-access", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: targetUserId, feature, enabled }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setMessage(data?.error ?? "Failed to update feature access.");
      return;
    }
    setMessage(`${feature === "quick_match" ? "Quick Match" : "Create Competition"} ${enabled ? "enabled" : "disabled"}.`);
    await loadUsers();
  };

  const onDeleteUser = async (targetUserId: string) => {
    const result = await deleteLinkedUserAccount(targetUserId);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setInfoModal({
      title: "User deleted",
      body: "The user account has been deleted.",
    });
    await loadUsers();
    await loadPlayers();
    await loadClaims();
    await loadUpdateRequests();
    await loadPremiumRequests();
    await loadAdminRequests();
    await loadMergeRequests();
    await loadDeletionRequests();
  };

  const onReviewPremiumRequest = async (req: PremiumRequest, approve: boolean, opts?: { isMinor?: boolean; guardianOk?: boolean }) => {
    const client = supabase;
    if (!client) return;
    if (!admin.isAdmin) {
      setMessage("Only administrators can review Premium requests.");
      return;
    }
    if (!isSuperAdmin) {
      if (approve) {
        const { error } = await client
          .from("premium_requests")
          .update({ admin_approved: true, approved_by_admin_at: new Date().toISOString() })
          .eq("id", req.id)
          .eq("status", "pending");
        if (error) {
          setMessage(`Failed to update Premium request: ${error.message}`);
          return;
        }
        setMessage("Premium request approved by admin. Awaiting super user.");
        await loadPremiumRequests();
        return;
      }
      const { error } = await client
        .from("premium_requests")
        .update({ status: "rejected" })
        .eq("id", req.id)
        .eq("status", "pending");
      if (error) {
        setMessage(`Failed to update Premium request: ${error.message}`);
        return;
      }
      setMessage("Premium request rejected.");
      await loadPremiumRequests();
      return;
    }
    if (approve) {
      if (!req.admin_approved) {
        setMessage("Super user can only approve after an admin review.");
        return;
      }
      if (opts?.isMinor && !opts.guardianOk) {
        setMessage("Guardian consent is required before approving Premium for minors.");
        return;
      }
      await onSetPremium(req.requester_user_id, true);
    }
    const { error } = await client
      .from("premium_requests")
      .update({ status: approve ? "approved" : "rejected", approved_by_super_at: approve ? new Date().toISOString() : null })
      .eq("id", req.id)
      .eq("status", "pending");
    if (error) {
      setMessage(`Failed to update Premium request: ${error.message}`);
      return;
    }
    await loadPremiumRequests();
  };

  const onReviewAdminRequest = async (req: AdminRequest, approve: boolean) => {
    const client = supabase;
    if (!client) return;
    if (!isSuperAdmin) {
      setMessage("Only the super user can approve admin access.");
      return;
    }
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/admin-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId: req.id, approve, requesterUserId: req.requester_user_id }),
    });
    if (!resp.ok) {
      const data = await resp.json();
      setMessage(data?.error ?? "Failed to update admin request.");
      return;
    }
    setMessage(null);
    setInfoModal({
      title: approve ? "Admin Access Approved" : "Admin Access Rejected",
      body: approve ? "The request has been approved." : "The request has been rejected.",
    });
    await loadAdminRequests();
    await loadUsers();
  };

  const onReviewLocationRequest = async (req: LocationRequest, approve: boolean) => {
    const client = supabase;
    if (!client) return;
    if (!isSuperAdmin) {
      setMessage("Only the super user can review location requests.");
      return;
    }
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/location-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId: req.id, approve }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setMessage(data?.error ?? "Failed to update location request.");
      return;
    }
    setInfoModal({
      title: approve ? "Location request approved" : "Location request rejected",
      body: approve
        ? `Location "${req.requested_location_name}" is now available for signup.`
        : "The location request has been rejected.",
    });
    await loadLocationRequests();
    await loadLocations();
  };

  const onBulkPremium = async (enabled: boolean) => {
    const client = supabase;
    if (!client) return;
    if (!isSuperAdmin) {
      setMessage("Only the super user can update all Premium status.");
      return;
    }
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/premium-bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled }),
    });
    if (!resp.ok) {
      const data = await resp.json();
      setMessage(data?.error ?? "Failed to update Premium.");
      return;
    }
    setMessage(`Premium ${enabled ? "enabled" : "disabled"} for all users.`);
    await loadUsers();
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            eyebrow="Players"
            title="Players"
            subtitle="Club roster, player profiles, and approval tasks."
          />
          {isSuperAdmin ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Admin tools</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href="/locations" className={pillInactiveClass}>
                  Manage locations
                </Link>
              </div>
            </section>
          ) : null}

          {isStandardUser && userId && !hasClaimedProfile ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Find or create your player profile</p>
                <p className="text-sm text-slate-600">Send your player-profile request for approval.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                  placeholder="First name"
                  value={claimFirstName}
                  onChange={(e) => setClaimFirstName(e.target.value)}
                />
                <input
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                  placeholder="Second name"
                  value={claimSecondName}
                  onChange={(e) => setClaimSecondName(e.target.value)}
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={onCreateProfileClaim}
                  className={`${buttonPrimaryClass} disabled:opacity-60`}
                >
                  Send request
                </button>
              </div>
            </section>
          ) : null}

          {isSuperAdmin ? (
            <details className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      System access and requests ({systemRequestCount})
                    </p>
                    <p className="text-sm text-slate-600">
                      Super-user controls for linking accounts, managing access, and handling approval queues.
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                    <span className="group-open:hidden">Expand</span>
                    <span className="hidden group-open:inline">Collapse</span>
                    <span className="transition-transform group-open:rotate-180">⌄</span>
                  </div>
                </div>
              </summary>
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Unlinked users ({unlinkedUsers.length})</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Signed-up accounts that still need to be connected to a player profile.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                      value={assignUserId}
                      onChange={(e) => setAssignUserId(e.target.value)}
                    >
                      <option value="">Select user</option>
                      {unlinkedUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.email ?? u.id}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                      value={assignPlayerId}
                      onChange={(e) => setAssignPlayerId(e.target.value)}
                    >
                      <option value="">Select player profile</option>
                      {unclaimedAdultPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name?.trim() ? p.full_name : p.display_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={onAssignProfile}
                      className={buttonPrimaryClass}
                    >
                      Link profile
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {unclaimedAdultPlayers.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        No unclaimed adult player profiles available for linking.
                      </p>
                    ) : null}
                    {unlinkedUsers.length === 0 ? <p className="text-sm text-slate-600">No unlinked users found.</p> : null}
                    {unlinkedUsers.map((u) => {
                      const linked = players.find((p) => p.id === u.linked_player_id);
                      return (
                        <div key={u.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                          <span className="text-slate-900">{u.email ?? u.id}</span>
                          <span className="text-slate-600">{linked ? `Linked: ${linked.full_name ?? linked.display_name}` : "Unlinked"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Account access ({filteredRoleUsers.length} users)</p>
                  <p className="mt-1 text-sm text-slate-600">Manage roles, premium access, and admin tools.</p>
                  <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onBulkPremium(true)}
                  className={buttonSuccessSmClass}
                >
                  Enable premium for all
                </button>
                <button
                  type="button"
                  onClick={() => onBulkPremium(false)}
                  className={buttonSecondarySmClass}
                >
                  Disable premium for all
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  placeholder="Search name or email"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as "all" | "super" | "admin" | "user")}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All roles</option>
                  <option value="super">Super User</option>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
                <select
                  value={premiumFilter}
                  onChange={(e) => setPremiumFilter(e.target.value as "all" | "premium" | "free")}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All plans</option>
                  <option value="premium">Premium</option>
                  <option value="free">Free</option>
                </select>
              </div>
              <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                {filteredRoleUsers.length === 0 ? <p className="text-sm text-slate-600">No matching users.</p> : null}
                {filteredRoleUsers.map((u) => {
                  const linked = players.find((p) => p.id === u.linked_player_id);
                  const linkedName = linked?.full_name?.trim() ? linked.full_name : linked?.display_name;
                  const displayLabel = linkedName ? `${linkedName} (${u.email ?? u.id})` : u.email ?? u.id;
                  const isRowSuperUser = Boolean(u.email && u.email.toLowerCase() === superAdminEmail);
                  const roleLabel = isRowSuperUser ? "Super User" : u.role === "admin" ? "Admin" : "User";
                  return (
                    <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-900">{displayLabel}</span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">{roleLabel}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.premium_unlocked ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {u.premium_unlocked ? "Premium" : "Free"}
                        </span>
                        {!isRowSuperUser && u.role === "admin" ? (
                          <>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.quick_match_enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                              Quick Match: {u.quick_match_enabled ? "On" : "Off"}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.competition_create_enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                              Create Competition: {u.competition_create_enabled ? "On" : "Off"}
                            </span>
                          </>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        {isRowSuperUser ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                            Protected Super User account
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onSetRole(u.id, "admin")}
                              className={buttonSuccessSmClass}
                            >
                              Make admin
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetRole(u.id, "user")}
                              className={buttonSecondarySmClass}
                            >
                              Make user
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetPremium(u.id, !u.premium_unlocked)}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                            >
                              {u.premium_unlocked ? "Disable premium" : "Enable premium"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetFeatureAccess(u.id, "quick_match", !u.quick_match_enabled)}
                              disabled={u.role !== "admin"}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {u.quick_match_enabled ? "Disable quick match" : "Enable quick match"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetFeatureAccess(u.id, "competition_create", !u.competition_create_enabled)}
                              disabled={u.role !== "admin"}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {u.competition_create_enabled ? "Disable create comp" : "Enable create comp"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Delete user account",
                                  body: `Are you sure you want to delete ${displayLabel}? This removes their login and unlinks any player profile.`,
                                  confirmLabel: "Delete user",
                                  tone: "danger",
                                  onConfirm: async () => {
                                    await onDeleteUser(u.id);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className={buttonDangerOutlineSmClass}
                            >
                              Delete user
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-2">
                <p className="text-sm font-semibold text-slate-900">Premium requests</p>
                {visiblePremiumRequests.length === 0 ? (
                  <p className="text-sm text-slate-600">No premium requests waiting for review.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {visiblePremiumRequests.map((r) => {
                        const requester = appUsers.find((u) => u.id === r.requester_user_id);
                        const linked = players.find((p) => p.id === requester?.linked_player_id);
                        const linkedName = linked?.full_name?.trim() ? linked.full_name : linked?.display_name;
                        const label = linkedName
                          ? `${linkedName} (${requester?.email ?? "Unknown email"})`
                          : requester?.email ?? r.requester_user_id;
                        const isMinor = Boolean(linked?.age_band && linked.age_band !== "18_plus");
                        const guardianOk = Boolean(r.guardian_consent ?? linked?.guardian_consent);
                        const adminReady = Boolean(r.admin_approved);
                        return (
                          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                            <div>
                              <p className="text-slate-900">{label}</p>
                              <p className="text-xs text-slate-500">Requested at: {new Date(r.created_at).toLocaleString()}</p>
                              <p className="text-xs text-slate-500">
                                {adminReady ? "Admin approved" : "Awaiting admin approval"}
                                {isMinor ? guardianOk ? " · Guardian consent confirmed" : " · Guardian consent required" : ""}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {!isSuperAdmin ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmModal({
                                      title: "Approve Premium Request",
                                      body: "Are you sure you want to approve this Premium request?",
                                      confirmLabel: "Approve",
                                      onConfirm: async () => {
                                        await onReviewPremiumRequest(r, true, { isMinor, guardianOk });
                                        setConfirmModal(null);
                                      },
                                    })
                                  }
                                  className={buttonSuccessSmClass}
                                >
                                  Approve (admin)
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmModal({
                                      title: "Approve Premium Request",
                                      body: "Are you sure you want to approve this Premium request?",
                                      confirmLabel: "Approve",
                                      onConfirm: async () => {
                                        await onReviewPremiumRequest(r, true, { isMinor, guardianOk });
                                        setConfirmModal(null);
                                      },
                                    })
                                  }
                                  disabled={!adminReady || (isMinor && !guardianOk)}
                                  className={`${buttonSuccessSmClass} disabled:opacity-60`}
                                >
                                  Approve Premium
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmModal({
                                    title: "Reject Premium Request",
                                    body: "Are you sure you want to reject this Premium request?",
                                    confirmLabel: "Reject",
                                    tone: "danger",
                                    onConfirm: async () => {
                                      await onReviewPremiumRequest(r, false);
                                      setConfirmModal(null);
                                    },
                                  })
                                }
                                className={buttonSecondarySmClass}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
                </div>
              {isSuperAdmin ? (
                <div className="pt-4">
                  <p className="text-sm font-semibold text-slate-900">Admin access requests</p>
                  {visibleAdminRequests.length === 0 ? (
                    <p className="text-sm text-slate-600">No admin access requests waiting for review.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {visibleAdminRequests.map((r) => {
                        const requester = appUsers.find((u) => u.id === r.requester_user_id);
                        const linked = players.find((p) => p.id === requester?.linked_player_id);
                        const linkedName = linked?.full_name?.trim() ? linked.full_name : linked?.display_name;
                        const label = linkedName
                          ? `${linkedName} (${requester?.email ?? "Unknown email"})`
                          : requester?.email ?? r.requester_user_id;
                        return (
                          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                            <div>
                              <p className="text-slate-900">{label}</p>
                              <p className="text-xs text-slate-500">Requested at: {new Date(r.created_at).toLocaleString()}</p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmModal({
                                    title: "Approve Admin Access",
                                    body: "Are you sure you want to approve this admin access request?",
                                    confirmLabel: "Approve",
                                    onConfirm: async () => {
                                      await onReviewAdminRequest(r, true);
                                      setConfirmModal(null);
                                    },
                                  })
                                }
                                className={buttonSuccessSmClass}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmModal({
                                    title: "Reject Admin Access",
                                    body: "Are you sure you want to reject this admin access request?",
                                    confirmLabel: "Reject",
                                    tone: "danger",
                                    onConfirm: async () => {
                                      await onReviewAdminRequest(r, false);
                                      setConfirmModal(null);
                                    },
                                  })
                                }
                                className={buttonSecondarySmClass}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
              {isSuperAdmin ? (
                <div className="pt-4">
                  <p className="text-sm font-semibold text-slate-900">Location requests</p>
                  {visibleLocationRequests.length === 0 ? (
                    <p className="text-sm text-slate-600">No location requests waiting for review.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {visibleLocationRequests.map((r) => (
                        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                          <div>
                            <p className="text-slate-900">{r.requester_full_name} ({r.requester_email})</p>
                            <p className="text-sm text-slate-700">Requested location: {r.requested_location_name}</p>
                            <p className="text-xs text-slate-500">Requested at: {new Date(r.created_at).toLocaleString()}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Approve Location Request",
                                  body: `Approve location "${r.requested_location_name}"?`,
                                  confirmLabel: "Approve",
                                  onConfirm: async () => {
                                    await onReviewLocationRequest(r, true);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className={buttonSuccessSmClass}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Reject Location Request",
                                  body: `Reject location "${r.requested_location_name}"?`,
                                  confirmLabel: "Reject",
                                  tone: "danger",
                                  onConfirm: async () => {
                                    await onReviewLocationRequest(r, false);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className={buttonSecondarySmClass}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              {isSuperAdmin ? (
                <div className="pt-4" id="profile-deletion-requests">
                  <p className="text-sm font-semibold text-slate-900">Profile deletion requests</p>
                  {visibleDeletionRequests.length === 0 ? (
                    <p className="text-sm text-slate-600">No profile deletion requests waiting for review.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {visibleDeletionRequests.map((r) => {
                        const target = players.find((p) => p.id === r.player_id);
                        const requester = appUsers.find((u) => u.id === r.requester_user_id);
                        const requesterPlayer = players.find((p) => p.id === requester?.linked_player_id);
                        const requesterName = requesterPlayer?.full_name?.trim()
                          ? requesterPlayer.full_name
                          : requesterPlayer?.display_name ?? requester?.email ?? "Unknown user";
                        return (
                          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                            <div>
                              <p className="text-slate-900">{target?.full_name ?? target?.display_name ?? "Unknown player profile"}</p>
                              <p className="text-xs text-slate-500">Requested by: {requesterName}</p>
                              <p className="text-xs text-slate-500">
                                Data handling: {r.delete_all_data ? "Delete personal profile data where possible" : "Archive profile and retain historical data"}
                              </p>
                              <p className="text-xs text-slate-500">Requested at: {new Date(r.created_at).toLocaleString()}</p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmModal({
                                    title: "Approve Profile Deletion",
                                    body: "Are you sure you want to approve this profile deletion request?",
                                    confirmLabel: "Approve",
                                    tone: "danger",
                                    onConfirm: async () => {
                                      await onReviewDeletionRequest(r, true);
                                      setConfirmModal(null);
                                    },
                                  })
                                }
                                className={buttonDangerOutlineSmClass}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmModal({
                                    title: "Reject Profile Deletion",
                                    body: "Are you sure you want to reject this profile deletion request?",
                                    confirmLabel: "Reject",
                                    tone: "danger",
                                    onConfirm: async () => {
                                      await onReviewDeletionRequest(r, false);
                                      setConfirmModal(null);
                                    },
                                  })
                                }
                                className={buttonSecondarySmClass}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
                </div>
              </div>
            </details>
          ) : null}

          {!isStandardUser ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">New sign-ups</h2>
                <button
                  type="button"
                  onClick={() => setTab("claims")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Open approval view
                </button>
              </div>
                <p className="mt-1 text-sm text-slate-600">Recent player-profile requests are shown here for quick review.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Pending claims</p>
                  <p className="text-2xl font-semibold text-slate-900">{visibleClaims.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Pending profile updates</p>
                  <p className="text-2xl font-semibold text-slate-900">{visibleUpdates.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Unlinked users</p>
                  <p className="text-2xl font-semibold text-slate-900">{unlinkedUsers.length}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {visibleClaims.slice(0, 3).map((c) => {
                  const requester = appUserById.get(c.requester_user_id)?.email ?? c.requester_user_id;
                  const requestedPlayer = playerById.get(c.player_id);
                  const requestedLabel = requestedPlayer
                    ? requestedPlayer.full_name?.trim() || requestedPlayer.display_name
                    : c.player_id;
                  return (
                    <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-sm text-slate-900">
                        <span className="font-medium">{requester}</span> requested link to{" "}
                        <span className="font-medium">{requestedLabel}</span>
                      </p>
                      <p className="text-xs text-slate-500">Requested at: {new Date(c.created_at).toLocaleString()}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Approve claim request",
                              body: "Are you sure you want to approve this claim request?",
                              confirmLabel: "Approve",
                              onConfirm: async () => {
                                await onReviewClaim(c, true);
                                setConfirmModal(null);
                              },
                            })
                          }
                          className={buttonSuccessSmClass}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Reject claim request",
                              body: "Are you sure you want to reject this claim request?",
                              confirmLabel: "Reject",
                              tone: "danger",
                              onConfirm: async () => {
                                await onReviewClaim(c, false);
                                setConfirmModal(null);
                              },
                            })
                          }
                          className={buttonSecondarySmClass}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
                {visibleClaims.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    No pending sign-up claim requests.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {canRegisterPlayers || isSuperAdmin ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {canRegisterPlayers ? (
                  <button
                    type="button"
                    onClick={() => setTab("register")}
                    className={visibleTab === "register" ? pillActiveClass : pillInactiveClass}
                  >
                    Register
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setTab("profiles")}
                  className={visibleTab === "profiles" ? pillActiveClass : pillInactiveClass}
                >
                  Player Profiles ({activePlayers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab("archived")}
                  className={visibleTab === "archived" ? pillActiveClass : pillInactiveClass}
                  disabled={!isSuperAdmin}
                >
                  Archived ({archivedPlayers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab("claims")}
                  className={visibleTab === "claims" ? pillActiveClass : pillInactiveClass}
                >
                  Claim Requests ({pendingClaims.length})
                </button>
              </div>
              {admin.isAdmin && !isSuperAdmin ? (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  Administrator access includes profile list and claim review for your location. Archived player controls remain Super User only.
                </p>
              ) : null}
            </section>
          ) : null}

          {loading ? <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">Loading players...</p> : null}
          <MessageModal message={message} onClose={() => setMessage(null)} />

          {visibleTab === "register" && canRegisterPlayers ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Register Player</h2>
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={onRegister}>
                <input
                  className="min-w-[260px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2"
                  placeholder="First name"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                />
                <input
                  className="min-w-[260px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2"
                  placeholder="Second name"
                  value={newSecondName}
                  onChange={(e) => setNewSecondName(e.target.value)}
                />
                <select
                  className="min-w-[220px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2"
                  value={newLocationId}
                  onChange={(e) => setNewLocationId(e.target.value)}
                >
                  <option value="">Select location (required)</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={saving}
                  className={buttonSuccessClass}
                >
                  {saving ? "Saving..." : "Register"}
                </button>
              </form>
              <p className="mt-2 text-xs text-slate-600">
                Child profiles are created from the parent/guardian player profile screen.
              </p>
            </section>
          ) : null}

          {visibleTab === "profiles" && !isStandardUser ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Player Profiles</h2>
              <p className="mt-1 text-sm text-slate-600">Open a player profile to view their individual stats and matchup history.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-sm text-slate-700">Filter by location</label>
                <select
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={profileLocationFilter}
                  onChange={(e) => setProfileLocationFilter(e.target.value)}
                >
                  <option value="all">All locations</option>
                  <option value="__none">No location</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">{filteredActivePlayers.length} player(s)</span>
              </div>
              <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {filteredActivePlayers.length === 0 ? <p className="text-sm text-slate-600">No active players for this filter.</p> : null}
                {filteredActivePlayers.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-3">
                      <Link href={`/players/${p.id}`} className="font-medium text-slate-900 underline">
                        {p.full_name ?? p.display_name}
                      </Link>
                      {p.claimed_by ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Linked login</span>
                      ) : (p.age_band ?? "18_plus") !== "18_plus" && p.guardian_user_id ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">Child linked to guardian</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Unlinked</span>
                      )}
                      {(p.age_band ?? "18_plus") !== "18_plus" && p.guardian_user_id ? (
                        <span className="text-xs text-slate-600">
                          Guardian:{" "}
                          {(() => {
                            const guardianUser = appUserById.get(p.guardian_user_id ?? "");
                            const guardianPlayer = guardianUser?.linked_player_id ? playerById.get(guardianUser.linked_player_id) : null;
                            return guardianPlayer?.full_name?.trim() ? guardianPlayer.full_name : guardianPlayer?.display_name ?? "Linked parent";
                          })()}
                        </span>
                      ) : null}
                      <Link href="/locations" className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {p.location_id ? "1 location" : "0 locations"}
                      </Link>
                      {!admin.isAdmin ? (
                        <p className="text-xs text-slate-600">{p.full_name ? "Full name on file" : "Name not set"}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/players/${p.id}`} className="text-sm font-medium text-teal-700 underline">
                        View profile
                      </Link>
                      {!admin.isAdmin ? (
                        p.claimed_by ? (
                          <span className="text-xs text-emerald-700">Claimed</span>
                        ) : myPendingByPlayer.has(p.id) ? (
                          <span className="text-xs text-amber-700">Claim pending</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRequestClaim(p)}
                            className={buttonSecondaryClass}
                          >
                            Claim profile
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {visibleTab === "archived" && isSuperAdmin ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Archived ({archivedPlayers.length})</h2>
              <div className="mt-3 space-y-2">
                {archivedPlayers.length === 0 ? <p className="text-sm text-slate-600">No archived players.</p> : null}
                {archivedPlayers.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <span className="text-slate-900">{p.full_name ?? p.display_name}</span>
                    <button
                      type="button"
                      onClick={() => onRestore(p)}
                      className={buttonSecondaryClass}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {visibleTab === "claims" && !isStandardUser ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Claim Requests</h2>
              <p className="mt-1 text-sm text-slate-600">
                Only administrators can approve requests.
              </p>
              {!visibleClaims.length ? <p className="mt-2 text-sm text-slate-600">No pending claim requests.</p> : null}
              <div className="mt-3 space-y-2">
                {visibleClaims.map((c) => {
                  const player = players.find((p) => p.id === c.player_id);
                  return (
                    <div key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <p className="font-medium text-slate-900">{player?.full_name ?? player?.display_name ?? "Unknown player"}</p>
                      <p className="text-sm text-slate-700">Requested name: {c.requested_full_name}</p>
                      <p className="text-xs text-slate-500">Requested at: {new Date(c.created_at).toLocaleString()}</p>
                      {admin.isAdmin ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmModal({
                                title: "Approve Claim Request",
                                body: "Are you sure you want to approve this claim request?",
                                confirmLabel: "Approve",
                                onConfirm: async () => {
                                  await onReviewClaim(c, true);
                                  setConfirmModal(null);
                                },
                              })
                            }
                            className="rounded-lg bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-800"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmModal({
                                title: "Reject Claim Request",
                                body: "Are you sure you want to reject this claim request?",
                                confirmLabel: "Reject",
                                tone: "danger",
                                onConfirm: async () => {
                                  await onReviewClaim(c, false);
                                  setConfirmModal(null);
                                },
                              })
                            }
                            className={buttonSecondaryClass}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">Awaiting reviewer approval.</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-6">
                <h3 className="text-xl font-semibold text-slate-900">Profile Update Requests</h3>
                {!visibleUpdates.length ? <p className="mt-2 text-sm text-slate-600">No pending profile updates.</p> : null}
                <div className="mt-3 space-y-2">
                  {visibleUpdates.map((r) => {
                    const player = players.find((p) => p.id === r.player_id);
                    const locationName = r.requested_location_id ? locationById.get(r.requested_location_id) : null;
                    return (
                      <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <p className="font-medium text-slate-900">{player?.full_name ?? player?.display_name ?? "Unknown player"}</p>
                        {r.requested_full_name ? <p className="text-sm text-slate-700">Requested name: {r.requested_full_name}</p> : null}
                        {r.requested_age_band ? (
                          <p className="text-sm text-slate-700">
                            Requested age band:{" "}
                            {r.requested_age_band === "under_13"
                              ? "Under 13"
                              : r.requested_age_band === "under_18"
                                ? "Under 18s"
                              : r.requested_age_band === "13_15"
                                ? "13–15"
                                : r.requested_age_band === "16_17"
                                  ? "16–17"
                                  : "18+"}
                            {r.requested_age_band !== "18_plus"
                              ? r.requested_guardian_consent
                                ? " · Guardian consent confirmed"
                                : " · Guardian consent required"
                              : ""}
                          </p>
                        ) : null}
                        {r.requested_guardian_name || r.requested_guardian_email ? (
                          <p className="text-xs text-slate-500">
                            Guardian: {r.requested_guardian_name ?? "Name missing"} · {r.requested_guardian_email ?? "Email missing"}
                          </p>
                        ) : null}
                        {r.requested_location_id ? <p className="text-sm text-slate-700">Requested location: {locationName ?? "Selected location"}</p> : null}
                        {r.requested_avatar_url ? <p className="text-sm text-slate-700">Requested avatar update.</p> : null}
                        <p className="text-xs text-slate-500">Requested at: {new Date(r.created_at).toLocaleString()}</p>
                        {admin.isAdmin ? (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Approve Profile Update",
                                  body: "Are you sure you want to approve this profile update request?",
                                  confirmLabel: "Approve",
                                  onConfirm: async () => {
                                    await onReviewUpdateRequest(r, true);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className="rounded-lg bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-800"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Reject Profile Update",
                                  body: "Are you sure you want to reject this profile update request?",
                                  confirmLabel: "Reject",
                                  tone: "danger",
                                  onConfirm: async () => {
                                    await onReviewUpdateRequest(r, false);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className={buttonSecondaryClass}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">Awaiting reviewer approval.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {isSuperAdmin ? (
                <div className="mt-6">
                  <h3 className="text-xl font-semibold text-slate-900">Merge Profile Requests</h3>
                  {!visibleMergeRequests.length ? <p className="mt-2 text-sm text-slate-600">No pending merge requests.</p> : null}
                  <div className="mt-3 space-y-2">
                    {visibleMergeRequests.map((r) => {
                      const target = players.find((p) => p.id === r.target_player_id);
                      return (
                        <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                          <p className="font-medium text-slate-900">
                            Requested: {r.requested_full_name} ({r.requested_age_band})
                          </p>
                          <p className="text-sm text-slate-700">
                            Possible duplicate: {target?.full_name ?? target?.display_name ?? "Unknown player"}
                          </p>
                          <p className="text-xs text-slate-500">Requested at: {new Date(r.created_at).toLocaleString()}</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Approve Merge Request",
                                  body: "Are you sure you want to approve this merge request?",
                                  confirmLabel: "Approve",
                                  onConfirm: async () => {
                                    await onReviewMergeRequest(r, true);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className="rounded-lg bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-800"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  title: "Reject Merge Request",
                                  body: "Are you sure you want to reject this merge request?",
                                  confirmLabel: "Reject",
                                  tone: "danger",
                                  onConfirm: async () => {
                                    await onReviewMergeRequest(r, false);
                                    setConfirmModal(null);
                                  },
                                })
                              }
                              className={buttonSecondaryClass}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </RequireAuth>
        <InfoModal
          open={Boolean(infoModal)}
          title={infoModal?.title ?? ""}
          description={infoModal?.body ?? ""}
          onClose={() => setInfoModal(null)}
        />
        <ConfirmModal
          open={Boolean(mergePrompt)}
          title="Duplicate Profile Found"
          description={
            mergePrompt
              ? `A player profile named "${mergePrompt.displayName}" already exists. Submit a merge request to the Super User for review?`
              : ""
          }
          confirmLabel="Submit Request"
          cancelLabel="Cancel"
          onCancel={() => setMergePrompt(null)}
          onConfirm={onSubmitMergeRequest}
        />
        <ConfirmModal
          open={Boolean(confirmModal)}
          title={confirmModal?.title ?? ""}
          description={confirmModal?.body ?? ""}
          confirmLabel={confirmModal?.confirmLabel ?? "Confirm"}
          tone={confirmModal?.tone ?? "default"}
          onCancel={() => setConfirmModal(null)}
          onConfirm={() => confirmModal?.onConfirm()}
        />
      </div>
    </main>
  );
}
