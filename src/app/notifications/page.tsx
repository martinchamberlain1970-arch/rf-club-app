"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";

type NotificationItem = {
  key: string;
  title: string;
  detail: string;
  created_at: string;
  href: string;
  status: string;
};

type ResultRow = { id: string; match_id: string; submitted_at: string; status: string };
type MatchLookup = {
  id: string;
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
};
type OpenCompetitionRow = {
  id: string;
  name: string;
  created_at: string;
  signup_deadline: string | null;
};

function getRoleSummary(isSuper: boolean, isAdmin: boolean) {
  if (isSuper) {
    return {
      label: "Super User",
      description: "You are seeing system, approval, and club activity updates.",
      accent: "from-amber-50 via-white to-teal-50",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (isAdmin) {
    return {
      label: "Club Admin",
      description: "You are seeing competition and approval updates for club management.",
      accent: "from-sky-50 via-white to-emerald-50",
      badgeClass: "border-sky-200 bg-sky-50 text-sky-800",
    };
  }
  return {
    label: "Player",
    description: "You are seeing updates about your account, requests, and submitted results.",
    accent: "from-indigo-50 via-white to-teal-50",
    badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-800",
  };
}

function getStatusMeta(status: string) {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case "approved":
      return {
        label: "Approved",
        pillClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "rejected":
      return {
        label: "Rejected",
        pillClass: "border-rose-200 bg-rose-50 text-rose-700",
      };
    case "open":
      return {
        label: "Open",
        pillClass: "border-sky-200 bg-sky-50 text-sky-700",
      };
    case "pending":
    default:
      return {
        label: normalized === "pending" ? "Pending" : status,
        pillClass: "border-amber-200 bg-amber-50 text-amber-700",
      };
  }
}

async function loadPlayerNameMap(playerIds: string[]) {
  const client = supabase;
  const map = new Map<string, string>();
  if (!client || playerIds.length === 0) return map;

  const { data, error } = await client.from("players").select("id,display_name,full_name").in("id", playerIds);
  if (error) return map;

  (data ?? []).forEach((player: { id: string; display_name: string; full_name: string | null }) => {
    map.set(player.id, player.full_name?.trim() ? player.full_name : player.display_name);
  });
  return map;
}

export default function NotificationsPage() {
  const admin = useAdminStatus();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const raw = window.localStorage.getItem("notifications_dismissed");
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  });

  const dismissedKey = useMemo(
    () => (admin.userId ? `notifications_dismissed_${admin.userId}` : "notifications_dismissed"),
    [admin.userId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(dismissedKey);
    queueMicrotask(() => {
      setDismissed(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    });
  }, [dismissedKey]);

  const saveDismissed = (next: Set<string>) => {
    setDismissed(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissedKey, JSON.stringify(Array.from(next)));
    }
  };

  const loadMatchLabels = async (rows: ResultRow[]) => {
    const client = supabase;
    const labels = new Map<string, string>();
    if (!client || rows.length === 0) return labels;

    const matchIds = Array.from(new Set(rows.map((r) => r.match_id).filter(Boolean)));
    if (!matchIds.length) return labels;

    const { data: matchesData } = await client
      .from("matches")
      .select("id,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id")
      .in("id", matchIds);
    const matches = (matchesData ?? []) as MatchLookup[];
    if (!matches.length) return labels;

    const playerIds = Array.from(
      new Set(
        matches.flatMap((m) =>
          [
            m.player1_id,
            m.player2_id,
            m.team1_player1_id,
            m.team1_player2_id,
            m.team2_player1_id,
            m.team2_player2_id,
          ].filter(Boolean) as string[]
        )
      )
    );
    const { data: playersData } = playerIds.length
      ? await client.from("players").select("id,display_name,full_name").in("id", playerIds)
      : { data: [] as Array<{ id: string; display_name: string; full_name: string | null }> };
    const nameById = new Map<string, string>(
      (playersData ?? []).map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])
    );

    const teamSingles = (id: string | null) => (id ? nameById.get(id) ?? "TBC" : "TBC");
    const teamDoubles = (a: string | null, b: string | null) => `${teamSingles(a)} & ${teamSingles(b)}`;

    for (const m of matches) {
      const left = m.match_mode === "doubles" ? teamDoubles(m.team1_player1_id, m.team1_player2_id) : teamSingles(m.player1_id);
      const right = m.match_mode === "doubles" ? teamDoubles(m.team2_player1_id, m.team2_player2_id) : teamSingles(m.player2_id);
      labels.set(m.id, `${left} vs ${right}`);
    }
    return labels;
  };

  useEffect(() => {
    const load = async () => {
      const client = supabase;
      if (!client || admin.loading || !admin.userId) return;

      const out: NotificationItem[] = [];
      const openCompsRes = await client
        .from("competitions")
        .select("id,name,created_at,signup_deadline")
        .eq("signup_open", true)
        .eq("is_archived", false)
        .eq("is_completed", false)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!openCompsRes.error) {
        (openCompsRes.data ?? []).forEach((c: OpenCompetitionRow) => {
          out.push({
            key: `open_competition:${c.id}`,
            title: "Open competition available",
            detail: c.signup_deadline
              ? `${c.name} · Sign-up closes ${new Date(c.signup_deadline).toLocaleString()}`
              : `${c.name} · Sign-up is open`,
            created_at: c.created_at,
            href: "/signups",
            status: "open",
          });
        });
      }
      if (admin.isSuper) {
        const [resultRes, claimRes, updateRes, adminReqRes, premiumRes, locationReqRes] = await Promise.all([
          client.from("result_submissions").select("id,match_id,submitted_at,status").eq("status", "pending").order("submitted_at", { ascending: false }),
          client.from("player_claim_requests").select("id,created_at,status").eq("status", "pending").order("created_at", { ascending: false }),
          client.from("player_update_requests").select("id,player_id,created_at,status").eq("status", "pending").order("created_at", { ascending: false }),
          client.from("admin_requests").select("id,created_at,status").eq("status", "pending").order("created_at", { ascending: false }),
          client.from("premium_requests").select("id,created_at,status").eq("status", "pending").order("created_at", { ascending: false }),
          client.from("location_requests").select("id,requester_full_name,requested_location_name,created_at,status").eq("status", "pending").order("created_at", { ascending: false }),
        ]);

        if (resultRes.error || claimRes.error || updateRes.error || adminReqRes.error || premiumRes.error || locationReqRes.error) {
          const firstError =
            resultRes.error?.message ??
            claimRes.error?.message ??
            updateRes.error?.message ??
            adminReqRes.error?.message ??
            premiumRes.error?.message ??
            locationReqRes.error?.message ??
            "Unknown error";
          setMessage(`Failed to load notifications: ${firstError}`);
          return;
        }

        const resultRows = (resultRes.data ?? []) as ResultRow[];
        const labels = await loadMatchLabels(resultRows);
        resultRows.forEach((r) => {
          out.push({
            key: `result:${r.id}`,
            title: "Result submission pending approval",
            detail: labels.get(r.match_id) ?? `Match ${r.match_id.slice(0, 8)}`,
            created_at: r.submitted_at,
            href: `/matches/${r.match_id}`,
            status: r.status,
          });
        });
        (claimRes.data ?? []).forEach((r: { id: string; created_at: string; status: string }) => {
          out.push({
            key: `claim:${r.id}`,
            title: "Player claim request pending",
            detail: "Review on Signup Requests",
            created_at: r.created_at,
            href: "/signup-requests",
            status: r.status,
          });
        });
        const updateRows = (updateRes.data ?? []) as Array<{ id: string; player_id: string; created_at: string; status: string }>;
        const playerNameById = await loadPlayerNameMap(Array.from(new Set(updateRows.map((row) => row.player_id).filter(Boolean))));
        updateRows.forEach((r) => {
          out.push({
            key: `update:${r.id}`,
            title: "Profile update request pending",
            detail: playerNameById.get(r.player_id) ?? "Unknown player",
            created_at: r.created_at,
            href: "/players?tab=claims",
            status: r.status,
          });
        });
        (adminReqRes.data ?? []).forEach((r: { id: string; created_at: string; status: string }) => {
          out.push({
            key: `admin:${r.id}`,
            title: "Admin access request pending",
            detail: "Review in Role Management",
            created_at: r.created_at,
            href: "/players",
            status: r.status,
          });
        });
        (premiumRes.data ?? []).forEach((r: { id: string; created_at: string; status: string }) => {
          out.push({
            key: `premium:${r.id}`,
            title: "Premium request pending",
            detail: "Review in Role Management",
            created_at: r.created_at,
            href: "/players",
            status: r.status,
          });
        });
        (locationReqRes.data ?? []).forEach((r: { id: string; requester_full_name: string; requested_location_name: string; created_at: string; status: string }) => {
          out.push({
            key: `location:${r.id}`,
            title: "Location request pending",
            detail: `${r.requester_full_name} requested "${r.requested_location_name}"`,
            created_at: r.created_at,
            href: "/signup-requests",
            status: r.status,
          });
        });
      } else if (admin.isAdmin) {
        const resultRes = await client
          .from("result_submissions")
          .select("id,match_id,submitted_at,status")
          .eq("status", "pending")
          .order("submitted_at", { ascending: false });
        if (resultRes.error) {
          setMessage(`Failed to load notifications: ${resultRes.error.message}`);
          return;
        }
        const resultRows = (resultRes.data ?? []) as ResultRow[];
        const labels = await loadMatchLabels(resultRows);
        resultRows.forEach((r) => {
          out.push({
            key: `result:${r.id}`,
            title: "Result submission pending approval",
            detail: labels.get(r.match_id) ?? `Match ${r.match_id.slice(0, 8)}`,
            created_at: r.submitted_at,
            href: `/matches/${r.match_id}`,
            status: r.status,
          });
        });
      } else {
        const [resultRes, claimRes, updateRes, adminReqRes, premiumRes] = await Promise.all([
          client
            .from("result_submissions")
            .select("id,match_id,submitted_at,status")
            .eq("submitted_by_user_id", admin.userId)
            .in("status", ["pending", "approved", "rejected"])
            .order("submitted_at", { ascending: false }),
          client
            .from("player_claim_requests")
            .select("id,created_at,status")
            .eq("requester_user_id", admin.userId)
            .in("status", ["pending", "approved", "rejected"])
            .order("created_at", { ascending: false }),
          client
            .from("player_update_requests")
            .select("id,player_id,created_at,status")
            .eq("requester_user_id", admin.userId)
            .in("status", ["pending", "approved", "rejected"])
            .order("created_at", { ascending: false }),
          client
            .from("admin_requests")
            .select("id,created_at,status")
            .eq("requester_user_id", admin.userId)
            .in("status", ["pending", "approved", "rejected"])
            .order("created_at", { ascending: false }),
          client
            .from("premium_requests")
            .select("id,created_at,status")
            .eq("requester_user_id", admin.userId)
            .in("status", ["pending", "approved", "rejected"])
            .order("created_at", { ascending: false }),
        ]);

        if (resultRes.error || claimRes.error || updateRes.error || adminReqRes.error || premiumRes.error) {
          const firstError =
            resultRes.error?.message ??
            claimRes.error?.message ??
            updateRes.error?.message ??
            adminReqRes.error?.message ??
            premiumRes.error?.message ??
            "Unknown error";
          setMessage(`Failed to load notifications: ${firstError}`);
          return;
        }

        const resultRows = (resultRes.data ?? []) as ResultRow[];
        const labels = await loadMatchLabels(resultRows);
        resultRows.forEach((r) => {
          out.push({
            key: `result:${r.id}`,
            title: `Result submission ${r.status}`,
            detail: labels.get(r.match_id) ?? `Match ${r.match_id.slice(0, 8)}`,
            created_at: r.submitted_at,
            href: `/matches/${r.match_id}`,
            status: r.status,
          });
        });
        (claimRes.data ?? []).forEach((r: { id: string; created_at: string; status: string }) => {
          out.push({
            key: `claim:${r.id}`,
            title: `Profile claim ${r.status}`,
            detail: r.status === "pending" ? "Open claim status" : "Open dashboard",
            created_at: r.created_at,
            href: r.status === "pending" ? "/?claimStatus=1" : "/",
            status: r.status,
          });
        });
        const updateRows = (updateRes.data ?? []) as Array<{ id: string; player_id: string; created_at: string; status: string }>;
        const playerNameById = await loadPlayerNameMap(Array.from(new Set(updateRows.map((row) => row.player_id).filter(Boolean))));
        updateRows.forEach((r) => {
          out.push({
            key: `update:${r.id}`,
            title: `Profile update ${r.status}`,
            detail: playerNameById.get(r.player_id) ?? "Unknown player",
            created_at: r.created_at,
            href: "/players",
            status: r.status,
          });
        });
        (adminReqRes.data ?? []).forEach((r: { id: string; created_at: string; status: string }) => {
          out.push({
            key: `admin:${r.id}`,
            title: `Admin access request ${r.status}`,
            detail: "Open your profile",
            created_at: r.created_at,
            href: "/",
            status: r.status,
          });
        });
        (premiumRes.data ?? []).forEach((r: { id: string; created_at: string; status: string }) => {
          out.push({
            key: `premium:${r.id}`,
            title: `Premium request ${r.status}`,
            detail: "Open Premium page",
            created_at: r.created_at,
            href: "/premium",
            status: r.status,
          });
        });
      }

      out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(out);
    };
    load();
  }, [admin.loading, admin.isAdmin, admin.isSuper, admin.userId]);

  const visible = useMemo(() => items.filter((n) => !dismissed.has(n.key)), [items, dismissed]);
  const roleSummary = getRoleSummary(admin.isSuper, admin.isAdmin);
  const totalItems = items.length;
  const visibleCount = visible.length;
  const dismissedCount = Math.max(0, totalItems - visibleCount);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Notifications" eyebrow="Inbox" subtitle="Track club updates, approvals, and account activity." />
          <section className={`rounded-3xl border border-slate-200 bg-gradient-to-r ${roleSummary.accent} p-5 shadow-sm`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${roleSummary.badgeClass}`}>
                  {roleSummary.label}
                </span>
                <p className="max-w-2xl text-sm text-slate-700">{roleSummary.description}</p>
              </div>
              <div className="grid min-w-[220px] flex-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Visible</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{visibleCount}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">All items</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{totalItems}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cleared</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{dismissedCount}</p>
                </div>
              </div>
            </div>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Latest updates</p>
                <p className="text-sm text-slate-600">Items stay here until you remove them.</p>
              </div>
              <button
                type="button"
                onClick={() => saveDismissed(new Set(items.map((n) => n.key)))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              >
                Clear all
              </button>
            </div>
            <MessageModal message={message} onClose={() => setMessage(null)} />
            <div className="space-y-3">
              {visible.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                  No updates right now.
                </div>
              ) : null}
              {visible.map((n) => (
                <div key={n.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Link href={n.href} className="min-w-[220px] flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">{n.title}</p>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusMeta(
                            n.status
                          ).pillClass}`}
                        >
                          {getStatusMeta(n.status).label}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-slate-600">{n.detail}</p>
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </Link>
                    <div className="flex items-start">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(dismissed);
                          next.add(n.key);
                          saveDismissed(next);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
