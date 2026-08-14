"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import MessageModal from "@/components/MessageModal";
import { supabase } from "@/lib/supabase";

type CueTable = { id: string; name: string; sport_type: "pool" | "snooker"; location_id: string };
type Reservation = { id: string; table_id: string; booked_by_user_id: string; booked_for_player_id: string; starts_at: string; ends_at: string; purpose: string; notes: string | null; playerName: string };
type AccessGrant = { id: string; player_id: string; sport_type: "pool" | "snooker"; access_role: "captain" | "vice_captain"; playerName: string };
type Player = { id: string; display_name: string; full_name: string | null };
type BookingData = { isSuper: boolean; playerId: string | null; eligibleSports: string[]; tables: CueTable[]; reservations: Reservation[]; access: AccessGrant[]; players: Player[] };

const londonDateTime = (value: string) => new Date(value).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
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
  const [duration, setDuration] = useState("60");
  const [purpose, setPurpose] = useState("fixture");
  const [notes, setNotes] = useState("");
  const [grantPlayerId, setGrantPlayerId] = useState("");
  const [grantSport, setGrantSport] = useState<"pool" | "snooker">("pool");
  const [grantRole, setGrantRole] = useState<"captain" | "vice_captain">("captain");

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
    if (tableId || !data) return;
    const firstEligible = data.tables.find((table) => data.eligibleSports.includes(table.sport_type));
    if (firstEligible) setTableId(firstEligible.id);
  }, [data, tableId]);

  const eligibleTables = useMemo(() => (data?.tables ?? []).filter((table) => data?.eligibleSports.includes(table.sport_type)), [data]);
  const tableNames = useMemo(() => new Map((data?.tables ?? []).map((table) => [table.id, table.name])), [data]);
  const upcoming = useMemo(() => (data?.reservations ?? []).filter((reservation) => new Date(reservation.ends_at).getTime() >= Date.now()), [data]);

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

  return <main className="min-h-screen bg-slate-100 p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-4"><RequireAuth>
    <header className="rounded-3xl bg-gradient-to-r from-emerald-950 to-slate-950 p-5 text-white shadow-xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">App-only reservations</p><h1 className="mt-1 text-3xl font-black">Book a cue table</h1><p className="mt-2 text-emerald-100">For authorised pool and snooker players. Reservations cannot be made through a public link.</p></div><PageNav /></div></header>
    <MessageModal message={message} onClose={() => setMessage(null)} />
    {loading ? <section className="rounded-2xl bg-white p-5 shadow">Loading reservations…</section> : null}
    {data ? <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-black text-slate-950">Make a reservation</h2><p className="mt-1 text-sm text-slate-600">Eligibility: Masters entrants can reserve the pool table; registered captains and vice-captains can reserve their sport&apos;s table.</p><p className="mt-1 text-xs text-slate-500">Book up to 60 days ahead. Earliest starts: 1pm Monday–Thursday and 11am Friday–Sunday.</p></div>{data.isSuper ? <Link href="/display/table-reservations" target="_blank" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">Open TV display</Link> : null}</div>
        {!data.playerId ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Link your app account to a player profile before booking.</p> : null}
        {data.playerId && !eligibleTables.length ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">Your account does not currently have table-booking access. Ask the Super User if you are a captain or vice-captain.</p> : null}
        {eligibleTables.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm font-medium text-slate-700">Table<select value={tableId} onChange={(event) => setTableId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{eligibleTables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Starts<input type="datetime-local" min={localInputValue(new Date())} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Length<select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{[30,60,90,120,150,180,240].map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} mins` : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="fixture">Competition fixture</option><option value="league_match">League match</option><option value="practice">Practice</option><option value="other">Other</option></select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Notes (optional)<input value={notes} maxLength={240} onChange={(event) => setNotes(event.target.value)} placeholder="Opponent, team or fixture details" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><button type="button" disabled={saving || !tableId || !startsAt} onClick={() => void book()} className="self-end rounded-lg bg-emerald-800 px-4 py-2.5 font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Reserve table"}</button></div> : null}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-2xl font-black text-slate-950">Upcoming reservations</h2><div className="mt-4 space-y-3">{upcoming.length ? upcoming.map((reservation) => <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div><p className="font-black text-slate-950">{londonDateTime(reservation.starts_at)}–{new Date(reservation.ends_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</p><p className="text-slate-700">{tableNames.get(reservation.table_id)} · {reservation.playerName} · {reservation.purpose.replace("_", " ")}</p>{reservation.notes ? <p className="text-sm text-slate-500">{reservation.notes}</p> : null}</div>{(data.isSuper || reservation.booked_for_player_id === data.playerId) ? <button type="button" disabled={saving} onClick={() => void cancel(reservation.id)} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">Cancel</button> : null}</article>) : <p className="text-sm text-slate-600">No upcoming reservations.</p>}</div></section>
      {data.isSuper ? <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm"><h2 className="text-2xl font-black text-violet-950">Captain and vice-captain access</h2><p className="mt-1 text-sm text-violet-800">Masters entrants receive pool access automatically. Use this register for pool and snooker captains or vice-captains.</p><div className="mt-4 grid gap-3 sm:grid-cols-4"><select value={grantPlayerId} onChange={(event) => setGrantPlayerId(event.target.value)} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="">Choose player</option>{data.players.map((player) => <option key={player.id} value={player.id}>{player.full_name?.trim() || player.display_name}</option>)}</select><select value={grantSport} onChange={(event) => setGrantSport(event.target.value as "pool" | "snooker")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="pool">Pool</option><option value="snooker">Snooker</option></select><select value={grantRole} onChange={(event) => setGrantRole(event.target.value as "captain" | "vice_captain")} className="rounded-lg border border-violet-300 bg-white px-3 py-2"><option value="captain">Captain</option><option value="vice_captain">Vice-captain</option></select><button type="button" disabled={saving || !grantPlayerId} onClick={() => void grant()} className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50">Grant access</button></div><div className="mt-4 flex flex-wrap gap-2">{data.access.map((grantRow) => <span key={grantRow.id} className="inline-flex items-center gap-2 rounded-full border border-violet-300 bg-white px-3 py-2 text-sm text-violet-950"><strong>{grantRow.playerName}</strong> · {grantRow.sport_type} {grantRow.access_role.replace("_", "-")}<button type="button" disabled={saving} onClick={() => void revoke(grantRow)} className="font-bold text-red-700">Remove</button></span>)}</div></section> : null}
    </> : null}
  </RequireAuth></div></main>;
}
