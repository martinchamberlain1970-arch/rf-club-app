"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import MessageModal from "@/components/MessageModal";
import { supabase } from "@/lib/supabase";

type UsageRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  path: string;
};

type AuditRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: "auth_sign_in" | "auth_sign_out";
};

type AppUser = {
  id: string;
  email: string | null;
  role: string | null;
  linked_player_id: string | null;
  created_at: string;
};

type Player = { id: string; display_name: string; full_name: string | null };
type WindowKey = "24h" | "7d" | "30d";

const WINDOW_MS: Record<WindowKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const WINDOW_LABELS: Record<WindowKey, string> = { "24h": "Last 24h", "7d": "Last 7 days", "30d": "Last 30 days" };

function featureLabel(path: string) {
  if (path === "/") return "Dashboard";
  if (path.startsWith("/my-fixtures")) return "My fixtures";
  if (path.startsWith("/table-bookings")) return "Table bookings";
  if (path.startsWith("/competitions/") || path.startsWith("/events")) return "Competitions";
  if (path.startsWith("/matches/")) return "Match scoring";
  if (path.startsWith("/league/")) return "League fixtures & table";
  if (path.startsWith("/rankings")) return "Rankings";
  if (path.startsWith("/stats")) return "Statistics";
  if (path.startsWith("/quick-match")) return "Quick match";
  if (path.startsWith("/results")) return "Results review";
  if (path.startsWith("/players")) return "Players";
  if (path.startsWith("/signups") || path.startsWith("/signup-requests")) return "Sign-ups";
  if (path.startsWith("/notifications")) return "Notifications";
  if (path.startsWith("/high-breaks")) return "High breaks";
  if (path.startsWith("/install")) return "Install app";
  if (path.startsWith("/audit")) return "Audit log";
  if (path.startsWith("/usage")) return "Activity dashboard";
  return path.split("?")[0] || "Other";
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "No record";
}

export default function UsagePage() {
  const admin = useAdminStatus();
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [authRows, setAuthRows] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [referenceTime, setReferenceTime] = useState(() => Date.now());

  useEffect(() => {
    const run = async () => {
      if (admin.loading) return;
      if (!admin.isSuper) {
        setLoading(false);
        return;
      }
      const client = supabase;
      if (!client) {
        setMessage("Supabase is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      const usageSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const [usageResult, authResult, usersResult] = await Promise.all([
        client
          .from("usage_events")
          .select("id,created_at,actor_user_id,actor_email,actor_role,path")
          .gte("created_at", usageSince)
          .order("created_at", { ascending: false })
          .limit(10000),
        client
          .from("audit_logs")
          .select("id,created_at,actor_user_id,actor_email,action")
          .in("action", ["auth_sign_in", "auth_sign_out"])
          .order("created_at", { ascending: false })
          .limit(10000),
        client
          .from("app_users")
          .select("id,email,role,linked_player_id,created_at")
          .order("created_at", { ascending: false }),
      ]);
      const error = usageResult.error || authResult.error || usersResult.error;
      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }
      const loadedUsers = (usersResult.data ?? []) as AppUser[];
      const playerIds = [...new Set(loadedUsers.map((user) => user.linked_player_id).filter(Boolean) as string[])];
      const playerResult = playerIds.length
        ? await client.from("players").select("id,display_name,full_name").in("id", playerIds)
        : { data: [] as Player[], error: null };
      if (playerResult.error) setMessage(playerResult.error.message);
      setUsageRows((usageResult.data ?? []) as UsageRow[]);
      setAuthRows((authResult.data ?? []) as AuditRow[]);
      setUsers(loadedUsers);
      setPlayers((playerResult.data ?? []) as Player[]);
      setReferenceTime(Date.now());
      setLoading(false);
    };
    void run();
  }, [admin.loading, admin.isSuper]);

  const windowStart = referenceTime - WINDOW_MS[windowKey];
  const windowUsage = useMemo(
    () => usageRows.filter((row) => new Date(row.created_at).getTime() >= windowStart),
    [usageRows, windowStart]
  );
  const windowAuth = useMemo(
    () => authRows.filter((row) => new Date(row.created_at).getTime() >= windowStart),
    [authRows, windowStart]
  );

  const playerNames = useMemo(
    () => new Map(players.map((player) => [player.id, player.full_name?.trim() || player.display_name])),
    [players]
  );

  const activityByUser = useMemo(() => {
    const map = new Map<string, { lastUsed: string | null; lastSignIn: string | null; lastSignOut: string | null; views: number; features: Map<string, number> }>();
    const get = (id: string) => {
      const current = map.get(id) ?? { lastUsed: null, lastSignIn: null, lastSignOut: null, views: 0, features: new Map<string, number>() };
      map.set(id, current);
      return current;
    };
    for (const row of usageRows) {
      if (!row.actor_user_id) continue;
      const current = get(row.actor_user_id);
      if (!current.lastUsed) current.lastUsed = row.created_at;
    }
    for (const row of windowUsage) {
      if (!row.actor_user_id) continue;
      const current = get(row.actor_user_id);
      current.views += 1;
      const feature = featureLabel(row.path);
      current.features.set(feature, (current.features.get(feature) ?? 0) + 1);
    }
    for (const row of authRows) {
      if (!row.actor_user_id) continue;
      const current = get(row.actor_user_id);
      if (row.action === "auth_sign_in" && !current.lastSignIn) current.lastSignIn = row.created_at;
      if (row.action === "auth_sign_out" && !current.lastSignOut) current.lastSignOut = row.created_at;
    }
    return map;
  }, [authRows, usageRows, windowUsage]);

  const accountRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .map((user) => {
        const activity = activityByUser.get(user.id);
        const name = user.linked_player_id ? playerNames.get(user.linked_player_id) || "Linked player" : "Not linked";
        const topFeatures = [...(activity?.features.entries() ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return { user, activity, name, topFeatures };
      })
      .filter((row) => !q || [row.name, row.user.email, row.user.role].some((value) => String(value ?? "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const aDate = a.activity?.lastUsed || a.activity?.lastSignIn || a.user.created_at;
        const bDate = b.activity?.lastUsed || b.activity?.lastSignIn || b.user.created_at;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
  }, [activityByUser, playerNames, query, users]);

  const summary = useMemo(() => {
    const activeIds = new Set(windowUsage.map((row) => row.actor_user_id).filter(Boolean));
    const byFeature = new Map<string, number>();
    for (const row of windowUsage) {
      const feature = featureLabel(row.path);
      byFeature.set(feature, (byFeature.get(feature) ?? 0) + 1);
    }
    return {
      activeAccounts: activeIds.size,
      signIns: windowAuth.filter((row) => row.action === "auth_sign_in").length,
      signOuts: windowAuth.filter((row) => row.action === "auth_sign_out").length,
      topFeatures: [...byFeature.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    };
  }, [windowAuth, windowUsage]);

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Accounts & Activity" eyebrow="Super User" subtitle="Registered accounts, login activity, and the app areas people use." />
          {!admin.loading && !admin.isSuper ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">Only the Super User can access account activity.</section> : null}
          {admin.isSuper ? <>
            <MessageModal message={message} onClose={() => setMessage(null)} />
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">{(["24h", "7d", "30d"] as WindowKey[]).map((key) => <button key={key} type="button" onClick={() => setWindowKey(key)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${windowKey === key ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{WINDOW_LABELS[key]}</button>)}</div>
                <p className="text-xs text-slate-500">Sign-outs are recorded when a person uses the app&apos;s Sign out button.</p>
              </div>
              {loading ? <p className="mt-4 text-sm text-slate-600">Loading account activity…</p> : <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[['Registered accounts', users.length], ['Active accounts', summary.activeAccounts], ['Page views', windowUsage.length], ['Sign-ins', summary.signIns], ['Explicit sign-outs', summary.signOuts]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-950">{value}</p></div>)}
                </div>
              </>}
            </section>

            {!loading ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-black text-slate-950">Who has registered and what they use</h2><p className="text-sm text-slate-600">Usage counts and favourite areas use the selected period; last activity looks back up to 90 days.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or email…" className="w-full rounded-lg border border-slate-300 px-3 py-2 sm:w-72" /></div>
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{["Player / account", "Registered", "Last sign-in", "Last sign-out", "Last active", `Use (${WINDOW_LABELS[windowKey]})`].map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">{heading}</th>)}</tr></thead><tbody>{accountRows.map(({ user, activity, name, topFeatures }) => <tr key={user.id} className="border-t border-slate-200 align-top"><td className="px-3 py-3"><p className="font-bold text-slate-950">{name}</p><p className="text-slate-600">{user.email || "No email"}</p><p className="text-xs uppercase text-slate-500">{user.role || "user"}{user.linked_player_id ? " · linked" : " · unlinked"}</p></td><td className="whitespace-nowrap px-3 py-3 text-slate-700">{displayDate(user.created_at)}</td><td className="whitespace-nowrap px-3 py-3 text-slate-700">{displayDate(activity?.lastSignIn)}</td><td className="whitespace-nowrap px-3 py-3 text-slate-700">{displayDate(activity?.lastSignOut)}</td><td className="whitespace-nowrap px-3 py-3 text-slate-700">{displayDate(activity?.lastUsed)}</td><td className="min-w-64 px-3 py-3 text-slate-700"><p className="font-bold text-slate-950">{activity?.views ?? 0} page views</p>{topFeatures.length ? <p className="mt-1 text-xs">{topFeatures.map(([feature, count]) => `${feature} (${count})`).join(" · ")}</p> : <p className="mt-1 text-xs text-slate-500">No recorded use in this period</p>}</td></tr>)}</tbody></table></div>
            </section> : null}

            {!loading ? <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-xl font-black text-slate-950">Most-used app areas</h2><div className="mt-3 space-y-2">{summary.topFeatures.length ? summary.topFeatures.map(([feature, count]) => <div key={feature} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="font-medium text-slate-800">{feature}</span><strong className="text-slate-950">{count}</strong></div>) : <p className="text-sm text-slate-600">No usage in this period.</p>}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-xl font-black text-slate-950">Recent login activity</h2><div className="mt-3 max-h-96 space-y-2 overflow-auto">{authRows.slice(0, 40).map((row) => { const account = users.find((user) => user.id === row.actor_user_id); const name = account?.linked_player_id ? playerNames.get(account.linked_player_id) : null; return <div key={row.id} className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-950">{name || row.actor_email || "Account"} · {row.action === "auth_sign_in" ? "Signed in" : "Signed out"}</p><p className="text-xs text-slate-500">{displayDate(row.created_at)}</p></div>; })}{!authRows.length ? <p className="text-sm text-slate-600">No login activity has been recorded yet.</p> : null}</div></section></div> : null}
          </> : null}
        </RequireAuth>
      </div>
    </main>
  );
}
