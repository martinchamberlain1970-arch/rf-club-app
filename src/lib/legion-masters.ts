export function normalizeCompetitionName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isLegionMastersLeague(value: string | null | undefined) {
  const name = normalizeCompetitionName(value);
  return name === "greenhithe legion masters 2026" || name === "greenhithe legion masters snooker 2026";
}

export function legionMastersCupName(value: string | null | undefined, sportType: string | null | undefined) {
  if (!isLegionMastersLeague(value)) return null;
  return sportType === "snooker"
    ? "Greenhithe Legion Masters Snooker Cup 2026"
    : "Greenhithe Legion Masters Cup 2026";
}
