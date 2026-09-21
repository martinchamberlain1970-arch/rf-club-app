export type TemporaryBookingHours = {
  id: string;
  table_id: string;
  starts_on: string;
  ends_on: string;
  weekday: number;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
};

export type NormalBookingHours = {
  table_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
};

export function effectiveHoursForDate(
  tableId: string,
  date: string,
  weekday: number,
  normalHours: NormalBookingHours[],
  temporaryHours: TemporaryBookingHours[]
) {
  const override = temporaryHours
    .filter((entry) => entry.table_id === tableId && entry.weekday === weekday && entry.starts_on <= date && entry.ends_on >= date)
    .sort((left, right) => right.starts_on.localeCompare(left.starts_on))[0];
  if (override) {
    return override.is_closed || !override.opens_at || !override.closes_at
      ? null
      : { opens_at: override.opens_at, closes_at: override.closes_at, temporary: true };
  }
  const normal = normalHours.find((entry) => entry.table_id === tableId && entry.weekday === weekday);
  return normal ? { opens_at: normal.opens_at, closes_at: normal.closes_at, temporary: false } : null;
}
