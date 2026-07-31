import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type RouteContext = { params: Promise<{ id: string }> };

function serverClient() {
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const client = serverClient();
  if (!client) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });

  const { id } = await context.params;
  const result = await client
    .from("competitions")
    .select("id,name,venue,sport_type,competition_format,match_mode,signup_open,signup_deadline,max_entries,is_archived,is_completed")
    .eq("id", id)
    .maybeSingle();

  if (result.error || !result.data || result.data.is_archived) {
    return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  }

  const [registered, guests] = await Promise.all([
    client
      .from("competition_entries")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", id)
      .in("status", ["pending", "approved"]),
    client
      .from("public_competition_signups")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", id)
      .eq("status", "pending"),
  ]);

  const competition = result.data;
  const entryCount = (registered.count ?? 0) + (guests.count ?? 0);
  const deadlinePassed = Boolean(
    competition.signup_deadline && new Date(competition.signup_deadline).getTime() < Date.now()
  );
  const full = Boolean(competition.max_entries && entryCount >= competition.max_entries);

  return NextResponse.json({
    competition: {
      id: competition.id,
      name: competition.name,
      venue: competition.venue,
      sportType: competition.sport_type,
      competitionFormat: competition.competition_format,
      matchMode: competition.match_mode,
      signupDeadline: competition.signup_deadline,
      maxEntries: competition.max_entries,
      entryCount,
      acceptingSignups: competition.signup_open && !competition.is_completed && !deadlinePassed && !full,
      closedReason: !competition.signup_open
        ? "Sign-ups are closed."
        : competition.is_completed
          ? "This competition has finished."
          : deadlinePassed
            ? "The sign-up deadline has passed."
            : full
              ? "This competition is currently full."
              : null,
    },
  });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const client = serverClient();
  if (!client) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const fullName = String(body?.fullName ?? "").trim().replace(/\s+/g, " ");
  const email = String(body?.email ?? "").trim().toLowerCase();
  const phone = String(body?.phone ?? "").trim().replace(/[^\d+()\s-]/g, "");
  const note = String(body?.note ?? "").trim();
  const website = String(body?.website ?? "").trim();

  // Honeypot: return success so automated submissions do not learn how to bypass it.
  if (website) return NextResponse.json({ ok: true });

  if (fullName.length < 2 || fullName.length > 100) {
    return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  }
  if (!email && !phone) {
    return NextResponse.json({ error: "Enter an email address or phone number." }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (phone && phone.replace(/\D/g, "").length < 7) {
    return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
  }
  if (note.length > 500) {
    return NextResponse.json({ error: "The note must be 500 characters or fewer." }, { status: 400 });
  }

  const competitionResult = await client
    .from("competitions")
    .select("id,signup_open,signup_deadline,max_entries,is_archived,is_completed")
    .eq("id", id)
    .maybeSingle();
  const competition = competitionResult.data;
  if (competitionResult.error || !competition || competition.is_archived) {
    return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  }
  if (!competition.signup_open || competition.is_completed) {
    return NextResponse.json({ error: "Sign-ups are closed for this competition." }, { status: 409 });
  }
  if (competition.signup_deadline && new Date(competition.signup_deadline).getTime() < Date.now()) {
    return NextResponse.json({ error: "The sign-up deadline has passed." }, { status: 409 });
  }

  const [registered, guests] = await Promise.all([
    client.from("competition_entries").select("id", { count: "exact", head: true }).eq("competition_id", id).in("status", ["pending", "approved"]),
    client.from("public_competition_signups").select("id", { count: "exact", head: true }).eq("competition_id", id).eq("status", "pending"),
  ]);
  if (competition.max_entries && (registered.count ?? 0) + (guests.count ?? 0) >= competition.max_entries) {
    return NextResponse.json({ error: "This competition is currently full." }, { status: 409 });
  }

  const insert = await client.from("public_competition_signups").insert({
    competition_id: id,
    full_name: fullName,
    email: email || null,
    phone: phone || null,
    note: note || null,
  });
  if (insert.error) {
    if (insert.error.code === "23505") {
      return NextResponse.json({ error: "That email address or phone number is already signed up." }, { status: 409 });
    }
    return NextResponse.json({ error: "We could not save your entry. Please try again." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
