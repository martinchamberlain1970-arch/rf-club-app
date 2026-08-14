"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import MessageModal from "@/components/MessageModal";
import TableBookingCalendar from "@/components/TableBookingCalendar";
import { supabase } from "@/lib/supabase";

type CueTable = { id: string; name: string; sport_type: "pool" | "snooker"; location_id: string };
type Reservation = { id: string; table_id: string; booked_by_user_id: string; booked_for_player_id: string; starts_at: string; ends_at: string; purpose: string; notes: string | null; playerName: string };
type AccessGrant = { id: string; player_id: string; sport_type: "pool" | "snooker"; access_role: "captain" | "vice_captain"; playerName: string };
type Player = { id: string; display_name: string; full_name: string | null };
type AvailabilityWindow = { id: string; table_id: string; weekday: number; opens_at: string; closes_at: string };
type BookingBlock = { id: string; table_id: string | null; starts_at: string; ends_at: string; category: string; title: string; notes: string | null };
type BookingData = { isSuper: boolean; playerId: string | null; eligibleSports: string[]; tables: CueTable[]; reservations: Reservation[]; availability: AvailabilityWindow[]; blocks: BookingBlock[]; access: AccessGrant[]; players: Player[] };

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const londonDateTime = (value: string) => new Date(value).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const londonTime = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const localInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export default function TableBookingsPage() {
  const [data, setData] = useState<BookingData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableId, setTableId] = useState("");
  const [startsAt, setStartsAt] = useState(() => { const date = new Date(); date.setHours(date.getHours() + 1, 0, 0, 0); return localInputValue(date); });
  const [duration, setDuration] = useState("30");
  const [purpose, setPurpose] = useState("fixture");
  const [notes, setNotes] = useState("");
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
  const selectedTable = eligibleTables.find((table) => table.id === tableId);
  const durationOptions = data?.isSuper ? [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360] : selectedTable?.sport_type === "snooker" ? [30, 60] : [30];
  const tableNames = useMemo(() => new Map((data?.tables ?? []).map((table) => [table.id, table.name])), [data]);
  const upcoming = useMemo(() => (data?.reservations ?? []).filter((reservation) => new Date(reservation.ends_at).getTime() >= Date.now()), [data]);
  const upcomingBlocks = useMemo(() => (data?.blocks ?? []).filter((block) => new Date(block.ends_at).getTime() >= Date.now()), [data]);

  const book = async () => {
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + Number(duration) * 60000);
    setSaving(true);
    try {
      await request({ action: "book", tableId, startsAt: start.toISOString(), endsAt: end.toISOString(), purpose, notes });
      setNotes(""); setMessage("Table reserved successfully."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reservation failed."); }
    finally { setSaving(false); }
  };
  const cancel = async (reservationId: string) => {
    if (!window.confirm("Cancel this table reservation?")) return;
    setSaving(true);
    try { await request({ action: "cancel", reservationId }); setMessage("Reservation cancelled."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation failed."); }
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
    <header className="rounded-3xl bg-gradient-to-r from-emerald-950 to-slate-950 p-5 text-white shadow-xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">App-only reservations</p><h1 className="mt-1 text-3xl font-black">Book a cue table</h1><p className="mt-2 text-emerald-100">For authorised pool and snooker players. Reservations cannot be made through a public link.</p></div><PageNav /></div></header>
    <MessageModal message={message} onClose={() => setMessage(null)} />
    {loading ? <section className="rounded-2xl bg-white p-5 shadow">Loading reservations…</section> : null}
    {data ? <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="text-2xl font-black text-slate-950">Make a reservation</h2><p className="mt-1 text-sm text-slate-600">Masters entrants can reserve the pool table; registered pool and snooker captains or vice-captains can reserve their sport&apos;s table.</p><p className="mt-1 text-xs text-slate-500">Bookings must fit within the Super User&apos;s published hours. Entertainment, home fixtures and other closures override those hours.</p></div>
        {!data.playerId ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Link your app account to a player profile before booking.</p> : null}
        {data.playerId && !eligibleTables.length ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Your account does not currently have table-booking access. Ask the Super User if you are a captain or vice-captain.</p> : null}
        {eligibleTables.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm font-medium text-slate-700">Table<select value={tableId} onChange={(event) => { const nextTableId = event.target.value; setTableId(nextTableId); if (!data.isSuper && eligibleTables.find((table) => table.id === nextTableId)?.sport_type === "pool") setDuration("30"); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{eligibleTables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Starts<input type="datetime-local" min={localInputValue(new Date())} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Length<select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{durationOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} mins` : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Maximum: {data.isSuper ? "6 hours (Super User)" : selectedTable?.sport_type === "snooker" ? "1 hour" : "30 minutes"}</span></label><label className="text-sm font-medium text-slate-700">Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="fixture">Competition fixture</option><option value="league_match">League match</option><option value="practice">Practice</option><option value="other">Other</option></select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Notes (optional)<input value={notes} maxLength={240} onChange={(event) => setNotes(event.target.value)} placeholder="Opponent, team or fixture details" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><button type="button" disabled={saving || !tableId || !startsAt} onClick={() => void book()} className="self-end rounded-lg bg-emerald-800 px-4 py-2.5 font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Reserve table"}</button></div> : null}
      </section>

      <TableBookingCalendar tables={data.tables} reservations={data.reservations} availability={data.availability} blocks={data.blocks} eligibleTableIds={eligibleTables.map((table) => table.id)} onChooseSlot={(selectedTableId, selectedStartsAt, selectedDuration) => { const sportType = data.tables.find((table) => table.id === selectedTableId)?.sport_type; setTableId(selectedTableId); setStartsAt(selectedStartsAt); setDuration(String(Math.min(selectedDuration, sportType === "pool" ? 30 : 60))); setMessage("That available start time has been added to the reservation form."); }} />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-2xl font-black text-slate-950">Weekly booking hours</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{data.tables.map((table) => <article key={table.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="font-black text-slate-950">{table.name}</h3><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">{days.map((dayName, weekday) => { const rule = data.availability.find((window) => window.table_id === table.id && window.weekday === weekday); return <div key={dayName} className="contents"><dt className="text-slate-600">{dayName}</dt><dd className={rule ? "font-semibold text-emerald-800" : "font-semibold text-red-700"}>{rule ? `${rule.opens_at.slice(0, 5)}–${rule.closes_at.slice(0, 5)}` : "Closed"}</dd></div>; })}</dl></article>)}</div></section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-amber-950">Entertainment, home matches and closures</h2><div className="mt-4 space-y-3">{upcomingBlocks.length ? upcomingBlocks.map((block) => <article key={block.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-4"><div><p className="font-black text-amber-950">{block.title}</p><p className="text-sm text-amber-900">{londonDateTime(block.starts_at)}–{londonTime(block.ends_at)} · {block.table_id ? tableNames.get(block.table_id) : "All tables"} · {block.category.replaceAll("_", " ")}</p>{block.notes ? <p className="mt-1 text-sm text-slate-600">{block.notes}</p> : null}</div>{data.isSuper ? <button type="button" disabled={saving} onClick={() => void removeBlock(block.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700">Remove</button> : null}</article>) : <p className="text-sm text-amber-900">No upcoming unavailable periods have been added.</p>}</div></section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-2xl font-black text-slate-950">Upcoming reservations</h2><div className="mt-4 space-y-3">{upcoming.length ? upcoming.map((reservation) => <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div><p className="font-black text-slate-950">{londonDateTime(reservation.starts_at)}–{londonTime(reservation.ends_at)}</p><p className="text-slate-700">{tableNames.get(reservation.table_id)} · {reservation.playerName} · {reservation.purpose.replace("_", " ")}</p>{reservation.notes ? <p className="text-sm text-slate-500">{reservation.notes}</p> : null}</div>{(data.isSuper || reservation.booked_for_player_id === data.playerId) ? <button type="button" disabled={saving} onClick={() => void cancel(reservation.id)} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">Cancel</button> : null}</article>) : <p className="text-sm text-slate-600">No upcoming reservations.</p>}</div></section>

      {data.isSuper ? <>
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-emerald-950">Super User: weekly availability</h2><p className="mt-1 text-sm text-emerald-800">Choose when each pool or snooker table can normally be booked. A closed day has no bookable hours.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="text-sm font-medium text-emerald-950 lg:col-span-2">Table<select value={scheduleTableId} onChange={(event) => setScheduleTableId(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2">{data.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-emerald-950">Day<select value={scheduleWeekday} onChange={(event) => setScheduleWeekday(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2">{days.map((dayName, weekday) => <option key={dayName} value={weekday}>{dayName}</option>)}</select></label><label className="flex items-end gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-950"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />Bookable</label><label className="text-sm font-medium text-emerald-950">From<input type="time" disabled={!scheduleEnabled} value={scheduleOpens} onChange={(event) => setScheduleOpens(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 disabled:opacity-50" /></label><label className="text-sm font-medium text-emerald-950">Until<input type="time" disabled={!scheduleEnabled} value={scheduleCloses} onChange={(event) => setScheduleCloses(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 disabled:opacity-50" /></label><button type="button" disabled={saving || !scheduleTableId} onClick={() => void saveAvailability()} className="rounded-lg bg-emerald-800 px-4 py-2 font-bold text-white disabled:opacity-50 lg:col-start-6">Save hours</button></div></section>

        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-amber-950">Super User: make tables unavailable</h2><p className="mt-1 text-sm text-amber-900">Add entertainment, home-team fixtures or other closures. These override weekly hours. Existing bookings must be cancelled or moved first.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="text-sm font-medium text-amber-950">Applies to<select value={blockTableId} onChange={(event) => setBlockTableId(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2"><option value="">All tables</option>{data.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-amber-950">Reason<select value={blockCategory} onChange={(event) => setBlockCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2"><option value="entertainment">Entertainment</option><option value="pool_home_match">Pool team home match</option><option value="snooker_home_match">Snooker team home match</option><option value="private_event">Private event</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select></label><label className="text-sm font-medium text-amber-950 lg:col-span-2">Starts<input type="datetime-local" value={blockStartsAt} onChange={(event) => setBlockStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 lg:col-span-2">Ends<input type="datetime-local" value={blockEndsAt} onChange={(event) => setBlockEndsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 sm:col-span-2 lg:col-span-3">Title<input value={blockTitle} maxLength={120} onChange={(event) => setBlockTitle(event.target.value)} placeholder="e.g. Saturday night entertainment or Home v Northfleet" className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-950 sm:col-span-2">Notes (optional)<input value={blockNotes} maxLength={240} onChange={(event) => setBlockNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><button type="button" disabled={saving || !blockTitle || !blockStartsAt || !blockEndsAt} onClick={() => void addBlock()} className="self-end rounded-lg bg-amber-800 px-4 py-2.5 font-bold text-white disabled:opacity-50">Add closure</button></div></section>

        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-violet-950">Captain and vice-captain access</h2><p className="mt-1 text-sm text-violet-800">Masters entrants receive pool access automatically. Use this register for pool and snooker captains or vice-captains.</p><div className="mt-4 grid gap-3 sm:grid-cols-4"><select value={grantPlayerId} onChange={(event) => setGrantPlayerId(event.target.value)} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="">Choose player</option>{data.players.map((player) => <option key={player.id} value={player.id}>{player.full_name?.trim() || player.display_name}</option>)}</select><select value={grantSport} onChange={(event) => setGrantSport(event.target.value as "pool" | "snooker")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="pool">Pool</option><option value="snooker">Snooker</option></select><select value={grantRole} onChange={(event) => setGrantRole(event.target.value as "captain" | "vice_captain")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="captain">Captain</option><option value="vice_captain">Vice-captain</option></select><button type="button" disabled={saving || !grantPlayerId} onClick={() => void grant()} className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50">Grant access</button></div><div className="mt-4 flex flex-wrap gap-2">{data.access.map((grantRow) => <span key={grantRow.id} className="inline-flex items-center gap-2 rounded-full border border-violet-300 bg-white px-3 py-2 text-sm text-violet-950"><strong>{grantRow.playerName}</strong> · {grantRow.sport_type} {grantRow.access_role.replace("_", "-")}<button type="button" disabled={saving} onClick={() => void revoke(grantRow)} className="font-bold text-red-700">Remove</button></span>)}</div></section>
      </> : null}
    </> : null}
  </RequireAuth></div></main>;
}
