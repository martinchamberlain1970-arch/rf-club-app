"use client";

import { useState } from "react";
import CueTableWeekGrid, { GridAvailability, GridBlock, GridReservation, GridTable } from "@/components/CueTableWeekGrid";

const londonDateKey = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const mondayFor = (date: string) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return value.toISOString().slice(0, 10); };
const moveWeek = (date: string, amount: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount * 7); return value.toISOString().slice(0, 10); };
const weekLabel = (date: string) => { const end = new Date(`${date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6); return `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`; };

export default function TableBookingCalendar({ tables, reservations, availability, blocks, eligibleTableIds, onChooseSlot }: { tables: GridTable[]; reservations: GridReservation[]; availability: GridAvailability[]; blocks: GridBlock[]; eligibleTableIds: string[]; onChooseSlot: (tableId: string, startsAt: string, duration: number) => void }) {
  const currentWeek = mondayFor(londonDateKey(new Date()));
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const table = tables.find((entry) => entry.id === tableId) ?? tables[0];
  const maxWeek = moveWeek(currentWeek, 8);
  if (!table) return null;
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-black text-slate-950">Table availability</h2><p className="mt-1 text-sm text-slate-600">Days run down the left and booking times run across the top. Select a green period to prefill the booking form.</p></div><div className="flex flex-wrap gap-2"><select value={table.id} onChange={(event) => setTableId(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">{tables.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><button type="button" disabled={weekStart <= currentWeek} onClick={() => setWeekStart(moveWeek(weekStart, -1))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-40">Previous</button><button type="button" onClick={() => setWeekStart(currentWeek)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold">This week</button><button type="button" disabled={weekStart >= maxWeek} onClick={() => setWeekStart(moveWeek(weekStart, 1))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-40">Next</button></div></div><p className="my-4 text-sm font-bold text-slate-700">Week: {weekLabel(weekStart)}</p><CueTableWeekGrid table={table} weekStart={weekStart} reservations={reservations} blocks={blocks} availability={availability} canBook={eligibleTableIds.includes(table.id)} onChooseSlot={(startsAt, duration) => onChooseSlot(table.id, startsAt, duration)} /></section>;
}
