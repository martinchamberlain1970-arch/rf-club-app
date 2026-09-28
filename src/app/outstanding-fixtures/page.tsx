"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import { logAudit } from "@/lib/audit";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";
import { resultSubmittedRescheduleNote } from "@/lib/reschedule-result-guard";
import { supabase } from "@/lib/supabase";

type CompetitionRow = {
  id: string;
  name: string;
  sport_type: string;
  competition_format: string;
  is_archived: boolean;
  is_completed: boolean;
  league_schedule_mode: string | null;
};

type MatchRow = {
  id: string;
  competition_id: string;
  player1_id: string | null;
  player2_id: string | null;
  scheduled_for: string | null;
  status: "pending" | "in_progress" | "complete" | "bye";
  round_no: number | null;
  match_no: number | null;
};

type PlayerRow = { id: string; display_name: string; full_name: string | null };
type RescheduleRow = {
  id: string;
  match_id: string;
  competition_id: string;
  original_scheduled_for: string;
  requested_scheduled_for: string;
  status: "pending" | "approved";
  note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type FixtureContact = { playerId: string; name: string; email: string | null; phone: string | null };

type OutstandingFixture = {
  match: MatchRow;
  competition: CompetitionRow;
  playerOne: string;
  playerTwo: string;
  deadline: Date;
  reschedule: RescheduleRow | null;
  overdue: boolean;
};

function displayDate(value: string | null) {
  if (!value) return "Date not set";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function displayDeadline(value: Date) {
  return value.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function whatsappNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `44${digits.slice(1)}`;
  return digits;
}

export default function OutstandingFixturesPage() {
  const admin = useAdminStatus();
  const canManage = admin.isAdmin || admin.isSuper;
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [reschedules, setReschedules] = useState<RescheduleRow[]>([]);
  const [submittedMatchIds, setSubmittedMatchIds] = useState<Set<string>>(new Set());
  const [competitionFilter, setCompetitionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue_unarranged" | "awaiting_reschedule" | "rescheduled" | "rescheduled_overdue">("all");
  const [contactsByMatch, setContactsByMatch] = useState<Record<string, FixtureContact[]>>({});
  const [contactLoadingId, setContactLoadingId] = useState<string | null>(null);
  const [reminderBusyId, setReminderBusyId] = useState<string | null>(null);
  const [rescheduleBusyId, setRescheduleBusyId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (admin.loading || !canManage) return;
    let cancelled = false;
    const load = async () => {
      const client = supabase;
      if (!client) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      const [competitionRes, matchRes, playerRes, rescheduleRes, submissionRes] = await Promise.all([
        client.from("competitions").select("id,name,sport_type,competition_format,is_archived,is_completed,league_schedule_mode").eq("competition_format", "league").eq("is_archived", false).eq("is_completed", false).neq("league_schedule_mode", "one_day"),
        client.from("matches").select("id,competition_id,player1_id,player2_id,scheduled_for,status,round_no,match_no").eq("is_archived", false).in("status", ["pending", "in_progress"]),
        client.from("players").select("id,display_name,full_name").eq("is_archived", false),
        client.from("league_reschedule_requests").select("id,match_id,competition_id,original_scheduled_for,requested_scheduled_for,status,note,reviewed_at,created_at").in("status", ["pending", "approved"]).order("created_at", { ascending: true }),
        client.from("result_submissions").select("match_id").eq("status", "pending"),
      ]);
      if (cancelled) return;
      const firstError = competitionRes.error || matchRes.error || playerRes.error || rescheduleRes.error || submissionRes.error;
      if (firstError) {
        setError(firstError.message || "Outstanding fixtures could not be loaded.");
      } else {
        setCompetitions((competitionRes.data ?? []) as CompetitionRow[]);
        setMatches((matchRes.data ?? []) as MatchRow[]);
        setPlayers((playerRes.data ?? []) as PlayerRow[]);
        setReschedules((rescheduleRes.data ?? []) as RescheduleRow[]);
        setSubmittedMatchIds(new Set((submissionRes.data ?? []).map((row) => String(row.match_id))));
        setError(null);
      }
      setLoading(false);
    };
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [admin.loading, canManage, refreshKey]);

  const competitionById = useMemo(() => new Map(competitions.map((competition) => [competition.id, competition])), [competitions]);
  const playerNameById = useMemo(() => new Map(players.map((player) => [player.id, player.full_name?.trim() || player.display_name])), [players]);
  const latestRescheduleByMatch = useMemo(() => {
    const map = new Map<string, RescheduleRow>();
    for (const request of reschedules) map.set(request.match_id, request);
    return map;
  }, [reschedules]);

  const outstanding = useMemo(() => {
    const now = new Date();
    return matches.flatMap((match): OutstandingFixture[] => {
      const competition = competitionById.get(match.competition_id);
      if (!competition || competition.is_archived || submittedMatchIds.has(match.id)) return [];
      if (!match.player1_id || !match.player2_id || match.player1_id === match.player2_id || !match.scheduled_for) return [];
      const deadline = getLeagueFixtureDeadline(match.scheduled_for, competition.name);
      if (!deadline) return [];
      const reschedule = latestRescheduleByMatch.get(match.id) ?? null;
      const overdue = deadline.getTime() < now.getTime();
      if (!overdue && !reschedule) return [];
      return [{
        match,
        competition,
        playerOne: playerNameById.get(match.player1_id) ?? "Unknown player",
        playerTwo: playerNameById.get(match.player2_id) ?? "Unknown player",
        deadline,
        reschedule,
        overdue,
      }];
    }).sort((a, b) => a.deadline.getTime() - b.deadline.getTime() || a.competition.name.localeCompare(b.competition.name));
  }, [competitionById, latestRescheduleByMatch, matches, playerNameById, submittedMatchIds]);

  const visibleFixtures = outstanding.filter((fixture) => {
    if (competitionFilter !== "all" && fixture.competition.id !== competitionFilter) return false;
    if (statusFilter === "overdue_unarranged" && (!fixture.overdue || fixture.reschedule?.status === "approved")) return false;
    if (statusFilter === "awaiting_reschedule" && fixture.reschedule?.status !== "pending") return false;
    if (statusFilter === "rescheduled" && fixture.reschedule?.status !== "approved") return false;
    if (statusFilter === "rescheduled_overdue" && (!fixture.overdue || fixture.reschedule?.status !== "approved")) return false;
    return true;
  });
  const listedCompetitions = [...new Map(outstanding.map((fixture) => [fixture.competition.id, fixture.competition])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const overdueUnarrangedCount = outstanding.filter((fixture) => fixture.overdue && fixture.reschedule?.status !== "approved").length;
  const awaitingRescheduleCount = outstanding.filter((fixture) => fixture.reschedule?.status === "pending").length;
  const rescheduledCount = outstanding.filter((fixture) => fixture.reschedule?.status === "approved").length;
  const appOrigin = typeof window === "undefined" ? "https://rf-club-app.vercel.app" : window.location.origin;

  const loadContacts = async (matchId: string) => {
    if (contactsByMatch[matchId]) {
      setContactsByMatch((current) => {
        const next = { ...current };
        delete next[matchId];
        return next;
      });
      return;
    }
    const client = supabase;
    if (!client) return;
    setContactLoadingId(matchId);
    const sessionResult = await client.auth.getSession();
    const token = sessionResult.data.session?.access_token;
    const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/contacts`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await response.json().catch(() => ({}));
    setContactLoadingId(null);
    if (!response.ok) {
      setNotice(body.error || "Player contact details could not be loaded.");
      return;
    }
    setContactsByMatch((current) => ({ ...current, [matchId]: (body.contacts ?? []) as FixtureContact[] }));
  };

  const sendEmailReminders = async (matchId: string) => {
    const client = supabase;
    if (!client) return;
    setReminderBusyId(matchId);
    const sessionResult = await client.auth.getSession();
    const token = sessionResult.data.session?.access_token;
    const response = await fetch("/api/admin/fixture-reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ matchId }),
    });
    const body = await response.json().catch(() => ({}));
    setReminderBusyId(null);
    if (!response.ok) {
      setNotice(body.error || "Fixture reminders could not be sent.");
      return;
    }
    const sent = Array.isArray(body.sent) ? body.sent.join(" and ") : "the available players";
    const missing = Array.isArray(body.missing) && body.missing.length ? ` No email address was available for ${body.missing.join(" and ")}.` : "";
    const failed = Array.isArray(body.failed) && body.failed.length ? ` Delivery failed for ${body.failed.join(" and ")}.` : "";
    setNotice(`Reminder sent to ${sent}.${missing}${failed}`);
  };

  const reviewReschedule = async (fixture: OutstandingFixture, decision: "approved" | "rejected") => {
    const client = supabase;
    const request = fixture.reschedule;
    if (!client || !admin.isSuper || !admin.userId || !request || request.status !== "pending") return;
    setRescheduleBusyId(request.id);
    if (decision === "approved") {
      const submissionResult = await client.from("result_submissions").select("id").eq("match_id", fixture.match.id).in("status", ["pending", "approved"]).limit(1).maybeSingle();
      if (submissionResult.error) {
        setRescheduleBusyId(null);
        setNotice(submissionResult.error.message);
        return;
      }
      if (submissionResult.data || fixture.match.status === "complete") {
        const closeResult = await client.from("league_reschedule_requests").update({ status: "rejected", reviewed_by_user_id: admin.userId, reviewed_at: new Date().toISOString(), note: resultSubmittedRescheduleNote(request.note) }).eq("id", request.id).eq("status", "pending");
        setRescheduleBusyId(null);
        if (closeResult.error) {
          setNotice(closeResult.error.message);
          return;
        }
        setNotice("A result has already been submitted, so it has been preserved and the reschedule request was closed.");
        setRefreshKey((value) => value + 1);
        return;
      }
      const frameResult = await client.from("frames").delete().eq("match_id", fixture.match.id);
      if (frameResult.error) {
        setRescheduleBusyId(null);
        setNotice(frameResult.error.message);
        return;
      }
      const submissionUpdate = await client.from("result_submissions").update({ status: "rejected", reviewed_by_user_id: admin.userId, reviewed_at: new Date().toISOString(), note: "Fixture rescheduled by Super User." }).eq("match_id", fixture.match.id).neq("status", "rejected");
      const matchUpdate = await client.from("matches").update({ scheduled_for: request.requested_scheduled_for, status: "pending", winner_player_id: null }).eq("id", fixture.match.id);
      if (submissionUpdate.error || matchUpdate.error) {
        setRescheduleBusyId(null);
        setNotice(submissionUpdate.error?.message || matchUpdate.error?.message || "The fixture could not be rescheduled.");
        return;
      }
    }
    const requestUpdate = await client.from("league_reschedule_requests").update({ status: decision, reviewed_by_user_id: admin.userId, reviewed_at: new Date().toISOString() }).eq("id", request.id).eq("status", "pending");
    setRescheduleBusyId(null);
    if (requestUpdate.error) {
      setNotice(requestUpdate.error.message);
      return;
    }
    await logAudit(`league_reschedule_${decision}`, { entityType: "match", entityId: fixture.match.id, summary: `Fixture reschedule request ${decision} from the outstanding-fixtures workflow.`, meta: { competitionId: request.competition_id, originalScheduledFor: request.original_scheduled_for, requestedScheduledFor: request.requested_scheduled_for } });
    setNotice(decision === "approved" ? "Reschedule approved. The fixture now appears in the players’ revised game week." : "Reschedule request rejected.");
    setRefreshKey((value) => value + 1);
  };

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Outstanding Fixtures"
            eyebrow="Club Manager"
            subtitle="One workflow for overdue fixtures, reschedule requests, approved moves, reminders and deadline decisions. Fixtures with a submitted result awaiting review stay in Results & Approvals."
            actions={<Link href="/fixtures/outstanding" className="rounded-xl border border-teal-700 bg-teal-700 px-3 py-2 text-sm font-bold text-white hover:bg-teal-800">Public view</Link>}
          />

          {notice ? <section className="flex items-start justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-950 shadow-sm"><p>{notice}</p><button type="button" onClick={() => setNotice(null)} className="font-bold">Close</button></section> : null}

          {!admin.loading && !canManage ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">Club Manager access only.</section>
          ) : null}

          {canManage ? (
            <>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Still to play</p><p className="mt-1 text-3xl font-black text-slate-950">{outstanding.length}</p></div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-700">Overdue · no move agreed</p><p className="mt-1 text-3xl font-black text-rose-950">{overdueUnarrangedCount}</p></div>
                <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">Move awaiting approval</p><p className="mt-1 text-3xl font-black text-violet-950">{awaitingRescheduleCount}</p></div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Rescheduled</p><p className="mt-1 text-3xl font-black text-amber-950">{rescheduledCount}</p></div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">Competition
                    <select value={competitionFilter} onChange={(event) => setCompetitionFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900">
                      <option value="all">All competitions</option>
                      {listedCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-700">Show
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900">
                      <option value="all">All outstanding</option>
                      <option value="overdue_unarranged">Overdue · no reschedule agreed</option>
                      <option value="awaiting_reschedule">Reschedule awaiting approval</option>
                      <option value="rescheduled">Approved reschedules</option>
                      <option value="rescheduled_overdue">Rescheduled · new deadline missed</option>
                    </select>
                  </label>
                </div>
              </section>

              {loading ? <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">Loading outstanding fixtures…</section> : null}
              {error ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900">{error}</section> : null}
              {!loading && !error ? (
                <section className="space-y-3">
                  {visibleFixtures.map((fixture) => {
                    const pendingReschedule = fixture.reschedule?.status === "pending";
                    const approvedReschedule = fixture.reschedule?.status === "approved";
                    const workflowLabel = pendingReschedule
                      ? "Reschedule requested · awaiting approval"
                      : approvedReschedule && fixture.overdue
                        ? "Rescheduled · new deadline missed"
                        : approvedReschedule
                          ? "Rescheduled · within new window"
                          : "Overdue · no reschedule agreed";
                    const contacts = contactsByMatch[fixture.match.id];
                    return (
                    <article key={fixture.match.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${fixture.overdue && !pendingReschedule ? "border-rose-200" : pendingReschedule ? "border-violet-200" : "border-amber-200"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${pendingReschedule ? "bg-violet-100 text-violet-900" : fixture.overdue ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900"}`}>{workflowLabel}</span>
                            {fixture.match.status === "in_progress" ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800">In progress</span> : null}
                          </div>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-teal-700">{fixture.competition.name}</p>
                          <h2 className="mt-1 text-xl font-black text-slate-950">{fixture.playerOne} vs {fixture.playerTwo}</h2>
                          <p className="mt-1 text-sm text-slate-600">Week {fixture.match.round_no ?? "—"} · Match {fixture.match.match_no ?? "—"} · Week beginning {displayDate(fixture.match.scheduled_for)}</p>
                          <p className={`mt-2 text-sm font-semibold ${fixture.overdue ? "text-rose-800" : "text-slate-700"}`}>Current deadline: {displayDeadline(fixture.deadline)}</p>
                          {fixture.reschedule ? <p className={`mt-2 rounded-xl border px-3 py-2 text-sm ${pendingReschedule ? "border-violet-200 bg-violet-50 text-violet-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>{pendingReschedule ? "Requested move" : "Moved"} from the week beginning <strong>{displayDate(fixture.reschedule.original_scheduled_for)}</strong> to <strong>{displayDate(fixture.reschedule.requested_scheduled_for)}</strong>{pendingReschedule ? "; this still needs approval." : "."}</p> : null}
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link href={`/matches/${fixture.match.id}`} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-800">{fixture.overdue ? "Review, reschedule or decide" : "Open fixture"}</Link>
                            {pendingReschedule && admin.isSuper ? <><button type="button" disabled={rescheduleBusyId === fixture.reschedule?.id} onClick={() => void reviewReschedule(fixture, "approved")} className="rounded-xl border border-violet-700 bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Approve new week</button><button type="button" disabled={rescheduleBusyId === fixture.reschedule?.id} onClick={() => void reviewReschedule(fixture, "rejected")} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-900 disabled:opacity-50">Reject request</button></> : null}
                            <button type="button" disabled={reminderBusyId === fixture.match.id} onClick={() => void sendEmailReminders(fixture.match.id)} className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-900 disabled:opacity-50">{reminderBusyId === fixture.match.id ? "Sending…" : "Email both players"}</button>
                            <button type="button" disabled={contactLoadingId === fixture.match.id} onClick={() => void loadContacts(fixture.match.id)} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900 disabled:opacity-50">{contactLoadingId === fixture.match.id ? "Loading…" : contacts ? "Hide WhatsApp options" : "WhatsApp players"}</button>
                          </div>
                          {contacts ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{contacts.map((contact) => {
                            const number = contact.phone ? whatsappNumber(contact.phone) : "";
                            const opponent = contact.playerId === fixture.match.player1_id ? fixture.playerTwo : fixture.playerOne;
                            const reminderText = `Hi ${contact.name.split(/\s+/)[0]}, just a reminder about your ${fixture.competition.name} fixture against ${opponent}. ${workflowLabel}. Please arrange the match and update Rack & Frame. ${appOrigin}/my-fixtures`;
                            return <div key={contact.playerId} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="font-bold text-slate-900">{contact.name}</p>{number ? <a href={`https://wa.me/${number}?text=${encodeURIComponent(reminderText)}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-lg bg-[#25D366] px-3 py-2 text-sm font-bold text-white">Open WhatsApp</a> : <p className="mt-2 text-xs text-slate-500">No mobile number recorded.</p>}</div>;
                          })}</div> : null}
                        </div>
                      </div>
                    </article>
                  );})}
                  {!visibleFixtures.length ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">No fixtures match this filter.</div> : null}
                </section>
              ) : null}
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
