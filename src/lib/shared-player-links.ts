export type SharedLinkPlayer = {
  id: string;
  display_name: string;
  full_name: string | null;
  location_name: string | null;
  linked_email: string | null;
};

export type SharedLinkSuggestion = {
  clubPlayer: SharedLinkPlayer;
  leaguePlayer: SharedLinkPlayer;
  score: number;
  confidence: "High" | "Medium" | "Low";
  matchedCount: number;
  totalFields: number;
  matchedFields: string[];
};

export function normalizeSharedLinkValue(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function firstName(value: string) {
  return normalizeSharedLinkValue(value).split(" ")[0] ?? "";
}

function surname(value: string) {
  const parts = normalizeSharedLinkValue(value).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function buildSharedLinkSuggestion(clubPlayer: SharedLinkPlayer, leaguePlayer: SharedLinkPlayer): SharedLinkSuggestion | null {
  const clubName = clubPlayer.full_name?.trim() || clubPlayer.display_name;
  const leagueName = leaguePlayer.full_name?.trim() || leaguePlayer.display_name;
  const clubNorm = normalizeSharedLinkValue(clubName);
  const leagueNorm = normalizeSharedLinkValue(leagueName);
  const clubSurname = surname(clubName);
  const leagueSurname = surname(leagueName);
  if (!clubSurname || !leagueSurname || clubSurname !== leagueSurname) return null;

  let score = 0;
  const matchedFields: string[] = [];
  let matchedCount = 0;
  const totalFields = 4;

  if (clubNorm === leagueNorm) {
    score += 70;
    matchedFields.push("Exact name");
    matchedCount += 1;
  } else if (firstName(clubName) === firstName(leagueName)) {
    score += 35;
    matchedFields.push("Surname + first name");
    matchedCount += 1;
  } else {
    score -= 15;
  }

  if (clubPlayer.linked_email && leaguePlayer.linked_email) {
    if (normalizeSharedLinkValue(clubPlayer.linked_email) === normalizeSharedLinkValue(leaguePlayer.linked_email)) {
      score += 40;
      matchedFields.push("Linked email");
      matchedCount += 1;
    } else {
      score -= 10;
    }
  }

  if (clubPlayer.location_name && leaguePlayer.location_name) {
    if (normalizeSharedLinkValue(clubPlayer.location_name) === normalizeSharedLinkValue(leaguePlayer.location_name)) {
      score += 15;
      matchedFields.push("Club/location");
      matchedCount += 1;
    } else {
      score -= 5;
    }
  }

  const clubDisplay = normalizeSharedLinkValue(clubPlayer.display_name);
  const leagueDisplay = normalizeSharedLinkValue(leaguePlayer.display_name);
  if (clubDisplay && leagueDisplay && clubDisplay === leagueDisplay) {
    score += 10;
    matchedFields.push("Display name");
    matchedCount += 1;
  }

  if (score < 35) return null;
  const confidence: SharedLinkSuggestion["confidence"] = score >= 80 ? "High" : score >= 55 ? "Medium" : "Low";
  return { clubPlayer, leaguePlayer, score, confidence, matchedCount, totalFields, matchedFields };
}
