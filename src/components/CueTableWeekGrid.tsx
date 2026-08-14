"use client";

export type GridTable = { id: string; name: string; sport_type: "pool" | "snooker" };
export type GridReservation = { id: string; table_id: string; starts_at: string; ends_at: string; playerName: string; purpose?: string; notes?: string | null };
export type GridAvailability = { table_id: string; weekday: number; opens_at: string; closes_at: string };
export type GridBlock = { id: string; table_id: string | null; starts_at: string; ends_at: string; category?: string; title: string; notes?: string | null };
type Period = { id: string; start: number; end: number; title: string; detail: string; kind: "booking" | "closure" };

const pad = (value: number) => String(value).padStart(2, "0");
const time = (value: number) => `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
const timeMinutes = (value: string) => { const [hour, minute] = value.slice(0, 5).split(":").map(Number); return hour * 60 + minute; };
const londonDateKey = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const londonMinutes = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  return Number(parts.find((entry) => entry.type === "hour")?.value ?? 0) * 60 + Number(parts.find((entry) => entry.type === "minute")?.value ?? 0);
};
const datesFrom = (start: string) => Array.from({ length: 7 }, (_, index) => { const date = new Date(`${start}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0, 10); });
const dayTitle = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

function periodsForDate(date: string, table: GridTable, reservations: GridReservation[], blocks: GridBlock[]) {
  const periods: Period[] = [];
  const add = (id: string, startsAt: string, endsAt: string, title: string, detail: string, kind: Period["kind"]) => {
    const startDate = londonDateKey(startsAt);
    const endDate = londonDateKey(endsAt);
    if (date < startDate || date > endDate) return;
    const start = date === startDate ? londonMinutes(startsAt) : 0;
    const end = date === endDate ? londonMinutes(endsAt) : 24 * 60;
    if (end > start) periods.push({ id, start, end, title, detail, kind });
  };
  reservations.filter((entry) => entry.table_id === table.id).forEach((entry) => add(entry.id, entry.starts_at, entry.ends_at, entry.playerName, [entry.purpose?.replaceAll("_", " "), entry.notes].filter(Boolean).join(" · "), "booking"));
  blocks.filter((entry) => !entry.table_id || entry.table_id === table.id).forEach((entry) => add(entry.id, entry.starts_at, entry.ends_at, entry.title, [entry.category?.replaceAll("_", " "), entry.notes].filter(Boolean).join(" · "), "closure"));
  return periods.sort((left, right) => left.start - right.start);
}

function freeSlots(opens: number, closes: number, periods: Period[]) {
  const busy = periods.map((period) => ({ start: Math.max(opens, period.start), end: Math.min(closes, period.end) })).filter((period) => period.end > period.start).sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const period of busy) {
    const last = merged.at(-1);
    if (last && period.start <= last.end) last.end = Math.max(last.end, period.end);
    else merged.push({ ...period });
  }
  const slots: Array<{ start: number; end: number }> = [];
  let cursor = opens;
  for (const period of merged) { if (period.start - cursor >= 30) slots.push({ start: cursor, end: period.start }); cursor = Math.max(cursor, period.end); }
  if (closes - cursor >= 30) slots.push({ start: cursor, end: closes });
  return slots;
}

export default function CueTableWeekGrid({ table, weekStart, reservations, blocks, availability, canBook = false, onChooseSlot, tv = false }: { table: GridTable; weekStart: string; reservations: GridReservation[]; blocks: GridBlock[]; availability: GridAvailability[]; canBook?: boolean; onChooseSlot?: (startsAt: string, duration: number) => void; tv?: boolean }) {
  const rules = availability.filter((rule) => rule.table_id === table.id);
  const axisStart = Math.min(11, ...rules.map((rule) => Math.floor(timeMinutes(rule.opens_at) / 60)));
  const axisEnd = Math.max(23, ...rules.map((rule) => Math.ceil(timeMinutes(rule.closes_at) / 60)));
  const axisMinutes = (axisEnd - axisStart) * 60;
  const hours = Array.from({ length: axisEnd - axisStart + 1 }, (_, index) => axisStart + index);
  const left = (minutes: number) => `${Math.max(0, Math.min(100, ((minutes - axisStart * 60) / axisMinutes) * 100))}%`;
  const width = (start: number, end: number) => `${Math.max(0, (Math.min(end, axisEnd * 60) - Math.max(start, axisStart * 60)) / axisMinutes * 100)}%`;

  return <div className={`overflow-hidden rounded-2xl border ${tv ? "border-white/20 bg-black/25" : "border-slate-200 bg-white"}`}><div className="overflow-x-auto"><div className={tv ? "min-w-[1180px]" : "min-w-[1000px]"}>
    <div className={`grid grid-cols-[120px_1fr] border-b ${tv ? "border-white/20 bg-black/35" : "border-slate-200 bg-slate-50"}`}><div className={`p-3 font-black ${tv ? "text-lg text-lime-300" : "text-sm text-slate-950"}`}>{table.name}</div><div className="relative h-12">{hours.map((hour) => <div key={hour} className={`absolute inset-y-0 border-l ${tv ? "border-white/15" : "border-slate-300"}`} style={{ left: left(hour * 60) }}><span className={`absolute left-1 top-3 text-xs font-bold ${tv ? "text-white/70" : "text-slate-600"}`}>{pad(hour)}:00</span></div>)}</div></div>
    {datesFrom(weekStart).map((date) => {
      const rule = rules.find((entry) => entry.weekday === weekday(date));
      const opens = rule ? timeMinutes(rule.opens_at) : 0;
      const closes = rule ? timeMinutes(rule.closes_at) : 0;
      const periods = periodsForDate(date, table, reservations, blocks);
      const slots = rule ? freeSlots(opens, closes, periods) : [];
      return <div key={date} className={`grid grid-cols-[120px_1fr] border-b last:border-b-0 ${tv ? "border-white/15" : "border-slate-200"}`}><div className={`flex flex-col justify-center p-3 ${tv ? "bg-black/30 text-white" : "bg-slate-50 text-slate-950"}`}><span className={tv ? "text-lg font-black" : "text-sm font-black"}>{dayTitle(date)}</span><span className={`mt-1 text-[10px] font-bold uppercase ${slots.length ? (tv ? "text-emerald-300" : "text-emerald-700") : (tv ? "text-white/50" : "text-slate-500")}`}>{!rule ? "Closed" : slots.length ? `${slots.length} free period${slots.length === 1 ? "" : "s"}` : "Unavailable"}</span></div><div className={`relative ${tv ? "h-24 bg-slate-800" : "h-20 bg-slate-200"}`}>
        {hours.map((hour) => <div key={hour} className={`pointer-events-none absolute inset-y-0 border-l ${tv ? "border-white/10" : "border-slate-300"}`} style={{ left: left(hour * 60) }} />)}
        {slots.map((slot) => <button key={`free-${slot.start}-${slot.end}`} type="button" disabled={!canBook || !onChooseSlot} onClick={() => onChooseSlot?.(`${date}T${time(slot.start)}`, Math.min(table.sport_type === "pool" ? 30 : 60, slot.end - slot.start))} className="absolute inset-y-2 overflow-hidden rounded-lg border border-emerald-400 bg-emerald-700/90 px-2 text-left text-[10px] font-bold text-white disabled:cursor-default" style={{ left: left(slot.start), width: width(slot.start, slot.end) }}><span className="block truncate">Available</span><span className="block truncate opacity-90">{time(slot.start)}–{time(slot.end)}</span></button>)}
        {periods.map((period) => <div key={`${period.kind}-${period.id}`} className={`absolute inset-y-2 z-10 overflow-hidden rounded-lg border px-2 py-1 text-[10px] shadow-sm ${period.kind === "closure" ? "border-amber-500 bg-amber-300 text-amber-950" : "border-sky-600 bg-sky-600 text-white"}`} style={{ left: left(period.start), width: width(period.start, period.end) }} title={`${time(period.start)}–${time(period.end)} ${period.title}${period.detail ? ` · ${period.detail}` : ""}`}><span className="block truncate font-black">{period.title}</span><span className="block truncate">{time(period.start)}–{time(period.end)}</span><span className="block truncate opacity-75">{period.detail}</span></div>)}
      </div></div>;
    })}
  </div></div><div className={`flex flex-wrap gap-3 px-4 py-3 text-xs font-semibold ${tv ? "border-t border-white/15 bg-black/35 text-white/75" : "border-t border-slate-200 bg-slate-50 text-slate-600"}`}><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-emerald-400" />Available</span><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-sky-600" />Booked</span><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-amber-300" />Unavailable — reason shown</span><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-slate-400" />Outside enabled hours</span></div></div>;
}
