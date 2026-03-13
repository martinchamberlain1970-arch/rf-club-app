"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import MessageModal from "@/components/MessageModal";

function readNextPath(): string {
  if (typeof window === "undefined") return "/";
  const raw = new URLSearchParams(window.location.search).get("next");
  return raw || "/";
}

function readSignupState(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("signup");
}

export default function SignInPage() {
  const router = useRouter();
  const nextPath = useMemo(() => readNextPath(), []);
  const signupState = useMemo(() => readSignupState(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(() =>
    signupState === "created" ? "Account created. Check your email if verification is enabled, then sign in." : null
  );

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
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
          autoRequestAdmin?: boolean;
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
        const maybeEnsureAdminAccess = async (playerIdForAutoLink?: string) => {
          if (!parsed.autoRequestAdmin || !parsed.locationId) return;
          if (playerIdForAutoLink) {
            const { data: sessionRes } = await client.auth.getSession();
            const token = sessionRes.session?.access_token;
            if (token) {
              const resp = await fetch("/api/auth/bootstrap-first-admin", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ playerId: playerIdForAutoLink, locationId: parsed.locationId }),
              });
              if (resp.ok) {
                setMessage("No admin exists at this location. Your profile has been linked and you are now the location administrator.");
                return;
              }
            }
          }
          setMessage("No admin was found at this location. Please ask the Super User to approve administrator access.");
        };

        if (parsed.type === "existing" && parsed.playerId && parsed.fullName) {
          if (parsed.autoRequestAdmin && parsed.locationId) {
            await maybeEnsureAdminAccess(parsed.playerId);
          } else {
            await submitClaim(parsed.playerId, parsed.fullName);
            setMessage(getPostSignInMessage());
          }
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
              display_name: parsed.firstName,
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
            if (parsed.autoRequestAdmin && parsed.locationId) {
              await maybeEnsureAdminAccess(created.id);
            } else {
              await submitClaim(created.id, fullName);
              setMessage(getPostSignInMessage());
            }
          }
        }
      } catch {
        // ignore parse/side-effect errors here
      }
      window.localStorage.removeItem("pending_claim");
    }
    router.replace(nextPath);
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-3xl font-bold text-slate-900">Sign In</h1>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-1 text-sm font-semibold text-slate-900">Rack &amp; Frame Club</p>
          <p className="mb-3 text-sm text-slate-600">
            Sign in to run quick matches, local competitions, player approvals, and club results.
          </p>
          <form onSubmit={onSignIn} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              />
            </div>
            <button type="submit" disabled={busy} className="rounded-xl bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {busy ? "Please wait..." : "Sign In"}
            </button>
          </form>
          <MessageModal message={message} onClose={() => setMessage(null)} />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-700">
            Don&apos;t yet have an account?{" "}
            <Link href="/auth/sign-up" className="font-semibold text-teal-700 underline underline-offset-4">
              Click here
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
