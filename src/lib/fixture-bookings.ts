export type FixtureBooking = {
  id: string;
  competition_id: string | null;
  participant_one_player_id: string | null;
  participant_two_player_id: string | null;
  starts_at: string;
  ends_at: string;
  purpose: string;
  status: string;
};

export type FixtureBookingMatch = {
  id: string;
  competition_id: string;
  player1_id: string | null;
  player2_id: string | null;
  scheduled_for?: string | null;
  status?: string | null;
};

function pairKey(first: string | null, second: string | null) {
  if (!first || !second || first === second) return null;
  return [first, second].sort().join(":");
}

function scheduledTime(value: string | null | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/**
 * Assigns each confirmed competition-table booking to the nearest matching
 * fixture. Open fixtures ignore expired reservations so a replacement booking
 * becomes the visible booking. The one-to-one assignment matters when the same
 * pair play twice.
 */
export function assignFixtureBookings(
  matches: FixtureBookingMatch[],
  bookings: FixtureBooking[],
  now = new Date()
) {
  const edges: Array<{ matchId: string; booking: FixtureBooking; distance: number }> = [];
  const nowTime = now.getTime();

  for (const match of matches) {
    if (match.status === "bye") continue;
    const matchPair = pairKey(match.player1_id, match.player2_id);
    if (!matchPair) continue;
    const matchTime = scheduledTime(match.scheduled_for);

    for (const booking of bookings) {
      const bookingEndTime = Date.parse(booking.ends_at);
      const matchIsOpen = match.status === "pending" || match.status === "in_progress";
      if (
        booking.status !== "booked" ||
        booking.purpose !== "fixture" ||
        booking.competition_id !== match.competition_id ||
        pairKey(booking.participant_one_player_id, booking.participant_two_player_id) !== matchPair ||
        (matchIsOpen && Number.isFinite(bookingEndTime) && bookingEndTime < nowTime)
      ) continue;
      const bookingTime = Date.parse(booking.starts_at);
      edges.push({
        matchId: match.id,
        booking,
        distance: Math.abs(matchTime - (Number.isFinite(bookingTime) ? bookingTime : matchTime)),
      });
    }
  }

  edges.sort((left, right) => left.distance - right.distance || left.booking.starts_at.localeCompare(right.booking.starts_at));
  const assignedMatches = new Set<string>();
  const assignedBookings = new Set<string>();
  const result = new Map<string, FixtureBooking>();
  for (const edge of edges) {
    if (assignedMatches.has(edge.matchId) || assignedBookings.has(edge.booking.id)) continue;
    assignedMatches.add(edge.matchId);
    assignedBookings.add(edge.booking.id);
    result.set(edge.matchId, edge.booking);
  }
  return result;
}

export function fixtureBookingLabel(booking: FixtureBooking) {
  const startsAt = new Date(booking.starts_at);
  const endsAt = new Date(booking.ends_at);
  const date = startsAt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
  const start = startsAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  });
  const end = endsAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  });
  return `${date}, ${start}–${end}`;
}
