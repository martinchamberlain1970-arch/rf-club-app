type ScheduledLeagueFixture = {
  week: number;
  scheduledFor: string | null;
  isReschedulePlaceholder?: boolean;
};

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getCalendarCurrentLeagueWeek(
  fixtures: ScheduledLeagueFixture[],
  fallbackWeeks: number[] = [],
  today = new Date(),
) {
  const scheduled = fixtures
    .filter((fixture) => !fixture.isReschedulePlaceholder && fixture.scheduledFor)
    .map((fixture) => ({ ...fixture, date: fixture.scheduledFor!.slice(0, 10) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.week - b.week);

  if (!scheduled.length) return fallbackWeeks[0] ?? 1;

  const monday = new Date(today);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = localDateKey(monday);
  const weekEnd = localDateKey(addLocalDays(monday, 6));

  const thisWeek = scheduled.find((fixture) => fixture.date >= weekStart && fixture.date <= weekEnd);
  if (thisWeek) return thisWeek.week;

  const nextWeek = scheduled.find((fixture) => fixture.date > weekEnd);
  if (nextWeek) return nextWeek.week;

  return scheduled.at(-1)?.week ?? fallbackWeeks.at(-1) ?? 1;
}
