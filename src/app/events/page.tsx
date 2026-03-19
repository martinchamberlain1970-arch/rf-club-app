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
  handicap_enabled?: boolean;
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

function getRoleSummary(isSuper: boolean, isAdmin: boolean) {
  if (isSuper) {
    return {
      label: "Super User",
      description: "Review competitions across the system, monitor progress, and manage archived event history.",
      accent: "from-amber-50 via-white to-teal-50",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (isAdmin) {
    return {
      label: "Club Admin",
      description: "Create competitions, monitor live progress, and manage completed or archived events for your club.",
      accent: "from-sky-50 via-white to-emerald-50",
      badgeClass: "border-sky-200 bg-sky-50 text-sky-800",
    };
  }
  return {
    label: "Player",
    description: "Browse active, completed, and archived competitions for your club.",
    accent: "from-indigo-50 via-white to-teal-50",
    badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-800",
  };
}

function getSportMeta(sport: Competition["sport_type"]) {
  switch (sport) {
    case "pool_8_ball":
      return {
        label: "Pool (8-ball)",
        cardClass: "border-cyan-200 bg-cyan-50 text-cyan-800",
      };
    case "pool_9_ball":
      return {
        label: "Pool (9-ball)",
        cardClass: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
      };
    case "snooker":
    default:
      return {
        label: "Snooker",
        cardClass: "border-amber-200 bg-amber-50 text-amber-800",
      };
  }
}

type OverviewTone = "teal" | "indigo" | "amber" | "emerald";

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
          .select("id,name,sport_type,competition_format,match_mode,handicap_enabled,best_of,is_practice,is_archived,is_completed,created_at")
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
  const roleSummary = getRoleSummary(admin.isSuper, admin.isAdmin);
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
  const overviewCards = useMemo(
    () => [
      {
        title: "Active Competitions",
        value: open.length,
        detail: "Current competitions available to play, review, or manage.",
        tone: "teal" as OverviewTone,
      },
      {
        title: "Completed",
        value: completed.length,
        detail: "Competitions with a confirmed winner and finished bracket.",
        tone: "emerald" as OverviewTone,
      },
      {
        title: "Archived",
        value: archived.length,
        detail: "Older competitions kept for history and audit only.",
        tone: "amber" as OverviewTone,
      },
      {
        title: "Matches In Progress",
        value: Array.from(statsByComp.values()).reduce((sum, stat) => sum + stat.inProgress, 0),
        detail: "Live or partially-completed matches still moving through the system.",
        tone: "indigo" as OverviewTone,
      },
    ],
    [archived.length, completed.length, open.length, statsByComp]
  );
  const overviewCardClass = (tone: OverviewTone) => {
    if (tone === "teal") return "border-teal-200 bg-gradient-to-br from-teal-50 to-white";
    if (tone === "indigo") return "border-indigo-200 bg-gradient-to-br from-indigo-50 to-white";
    if (tone === "amber") return "border-amber-200 bg-gradient-to-br from-amber-50 to-white";
    return "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white";
  };
  const overviewValueClass = (tone: OverviewTone) => {
    if (tone === "teal") return "text-teal-700";
    if (tone === "indigo") return "text-indigo-700";
    if (tone === "amber") return "text-amber-700";
    return "text-emerald-700";
  };

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
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Active</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{open.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Completed</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{completed.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Archived</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{archived.length}</p>
                </div>
              </div>
            </div>
          </section>

          <section className={cardBaseClass}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Competition Overview</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">Club Competition Timeline</h2>
                <p className="mt-1 text-sm text-slate-600">
                  A clearer read of what is live, what is complete, and where competition activity still needs attention.
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                {activeRows.length > 0 ? `${activeRows.length} shown in current view` : "No competitions in this view"}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {overviewCards.map((card) => (
                <div key={card.title} className={`rounded-2xl border p-4 shadow-sm ${overviewCardClass(card.tone)}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{card.title}</p>
                  <p className={`mt-2 text-3xl font-black ${overviewValueClass(card.tone)}`}>{card.value}</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">{card.detail}</p>
                </div>
              ))}
            </div>
          </section>

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
            <div className="grid gap-3">
              {activeRows.map((r) => {
                const sportMeta = getSportMeta(r.sport_type);
                const competitionStats = statsByComp.get(r.id);
                return (
                  <article key={r.id} className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-[240px] flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${sportMeta.cardClass}`}>
                            {sportMeta.label}
                          </span>
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
                            {r.competition_format === "knockout" ? "Knockout" : "League"}
                          </span>
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
                            {r.match_mode === "doubles" ? "Doubles" : "Singles"}
                          </span>
                          {r.handicap_enabled ? (
                            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                              Handicapped
                            </span>
                          ) : null}
                          {r.is_practice ? (
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
                              Practice
                            </span>
                          ) : null}
                        </div>
                        <div>
                          <h2 className="text-2xl font-black text-slate-950">{r.name}</h2>
                          <p className="mt-1 text-sm text-slate-500">Created {fmtDate.format(new Date(r.created_at))}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">Format</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">{r.match_mode === "doubles" ? "Doubles" : "Singles"}</p>
                          </div>
                          <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Match Length</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">Best of {r.best_of}</p>
                          </div>
                          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Progress</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {competitionStats ? `${competitionStats.done}/${competitionStats.total} complete` : "No matches yet"}
                            </p>
                          </div>
                        </div>
                        {competitionStats?.inProgress ? (
                          <p className="text-sm text-slate-600">{competitionStats.inProgress} match(es) currently in progress.</p>
                        ) : null}
                      </div>
                      <div className="flex min-w-[180px] flex-col items-start gap-3">
                        <Link href={`/competitions/${r.id}`} className={buttonPrimaryClass}>
                          Open event
                        </Link>
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
                              className={actionSecondaryClass}
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
                              className={actionDangerClass}
                            >
                              Delete permanently
                            </button>
                          </>
                        ) : admin.isAdmin ? (
                          <>
                            <button
                              type="button"
                              onClick={() => restoreEvent(r)}
                              className={actionSuccessClass}
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
                              className={actionDangerClass}
                            >
                              Delete permanently
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
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
