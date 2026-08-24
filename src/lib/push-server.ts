import type { SupabaseClient } from "@supabase/supabase-js";
import webPush from "web-push";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export function pushIsConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function configurePush() {
  if (!pushIsConfigured()) throw new Error("Web Push is not configured.");
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT as string,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
}

export async function sendPushToUserIds(client: SupabaseClient, userIds: string[], payload: PushPayload) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!pushIsConfigured() || !uniqueUserIds.length) return { sent: 0, failed: 0, configured: pushIsConfigured() };
  configurePush();
  const subscriptionsResult = await client
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .in("user_id", uniqueUserIds)
    .eq("is_active", true);
  if (subscriptionsResult.error) return { sent: 0, failed: 0, configured: true, error: subscriptionsResult.error.message };
  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptionsResult.data ?? []) {
    try {
      await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) await client.from("push_subscriptions").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", subscription.id);
    }
  }
  return { sent, failed, configured: true };
}
