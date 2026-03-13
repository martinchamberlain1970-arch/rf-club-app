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
        (updateRes.data ?? []).forEach((r: { id: string; player_id: string; created_at: string; status: string }) => {
          out.push({
            key: `update:${r.id}`,
            title: "Profile update request pending",
            detail: `Player ${r.player_id}`,
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
        (updateRes.data ?? []).forEach((r: { id: string; player_id: string; created_at: string; status: string }) => {
          out.push({
            key: `update:${r.id}`,
            title: `Profile update ${r.status}`,
            detail: `Player ${r.player_id}`,
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

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Notifications" eyebrow="Inbox" subtitle="Track club updates, approvals, and account activity." />
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-700">
              {admin.isSuper
                ? "You are seeing system, approval, and club activity updates."
                : admin.isAdmin
                  ? "You are seeing competition and approval updates for club management."
                  : "You are seeing updates about your account, requests, and submitted results."}
            </p>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-slate-600">Items stay here until you remove them.</p>
              <button
                type="button"
                onClick={() => saveDismissed(new Set(items.map((n) => n.key)))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
              >
                Clear all
              </button>
            </div>
            <MessageModal message={message} onClose={() => setMessage(null)} />
            <div className="space-y-2">
              {visible.length === 0 ? <p className="text-sm text-slate-600">No updates right now.</p> : null}
              {visible.map((n) => (
                <div key={n.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <Link href={n.href} className="min-w-[220px] flex-1">
                    <p className="font-medium text-slate-900">{n.title}</p>
                    <p className="text-sm text-slate-600">{n.detail}</p>
                    <p className="text-xs text-slate-500">{new Date(n.created_at).toLocaleString()}</p>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set(dismissed);
                      next.add(n.key);
                      saveDismissed(next);
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
