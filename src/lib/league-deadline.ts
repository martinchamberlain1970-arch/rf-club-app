import { isLegionMastersLeague } from "@/lib/legion-masters";

const LONDON_TIME_ZONE = "Europe/London";

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
