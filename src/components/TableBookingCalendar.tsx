"use client";

import { useMemo, useState } from "react";

type CalendarTable = { id: string; name: string; sport_type: "pool" | "snooker" };
type CalendarReservation = { table_id: string; starts_at: string; ends_at: string; status: string };
type CalendarAvailability = { table_id: string; weekday: number; opens_at: string; closes_at: string };
type CalendarBlock = { table_id: string | null; starts_at: string; ends_at: string };

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const minutes = (value: string) => { const [hour, minute] = value.slice(0, 5).split(":").map(Number); return hour * 60 + minute; };
const timeValue = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
const overlaps = (start: Date, end: Date, item: { starts_at: string; ends_at: string }) => start < new Date(item.ends_at) && end > new Date(item.starts_at);

export default function TableBookingCalendar({ tables, reservations, availability, blocks, onChooseSlot }: {
  tables: CalendarTable[];
  reservations: CalendarReservation[];
  availability: CalendarAvailability[];
  blocks: CalendarBlock[];
  onChooseSlot: (tableId: string, startsAt: string, duration: number) => void;
}) {
  const today = useMemo(() => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; }, []);
  const latest = useMemo(() => { const value = new Date(today); value.setDate(value.getDate() + 60); return value; }, [today]);
  const [shownMonth, setShownMonth] = useState(monthKey(today));
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const [selectedDate, setSelectedDate] = useState(dateKey(today));
  const table = tables.find((entry) => entry.id === tableId) ?? tables[0];

  const slotData = (day: Date) => {
    if (!table || day < today || day > latest) return { total: 0, free: [] as { start: Date; label: string; duration: number }[] };
    const rule = availability.find((entry) => entry.table_id === table.id && entry.weekday === day.getDay());
    if (!rule) return { total: 0, free: [] as { start: Date; label: string; duration: number }[] };
    const duration = table.sport_type === "pool" ? 30 : 60;
    const free: { start: Date; label: string; duration: number }[] = [];
    let total = 0;
    for (let value = minutes(rule.opens_at); value + duration <= minutes(rule.closes_at); value += duration) {
      const start = new Date(`${dateKey(day)}T${timeValue(value)}:00`);
      const end = new Date(start.getTime() + duration * 60000);
      if (start < new Date()) continue;
      total += 1;
      const unavailable = reservations.some((entry) => entry.table_id === table.id && entry.status === "booked" && overlaps(start, end, entry))
        || blocks.some((entry) => (!entry.table_id || entry.table_id === table.id) && overlaps(start, end, entry));
      if (!unavailable) free.push({ start, label: timeValue(value), duration });
    }
    return { total, free };
  };

  if (!table) return null;
  const [year, month] = shownMonth.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const cells: (Date | null)[] = Array.from({ length: (first.getDay() + 6) % 7 }, () => null);
  for (let day = 1; day <= last.getDate(); day += 1) cells.push(new Date(year, month - 1, day));
  while (cells.length % 7) cells.push(null);
  const selected = new Date(`${selectedDate}T12:00:00`);
  const selectedSlots = slotData(selected).free;
  const previousMonth = new Date(year, month - 2, 1);
  const nextMonth = new Date(year, month, 1);
  const canPrevious = previousMonth >= new Date(today.getFullYear(), today.getMonth(), 1);
  const canNext = nextMonth <= new Date(latest.getFullYear(), latest.getMonth(), 1);

  return <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-2xl font-black text-slate-950">Choose an available time</h2><p className="mt-1 text-sm text-slate-600">Select a date, then choose a free time to fill in the booking form.</p></div>
      <select value={table.id} onChange={(event) => { setTableId(event.target.value); setSelectedDate(dateKey(today)); }} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">{tables.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
    </div>
    <div className="mt-5 flex items-center justify-between gap-3"><button type="button" disabled={!canPrevious} onClick={() => { setShownMonth(monthKey(previousMonth)); setSelectedDate(dateKey(previousMonth < today ? today : previousMonth)); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-30">Previous</button><h3 className="text-lg font-black text-slate-900">{first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3><button type="button" disabled={!canNext} onClick={() => { setShownMonth(monthKey(nextMonth)); setSelectedDate(dateKey(nextMonth)); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-30">Next</button></div>
    <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-bold uppercase text-slate-500">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
    <div className="grid grid-cols-7 gap-1">{cells.map((day, index) => {
      if (!day) return <span key={`blank-${index}`} className="min-h-20 rounded-lg bg-slate-50" />;
      const slots = slotData(day);
      const key = dateKey(day);
      const closed = slots.total === 0;
      const full = !closed && slots.free.length === 0;
      const partlyBooked = !closed && !full && slots.free.length < slots.total;
      const selectable = slots.free.length > 0;
      const colour = closed || day < today || day > latest ? "bg-slate-100 text-slate-400" : full ? "bg-slate-200 text-slate-600" : partlyBooked ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-950";
      const fullLabel = closed ? "Closed" : full ? "Full" : partlyBooked ? "Partly booked" : "Available";
      const shortLabel = closed ? "—" : full ? "Full" : partlyBooked ? "Part" : "Free";
      return <button key={key} type="button" aria-label={`${day.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}: ${fullLabel}`} disabled={!selectable} onClick={() => setSelectedDate(key)} className={`min-h-20 min-w-0 overflow-hidden rounded-lg border p-1.5 text-left sm:p-2 ${colour} ${selectedDate === key ? "border-emerald-800 ring-2 ring-emerald-600" : "border-transparent"} disabled:cursor-default`}><span className="block text-sm font-black sm:text-base">{day.getDate()}</span><span className="mt-1 block truncate text-[9px] font-bold sm:hidden">{shortLabel}</span><span className="mt-1 hidden truncate text-xs font-bold sm:block">{fullLabel}</span></button>;
    })}</div>
    <div className="mt-5 rounded-xl bg-slate-50 p-4"><h3 className="font-black text-slate-950">{selected.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3>{selectedSlots.length ? <div className="mt-3 flex flex-wrap gap-2">{selectedSlots.map((slot) => <button key={slot.start.toISOString()} type="button" onClick={() => onChooseSlot(table.id, slot.start.toISOString(), slot.duration)} className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700">{slot.label}</button>)}</div> : <p className="mt-2 text-sm text-slate-600">No online booking times are available on this date.</p>}</div>
  </section>;
}
