import { isLegionMastersLeague } from "@/lib/legion-masters";

const LONDON_TIME_ZONE = "Europe/London";
const NEW_DEADLINE_RULE_START = new Date("2026-10-26T00:00:00Z");

function londonOffsetMs(at: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - at.getTime();
}

export function getLeagueFixtureDeadlineTime(competitionName: string | null | undefined) {
  return isLegionMastersLeague(competitionName) ? "22:30" : "21:00";
}

export function getLeagueFixtureDeadline(scheduledFor: string | null | undefined, competitionName?: string | null) {
  if (!scheduledFor) return null;
  const [year, month, day] = scheduledFor.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const [hour, minute] = getLeagueFixtureDeadlineTime(competitionName).split(":").map(Number);
  const wallClockGuess = new Date(Date.UTC(year, month - 1, day + 6, hour, minute, 0));
  return new Date(wallClockGuess.getTime() - londonOffsetMs(wallClockGuess));
}

/** The normal four-week playing window closes two Sundays after the fixture's due week. */
export function getLeagueFixtureFinalDeadline(scheduledFor: string | null | undefined, competitionName?: string | null) {
  const originalDeadline = getLeagueFixtureDeadline(scheduledFor, competitionName);
  if (!originalDeadline) return null;
  const standardFinalDeadline = new Date(originalDeadline.getTime() + 14 * 24 * 60 * 60 * 1000);

  // When this policy was introduced, existing late fixtures were given one
  // final grace week so the new automatic walkover was not retrospective.
  if (originalDeadline < NEW_DEADLINE_RULE_START) {
    const [hour, minute] = getLeagueFixtureDeadlineTime(competitionName).split(":").map(Number);
    const graceWallClockGuess = new Date(Date.UTC(2026, 10, 1, hour, minute, 0));
    const graceDeadline = new Date(graceWallClockGuess.getTime() - londonOffsetMs(graceWallClockGuess));
    return standardFinalDeadline > graceDeadline ? standardFinalDeadline : graceDeadline;
  }

  return standardFinalDeadline;
}

/** The first-named player can lodge evidence from the Sunday before the final deadline. */
export function getLeagueFixtureClaimWindowOpens(scheduledFor: string | null | undefined, competitionName?: string | null) {
  const finalDeadline = getLeagueFixtureFinalDeadline(scheduledFor, competitionName);
  return finalDeadline ? new Date(finalDeadline.getTime() - 7 * 24 * 60 * 60 * 1000) : null;
}

/** A walkover remains provisional for 24 hours after the playing window closes. */
export function getLeagueFixtureWalkoverReviewUntil(scheduledFor: string | null | undefined, competitionName?: string | null) {
  const finalDeadline = getLeagueFixtureFinalDeadline(scheduledFor, competitionName);
  return finalDeadline ? new Date(finalDeadline.getTime() + 24 * 60 * 60 * 1000) : null;
}
