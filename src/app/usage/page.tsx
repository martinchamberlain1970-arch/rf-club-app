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
  actor_email: string | null;
  actor_role: string | null;
  path: string;
};

type WindowKey = "24h" | "7d" | "30d";

export default function UsagePage() {
  const admin = useAdminStatus();
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      if (admin.loading) return;
      if (!admin.isSuper) {
        setLoading(false);
        return;
      }
      const client = supabase;
      if (!client) {
        setLoading(false);
        return;
      }
      const ms = windowKey === "24h" ? 24 * 60 * 60 * 1000 : windowKey === "7d" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const sinceIso = new Date(Date.now() - ms).toISOString();
      setLoading(true);
      const res = await client
        .from("usage_events")
        .select("id,created_at,actor_email,actor_role,path")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (res.error) setMessage(res.error.message);
      else setRows((res.data ?? []) as UsageRow[]);
      setLoading(false);
    };
    run();
  }, [admin.loading, admin.isSuper, windowKey]);

  const totals = useMemo(() => {
    const byPath = new Map<string, number>();
    let adminViews = 0;
    let userViews = 0;
    for (const r of rows) {
      byPath.set(r.path, (byPath.get(r.path) ?? 0) + 1);
      if (r.actor_role === "owner" || r.actor_role === "admin") adminViews += 1;
      else userViews += 1;
    }
    return {
      total: rows.length,
      adminViews,
      userViews,
      topPaths: Array.from(byPath.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12),
    };
  }, [rows]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Usage Analytics" eyebrow="Analytics" subtitle="Super User usage summary." />
          {!admin.loading && !admin.isSuper ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Only the Super User can access usage analytics.
            </section>
          ) : null}
          {admin.isSuper ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setWindowKey("24h")}
                  className={`rounded-full border px-3 py-1 text-sm ${windowKey === "24h" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  Last 24h
                </button>
                <button
                  type="button"
                  onClick={() => setWindowKey("7d")}
                  className={`rounded-full border px-3 py-1 text-sm ${windowKey === "7d" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  Last 7d
                </button>
                <button
                  type="button"
                  onClick={() => setWindowKey("30d")}
                  className={`rounded-full border px-3 py-1 text-sm ${windowKey === "30d" ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  Last 30d
                </button>
              </div>

              <MessageModal message={message ?? (!supabase ? "Supabase is not configured." : null)} onClose={() => setMessage(null)} />
              {loading ? <p className="text-sm text-slate-600">Loading usage...</p> : null}

              {!loading ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Total page views</p>
                      <p className="text-2xl font-bold text-slate-900">{totals.total}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Admin/Super views</p>
                      <p className="text-2xl font-bold text-slate-900">{totals.adminViews}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">User views</p>
                      <p className="text-2xl font-bold text-slate-900">{totals.userViews}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">Top pages</div>
                    <div className="max-h-80 overflow-auto">
                      {totals.topPaths.length === 0 ? (
                        <p className="p-3 text-sm text-slate-600">No usage data in this window.</p>
                      ) : (
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="px-3 py-2 text-left font-medium text-slate-700">Path</th>
                              <th className="px-3 py-2 text-left font-medium text-slate-700">Views</th>
                            </tr>
                          </thead>
                          <tbody>
                            {totals.topPaths.map(([path, count]) => (
                              <tr key={path} className="border-b border-slate-100">
                                <td className="px-3 py-2 text-slate-800">{path}</td>
                                <td className="px-3 py-2 text-slate-700">{count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
