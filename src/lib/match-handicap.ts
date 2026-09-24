export function handicapValue(value: number | null | undefined) {
  return Math.max(0, Number(value ?? 0));
}

export function formatMatchHandicapStart(
  team1Label: string,
  team2Label: string,
  team1Start: number | null | undefined,
  team2Start: number | null | undefined
) {
  const first = handicapValue(team1Start);
  const second = handicapValue(team2Start);
  if (first === 0 && second === 0) return "Match handicap start: Level (0–0)";
  return `Match handicap start: ${team1Label} ${first > 0 ? `+${first}` : "0"} · ${team2Label} ${second > 0 ? `+${second}` : "0"}`;
}
