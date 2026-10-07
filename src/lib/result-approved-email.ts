import type { SupabaseClient } from "@supabase/supabase-js";
import { getWelcomeCandidate } from "@/lib/competition-welcome";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";

type ResultActor = { user: { id: string | null; email?: string | null }; role: string };
type Standing = { playerId: string; name: string; played: number; won: number; lost: number; points: number; pointsFor: number; pointsAgainst: number; position?: number };

const systemFromAddress = () => process.env.SYSTEM_EMAIL_FROM_ADDRESS?.trim() || "information@rackandframe.app";

function ordinal(value: number) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

export async function sendApprovedResultEmails(client: SupabaseClient, matchId: string, actor: ResultActor) {
  const matchResult = await client.from("matches")
    .select("id,competition_id,status,match_mode,player1_id,player2_id,winner_player_id")
    .eq("id", matchId).maybeSingle();
  const match = matchResult.data;
  if (matchResult.error) throw new Error(matchResult.error.message);
  if (!match || match.status !== "complete" || match.match_mode !== "singles" || !match.player1_id || !match.player2_id || !match.winner_player_id || match.player1_id === match.player2_id) {
    return [];
  }

  const competitionResult = await client.from("competitions")
    .select("id,name,sport_type,competition_format,league_schedule_mode,league_meetings,league_finals_size")
    .eq("id", match.competition_id).maybeSingle();
  const competition = competitionResult.data;
  if (competitionResult.error || !competition) throw new Error(competitionResult.error?.message || "Competition not found.");
  if (competition.competition_format !== "league") return [];

  const [entriesResult, matchesResult] = await Promise.all([
    client.from("competition_entries").select("id,player_id").eq("competition_id", competition.id).eq("status", "approved"),
    client.from("matches").select("id,round_no,status,player1_id,player2_id,winner_player_id").eq("competition_id", competition.id).eq("is_archived", false),
  ]);
  if (entriesResult.error || matchesResult.error) throw new Error(entriesResult.error?.message || matchesResult.error?.message || "League table could not be calculated.");
  const entries = entriesResult.data ?? [];
  const playerIds = [...new Set(entries.map((entry) => entry.player_id).filter(Boolean) as string[])];
  const matchIds = (matchesResult.data ?? []).map((row) => row.id);
  const [playersResult, framesResult] = await Promise.all([
    client.from("players").select("id,display_name,full_name").in("id", playerIds),
    matchIds.length ? client.from("frames").select("match_id,winner_player_id,team1_points,team2_points").in("match_id", matchIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (playersResult.error || framesResult.error) throw new Error(playersResult.error?.message || framesResult.error?.message || "Result details could not be loaded.");
  const names = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const framesByMatch = new Map<string, Array<{ winner_player_id: string | null; team1_points: number | null; team2_points: number | null }>>();
  for (const frame of framesResult.data ?? []) framesByMatch.set(frame.match_id, [...(framesByMatch.get(frame.match_id) ?? []), frame]);

  const standings = new Map<string, Standing>();
  for (const playerId of playerIds) standings.set(playerId, { playerId, name: names.get(playerId) || "Player", played: 0, won: 0, lost: 0, points: 0, pointsFor: 0, pointsAgainst: 0 });
  const entrantCount = playerIds.length;
  const meetings = Math.max(1, Number(competition.league_meetings ?? 1));
  const leagueRoundCount = (entrantCount % 2 === 0 ? Math.max(1, entrantCount - 1) : entrantCount) * meetings;
  const leagueMatches = (matchesResult.data ?? []).filter((row) => competition.league_schedule_mode !== "one_day" || (row.round_no ?? 1) <= leagueRoundCount);
  for (const row of leagueMatches) {
    if (row.status !== "complete" || !row.player1_id || !row.player2_id || row.player1_id === row.player2_id) continue;
    const one = standings.get(row.player1_id); const two = standings.get(row.player2_id);
    if (!one || !two) continue;
    one.played += 1; two.played += 1;
    const frames = framesByMatch.get(row.id) ?? [];
    let scoreOne = frames.filter((frame) => frame.winner_player_id === row.player1_id).length;
    let scoreTwo = frames.filter((frame) => frame.winner_player_id === row.player2_id).length;
    if (!frames.length && row.winner_player_id) { scoreOne = row.winner_player_id === row.player1_id ? 1 : 0; scoreTwo = row.winner_player_id === row.player2_id ? 1 : 0; }
    one.points += scoreOne; two.points += scoreTwo;
    const forOne = competition.sport_type === "snooker" ? frames.reduce((total, frame) => total + Number(frame.team1_points ?? 0), 0) : scoreOne;
    const forTwo = competition.sport_type === "snooker" ? frames.reduce((total, frame) => total + Number(frame.team2_points ?? 0), 0) : scoreTwo;
    one.pointsFor += forOne; one.pointsAgainst += forTwo; two.pointsFor += forTwo; two.pointsAgainst += forOne;
    if (row.winner_player_id === row.player1_id) { one.won += 1; two.lost += 1; }
    else if (row.winner_player_id === row.player2_id) { two.won += 1; one.lost += 1; }
  }
  const table = [...standings.values()].sort((a, b) => b.points - a.points || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || b.pointsFor - a.pointsFor || b.won - a.won || a.lost - b.lost || a.name.localeCompare(b.name));
  table.forEach((row, index) => { row.position = index + 1; });

  const currentFrames = framesByMatch.get(match.id) ?? [];
  const rackScoreOne = currentFrames.filter((frame) => frame.winner_player_id === match.player1_id).length;
  const rackScoreTwo = currentFrames.filter((frame) => frame.winner_player_id === match.player2_id).length;
  const displayScoreOne = competition.sport_type === "snooker" ? currentFrames.reduce((sum, frame) => sum + Number(frame.team1_points ?? 0), 0) : rackScoreOne;
  const displayScoreTwo = competition.sport_type === "snooker" ? currentFrames.reduce((sum, frame) => sum + Number(frame.team2_points ?? 0), 0) : rackScoreTwo;
  const playerNames = { [match.player1_id]: names.get(match.player1_id) || "Player 1", [match.player2_id]: names.get(match.player2_id) || "Player 2" };
  const entryByPlayer = new Map(entries.map((entry) => [entry.player_id as string, entry.id as string]));
  const previous = await client.from("audit_logs").select("meta").eq("action", "result_approved_email_sent").eq("entity_id", match.id);
  const sentPlayers = new Set((previous.data ?? []).map((row) => String((row.meta as { player_id?: string } | null)?.player_id ?? "")).filter(Boolean));
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
  const leagueUrl = `${siteUrl}/league/${competition.id}`;
  const results = [] as Array<{ playerId: string; status: string; email: string | null }>;

  for (const playerId of [match.player1_id, match.player2_id]) {
    if (sentPlayers.has(playerId)) { results.push({ playerId, status: "duplicate", email: null }); continue; }
    const entryId = entryByPlayer.get(playerId);
    const candidate = entryId ? await getWelcomeCandidate(client, entryId) : null;
    const email = candidate?.email?.trim().toLowerCase() || null;
    const playerName = playerNames[playerId];
    if (!email) { results.push({ playerId, status: "no_email", email: null }); continue; }
    if (!hasMailerConfig()) { results.push({ playerId, status: "not_configured", email }); continue; }
    const won = match.winner_player_id === playerId;
    const standing = standings.get(playerId);
    const pointsEarned = playerId === match.player1_id ? rackScoreOne : rackScoreTwo;
    const firstName = playerName.split(/\s+/)[0] || "Player";
    const opponentName = playerId === match.player1_id ? playerNames[match.player2_id] : playerNames[match.player1_id];
    const positionLine = standing?.position ? `${ordinal(standing.position)} of ${table.length}` : "League position unavailable";
    const cupSize = Number(competition.league_finals_size ?? 0);
    const cupLine = standing?.position && cupSize > 0 && standing.position <= cupSize ? ` You are currently in a top-${cupSize} cup place.` : "";
    const intro = won ? `Congratulations ${firstName} — your result against ${opponentName} has been approved.` : `Commiserations ${firstName} — your result against ${opponentName} has been approved.`;
    const subject = `${won ? "Congratulations" : "Result confirmed"}: ${playerNames[match.player1_id]} ${displayScoreOne}–${displayScoreTwo} ${playerNames[match.player2_id]}`;
    const text = `${intro}\n\nCompetition: ${competition.name}\nApproved result: ${playerNames[match.player1_id]} ${displayScoreOne}–${displayScoreTwo} ${playerNames[match.player2_id]}\nLeague points earned: ${pointsEarned}\nCurrent league position: ${positionLine}\nPlayed: ${standing?.played ?? 0} | Won: ${standing?.won ?? 0} | Lost: ${standing?.lost ?? 0} | League points: ${standing?.points ?? 0}${cupLine}\n\nView the league table: ${leagueUrl}\n\nThis is an automated message; replies are not monitored.\n\nRack & Frame Club`;
    const html = brandedEmail({
      eyebrow: won ? "Result approved · Congratulations" : "Result approved",
      title: won ? `Well played, ${firstName}` : `Commiserations, ${firstName}`,
      intro,
      bodyHtml: `<div style="padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center"><div style="font-size:14px;color:#64748b">Approved result</div><div style="margin-top:6px;font-size:22px;font-weight:800;color:#0f172a">${escapeEmailHtml(playerNames[match.player1_id])} ${displayScoreOne}–${displayScoreTwo} ${escapeEmailHtml(playerNames[match.player2_id])}</div></div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">League points earned</td><td style="padding:8px 0;text-align:right;font-weight:700">${pointsEarned}</td></tr><tr><td style="padding:8px 0;color:#64748b">Current position</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeEmailHtml(positionLine)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Season record</td><td style="padding:8px 0;text-align:right;font-weight:700">P ${standing?.played ?? 0} · W ${standing?.won ?? 0} · L ${standing?.lost ?? 0} · Pts ${standing?.points ?? 0}</td></tr></table>${cupLine ? `<p style="margin:16px 0 0;font-weight:700;color:#047857">${escapeEmailHtml(cupLine.trim())}</p>` : ""}`,
      primaryButton: { label: "View league table", url: leagueUrl },
      footerNote: "This result notification is sent automatically from Rack & Frame Information. Replies are not monitored.",
    });
    try {
      const sent = await sendEmail({ to: email, subject, text, html, fromAddress: systemFromAddress(), fromName: "Rack & Frame Information", replyTo: null });
      await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "result_approved_email_sent", entity_type: "match", entity_id: match.id, summary: `${won ? "Winner" : "Opponent"} result email sent to ${playerName}.`, meta: { recipient: email, player_id: playerId, won, position: standing?.position ?? null, message_id: sent.messageId, provider: sent.provider, sender: systemFromAddress() } });
      results.push({ playerId, status: "sent", email });
    } catch (error) {
      await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "result_approved_email_failed", entity_type: "match", entity_id: match.id, summary: `Result email to ${playerName} failed.`, meta: { recipient: email, player_id: playerId, won, error: error instanceof Error ? error.message : "Email failed.", sender: systemFromAddress() } });
      results.push({ playerId, status: "failed", email });
    }
  }
  return results;
}
