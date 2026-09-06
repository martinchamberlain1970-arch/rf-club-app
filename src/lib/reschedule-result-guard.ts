import type { SupabaseClient } from "@supabase/supabase-js";

export const RESULT_SUBMITTED_RESCHEDULE_NOTE = "[Closed automatically: result submitted before reschedule review.]";

export function resultSubmittedRescheduleNote(existingNote: string | null | undefined) {
  const note = existingNote?.trim() ?? "";
  if (note.includes(RESULT_SUBMITTED_RESCHEDULE_NOTE)) return note;
  return [note, RESULT_SUBMITTED_RESCHEDULE_NOTE].filter(Boolean).join("\n\n");
}

export async function closePendingRescheduleAfterResult(
  client: SupabaseClient,
  matchId: string,
  reviewedByUserId: string | null
) {
  const pending = await client
    .from("league_reschedule_requests")
    .select("id,note")
    .eq("match_id", matchId)
    .eq("status", "pending");
  if (pending.error) return { closed: 0, error: pending.error.message };
  if (!pending.data?.length) return { closed: 0, error: null };

  const reviewedAt = new Date().toISOString();
  for (const request of pending.data) {
    const update = await client
      .from("league_reschedule_requests")
      .update({
        status: "rejected",
        reviewed_by_user_id: reviewedByUserId,
        reviewed_at: reviewedAt,
        note: resultSubmittedRescheduleNote(request.note),
      })
      .eq("id", request.id)
      .eq("status", "pending");
    if (update.error) return { closed: 0, error: update.error.message };
  }
  return { closed: pending.data.length, error: null };
}
