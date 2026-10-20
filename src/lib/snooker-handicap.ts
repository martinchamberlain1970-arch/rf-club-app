export const MAX_SNOOKER_START = 40;

export function targetSnookerHandicapFromElo(rating: number) {
  const raw = (1000 - rating) / 5;
  return Math.round(raw / 4) * 4;
}

export function calculateSnookerHandicapStarts(playerOneHandicap: number | null | undefined, playerTwoHandicap: number | null | undefined) {
  const h1 = playerOneHandicap ?? 0;
  const h2 = playerTwoHandicap ?? 0;
  const baseline = Math.min(h1, h2);
  const rawTeam1 = h1 - baseline;
  const rawTeam2 = h2 - baseline;

  return {
    team1: Math.min(MAX_SNOOKER_START, rawTeam1),
    team2: Math.min(MAX_SNOOKER_START, rawTeam2),
  };
}
