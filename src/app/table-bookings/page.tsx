"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import MessageModal from "@/components/MessageModal";
import TableBookingCalendar from "@/components/TableBookingCalendar";
import { supabase } from "@/lib/supabase";

type CueTable = { id: string; name: string; sport_type: "pool" | "snooker"; location_id: string };
type Reservation = { id: string; table_id: string; booked_by_user_id: string; booked_for_player_id: string; starts_at: string; ends_at: string; purpose: "fixture" | "league_match" | "other"; notes: string | null; status: "pending" | "booked" | "rejected" | "cancelled"; participant_one: string | null; participant_two: string | null; team_name: string | null; requester_email: string | null; rejection_reason: string | null; playerName: string };
type AccessGrant = { id: string; player_id: string; sport_type: "pool" | "snooker"; access_role: "captain" | "vice_captain"; playerName: string };
type Player = { id: string; display_name: string; full_name: string | null };
type AvailabilityWindow = { id: string; table_id: string; weekday: number; opens_at: string; closes_at: string };
type BookingBlock = { id: string; table_id: string | null; starts_at: string; ends_at: string; category: string; title: string; notes: string | null };
type BookingData = { isSuper: boolean; userId: string; playerId: string | null; eligibleSports: string[]; canBookOther: boolean; tables: CueTable[]; reservations: Reservation[]; availability: AvailabilityWindow[]; blocks: BookingBlock[]; access: AccessGrant[]; players: Player[] };

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const londonDateTime = (value: string) => new Date(value).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const londonTime = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const reservationTitle = (reservation: Reservation) => reservation.purpose === "league_match"
  ? reservation.team_name || "League team booking"
  : reservation.purpose === "other"
    ? reservation.notes || "Other table booking"
    : [reservation.participant_one, reservation.participant_two].filter(Boolean).join(" vs. ") || reservation.playerName;
const localInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export default function TableBookingsPage() {
  const bookingFormRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<BookingData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bookingView, setBookingView] = useState<"player" | "manage">("manage");
  const [tableId, setTableId] = useState("");
  const [startsAt, setStartsAt] = useState(() => { const date = new Date(); date.setHours(date.getHours() + 1, 0, 0, 0); return localInputValue(date); });
  const [duration, setDuration] = useState("30");
  const [purpose, setPurpose] = useState("fixture");
  const [participantOne, setParticipantOne] = useState("");
  const [participantTwo, setParticipantTwo] = useState("");
  const [teamName, setTeamName] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);
  const [grantPlayerId, setGrantPlayerId] = useState("");
  const [grantSport, setGrantSport] = useState<"pool" | "snooker">("pool");
  const [grantRole, setGrantRole] = useState<"captain" | "vice_captain">("captain");
  const [scheduleTableId, setScheduleTableId] = useState("");
  const [scheduleWeekday, setScheduleWeekday] = useState("1");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleOpens, setScheduleOpens] = useState("13:00");
  const [scheduleCloses, setScheduleCloses] = useState("23:00");
  const [blockTableId, setBlockTableId] = useState("");
  const [blockStartsAt, setBlockStartsAt] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(18, 0, 0, 0); return localInputValue(date); });
  const [blockEndsAt, setBlockEndsAt] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(23, 0, 0, 0); return localInputValue(date); });
  const [blockCategory, setBlockCategory] = useState("entertainment");
  const [blockTitle, setBlockTitle] = useState("");
  const [blockNotes, setBlockNotes] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  const request = useCallback(async (body?: Record<string, unknown>) => {
    const client = supabase;
    const session = client ? await client.auth.getSession() : null;
    const token = session?.data.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const response = await fetch("/api/table-bookings", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The booking request could not be completed.");
    return payload;
  }, []);

  const load = useCallback(async () => {
    try { setLoading(true); const payload = await request(); setData(payload as BookingData); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Bookings could not be loaded."); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTimeMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!data) return;
    if (!tableId) {
      const firstEligible = data.tables.find((table) => data.eligibleSports.includes(table.sport_type));
      if (firstEligible) setTableId(firstEligible.id);
    }
    if (!scheduleTableId && data.tables[0]) setScheduleTableId(data.tables[0].id);
  }, [data, scheduleTableId, tableId]);
  useEffect(() => {
    if (!data || !scheduleTableId) return;
    const weekday = Number(scheduleWeekday);
    const rule = data.availability.find((window) => window.table_id === scheduleTableId && window.weekday === weekday);
    setScheduleEnabled(Boolean(rule));
    setScheduleOpens(rule?.opens_at.slice(0, 5) ?? ([0, 5, 6].includes(weekday) ? "11:00" : "13:00"));
    setScheduleCloses(rule?.closes_at.slice(0, 5) ?? "23:00");
  }, [data, scheduleTableId, scheduleWeekday]);

  const eligibleTables = useMemo(() => (data?.tables ?? []).filter((table) => data?.eligibleSports.includes(table.sport_type)), [data]);
  const isManageView = Boolean(data?.isSuper && bookingView === "manage");
  const isPlayerView = !data?.isSuper || bookingView === "player";
  const selectedTable = eligibleTables.find((table) => table.id === tableId);
  const durationOptions = isManageView ? [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360] : selectedTable?.sport_type === "snooker" ? [60] : [30];
  useEffect(() => {
    if (!isManageView && selectedTable) setDuration(selectedTable.sport_type === "snooker" ? "60" : "30");
  }, [isManageView, selectedTable]);
  const tableNames = useMemo(() => new Map((data?.tables ?? []).map((table) => [table.id, table.name])), [data]);
  const upcoming = useMemo(() => (data?.reservations ?? []).filter((reservation) => new Date(reservation.ends_at).getTime() > currentTimeMs), [currentTimeMs, data]);
  const visibleRequests = useMemo(() => isManageView ? upcoming : upcoming.filter((reservation) => reservation.booked_by_user_id === data?.userId), [data?.userId, isManageView, upcoming]);
  const pending = useMemo(() => visibleRequests.filter((reservation) => reservation.status === "pending"), [visibleRequests]);
  const declined = useMemo(() => visibleRequests.filter((reservation) => reservation.status === "rejected"), [visibleRequests]);
  const confirmed = useMemo(() => upcoming.filter((reservation) => reservation.status === "booked"), [upcoming]);
  const upcomingBlocks = useMemo(() => (data?.blocks ?? []).filter((block) => new Date(block.ends_at).getTime() > currentTimeMs), [currentTimeMs, data]);

  const book = async () => {
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + Number(duration) * 60000);
    setSaving(true);
    try {
      const result = await request({ action: editingReservationId ? "edit" : "book", reservationId: editingReservationId, tableId, startsAt: start.toISOString(), endsAt: end.toISOString(), purpose, participantOne, participantTwo, teamName, otherReason });
      const wasEditing = Boolean(editingReservationId);
      setEditingReservationId(null); setParticipantTwo(""); setTeamName(""); setOtherReason(""); setMessage(result.status === "pending" ? wasEditing ? "Your updated booking has been sent to the Super User for approval." : "Booking request sent to the Super User for approval." : wasEditing ? "Booking updated successfully." : "Table reserved successfully."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reservation failed."); }
    finally { setSaving(false); }
  };
  const editReservation = (reservation: Reservation) => {
    setEditingReservationId(reservation.id);
    setTableId(reservation.table_id);
    setStartsAt(localInputValue(new Date(reservation.starts_at)));
    setDuration(String((new Date(reservation.ends_at).getTime() - new Date(reservation.starts_at).getTime()) / 60000));
    setPurpose(reservation.purpose);
    setParticipantOne(reservation.participant_one ?? "");
    setParticipantTwo(reservation.participant_two ?? "");
    setTeamName(reservation.team_name ?? "");
    setOtherReason(reservation.notes ?? "");
    window.setTimeout(() => bookingFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const cancel = async (reservationId: string) => {
    if (!window.confirm("Cancel this table reservation?")) return;
    setSaving(true);
    try { await request({ action: "cancel", reservationId }); setMessage("Reservation cancelled."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation failed."); }
    finally { setSaving(false); }
  };
  const review = async (reservationId: string, action: "approve" | "reject") => {
    const reason = action === "reject" ? window.prompt("Why is this booking being rejected? The reason will be emailed to the requester.")?.trim() : "";
    if (action === "reject" && !reason) return;
    setSaving(true);
    try {
      const result = await request({ action, reservationId, reason });
      setMessage(`${action === "approve" ? "Booking accepted" : "Booking rejected"}.${result.emailSent ? " Email sent via Resend." : result.emailError ? ` Email not sent: ${result.emailError}` : ""}`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The booking could not be reviewed."); }
    finally { setSaving(false); }
  };
  const deleteReservation = async (reservationId: string) => {
    if (!window.confirm("Permanently delete this booking? The requester will be emailed if an address is available.")) return;
    setSaving(true);
    try {
      const result = await request({ action: "delete", reservationId });
      setMessage(`Booking deleted.${result.emailSent ? " Email sent via Resend." : result.emailError ? ` Email not sent: ${result.emailError}` : ""}`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The booking could not be deleted."); }
    finally { setSaving(false); }
  };
  const grant = async () => {
    setSaving(true);
    try { await request({ action: "grant_access", playerId: grantPlayerId, sportType: grantSport, accessRole: grantRole }); setMessage("Booking access updated."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Access could not be updated."); }
    finally { setSaving(false); }
  };
  const revoke = async (grantRow: AccessGrant) => {
    setSaving(true);
    try { await request({ action: "revoke_access", playerId: grantRow.player_id, sportType: grantRow.sport_type }); setMessage("Booking access removed."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Access could not be removed."); }
    finally { setSaving(false); }
  };
  const saveAvailability = async () => {
    setSaving(true);
    try {
      await request({ action: "set_availability", tableId: scheduleTableId, weekday: Number(scheduleWeekday), enabled: scheduleEnabled, opensAt: scheduleOpens, closesAt: scheduleCloses });
      setMessage(scheduleEnabled ? "Weekly table availability updated." : "The table is now closed for bookings on that day."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Availability could not be updated."); }
    finally { setSaving(false); }
  };
  const addBlock = async () => {
    setSaving(true);
    try {
      await request({ action: "add_block", tableId: blockTableId || null, startsAt: new Date(blockStartsAt).toISOString(), endsAt: new Date(blockEndsAt).toISOString(), category: blockCategory, title: blockTitle, notes: blockNotes });
      setBlockTitle(""); setBlockNotes(""); setMessage("Unavailable period added."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unavailable period could not be added."); }
    finally { setSaving(false); }
  };
  const removeBlock = async (blockId: string) => {
    if (!window.confirm("Remove this unavailable period?")) return;
    setSaving(true);
    try { await request({ action: "remove_block", blockId }); setMessage("Unavailable period removed."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unavailable period could not be removed."); }
    finally { setSaving(false); }
  };

  return <main className="min-h-screen bg-slate-100 p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-4"><RequireAuth>
    <header className="rounded-3xl bg-gradient-to-r from-emerald-950 to-slate-950 p-5 text-white shadow-xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">App-only reservations</p><h1 className="mt-1 text-3xl font-black">{isManageView ? "Manage cue-table bookings" : "Book a cue table"}</h1><p className="mt-2 text-emerald-100">{isManageView ? "Review requests, manage availability and administer bookings." : "For authorised pool and snooker players. Reservations cannot be made through a public link."}</p></div><PageNav /></div>{data?.isSuper ? <div className="mt-4 inline-flex rounded-full border border-white/25 bg-slate-950/40 p-1"><button type="button" onClick={() => { setBookingView("player"); setDuration(selectedTable?.sport_type === "snooker" ? String(Math.min(Number(duration), 60)) : "30"); }} className={`rounded-full px-4 py-2 text-sm font-bold ${bookingView === "player" ? "bg-lime-300 text-slate-950" : "text-white"}`}>Player</button><button type="button" onClick={() => setBookingView("manage")} className={`rounded-full px-4 py-2 text-sm font-bold ${bookingView === "manage" ? "bg-amber-300 text-slate-950" : "text-white"}`}>Manage</button></div> : null}</header>
    <MessageModal message={message} onClose={() => setMessage(null)} />
    {loading ? <section className="rounded-2xl bg-white p-5 shadow">Loading reservations…</section> : null}
    {data ? <>
      {isPlayerView && eligibleTables.length ? <TableBookingCalendar tables={eligibleTables} reservations={upcoming} availability={data.availability} blocks={upcomingBlocks} onChooseSlot={(chosenTableId, chosenStartsAt, chosenDuration) => { setTableId(chosenTableId); setStartsAt(localInputValue(new Date(chosenStartsAt))); setDuration(String(chosenDuration)); }} /> : null}
      <section ref={bookingFormRef} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-black text-slate-950">{editingReservationId ? "Edit booking" : "Request a table"}</h2><p className="mt-1 text-sm text-slate-600">Choose a competition fixture, home league match or—where authorised—another reason. Player requests are sent to the Super User for approval; Super User bookings are confirmed immediately.</p></div>{editingReservationId ? <button type="button" onClick={() => setEditingReservationId(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">Cancel editing</button> : null}</div>
        {!data.playerId ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Link your app account to a player profile before booking.</p> : null}
        {data.playerId && !eligibleTables.length ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Your account does not currently have table-booking access. Ask the Super User if you are a captain or vice-captain.</p> : null}
        {eligibleTables.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">Table<select value={tableId} onChange={(event) => { const nextTableId = event.target.value; setTableId(nextTableId); if (!isManageView) setDuration(eligibleTables.find((table) => table.id === nextTableId)?.sport_type === "snooker" ? "60" : "30"); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{eligibleTables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Booking type<select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="fixture">Competition fixture</option><option value="league_match">Home league match</option>{data.canBookOther ? <option value="other">Other</option> : null}</select></label>
          <label className="text-sm font-medium text-slate-700">Starts<input type="datetime-local" min={localInputValue(new Date())} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Length<select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{durationOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} mins` : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Maximum: {isManageView ? "6 hours (Super User)" : selectedTable?.sport_type === "snooker" ? "1 hour" : "30 minutes"}</span></label>
          {purpose === "fixture" ? <><label className="text-sm font-medium text-slate-700 sm:col-span-1 lg:col-span-2">Player one<input value={participantOne} maxLength={80} onChange={(event) => setParticipantOne(event.target.value)} placeholder="e.g. Jo Bloggs" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700 sm:col-span-1 lg:col-span-2">Player two (optional)<input value={participantTwo} maxLength={80} onChange={(event) => setParticipantTwo(event.target.value)} placeholder="e.g. Jim Smith" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label></> : purpose === "league_match" ? <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Home team name<input value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. Greenhithe Legion A" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label> : <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Reason<input value={otherReason} maxLength={240} required onChange={(event) => setOtherReason(event.target.value)} placeholder="e.g. Team practice night" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="mt-1 block text-xs text-slate-500">Other bookings are limited to team captains, vice-captains and the Super User.</span></label>}
          <button type="button" disabled={saving || !tableId || !startsAt || (purpose === "fixture" ? !participantOne.trim() : purpose === "league_match" ? !teamName.trim() : !otherReason.trim())} onClick={() => void book()} className="rounded-lg bg-emerald-800 px-4 py-2.5 font-bold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-4">{saving ? "Saving…" : editingReservationId ? data.isSuper ? "Save changes" : "Submit changes for approval" : data.isSuper ? isManageView ? "Confirm booking" : "Book table" : "Send booking request"}</button>
        </div> : null}
      </section>

      {(pending.length || declined.length) ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black text-amber-950">Booking requests</h2><p className="mt-1 text-sm text-amber-800">{isManageView ? "Accept or reject pending requests. The requester is emailed through Resend." : "Requests remain here until the Super User makes a decision."}</p></div>{pending.length ? <span className="rounded-full bg-amber-200 px-3 py-1 text-sm font-black text-amber-950">{pending.length} pending</span> : null}</div><div className="mt-4 space-y-3">{[...pending, ...declined].map((reservation) => <article key={reservation.id} className="rounded-xl border border-amber-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-slate-950">{londonDateTime(reservation.starts_at)}–{londonTime(reservation.ends_at)}</p><p className="mt-1 font-semibold text-slate-800">{tableNames.get(reservation.table_id)} · {reservationTitle(reservation)}</p><p className="mt-1 text-sm text-slate-500">Requested by {reservation.playerName}{reservation.requester_email ? ` · ${reservation.requester_email}` : ""}</p>{reservation.rejection_reason ? <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">Rejected: {reservation.rejection_reason}</p> : null}</div><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${reservation.status === "pending" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>{reservation.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{isManageView && reservation.status === "pending" ? <><button type="button" disabled={saving} onClick={() => void review(reservation.id, "approve")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Accept</button><button type="button" disabled={saving} onClick={() => void review(reservation.id, "reject")} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white">Reject</button></> : null}{isManageView ? <button type="button" disabled={saving} onClick={() => void deleteReservation(reservation.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Delete</button> : reservation.status === "pending" ? <button type="button" disabled={saving} onClick={() => void cancel(reservation.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Withdraw request</button> : null}</div></article>)}</div></section> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-2xl font-black text-slate-950">Confirmed bookings</h2><p className="mt-1 text-sm text-slate-600">A chronological list of accepted table bookings.</p><div className="mt-4 divide-y divide-slate-200">{confirmed.length ? confirmed.map((reservation) => { const isOwnBooking = reservation.booked_by_user_id === data.userId; const canManage = isManageView || isOwnBooking; return <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div><p className="font-black text-slate-950">{londonDateTime(reservation.starts_at)}–{londonTime(reservation.ends_at)}</p><p className="mt-1 text-slate-700">{tableNames.get(reservation.table_id)} · <strong>{reservationTitle(reservation)}</strong></p><p className="mt-1 text-xs text-slate-500">Booked by {reservation.playerName}</p></div><div className="flex gap-2">{canManage ? <button type="button" disabled={saving} onClick={() => editReservation(reservation)} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800">Edit</button> : null}{isManageView ? <button type="button" disabled={saving} onClick={() => void deleteReservation(reservation.id)} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">Delete</button> : isOwnBooking ? <button type="button" disabled={saving} onClick={() => void cancel(reservation.id)} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">Cancel</button> : null}</div></article>; }) : <p className="text-sm text-slate-600">No confirmed upcoming bookings.</p>}</div></section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-2xl font-black text-slate-950">Weekly booking hours</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{data.tables.map((table) => <article key={table.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="font-black text-slate-950">{table.name}</h3><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">{days.map((dayName, weekday) => { const rule = data.availability.find((window) => window.table_id === table.id && window.weekday === weekday); return <div key={dayName} className="contents"><dt className="text-slate-600">{dayName}</dt><dd className={rule ? "font-semibold text-emerald-800" : "font-semibold text-red-700"}>{rule ? `${rule.opens_at.slice(0, 5)}–${rule.closes_at.slice(0, 5)}` : "Closed"}</dd></div>; })}</dl></article>)}</div></section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-amber-950">Entertainment, home matches and closures</h2><div className="mt-4 space-y-3">{upcomingBlocks.length ? upcomingBlocks.map((block) => <article key={block.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-4"><div><p className="font-black text-amber-950">{block.title}</p><p className="text-sm text-amber-900">{londonDateTime(block.starts_at)}–{londonTime(block.ends_at)} · {block.table_id ? tableNames.get(block.table_id) : "All tables"} · {block.category.replaceAll("_", " ")}</p>{block.notes ? <p className="mt-1 text-sm text-slate-600">{block.notes}</p> : null}</div>{isManageView ? <button type="button" disabled={saving} onClick={() => void removeBlock(block.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Remove</button> : null}</article>) : <p className="text-sm text-amber-900">No upcoming unavailable periods have been added.</p>}</div></section>

      {isManageView ? <>
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-emerald-950">Super User: weekly availability</h2><p className="mt-1 text-sm text-emerald-800">Choose when each pool or snooker table can normally be booked. A closed day has no bookable hours.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="text-sm font-medium text-emerald-950 lg:col-span-2">Table<select value={scheduleTableId} onChange={(event) => setScheduleTableId(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2">{data.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-emerald-950">Day<select value={scheduleWeekday} onChange={(event) => setScheduleWeekday(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2">{days.map((dayName, weekday) => <option key={dayName} value={weekday}>{dayName}</option>)}</select></label><label className="flex items-end gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-950"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />Bookable</label><label className="text-sm font-medium text-emerald-950">From<input type="time" disabled={!scheduleEnabled} value={scheduleOpens} onChange={(event) => setScheduleOpens(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 disabled:opacity-50" /></label><label className="text-sm font-medium text-emerald-950">Until<input type="time" disabled={!scheduleEnabled} value={scheduleCloses} onChange={(event) => setScheduleCloses(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 disabled:opacity-50" /></label><button type="button" disabled={saving || !scheduleTableId} onClick={() => void saveAvailability()} className="rounded-lg bg-emerald-800 px-4 py-2 font-bold text-white disabled:opacity-50 lg:col-start-6">Save hours</button></div></section>

        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-amber-950">Super User: make tables unavailable</h2><p className="mt-1 text-sm text-amber-900">Add entertainment, home-team fixtures or other closures. These override weekly hours. Existing bookings must be cancelled or moved first.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="text-sm font-medium text-amber-950">Applies to<select value={blockTableId} onChange={(event) => setBlockTableId(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2"><option value="">All tables</option>{data.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-amber-950">Reason<select value={blockCategory} onChange={(event) => setBlockCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2"><option value="entertainment">Entertainment</option><option value="pool_home_match">Pool team home match</option><option value="snooker_home_match">Snooker team home match</option><option value="private_event">Private event</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select></label><label className="text-sm font-medium text-amber-950 lg:col-span-2">Starts<input type="datetime-local" value={blockStartsAt} onChange={(event) => setBlockStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 lg:col-span-2">Ends<input type="datetime-local" value={blockEndsAt} onChange={(event) => setBlockEndsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 sm:col-span-2 lg:col-span-3">Title<input value={blockTitle} maxLength={120} onChange={(event) => setBlockTitle(event.target.value)} placeholder="e.g. Saturday night entertainment or Home v Northfleet" className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 sm:col-span-2">Notes (optional)<input value={blockNotes} maxLength={240} onChange={(event) => setBlockNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><button type="button" disabled={saving || !blockTitle || !blockStartsAt || !blockEndsAt} onClick={() => void addBlock()} className="self-end rounded-lg bg-amber-800 px-4 py-2.5 font-bold text-white disabled:opacity-50">Add closure</button></div></section>

        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-violet-950">Captain and vice-captain access</h2><p className="mt-1 text-sm text-violet-800">Masters entrants receive access automatically for their competition’s table. Use this register for pool and snooker captains or vice-captains.</p><div className="mt-4 grid gap-3 sm:grid-cols-4"><select value={grantPlayerId} onChange={(event) => setGrantPlayerId(event.target.value)} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="">Choose player</option>{data.players.map((player) => <option key={player.id} value={player.id}>{player.full_name?.trim() || player.display_name}</option>)}</select><select value={grantSport} onChange={(event) => setGrantSport(event.target.value as "pool" | "snooker")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="pool">Pool</option><option value="snooker">Snooker</option></select><select value={grantRole} onChange={(event) => setGrantRole(event.target.value as "captain" | "vice_captain")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="captain">Captain</option><option value="vice_captain">Vice-captain</option></select><button type="button" disabled={saving || !grantPlayerId} onClick={() => void grant()} className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50">Grant access</button></div><div className="mt-4 flex flex-wrap gap-2">{data.access.map((grantRow) => <span key={grantRow.id} className="inline-flex items-center gap-2 rounded-full border border-violet-300 bg-white px-3 py-2 text-sm text-violet-950"><strong>{grantRow.playerName}</strong> · {grantRow.sport_type} {grantRow.access_role.replace("_", "-")}<button type="button" disabled={saving} onClick={() => void revoke(grantRow)} className="font-bold text-red-700">Remove</button></span>)}</div></section>
      </> : null}
    </> : null}
  </RequireAuth></div></main>;
}
