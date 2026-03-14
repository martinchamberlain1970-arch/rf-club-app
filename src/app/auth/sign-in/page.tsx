"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import MessageModal from "@/components/MessageModal";
import rackAndFramePhoto from "@/photo/rackandframe.png";

function readNextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  const params = new URLSearchParams(window.location.search);
  if (params.get("signed_out") === "1") return "/dashboard";
  const raw = params.get("next");
  return raw || "/dashboard";
}

function readSignupState(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("signup");
}

function readSignedOutState(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("signed_out") === "1";
}

export default function SignInPage() {
  const router = useRouter();
  const nextPath = useMemo(() => readNextPath(), []);
  const signupState = useMemo(() => readSignupState(), []);
  const signedOutState = useMemo(() => readSignedOutState(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(() =>
    signedOutState
      ? "You have been signed out."
      : signupState === "created"
      ? "Account created. Check your email if verification is enabled, then sign in."
      : signupState === "confirmed"
        ? "Email confirmed. You can sign in now."
        : null
  );
  const fieldClass = "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200";
  const cardClass = "rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur";

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("rf_signing_out");
    }
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    setBusy(true);
    const { error } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setMessage(`Sign in failed: ${error.message}`);
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("rf_signing_out");
    }
    const authUserRes = await client.auth.getUser();
    const signedInUserId = authUserRes.data.user?.id ?? null;
    if (signedInUserId) {
      const { data: appUser } = await client.from("app_users").select("linked_player_id").eq("id", signedInUserId).maybeSingle();
      const linkedPlayerId = appUser?.linked_player_id ?? null;
      if (linkedPlayerId) {
        const { data: linkedPlayer } = await client.from("players").select("age_band").eq("id", linkedPlayerId).maybeSingle();
        const isUnder18 = Boolean(linkedPlayer?.age_band && linkedPlayer.age_band !== "18_plus");
        if (isUnder18) {
          await client.auth.signOut();
          setMessage("Direct login is available for 18+ accounts only. Under-18 profiles must be managed by a parent/guardian or administrator.");
          return;
        }
      }
    }
    await logAudit("auth_sign_in", { entityType: "auth", summary: "User signed in." });
    const pending = typeof window !== "undefined" ? window.localStorage.getItem("pending_claim") : null;
    if (pending) {
      try {
        const parsed = JSON.parse(pending) as {
          type: "existing" | "create";
          playerId?: string;
          fullName?: string;
          restoreArchived?: boolean;
          firstName?: string;
          secondName?: string;
          locationId?: string;
          requestedLocationName?: string;
          ageBand?: "under_13" | "13_15" | "16_17" | "18_plus";
          guardianConsent?: boolean;
          guardianName?: string;
          guardianEmail?: string;
          guardianUserId?: string;
        };
        const { data } = await client.auth.getUser();
        const userId = data.user?.id;
        if (!userId) {
          window.localStorage.removeItem("pending_claim");
          if (typeof window !== "undefined") {
            window.location.replace(nextPath);
            return;
          }
          router.replace(nextPath);
          return;
        }
        const submitClaim = async (playerId: string, fullName: string) => {
          await client.from("player_claim_requests").insert({
            player_id: playerId,
            requester_user_id: userId,
            requested_full_name: fullName,
            status: "pending",
          });
        };
        const getPostSignInMessage = () =>
          parsed.requestedLocationName
            ? `Your account is active. Your requested location "${parsed.requestedLocationName}" is waiting for Super User review.`
            : "Your profile-link request has been submitted for administrator approval.";

        if (parsed.type === "existing" && parsed.playerId && parsed.fullName) {
          await submitClaim(parsed.playerId, parsed.fullName);
          setMessage(getPostSignInMessage());
          if (parsed.locationId) {
            await client.from("player_update_requests").insert({
              player_id: parsed.playerId,
              requester_user_id: userId,
              requested_full_name: null,
              requested_location_id: parsed.locationId,
              requested_age_band: parsed.ageBand ?? null,
              requested_guardian_consent: parsed.guardianConsent ?? null,
              requested_guardian_name: parsed.guardianName ?? null,
              requested_guardian_email: parsed.guardianEmail ?? null,
              requested_guardian_user_id: parsed.guardianUserId ?? null,
              status: "pending",
            });
          }
        }
        if (parsed.type === "create" && parsed.firstName) {
          const effectiveAgeBand = parsed.ageBand ?? "18_plus";
          const fullName = effectiveAgeBand === "18_plus" ? `${parsed.firstName} ${parsed.secondName ?? ""}`.trim() : parsed.firstName;
          const { data: created } = await client
            .from("players")
            .insert({
              display_name: fullName,
              first_name: parsed.firstName,
              nickname: null,
              full_name: fullName,
              is_archived: false,
              claimed_by: null,
              location_id: effectiveAgeBand === "18_plus" ? parsed.locationId ?? null : null,
              age_band: effectiveAgeBand,
              guardian_consent: effectiveAgeBand === "18_plus" ? false : Boolean(parsed.guardianConsent),
              guardian_consent_at: effectiveAgeBand === "18_plus" ? null : Boolean(parsed.guardianConsent) ? new Date().toISOString() : null,
              guardian_name: parsed.guardianName ?? null,
              guardian_email: parsed.guardianEmail ?? null,
              guardian_user_id: parsed.guardianUserId ?? null,
            })
            .select("id")
            .single();
          if (created?.id) {
            await submitClaim(created.id, fullName);
            setMessage(getPostSignInMessage());
          }
        }
      } catch {
        // ignore parse/side-effect errors here
      }
      window.localStorage.removeItem("pending_claim");
    }
    if (typeof window !== "undefined") {
      window.location.replace(nextPath);
      return;
    }
    router.replace(nextPath);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.16),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f4_48%,_#fff8ef_100%)] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr] lg:items-start">
          <section className={`${cardClass} overflow-hidden`}>
            <div className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
              <div className="space-y-4">
                <div className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-teal-700">
                  Rack &amp; Frame Club
                </div>
                <div className="space-y-3">
                  <h1 className="max-w-lg text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                    Get straight back to your club game night.
                  </h1>
                  <p className="max-w-md text-base leading-7 text-slate-600 sm:text-lg">
                    Rack &amp; Frame keeps your quick matches, local tournaments, player updates, results, and rankings together in one place.
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  This app is built for social clubs running local cue-sports play, from quick practice matches to full club competitions.
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-0 rounded-[30px] bg-gradient-to-br from-teal-200/40 via-transparent to-amber-200/50 blur-2xl" />
                <div className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_30px_70px_rgba(15,23,42,0.18)]">
                  <Image
                    src={rackAndFramePhoto}
                    alt="Rack and Frame club"
                    className="h-[360px] w-full object-contain bg-slate-100 object-center sm:h-[520px]"
                    priority
                  />
                  <div className="border-t border-slate-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">Ready to continue?</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Sign in to open your player dashboard, check notifications, submit results, and jump back into club play.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={`${cardClass} space-y-4 lg:max-w-md lg:justify-self-end`}>
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sign in</p>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Welcome back</h2>
              <p className="text-sm leading-6 text-slate-600">
                Sign in to manage your matches, check player updates, and keep your club activity moving.
              </p>
            </div>

            <form onSubmit={onSignIn} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass}
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={fieldClass}
                  placeholder="Enter your password"
                />
              </div>
              <button type="submit" disabled={busy} className="rounded-2xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60">
                {busy ? "Please wait..." : "Sign in"}
              </button>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Don&apos;t have an account yet?{" "}
              <Link href="/auth/sign-up" className="font-semibold text-teal-700 underline underline-offset-4">
                Create one here
              </Link>
              .
            </div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              Designed and developed by Martin Chamberlain
            </p>
            <MessageModal message={message} onClose={() => setMessage(null)} />
          </section>
        </div>
      </div>
    </main>
  );
}
