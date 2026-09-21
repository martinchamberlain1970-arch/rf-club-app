"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import MessageModal from "@/components/MessageModal";
import TableBookingCalendar from "@/components/TableBookingCalendar";
import useExperienceMode from "@/components/useExperienceMode";
import { supabase } from "@/lib/supabase";
import type { TemporaryBookingHours } from "@/lib/table-booking-hours";

type CueTable = { id: string; name: string; sport_type: "pool" | "snooker"; location_id: string };
type Reservation = { id: string; table_id: string; booked_by_user_id: string; booked_for_player_id: string; starts_at: string; ends_at: string; purpose: "fixture" | "league_match" | "other"; notes: string | null; status: "pending" | "booked" | "rejected" | "cancelled"; participant_one: string | null; participant_two: string | null; participant_one_player_id: string | null; participant_two_player_id: string | null; competition_id: string | null; team_name: string | null; requester_email: string | null; rejection_reason: string | null; playerName: string };
type AccessGrant = { id: string; player_id: string; sport_type: "pool" | "snooker"; access_role: "captain" | "vice_captain"; playerName: string };
type Player = { id: string; display_name: string; full_name: string | null };
type AvailabilityWindow = { id: string; table_id: string; weekday: number; opens_at: string; closes_at: string };
type BookingBlock = { id: string; table_id: string | null; starts_at: string; ends_at: string; category: string; title: string; notes: string | null };
type BookingCompetition = { id: string; name: string; sport_type: "snooker" | "pool_8_ball" | "pool_9_ball"; players: Array<{ id: string; name: string }> };
type BookingData = { isSuper: boolean; userId: string; playerId: string | null; eligibleSports: string[]; canBookOther: boolean; tables: CueTable[]; reservations: Reservation[]; availability: AvailabilityWindow[]; temporaryAvailability: TemporaryBookingHours[]; blocks: BookingBlock[]; access: AccessGrant[]; players: Player[]; competitions: BookingCompetition[] };
type TemporaryHoursInput = { weekday: number; isClosed: boolean; opensAt: string; closesAt: string };

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
const localDateValue = (date: Date) => localInputValue(date).slice(0, 10);
const mondayToSunday = [1, 2, 3, 4, 5, 6, 0];

export default function TableBookingsPage() {
  const bookingFormRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<BookingData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bookingView, setBookingView] = useExperienceMode();
  const [tableId, setTableId] = useState("");
  const [startsAt, setStartsAt] = useState(() => { const date = new Date(); date.setHours(date.getHours() + 1, 0, 0, 0); return localInputValue(date); });
  const [duration, setDuration] = useState("30");
  const [purpose, setPurpose] = useState("fixture");
  const [competitionId, setCompetitionId] = useState("");
  const [participantOnePlayerId, setParticipantOnePlayerId] = useState("");
  const [participantTwoPlayerId, setParticipantTwoPlayerId] = useState("");
  const [participantOne, setParticipantOne] = useState("");
  const [participantTwo, setParticipantTwo] = useState("");
  const [teamName, setTeamName] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);
  const [grantPlayerId, setGrantPlayerId] = useState("");
  const [grantSport, setGrantSport] = useState<"pool" | "snooker">("pool");
  const [grantRole, setGrantRole] = useState<"captain" | "vice_captain">("captain");
  const [temporaryTableId, setTemporaryTableId] = useState("");
  const [hoursChangeType, setHoursChangeType] = useState<"standard" | "dated">("standard");
  const [temporaryStartsOn, setTemporaryStartsOn] = useState(() => localDateValue(new Date()));
  const [temporaryEndsOn, setTemporaryEndsOn] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 55); return localDateValue(date); });
  const [temporaryHours, setTemporaryHours] = useState<TemporaryHoursInput[]>(() => mondayToSunday.map((weekday) => ({ weekday, isClosed: false, opensAt: [0, 6].includes(weekday) ? "11:00" : "13:00", closesAt: "23:00" })));
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
    if (!temporaryTableId && data.tables[0]) {
      const firstTableId = data.tables[0].id;
      setTemporaryTableId(firstTableId);
      setTemporaryHours(mondayToSunday.map((weekday) => {
        const normal = data.availability.find((entry) => entry.table_id === firstTableId && entry.weekday === weekday);
        return { weekday, isClosed: !normal, opensAt: normal?.opens_at.slice(0, 5) ?? "13:00", closesAt: normal?.closes_at.slice(0, 5) ?? "23:00" };
      }));
    }
  }, [data, tableId, temporaryTableId]);
  const chooseTemporaryTable = (nextTableId: string) => {
    setTemporaryTableId(nextTableId);
    if (!data) return;
    setTemporaryHours(mondayToSunday.map((weekday) => {
      const normal = data.availability.find((entry) => entry.table_id === nextTableId && entry.weekday === weekday);
      return { weekday, isClosed: !normal, opensAt: normal?.opens_at.slice(0, 5) ?? "13:00", closesAt: normal?.closes_at.slice(0, 5) ?? "23:00" };
    }));
  };
  useEffect(() => {
    if (!data || typeof window === "undefined" || !window.location.hash) return;
    const targetId = window.location.hash.slice(1);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [data]);

  const eligibleTables = useMemo(() => (data?.tables ?? []).filter((table) => data?.eligibleSports.includes(table.sport_type)), [data]);
  const isManageView = Boolean(data?.isSuper && bookingView === "manage");
  const isPlayerView = !data?.isSuper || bookingView === "player";
  const selectedTable = eligibleTables.find((table) => table.id === tableId);
  const bookingCompetitions = useMemo(() => (data?.competitions ?? []).filter((competition) =>
    selectedTable?.sport_type === "snooker" ? competition.sport_type === "snooker" : competition.sport_type !== "snooker"
  ), [data?.competitions, selectedTable?.sport_type]);
  const selectedCompetition = bookingCompetitions.find((competition) => competition.id === competitionId);
  const temporaryPeriods = useMemo(() => {
    const grouped = new Map<string, { tableId: string; startsOn: string; endsOn: string; rows: TemporaryBookingHours[] }>();
    for (const row of data?.temporaryAvailability ?? []) {
      const key = `${row.table_id}:${row.starts_on}:${row.ends_on}`;
      const existing = grouped.get(key);
      if (existing) existing.rows.push(row);
      else grouped.set(key, { tableId: row.table_id, startsOn: row.starts_on, endsOn: row.ends_on, rows: [row] });
    }
    return [...grouped.values()].sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  }, [data?.temporaryAvailability]);
  const durationOptions = isManageView ? [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360] : selectedTable?.sport_type === "snooker" ? [60] : [30];
  useEffect(() => {
    if (!isManageView && selectedTable) setDuration(selectedTable.sport_type === "snooker" ? "60" : "30");
  }, [isManageView, selectedTable]);
  useEffect(() => {
    if (purpose !== "fixture") return;
    if (!bookingCompetitions.some((competition) => competition.id === competitionId)) {
      setCompetitionId(bookingCompetitions[0]?.id ?? "");
      setParticipantOnePlayerId(!data?.isSuper ? data?.playerId ?? "" : "");
      setParticipantTwoPlayerId("");
    }
  }, [bookingCompetitions, competitionId, data?.isSuper, data?.playerId, purpose]);
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
      const result = await request({ action: editingReservationId ? "edit" : "book", reservationId: editingReservationId, tableId, startsAt: start.toISOString(), endsAt: end.toISOString(), purpose, competitionId, participantOnePlayerId, participantTwoPlayerId, participantOne, participantTwo, teamName, otherReason });
      const wasEditing = Boolean(editingReservationId);
      setEditingReservationId(null); setParticipantTwoPlayerId(""); setParticipantTwo(""); setTeamName(""); setOtherReason(""); setMessage(result.status === "pending" ? wasEditing ? "Your updated booking has been sent to the Super User for approval." : "Booking request sent to the Super User for approval." : result.autoApproved ? "The table was free, so this competition booking is confirmed for both players." : wasEditing ? "Booking updated successfully." : "Table reserved successfully."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reservation failed."); }
    finally { setSaving(false); }
  };
  const editReservation = (reservation: Reservation) => {
    setEditingReservationId(reservation.id);
    setTableId(reservation.table_id);
    setStartsAt(localInputValue(new Date(reservation.starts_at)));
    setDuration(String((new Date(reservation.ends_at).getTime() - new Date(reservation.starts_at).getTime()) / 60000));
    setPurpose(reservation.purpose);
    setCompetitionId(reservation.competition_id ?? "");
    setParticipantOnePlayerId(reservation.participant_one_player_id ?? "");
    setParticipantTwoPlayerId(reservation.participant_two_player_id ?? "");
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
  const saveTemporaryAvailability = async () => {
    setSaving(true);
    try {
      if (hoursChangeType === "standard") {
        await request({ action: "set_weekly_availability", tableId: temporaryTableId, hours: temporaryHours });
        setMessage("Standard Monday-to-Sunday opening hours saved.");
      } else {
        await request({ action: "set_temporary_availability", tableId: temporaryTableId, startsOn: temporaryStartsOn, endsOn: temporaryEndsOn, hours: temporaryHours });
        setMessage("Dated Monday-to-Sunday opening hours saved.");
      }
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Opening hours could not be saved."); }
    finally { setSaving(false); }
  };
  const editTemporaryAvailability = (period: { tableId: string; startsOn: string; endsOn: string; rows: TemporaryBookingHours[] }) => {
    setHoursChangeType("dated");
    setTemporaryTableId(period.tableId);
    setTemporaryStartsOn(period.startsOn);
    setTemporaryEndsOn(period.endsOn);
    setTemporaryHours(mondayToSunday.map((weekday) => {
      const row = period.rows.find((entry) => entry.weekday === weekday);
      return { weekday, isClosed: row?.is_closed ?? true, opensAt: row?.opens_at?.slice(0, 5) ?? "13:00", closesAt: row?.closes_at?.slice(0, 5) ?? "23:00" };
    }));
  };
  const deleteTemporaryAvailability = async (period: { tableId: string; startsOn: string; endsOn: string }) => {
    if (!window.confirm("Remove this dated opening-hours change and use the standard hours for those dates?")) return;
    setSaving(true);
    try { await request({ action: "delete_temporary_availability", tableId: period.tableId, startsOn: period.startsOn, endsOn: period.endsOn }); setMessage("Dated opening-hours change removed."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The dated opening-hours change could not be removed."); }
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
    <header className="rounded-3xl bg-gradient-to-r from-emerald-950 to-slate-950 p-5 text-white shadow-xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">App-only reservations</p><h1 className="mt-1 text-3xl font-black">{isManageView ? "Manage cue-table bookings" : "Table bookings"}</h1><p className="mt-2 text-emerald-100">{isManageView ? "Review requests, manage availability and administer bookings." : "View your upcoming bookings or reserve an authorised pool or snooker table."}</p></div><PageNav /></div>{data?.isSuper ? <div className="mt-4 inline-flex rounded-full border border-white/25 bg-slate-950/40 p-1"><button type="button" onClick={() => { setBookingView("player"); setDuration(selectedTable?.sport_type === "snooker" ? String(Math.min(Number(duration), 60)) : "30"); }} className={`rounded-full px-4 py-2 text-sm font-bold ${bookingView === "player" ? "bg-lime-300 text-slate-950" : "text-white"}`}>Player</button><button type="button" onClick={() => setBookingView("manage")} className={`rounded-full px-4 py-2 text-sm font-bold ${bookingView === "manage" ? "bg-amber-300 text-slate-950" : "text-white"}`}>Manage</button></div> : null}</header>
    <MessageModal message={message} onClose={() => setMessage(null)} />
    {loading ? <section className="rounded-2xl bg-white p-5 shadow">Loading reservations…</section> : null}
    {data ? <>
      {isPlayerView && eligibleTables.length ? <TableBookingCalendar tables={eligibleTables} reservations={upcoming} availability={data.availability} temporaryAvailability={data.temporaryAvailability ?? []} blocks={upcomingBlocks} onChooseSlot={(chosenTableId, chosenStartsAt, chosenDuration) => { setTableId(chosenTableId); setStartsAt(localInputValue(new Date(chosenStartsAt))); setDuration(String(chosenDuration)); }} /> : null}
      <section id="request-table" ref={bookingFormRef} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-black text-slate-950">{editingReservationId ? "Edit booking" : "Request a table"}</h2><p className="mt-1 text-sm text-slate-600">Competition bookings confirm automatically when the table is free and all details are valid. Home league matches and other bookings still follow the approval rules below.</p></div>{editingReservationId ? <button type="button" onClick={() => setEditingReservationId(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">Cancel editing</button> : null}</div>
        {!data.playerId && !data.isSuper ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Link your app account to a player profile before booking.</p> : null}
        {data.playerId && !eligibleTables.length ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Your account does not currently have table-booking access. Ask the Super User if you are a captain or vice-captain.</p> : null}
        {eligibleTables.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">Table<select value={tableId} onChange={(event) => { const nextTableId = event.target.value; setTableId(nextTableId); if (!isManageView) setDuration(eligibleTables.find((table) => table.id === nextTableId)?.sport_type === "snooker" ? "60" : "30"); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{eligibleTables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Booking type<select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="fixture">Competition fixture</option><option value="league_match">Home league match</option>{data.canBookOther ? <option value="other">Other</option> : null}</select></label>
          <label className="text-sm font-medium text-slate-700">Starts<input type="datetime-local" step={1800} min={localInputValue(new Date())} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="mt-1 block text-xs text-slate-500">Start times are available every 30 minutes.</span></label>
          <label className="text-sm font-medium text-slate-700">Length<select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{durationOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} mins` : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Maximum: {isManageView ? "6 hours (Super User)" : selectedTable?.sport_type === "snooker" ? "1 hour" : "30 minutes"}</span></label>
          {purpose === "fixture" ? <>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Competition<select value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); setParticipantOnePlayerId(!data.isSuper ? data.playerId ?? "" : ""); setParticipantTwoPlayerId(""); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Choose competition</option>{bookingCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-1 lg:col-span-2">Player one<select value={participantOnePlayerId} onChange={(event) => setParticipantOnePlayerId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Choose player one</option>{(selectedCompetition?.players ?? []).map((player) => <option key={player.id} value={player.id} disabled={player.id === participantTwoPlayerId}>{player.name}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-1 lg:col-span-2">Player two<select value={participantTwoPlayerId} onChange={(event) => setParticipantTwoPlayerId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Choose player two</option>{(selectedCompetition?.players ?? []).map((player) => <option key={player.id} value={player.id} disabled={player.id === participantOnePlayerId}>{player.name}</option>)}</select></label>
          </> : purpose === "league_match" ? <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Home team name<input value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. Greenhithe Legion A" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label> : <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Reason<input value={otherReason} maxLength={240} required onChange={(event) => setOtherReason(event.target.value)} placeholder="e.g. Team practice night" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="mt-1 block text-xs text-slate-500">Other bookings are limited to team captains, vice-captains and the Super User.</span></label>}
          <button type="button" disabled={saving || !tableId || !startsAt || (purpose === "fixture" ? !competitionId || !participantOnePlayerId || !participantTwoPlayerId || participantOnePlayerId === participantTwoPlayerId : purpose === "league_match" ? !teamName.trim() : !otherReason.trim())} onClick={() => void book()} className="rounded-lg bg-emerald-800 px-4 py-2.5 font-bold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-4">{saving ? "Saving…" : editingReservationId ? data.isSuper ? "Save changes" : purpose === "fixture" ? "Save confirmed booking" : "Submit changes for approval" : purpose === "fixture" ? "Book and confirm" : data.isSuper ? isManageView ? "Confirm booking" : "Book table" : "Send booking request"}</button>
        </div> : null}
      </section>

      {(pending.length || declined.length) ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black text-amber-950">Booking requests</h2><p className="mt-1 text-sm text-amber-800">{isManageView ? "Accept or reject pending requests. The requester is emailed through Resend." : "Requests remain here until the Super User makes a decision."}</p></div>{pending.length ? <span className="rounded-full bg-amber-200 px-3 py-1 text-sm font-black text-amber-950">{pending.length} pending</span> : null}</div><div className="mt-4 space-y-3">{[...pending, ...declined].map((reservation) => <article key={reservation.id} className="rounded-xl border border-amber-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-slate-950">{londonDateTime(reservation.starts_at)}–{londonTime(reservation.ends_at)}</p><p className="mt-1 font-semibold text-slate-800">{tableNames.get(reservation.table_id)} · {reservationTitle(reservation)}</p><p className="mt-1 text-sm text-slate-500">Requested by {reservation.playerName}{reservation.requester_email ? ` · ${reservation.requester_email}` : ""}</p>{reservation.rejection_reason ? <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">Rejected: {reservation.rejection_reason}</p> : null}</div><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${reservation.status === "pending" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>{reservation.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{isManageView && reservation.status === "pending" ? <><button type="button" disabled={saving} onClick={() => void review(reservation.id, "approve")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Accept</button><button type="button" disabled={saving} onClick={() => void review(reservation.id, "reject")} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white">Reject</button></> : null}{isManageView ? <button type="button" disabled={saving} onClick={() => void deleteReservation(reservation.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Delete</button> : reservation.status === "pending" ? <button type="button" disabled={saving} onClick={() => void cancel(reservation.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Withdraw request</button> : null}</div></article>)}</div></section> : null}

      <details id="confirmed-bookings" className="group scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><div><h2 className="text-2xl font-black text-slate-950">Table reservations</h2><p className="mt-1 text-sm text-slate-600">A chronological list of confirmed upcoming bookings.</p></div><div className="flex shrink-0 items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700">{confirmed.length}</span><span className="text-sm font-bold text-emerald-800"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span></div></summary>
        <div className="mt-4 divide-y divide-slate-200">{confirmed.length ? confirmed.map((reservation) => { const isOwnBooking = reservation.booked_by_user_id === data.userId; const canManage = isManageView || isOwnBooking; return <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div><p className="font-black text-slate-950">{londonDateTime(reservation.starts_at)}–{londonTime(reservation.ends_at)}</p><p className="mt-1 text-slate-700">{tableNames.get(reservation.table_id)} · <strong>{reservationTitle(reservation)}</strong></p><p className="mt-1 text-xs text-slate-500">Booked by {reservation.playerName}</p></div><div className="flex gap-2">{canManage ? <button type="button" disabled={saving} onClick={() => editReservation(reservation)} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800">Edit</button> : null}{isManageView ? <button type="button" disabled={saving} onClick={() => void deleteReservation(reservation.id)} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">Delete</button> : isOwnBooking ? <button type="button" disabled={saving} onClick={() => void cancel(reservation.id)} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">Cancel</button> : null}</div></article>; }) : <p className="text-sm text-slate-600">No confirmed upcoming bookings.</p>}</div>
      </details>

      <details className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><h2 className="text-2xl font-black text-slate-950">Weekly booking hours</h2><span className="shrink-0 text-sm font-bold text-emerald-800"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span></summary><div className="mt-4 grid gap-4 md:grid-cols-2">{data.tables.map((table) => <article key={table.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="font-black text-slate-950">{table.name}</h3><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">{days.map((dayName, weekday) => { const rule = data.availability.find((window) => window.table_id === table.id && window.weekday === weekday); return <div key={dayName} className="contents"><dt className="text-slate-600">{dayName}</dt><dd className={rule ? "font-semibold text-emerald-800" : "font-semibold text-red-700"}>{rule ? `${rule.opens_at.slice(0, 5)}–${rule.closes_at.slice(0, 5)}` : "Closed"}</dd></div>; })}</dl></article>)}</div></details>

      {temporaryPeriods.length ? <details open className="group rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><div><h2 className="text-2xl font-black text-sky-950">Dated opening-hours changes</h2><p className="mt-1 text-sm text-sky-800">Standard hours remain saved and resume automatically after each dated change.</p></div><span className="rounded-full bg-sky-200 px-3 py-1 text-sm font-black text-sky-950">{temporaryPeriods.length}</span></summary><div className="mt-4 space-y-3">{temporaryPeriods.map((period) => <article key={`${period.tableId}:${period.startsOn}:${period.endsOn}`} className="rounded-xl border border-sky-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-slate-950">{data.tables.find((table) => table.id === period.tableId)?.name ?? "Table"}</h3><p className="mt-1 font-semibold text-sky-900">{new Date(`${period.startsOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} to {new Date(`${period.endsOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p></div>{isManageView ? <div className="flex gap-2"><button type="button" onClick={() => editTemporaryAvailability(period)} className="rounded-lg border border-sky-300 px-3 py-2 text-sm font-bold text-sky-900">Edit</button><button type="button" disabled={saving} onClick={() => void deleteTemporaryAvailability(period)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Remove</button></div> : null}</div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">{mondayToSunday.map((weekday) => { const row = period.rows.find((entry) => entry.weekday === weekday); return <div key={weekday} className="contents"><dt className="text-slate-600">{days[weekday]}</dt><dd className={row && !row.is_closed ? "font-semibold text-emerald-800" : "font-semibold text-red-700"}>{row && !row.is_closed ? `${row.opens_at?.slice(0, 5)}–${row.closes_at?.slice(0, 5)}` : "Closed"}</dd></div>; })}</dl></article>)}</div></details> : null}

      <details className="group rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><h2 className="text-2xl font-black text-amber-950">Entertainment, home matches and closures</h2><div className="flex shrink-0 items-center gap-2"><span className="rounded-full bg-amber-200 px-3 py-1 text-sm font-black text-amber-950">{upcomingBlocks.length}</span><span className="text-sm font-bold text-amber-900"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span></div></summary><div className="mt-4 space-y-3">{upcomingBlocks.length ? upcomingBlocks.map((block) => <article key={block.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-4"><div><p className="font-black text-amber-950">{block.title}</p><p className="text-sm text-amber-900">{londonDateTime(block.starts_at)}–{londonTime(block.ends_at)} · {block.table_id ? tableNames.get(block.table_id) : "All tables"} · {block.category.replaceAll("_", " ")}</p>{block.notes ? <p className="mt-1 text-sm text-slate-600">{block.notes}</p> : null}</div>{isManageView ? <button type="button" disabled={saving} onClick={() => void removeBlock(block.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Remove</button> : null}</article>) : <p className="text-sm text-amber-900">No upcoming unavailable periods have been added.</p>}</div></details>

      {isManageView ? <>
        <details open className="group rounded-2xl border border-emerald-300 bg-emerald-50 p-5 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><div><h2 className="text-2xl font-black text-emerald-950">Super User: opening hours</h2><p className="mt-1 text-sm text-emerald-800">Enter the club’s Monday-to-Sunday hours and choose whether the change is permanent or for fixed dates.</p></div><span className="shrink-0 text-sm font-bold text-emerald-900"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span></summary><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-emerald-950">Table<select value={temporaryTableId} onChange={(event) => chooseTemporaryTable(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2">{data.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-emerald-950">How long does this change apply?<select value={hoursChangeType} onChange={(event) => { const next = event.target.value as "standard" | "dated"; setHoursChangeType(next); if (next === "standard") chooseTemporaryTable(temporaryTableId); }} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2"><option value="standard">Standard hours — until changed again</option><option value="dated">Different hours between fixed dates</option></select></label></div>{hoursChangeType === "dated" ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-emerald-950">Starts<input type="date" value={temporaryStartsOn} onChange={(event) => setTemporaryStartsOn(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-emerald-950">Ends<input type="date" min={temporaryStartsOn} value={temporaryEndsOn} onChange={(event) => setTemporaryEndsOn(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2" /></label></div> : <p className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm text-emerald-900">These become the table’s normal opening hours and stay in place until a Super User changes them again.</p>}<div className="mt-4 overflow-x-auto"><div className="min-w-[620px] space-y-2">{temporaryHours.map((row, index) => <div key={row.weekday} className="grid grid-cols-[130px_120px_1fr_1fr] items-center gap-3 rounded-xl border border-emerald-200 bg-white p-3"><strong className="text-slate-950">{days[row.weekday]}</strong><label className="flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={row.isClosed} onChange={(event) => setTemporaryHours((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, isClosed: event.target.checked } : entry))} />Closed</label><label className="text-xs font-semibold text-slate-600">Opens<input type="time" disabled={row.isClosed} value={row.opensAt} onChange={(event) => setTemporaryHours((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, opensAt: event.target.value } : entry))} className="mt-1 w-full rounded-lg border border-emerald-300 px-3 py-2 disabled:opacity-40" /></label><label className="text-xs font-semibold text-slate-600">Closes<input type="time" disabled={row.isClosed} value={row.closesAt} onChange={(event) => setTemporaryHours((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, closesAt: event.target.value } : entry))} className="mt-1 w-full rounded-lg border border-emerald-300 px-3 py-2 disabled:opacity-40" /></label></div>)}</div></div><button type="button" disabled={saving || !temporaryTableId || (hoursChangeType === "dated" && (!temporaryStartsOn || !temporaryEndsOn))} onClick={() => void saveTemporaryAvailability()} className="mt-4 rounded-lg bg-emerald-800 px-4 py-2.5 font-bold text-white disabled:opacity-50">Save opening hours</button></details>

        <details className="group rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><div><h2 className="text-2xl font-black text-amber-950">Super User: make tables unavailable</h2><p className="mt-1 text-sm text-amber-900">Add entertainment, home matches or closures.</p></div><span className="shrink-0 text-sm font-bold text-amber-900"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span></summary><p className="mt-4 text-sm text-amber-900">These periods override weekly hours. Existing bookings must be cancelled or moved first.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="text-sm font-medium text-amber-950">Applies to<select value={blockTableId} onChange={(event) => setBlockTableId(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2"><option value="">All tables</option>{data.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-amber-950">Reason<select value={blockCategory} onChange={(event) => setBlockCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2"><option value="entertainment">Entertainment</option><option value="pool_home_match">Pool team home match</option><option value="snooker_home_match">Snooker team home match</option><option value="private_event">Private event</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select></label><label className="text-sm font-medium text-amber-950 lg:col-span-2">Starts<input type="datetime-local" value={blockStartsAt} onChange={(event) => setBlockStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 lg:col-span-2">Ends<input type="datetime-local" value={blockEndsAt} onChange={(event) => setBlockEndsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 sm:col-span-2 lg:col-span-3">Title<input value={blockTitle} maxLength={120} onChange={(event) => setBlockTitle(event.target.value)} placeholder="e.g. Saturday night entertainment or Home v Northfleet" className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 sm:col-span-2">Notes (optional)<input value={blockNotes} maxLength={240} onChange={(event) => setBlockNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><button type="button" disabled={saving || !blockTitle || !blockStartsAt || !blockEndsAt} onClick={() => void addBlock()} className="self-end rounded-lg bg-amber-800 px-4 py-2.5 font-bold text-white disabled:opacity-50">Add closure</button></div></details>

        <details className="group rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><div><h2 className="text-2xl font-black text-violet-950">Captain and vice-captain access</h2><p className="mt-1 text-sm text-violet-800">Manage additional table-booking access.</p></div><div className="flex shrink-0 items-center gap-2"><span className="rounded-full bg-violet-200 px-3 py-1 text-sm font-black text-violet-950">{data.access.length}</span><span className="text-sm font-bold text-violet-900"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span></div></summary><p className="mt-4 text-sm text-violet-800">Masters entrants receive access automatically for their competition’s table. Use this register for pool and snooker captains or vice-captains.</p><div className="mt-4 grid gap-3 sm:grid-cols-4"><select value={grantPlayerId} onChange={(event) => setGrantPlayerId(event.target.value)} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="">Choose player</option>{data.players.map((player) => <option key={player.id} value={player.id}>{player.full_name?.trim() || player.display_name}</option>)}</select><select value={grantSport} onChange={(event) => setGrantSport(event.target.value as "pool" | "snooker")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="pool">Pool</option><option value="snooker">Snooker</option></select><select value={grantRole} onChange={(event) => setGrantRole(event.target.value as "captain" | "vice_captain")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="captain">Captain</option><option value="vice_captain">Vice-captain</option></select><button type="button" disabled={saving || !grantPlayerId} onClick={() => void grant()} className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50">Grant access</button></div><div className="mt-4 flex flex-wrap gap-2">{data.access.map((grantRow) => <span key={grantRow.id} className="inline-flex items-center gap-2 rounded-full border border-violet-300 bg-white px-3 py-2 text-sm text-violet-950"><strong>{grantRow.playerName}</strong> · {grantRow.sport_type} {grantRow.access_role.replace("_", "-")}<button type="button" disabled={saving} onClick={() => void revoke(grantRow)} className="font-bold text-red-700">Remove</button></span>)}</div></details>
      </> : null}
    </> : null}
  </RequireAuth></div></main>;
}
