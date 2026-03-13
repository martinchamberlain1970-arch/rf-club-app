"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";
import useAdminStatus from "@/components/useAdminStatus";
import ConfirmModal from "@/components/ConfirmModal";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";

type Player = { id: string; full_name: string | null; display_name: string };
type AppUser = { id: string; email: string | null; linked_player_id: string | null; role?: string | null };
type ClaimRequest = {
  id: string;
  player_id: string;
  requester_user_id: string;
  requested_full_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};
type LocationRequest = {
  id: string;
  requester_user_id: string | null;
  requester_email: string;
  requester_full_name: string;
  requested_location_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export default function SignupRequestsPage() {
  const admin = useAdminStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimRequest[]>([]);
  const [locationRequests, setLocationRequests] = useState<LocationRequest[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    body: string;
    confirmLabel?: string;
    tone?: "default" | "danger";
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; body: string } | null>(null);

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const isSuperAdmin = Boolean(superAdminEmail && admin.email && admin.email.toLowerCase() === superAdminEmail);

  const load = async () => {
    const client = supabase;
    if (!client) return;
    const [claimRes, locRes, playerRes, userRes] = await Promise.all([
      client
        .from("player_claim_requests")
        .select("id,player_id,requester_user_id,requested_full_name,status,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      client
        .from("location_requests")
        .select("id,requester_user_id,requester_email,requester_full_name,requested_location_name,status,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      client.from("players").select("id,full_name,display_name"),
      client.from("app_users").select("id,email,linked_player_id,role"),
    ]);

    const firstError = claimRes.error?.message || locRes.error?.message || playerRes.error?.message || userRes.error?.message;
    if (firstError) {
      setMessage(`Failed to load signup requests: ${firstError}`);
      return;
    }
    setClaims((claimRes.data ?? []) as ClaimRequest[]);
    setLocationRequests((locRes.data ?? []) as LocationRequest[]);
    setPlayers((playerRes.data ?? []) as Player[]);
    setUsers((userRes.data ?? []) as AppUser[]);
  };

  useEffect(() => {
    if (!admin.loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.loading]);

  const onReviewClaim = async (claim: ClaimRequest, approve: boolean) => {
    const client = supabase;
    if (!client) return;
    if (!isSuperAdmin || !admin.userId) {
      setMessage("Only the super user can review signup claims.");
      return;
    }
    const update = await client
      .from("player_claim_requests")
      .update({
        status: approve ? "approved" : "rejected",
        reviewed_by_user_id: admin.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", claim.id)
      .eq("status", "pending");
    if (update.error) {
      setMessage(update.error.message);
      return;
    }
    if (approve) {
      const p = players.find((x) => x.id === claim.player_id);
      await client
        .from("players")
        .update({ claimed_by: claim.requester_user_id, full_name: claim.requested_full_name || p?.full_name })
        .eq("id", claim.player_id);
      await client.from("app_users").update({ linked_player_id: claim.player_id }).eq("id", claim.requester_user_id);
    }
    setInfoModal({
      title: approve ? "Claim approved" : "Claim rejected",
      body: approve ? "User has been linked to the requested player profile." : "The signup claim request was rejected.",
    });
    await load();
  };

  const onReviewLocationRequest = async (reqId: string, approve: boolean) => {
    const client = supabase;
    if (!client) return;
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
      body: JSON.stringify({ requestId: reqId, approve }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setMessage(data?.error ?? "Failed to review location request.");
      return;
    }
    setInfoModal({
      title: approve ? "Location approved" : "Location rejected",
      body: approve ? "Location request approved and created." : "Location request rejected.",
    });
    await load();
  };

  const superUserIds = useMemo(() => {
    return new Set(
      users
        .filter((u) => {
          const email = (u.email ?? "").toLowerCase();
          const role = (u.role ?? "").toLowerCase();
          if (superAdminEmail && email === superAdminEmail) return true;
          return role === "owner" || role === "super";
        })
        .map((u) => u.id)
    );
  }, [users, superAdminEmail]);

  const visibleClaims = useMemo(
    () => claims.filter((c) => !superUserIds.has(c.requester_user_id)),
    [claims, superUserIds]
  );

  const visibleLocationRequests = useMemo(
    () =>
      locationRequests.filter((r) => {
        const email = r.requester_email.toLowerCase();
        if (superAdminEmail && email === superAdminEmail) return false;
        if (r.requester_user_id && superUserIds.has(r.requester_user_id)) return false;
        return true;
      }),
    [locationRequests, superUserIds, superAdminEmail]
  );

  const unlinkedUsers = useMemo(() => {
    const pendingRequesterIds = new Set(visibleClaims.map((c) => c.requester_user_id));
    return users.filter((u) => {
      if (u.linked_player_id) return false;
      if (pendingRequesterIds.has(u.id)) return false;
      if (superUserIds.has(u.id)) return false;
      return true;
    });
  }, [users, visibleClaims, superUserIds]);

  const playerName = (playerId: string) => {
    const p = players.find((x) => x.id === playerId);
    return p ? (p.full_name?.trim() ? p.full_name : p.display_name) : playerId;
  };
  const userLabel = (userId: string) => {
    const u = users.find((x) => x.id === userId);
    return u?.email ?? userId;
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Signup Requests" eyebrow="Super User" subtitle="Review new-user profile links and location requests." />
          {!admin.loading && !isSuperAdmin ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">Only the Super User can access this page.</section>
          ) : null}
          {!admin.loading && isSuperAdmin ? (
            <>
              <MessageModal message={message} onClose={() => setMessage(null)} />
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Pending Profile Claims</h2>
                {visibleClaims.length === 0 ? <p className="mt-2 text-sm text-slate-600">No pending profile-claim requests.</p> : null}
                <div className="mt-2 space-y-2">
                  {visibleClaims.map((c) => (
                    <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-sm text-slate-900">
                        <span className="font-semibold">{userLabel(c.requester_user_id)}</span> requested link to{" "}
                        <span className="font-semibold">{playerName(c.player_id)}</span>
                      </p>
                      <p className="text-xs text-slate-500">Requested name: {c.requested_full_name}</p>
                      <p className="text-xs text-slate-500">Requested at: {new Date(c.created_at).toLocaleString()}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Approve profile claim",
                              body: "Approve and link this user to the player profile?",
                              confirmLabel: "Approve",
                              onConfirm: async () => {
                                await onReviewClaim(c, true);
                                setConfirmModal(null);
                              },
                            })
                          }
                          className="rounded-lg bg-emerald-700 px-3 py-1 text-xs text-white"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Reject profile claim",
                              body: "Reject this profile claim request?",
                              confirmLabel: "Reject",
                              tone: "danger",
                              onConfirm: async () => {
                                await onReviewClaim(c, false);
                                setConfirmModal(null);
                              },
                            })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Pending Location Requests</h2>
                {visibleLocationRequests.length === 0 ? <p className="mt-2 text-sm text-slate-600">No pending location requests.</p> : null}
                <div className="mt-2 space-y-2">
                  {visibleLocationRequests.map((r) => (
                    <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-sm text-slate-900">
                        <span className="font-semibold">{r.requester_full_name}</span> ({r.requester_email}) requested{" "}
                        <span className="font-semibold">{r.requested_location_name}</span>
                      </p>
                      <p className="text-xs text-slate-500">Requested at: {new Date(r.created_at).toLocaleString()}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Approve location request",
                              body: `Approve "${r.requested_location_name}" and add it to locations?`,
                              confirmLabel: "Approve",
                              onConfirm: async () => {
                                await onReviewLocationRequest(r.id, true);
                                setConfirmModal(null);
                              },
                            })
                          }
                          className="rounded-lg bg-emerald-700 px-3 py-1 text-xs text-white"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              title: "Reject location request",
                              body: `Reject "${r.requested_location_name}"?`,
                              confirmLabel: "Reject",
                              tone: "danger",
                              onConfirm: async () => {
                                await onReviewLocationRequest(r.id, false);
                                setConfirmModal(null);
                              },
                            })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Unlinked Registered Users</h2>
                <p className="text-sm text-slate-600">Users who signed up but currently have no linked player profile and no pending claim.</p>
                {unlinkedUsers.length === 0 ? <p className="mt-2 text-sm text-slate-600">No unlinked users.</p> : null}
                <div className="mt-2 space-y-2">
                  {unlinkedUsers.map((u) => (
                    <div key={u.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900">
                      {u.email ?? u.id}
                    </div>
                  ))}
                </div>
                <Link href="/players" className="mt-3 inline-block text-sm text-teal-700 underline underline-offset-4">
                  Open Registered Players to manually link profile
                </Link>
              </section>
            </>
          ) : null}
        </RequireAuth>
      </div>
      <ConfirmModal
        open={Boolean(confirmModal)}
        title={confirmModal?.title ?? ""}
        description={confirmModal?.body ?? ""}
        confirmLabel={confirmModal?.confirmLabel}
        tone={confirmModal?.tone}
        onConfirm={() => void confirmModal?.onConfirm()}
        onCancel={() => setConfirmModal(null)}
      />
      <InfoModal
        open={Boolean(infoModal)}
        title={infoModal?.title ?? ""}
        description={infoModal?.body ?? ""}
        onClose={() => setInfoModal(null)}
      />
    </main>
  );
}
