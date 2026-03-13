"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import { supabase } from "@/lib/supabase";
import useAdminStatus from "@/components/useAdminStatus";
import ScreenHeader from "@/components/ScreenHeader";
import { logAudit } from "@/lib/audit";
import ConfirmModal from "@/components/ConfirmModal";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";

type Competition = {
  id: string;
  name: string;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  competition_format: "knockout" | "league";
  match_mode: "singles" | "doubles";
  best_of: number;
  is_practice: boolean;
  is_archived: boolean;
  is_completed: boolean;
  created_at: string;
};

type MatchRow = {
  competition_id: string;
  status: "pending" | "in_progress" | "complete" | "bye";
  updated_at: string;
  is_archived?: boolean | null;
};

type Tab = "open" | "completed" | "archived";

function tabFromUrl(): Tab {
  if (typeof window === "undefined") return "open";
  const t = new URLSearchParams(window.location.search).get("tab");
  return t === "completed" || t === "archived" ? t : "open";
}

const fmtDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function EventsPage() {
  const admin = useAdminStatus();
  const [rows, setRows] = useState<Competition[]>([]);
  const [matchRows, setMatchRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabFromUrl());
  const [infoModal, setInfoModal] = useState<{ title: string; description: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    tone?: "default" | "danger";
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const cardBaseClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillActiveClass = `${pillBaseClass} border-teal-700 bg-teal-700 text-white`;
  const pillInactiveClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const buttonPrimaryClass = "rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800";
  const actionSecondaryClass = "inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-50";
  const actionDangerClass = "inline-flex items-center rounded-xl border border-rose-300 bg-white px-3 py-1 text-sm font-medium text-rose-700 transition hover:bg-rose-50";
  const actionSuccessClass = "inline-flex items-center rounded-xl border border-emerald-300 bg-white px-3 py-1 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50";

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const load = async () => {
      const [compRes, matchesRes] = await Promise.all([
        client
          .from("competitions")
          .select("id,name,sport_type,competition_format,match_mode,best_of,is_practice,is_archived,is_completed,created_at")
          .order("created_at", { ascending: false }),
        client
          .from("matches")
          .select("competition_id,status,updated_at,is_archived"),
      ]);
      if (!active) return;
      if (compRes.error || !compRes.data) {
        setMessage(compRes.error?.message ?? "Failed to load events.");
        setLoading(false);
        return;
      }
      setRows(compRes.data as Competition[]);
      setMatchRows((matchesRes.data ?? []) as MatchRow[]);
      setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const open = useMemo(() => rows.filter((r) => !r.is_archived && !r.is_completed), [rows]);
  const completed = useMemo(() => rows.filter((r) => !r.is_archived && r.is_completed), [rows]);
  const archived = useMemo(() => rows.filter((r) => r.is_archived), [rows]);
  const activeRows = tab === "archived" ? archived : tab === "completed" ? completed : open;
  const statsByComp = useMemo(() => {
    const map = new Map<string, { total: number; done: number; inProgress: number; lastUpdated: string | null }>();
    for (const m of matchRows) {
      if (m.is_archived) continue;
      const prev = map.get(m.competition_id) ?? { total: 0, done: 0, inProgress: 0, lastUpdated: null };
      prev.total += 1;
      if (m.status === "complete" || m.status === "bye") prev.done += 1;
      if (m.status === "in_progress") prev.inProgress += 1;
      if (!prev.lastUpdated || new Date(m.updated_at).getTime() > new Date(prev.lastUpdated).getTime()) {
        prev.lastUpdated = m.updated_at;
      }
      map.set(m.competition_id, prev);
    }
    return map;
  }, [matchRows]);

  const deleteEvent = async (row: Competition) => {
    const client = supabase;
    if (!client) return;
    setMessage(null);
    const matchIdRes = await client.from("matches").select("id").eq("competition_id", row.id);
    if (matchIdRes.error) {
      setMessage(`Failed to load event matches: ${matchIdRes.error.message}`);
      return;
    }
    const matchIds = (matchIdRes.data ?? []).map((m) => m.id as string);
    if (matchIds.length > 0) {
      const subRes = await client.from("result_submissions").delete().in("match_id", matchIds);
      if (subRes.error) {
        setMessage(`Failed to delete result submissions: ${subRes.error.message}`);
        return;
      }
      const frameRes = await client.from("frames").delete().in("match_id", matchIds);
      if (frameRes.error) {
        setMessage(`Failed to delete frames: ${frameRes.error.message}`);
        return;
      }
      const matchRes = await client.from("matches").delete().eq("competition_id", row.id);
      if (matchRes.error) {
        setMessage(`Failed to delete matches: ${matchRes.error.message}`);
        return;
      }
    }
    const compRes = await client.from("competitions").delete().eq("id", row.id);
    if (compRes.error) {
      setMessage(`Failed to delete event: ${compRes.error.message}`);
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== row.id));
    setMatchRows((prev) => prev.filter((m) => m.competition_id !== row.id));
    await logAudit("competition_deleted", {
      entityType: "competition",
      entityId: row.id,
      summary: `Competition deleted permanently: ${row.name}.`,
    });
    setInfoModal({ title: "Event Deleted", description: `Event "${row.name}" deleted permanently.` });
  };

  const archiveEvent = async (row: Competition) => {
    const client = supabase;
    if (!client) return;
    const res = await client.from("competitions").update({ is_archived: true }).eq("id", row.id);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    await logAudit("competition_archived", {
      entityType: "competition",
      entityId: row.id,
      summary: `Competition archived: ${row.name}.`,
    });
    setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, is_archived: true } : x)));
  };

  const restoreEvent = async (row: Competition) => {
    const client = supabase;
    if (!client) return;
    const res = await client.from("competitions").update({ is_archived: false }).eq("id", row.id);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    await logAudit("competition_restored", {
      entityType: "competition",
      entityId: row.id,
      summary: `Competition restored: ${row.name}.`,
    });
    setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, is_archived: false } : x)));
  };

  const changeTab = (next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url.toString());
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <ScreenHeader title="Events" eyebrow="Events" subtitle="Run, review, and manage club competitions." />

          <div className="flex items-center gap-2">
            {admin.isAdmin ? (
              <Link href="/events/new" className={buttonPrimaryClass}>
                New Competition
              </Link>
            ) : null}
          </div>

          <section className={cardBaseClass}>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => changeTab("open")} className={tab === "open" ? pillActiveClass : pillInactiveClass}>Active ({open.length})</button>
              <button type="button" onClick={() => changeTab("completed")} className={tab === "completed" ? pillActiveClass : pillInactiveClass}>Completed ({completed.length})</button>
              <button type="button" onClick={() => changeTab("archived")} className={tab === "archived" ? pillActiveClass : pillInactiveClass}>Archived ({archived.length})</button>
            </div>
          </section>

          {loading ? <p className={cardBaseClass}>Loading competitions...</p> : null}
          <MessageModal message={message} onClose={() => setMessage(null)} />

          <section className="space-y-3">
            {activeRows.length === 0 ? (
              <p className={`${cardBaseClass} text-slate-600`}>
                {tab === "open" ? "No active competitions." : tab === "completed" ? "No completed competitions yet." : "No archived competitions."}
              </p>
            ) : null}
            {activeRows.map((r) => (
              <article key={r.id} className={cardBaseClass}>
                <h2 className="text-xl font-semibold text-slate-900">{r.name}</h2>
                <p className="mt-1 text-slate-700">
                  {r.sport_type === "pool_8_ball" ? "Pool (8-ball)" : r.sport_type === "pool_9_ball" ? "Pool (9-ball)" : "Snooker"} · {r.competition_format === "knockout" ? "Knockout" : "League"}{r.is_practice ? " · Practice match" : ""}
                </p>
                <p className="mt-1 text-slate-700">Format: {r.match_mode === "doubles" ? "Doubles" : "Singles"}</p>
                <p className="mt-1 text-slate-700">Best of {r.best_of}</p>
                {statsByComp.get(r.id) ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Progress: {statsByComp.get(r.id)!.done}/{statsByComp.get(r.id)!.total} matches complete
                    {statsByComp.get(r.id)!.inProgress > 0 ? ` · ${statsByComp.get(r.id)!.inProgress} in progress` : ""}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-slate-500">Created {fmtDate.format(new Date(r.created_at))}</p>
                <Link href={`/competitions/${r.id}`} className={`${buttonPrimaryClass} mt-2 inline-flex`}>Open event</Link>
                {admin.isAdmin && tab !== "archived" ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          title: "Archive competition",
                          description: `Archive "${r.name}"? This hides it from the main list but keeps the results and stats.`,
                          confirmLabel: "Archive",
                          onConfirm: async () => {
                            await archiveEvent(r);
                            setConfirmModal(null);
                          },
                        })
                      }
                      className={`ml-2 mt-2 ${actionSecondaryClass}`}
                    >
                      Archive
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          title: "Delete competition permanently",
                          description: "This will permanently remove the competition and its match data.",
                          confirmLabel: "Delete permanently",
                          tone: "danger",
                          onConfirm: async () => {
                            await deleteEvent(r);
                            setConfirmModal(null);
                          },
                        })
                      }
                      className={`ml-2 mt-2 ${actionDangerClass}`}
                    >
                      Delete permanently
                    </button>
                  </>
                ) : admin.isAdmin ? (
                  <>
                    <button
                      type="button"
                      onClick={() => restoreEvent(r)}
                      className={`ml-2 mt-2 ${actionSuccessClass}`}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          title: "Delete competition permanently",
                          description: "This will permanently remove the competition and its match data.",
                          confirmLabel: "Delete permanently",
                          tone: "danger",
                          onConfirm: async () => {
                            await deleteEvent(r);
                            setConfirmModal(null);
                          },
                        })
                      }
                      className={`ml-2 mt-2 ${actionDangerClass}`}
                    >
                      Delete permanently
                    </button>
                  </>
                ) : null}
              </article>
            ))}
          </section>
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
      </div>
    </main>
  );
}
