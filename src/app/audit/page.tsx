"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import useAdminStatus from "@/components/useAdminStatus";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";
import { supabase } from "@/lib/supabase";

type AuditRow = {
  id: string;
  created_at: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
};

type MatchRow = {
  id: string;
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
};

type PlayerRow = { id: string; display_name: string; full_name: string | null };

const ACTION_LABELS: Record<string, string> = {
  auth_sign_in: "Signed in",
  auth_sign_up: "Created account",
  quick_match_created: "Created quick match",
  competition_created: "Created competition",
  competition_archived: "Archived event",
  competition_restored: "Restored event",
  competition_deleted: "Deleted event",
  match_progress_saved: "Saved match progress",
  match_completed: "Completed match",
  match_walkover_awarded: "Awarded walkover",
  match_archived: "Archived match",
  match_restored: "Restored match",
  match_deleted: "Deleted match",
  result_submitted_for_approval: "Submitted result for approval",
  result_approved: "Approved submitted result",
  result_rejected: "Rejected submitted result",
  location_created: "Created location",
  profile_deletion_user_removed: "Removed linked login after profile deletion approval",
};

export default function AuditPage() {
  const admin = useAdminStatus();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [entityLabels, setEntityLabels] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
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
        setMessage("Supabase is not configured.");
        setLoading(false);
        return;
      }
      const res = await client
        .from("audit_logs")
        .select("id,created_at,actor_email,actor_role,action,entity_type,entity_id,summary")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (res.error) {
        setMessage(res.error.message);
      } else {
        const loaded = (res.data ?? []) as AuditRow[];
        setRows(loaded);

        const competitionIds = Array.from(
          new Set(loaded.filter((r) => r.entity_type === "competition" && r.entity_id).map((r) => r.entity_id as string))
        );
        const matchIds = Array.from(
          new Set(loaded.filter((r) => r.entity_type === "match" && r.entity_id).map((r) => r.entity_id as string))
        );
        const playerIds = Array.from(
          new Set(loaded.filter((r) => r.entity_type === "player" && r.entity_id).map((r) => r.entity_id as string))
        );
        const submissionIds = Array.from(
          new Set(loaded.filter((r) => r.entity_type === "result_submission" && r.entity_id).map((r) => r.entity_id as string))
        );

        const labels = new Map<string, string>();

        if (competitionIds.length) {
          const cRes = await client.from("competitions").select("id,name").in("id", competitionIds);
          for (const c of cRes.data ?? []) labels.set(`competition:${c.id}`, c.name ?? "Competition");
        }

        const neededMatchIds = new Set<string>(matchIds);
        if (submissionIds.length) {
          const rsRes = await client.from("result_submissions").select("id,match_id").in("id", submissionIds);
          for (const s of rsRes.data ?? []) {
            labels.set(`result_submission:${s.id}`, `Submission for match ${String(s.match_id).slice(0, 8)}`);
            neededMatchIds.add(String(s.match_id));
          }
        }

        const finalMatchIds = Array.from(neededMatchIds);
        if (finalMatchIds.length) {
          const mRes = await client
            .from("matches")
            .select("id,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id")
            .in("id", finalMatchIds);
          const matches = (mRes.data ?? []) as MatchRow[];
          const allPlayerIds = Array.from(
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
          const pRes = allPlayerIds.length
            ? await client.from("players").select("id,display_name,full_name").in("id", allPlayerIds)
            : { data: [] as PlayerRow[] };
          const nameById = new Map(
            (pRes.data ?? []).map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])
          );
          const single = (id: string | null) => (id ? nameById.get(id) ?? "TBC" : "TBC");
          const team = (a: string | null, b: string | null) => `${single(a)} & ${single(b)}`;
          for (const m of matches) {
            const left =
              m.match_mode === "doubles" ? team(m.team1_player1_id, m.team1_player2_id) : single(m.player1_id);
            const right =
              m.match_mode === "doubles" ? team(m.team2_player1_id, m.team2_player2_id) : single(m.player2_id);
            labels.set(`match:${m.id}`, `${left} vs ${right}`);
          }
        }

        if (playerIds.length) {
          const pRes = await client.from("players").select("id,display_name,full_name").in("id", playerIds);
          for (const p of pRes.data ?? []) {
            labels.set(`player:${p.id}`, p.full_name?.trim() ? p.full_name : p.display_name);
          }
        }

        setEntityLabels(labels);
      }
      setLoading(false);
    };
    run();
  }, [admin.loading, admin.isSuper]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.actor_email, r.actor_role, r.action, r.entity_type, r.entity_id, r.summary]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, query]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Audit Log" eyebrow="Admin" subtitle="Super User activity trail." />
          {!admin.loading && !admin.isSuper ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Only the Super User can access Audit Log.
            </section>
          ) : null}
          {admin.isSuper ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  placeholder="Search by user, action, entity, or summary..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <MessageModal message={message} onClose={() => setMessage(null)} />
              {loading ? <p className="text-sm text-slate-600">Loading audit log...</p> : null}
              {!loading && filtered.length === 0 ? <p className="text-sm text-slate-600">No audit entries.</p> : null}
              {!loading && filtered.length > 0 ? (
                <div className="overflow-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">When</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Who</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Role</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Action</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Entity</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id} className="border-t border-slate-200">
                          <td className="px-3 py-2 text-slate-700">{new Date(r.created_at).toLocaleString()}</td>
                          <td className="px-3 py-2 text-slate-700">{r.actor_email || "-"}</td>
                          <td className="px-3 py-2 text-slate-700">{r.actor_role || "-"}</td>
                          <td className="px-3 py-2 font-medium text-slate-900" title={r.action}>
                            {ACTION_LABELS[r.action] ?? r.action.replaceAll("_", " ")}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {r.entity_type && r.entity_id
                              ? entityLabels.get(`${r.entity_type}:${r.entity_id}`) || `${r.entity_type}: ${r.entity_id.slice(0, 8)}`
                              : "-"}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{r.summary || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
