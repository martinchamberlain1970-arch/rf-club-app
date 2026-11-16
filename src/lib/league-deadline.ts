import { isLegionMastersLeague } from "@/lib/legion-masters";

const LONDON_TIME_ZONE = "Europe/London";
const TRANSITION_GRACE_WEEK_END = "2026-11-22";

type ApprovedRescheduleAnchor = {
  match_id: string;
  original_scheduled_for: string | null;
  created_at?: string | null;
};

/** Keep deadlines tied to the first approved reschedule's original fixture week. */
export function buildLeagueFixtureAnchorMap(rows: ApprovedRescheduleAnchor[]) {
  const anchors = new Map<string, { date: string; createdAt: string }>();
  for (const row of rows) {
    if (!row.match_id || !row.original_scheduled_for) continue;
    const createdAt = row.created_at ?? "";
    const current = anchors.get(row.match_id);
    if (!current || createdAt < current.createdAt) {
      anchors.set(row.match_id, { date: row.original_scheduled_for, createdAt });
    }
  }
  return new Map([...anchors].map(([matchId, value]) => [matchId, value.date]));
}

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

function getTransitionGraceDeadline(competitionName?: string | null) {
  const [year, month, day] = TRANSITION_GRACE_WEEK_END.split("-").map(Number);
  const [hour, minute] = getLeagueFixtureDeadlineTime(competitionName).split(":").map(Number);
  const wallClockGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return new Date(wallClockGuess.getTime() - londonOffsetMs(wallClockGuess));
}

export function hasLeagueFixtureTransitionGrace(scheduledFor: string | null | undefined, competitionName?: string | null) {
  if (!isLegionMastersLeague(competitionName)) return false;
  const originalDeadline = getLeagueFixtureDeadline(scheduledFor, competitionName);
  if (!originalDeadline) return false;
  const standardFinalDeadline = new Date(originalDeadline.getTime() + 14 * 24 * 60 * 60 * 1000);
  return standardFinalDeadline < getTransitionGraceDeadline(competitionName);
}

/** The normal four-week playing window closes two Sundays after the fixture's due week. */
export function getLeagueFixtureFinalDeadline(scheduledFor: string | null | undefined, competitionName?: string | null) {
  const originalDeadline = getLeagueFixtureDeadline(scheduledFor, competitionName);
  if (!originalDeadline) return null;
  const standardFinalDeadline = new Date(originalDeadline.getTime() + 14 * 24 * 60 * 60 * 1000);

  // The five fixtures still overdue when the original-date rule was restored
  // receive one final week from 16 November. Normal enforcement resumes on
  // Monday 23 November 2026; fixtures naturally due on 22 November are not extended.
  if (!isLegionMastersLeague(competitionName)) return standardFinalDeadline;
  const graceDeadline = getTransitionGraceDeadline(competitionName);
  return standardFinalDeadline > graceDeadline ? standardFinalDeadline : graceDeadline;
}

/** Legacy claim-window helper retained for existing recorded deadline cases. */
export function getLeagueFixtureClaimWindowOpens(scheduledFor: string | null | undefined, competitionName?: string | null) {
  const finalDeadline = getLeagueFixtureFinalDeadline(scheduledFor, competitionName);
  return finalDeadline ? new Date(finalDeadline.getTime() - 7 * 24 * 60 * 60 * 1000) : null;
}

/** Legacy-named helper: unresolved fixtures become void as soon as the final playing deadline passes. */
export function getLeagueFixtureWalkoverReviewUntil(scheduledFor: string | null | undefined, competitionName?: string | null) {
  return getLeagueFixtureFinalDeadline(scheduledFor, competitionName);
}
