import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AVATAR_SUFFIX, AVATAR_CACHE_SECONDS, optimiseAvatar } from "@/lib/optimise-avatar";
export const runtime = "nodejs";
export const maxDuration = 60;

async function authorise(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!url || !key || !token) throw new Error("Unauthorised");
  const admin = createClient(url, key);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorised");
  const user = await admin.from("app_users").select("role").eq("id", data.user.id).maybeSingle();
  const owner = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_OWNER_EMAIL)?.trim().toLowerCase();
  if (user.error || !((owner && data.user.email?.toLowerCase() === owner) || ["owner"].includes(user.data?.role ?? ""))) throw new Error("Unauthorised");
  return admin;
}
export async function GET(req: NextRequest) {
  let admin;
  try { admin = await authorise(req); } catch { return NextResponse.json({ error: "Owner access required." }, { status: 403 }); }
  const result = await admin.storage.from("avatars").list("avatars", { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  if (result.data.length >= 1000) return NextResponse.json({ error: "Inventory exceeds batch limit." }, { status: 409 });
  const rows = result.data.filter(row => row.id && !row.name.endsWith(AVATAR_SUFFIX)).map(row => {
    const path = `avatars/${row.name}`;
    const optimised = result.data.find(item => item.name === row.name + AVATAR_SUFFIX);
    return { path, originalBytes: row.metadata?.size ?? 0, optimisedBytes: optimised?.metadata?.size ?? null,
      originalUrl: admin.storage.from("avatars").getPublicUrl(path).data.publicUrl,
      optimisedUrl: optimised ? admin.storage.from("avatars").getPublicUrl(path + AVATAR_SUFFIX).data.publicUrl : null };
  });
  const players = await admin.from("players").select("id,avatar_url").not("avatar_url", "is", null);
  const pending = await admin.from("player_update_requests").select("id,requested_avatar_url").eq("status", "pending").not("requested_avatar_url", "is", null);
  if (players.error || pending.error) return NextResponse.json({ error: "Unable to verify photo references." }, { status: 500 });
  const references = [...players.data.map(row => row.avatar_url), ...pending.data.map(row => row.requested_avatar_url)];
  const originalUrls = new Set(rows.map(row => row.originalUrl));
  const optimisedUrls = new Set(rows.map(row => row.optimisedUrl).filter(Boolean));
  return NextResponse.json({ photos: rows, references: { original: references.filter(url => originalUrls.has(url)).length, optimised: references.filter(url => optimisedUrls.has(url)).length, other: references.filter(url => !originalUrls.has(url) && !optimisedUrls.has(url)).length } }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  let admin;
  try { admin = await authorise(req); } catch { return NextResponse.json({ error: "Owner access required." }, { status: 403 }); }
  const body = await req.json().catch(() => null);
  const path = body?.path;
  const action = body?.action;
  if (typeof path !== "string" || !/^avatars\/[a-zA-Z0-9_.-]+$/.test(path) || path.endsWith(AVATAR_SUFFIX) || !["prepare", "activate", "rollback"].includes(action)) return NextResponse.json({ error: "Invalid operation." }, { status: 400 });
  try {
    const bucket = admin.storage.from("avatars");
    const target = path + AVATAR_SUFFIX;
    if (action === "prepare") {
      const existing = await bucket.info(target);
      if (!existing.data) {
        const original = await bucket.download(path);
        if (original.error) throw original.error;
        const output = await optimiseAvatar(new Uint8Array(await original.data.arrayBuffer()));
        const upload = await bucket.upload(target, output, { contentType: "image/webp", cacheControl: AVATAR_CACHE_SECONDS, upsert: false });
        if (upload.error) throw upload.error;
      }
      return NextResponse.json({ ok: true });
    }
    // Check the destination exists before changing any references. Never delete either file.
    const destination = await bucket.info(action === "activate" ? target : path);
    if (destination.error || !destination.data) throw new Error("Destination photo is missing; prepare it first.");
    const originalUrl = bucket.getPublicUrl(path).data.publicUrl;
    const optimisedUrl = bucket.getPublicUrl(target).data.publicUrl;
    const from = action === "activate" ? originalUrl : optimisedUrl;
    const to = action === "activate" ? optimisedUrl : originalUrl;
    // Compare-and-swap prevents overwriting a newer photo uploaded during migration.
    const players = await admin.from("players").update({ avatar_url: to }).eq("avatar_url", from).select("id");
    if (players.error) throw players.error;
    const requests = await admin.from("player_update_requests").update({ requested_avatar_url: to }).eq("requested_avatar_url", from).eq("status", "pending").select("id");
    if (requests.error) throw requests.error;
    return NextResponse.json({ ok: true, players: players.data.length, requests: requests.data.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Photo operation failed; safe to retry." }, { status: 400 });
  }
}
