"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";
import rackAndFramePhoto from "@/photo/rackandframe.png";

type Location = { id: string; name: string };
type SignupDraft = {
  step?: 1 | 2;
  email?: string;
  password?: string;
  firstName?: string;
  secondName?: string;
  locationId?: string;
  requestedLocationName?: string;
  acceptPrivacy?: boolean;
  acceptTerms?: boolean;
};

type PendingClaimPayload =
  | {
      type: "existing";
      playerId: string;
      fullName: string;
      locationId?: string;
      requestedLocationName?: string | null;
      restoreArchived?: boolean;
    }
  | {
      type: "create";
      firstName: string;
      secondName: string;
      locationId?: string;
      requestedLocationName?: string | null;
      ageBand?: "under_13" | "13_15" | "16_17" | "18_plus";
      guardianConsent?: boolean;
      guardianName?: string;
      guardianEmail?: string;
      guardianUserId?: string;
    };

const SIGNUP_DRAFT_KEY = "signup_draft_v1";

function mapSignUpError(message: string, code?: string, status?: number) {
  const detail = [code, status ? String(status) : null].filter(Boolean).join(" · ");
  const lower = message.toLowerCase();
  if (lower.includes("unexpected failure")) {
    return `Sign up failed. Check Supabase Auth settings (Confirm email, Allow signups, CAPTCHA, SMTP).${detail ? ` (${detail})` : ""}`;
  }
  if (lower.includes("email rate limit")) {
    return `Too many signup emails were sent recently. Wait a few minutes and try again.${detail ? ` (${detail})` : ""}`;
  }
  return `Sign up failed: ${message}${detail ? ` (${detail})` : ""}`;
}

function readSignupDraft(): SignupDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SIGNUP_DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SignupDraft;
  } catch {
    window.sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
    return null;
  }
}

function AuthTopNav({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
      >
        Back
      </button>
      <Link href="/" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
        Home
      </Link>
    </div>
  );
}

export default function SignUpPage() {
  const router = useRouter();
  const [draft] = useState<SignupDraft | null>(() => readSignupDraft());
  const [step, setStep] = useState<1 | 2>(() => (draft?.step === 2 ? 2 : 1));
  const [email, setEmail] = useState(() => (typeof draft?.email === "string" ? draft.email : ""));
  const [password, setPassword] = useState(() => (typeof draft?.password === "string" ? draft.password : ""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(() => (typeof draft?.firstName === "string" ? draft.firstName : ""));
  const [secondName, setSecondName] = useState(() => (typeof draft?.secondName === "string" ? draft.secondName : ""));
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState(() => (typeof draft?.locationId === "string" ? draft.locationId : ""));
  const [requestedLocationName, setRequestedLocationName] = useState(() =>
    typeof draft?.requestedLocationName === "string" ? draft.requestedLocationName : ""
  );
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(() => draft?.acceptPrivacy === true);
  const [acceptTerms, setAcceptTerms] = useState(() => draft?.acceptTerms === true);
  const [infoModal, setInfoModal] = useState<{ title: string; body: string; closeLabel?: string; redirectTo?: string } | null>(null);
  const privacyPolicyUrl = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim() || "/privacy";
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL?.trim() || "/terms";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const fieldClass = "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200";
  const cardClass = "rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur";

  const getEmailRedirectUrl = () => {
    if (siteUrl) {
      return `${siteUrl.replace(/\/$/, "")}/auth/sign-in?signup=confirmed`;
    }
    if (typeof window !== "undefined") {
      return `${window.location.origin}/auth/sign-in?signup=confirmed`;
    }
    return undefined;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft = {
      step,
      email,
      password,
      firstName,
      secondName,
      locationId,
      requestedLocationName,
      acceptPrivacy,
      acceptTerms,
    };
    window.sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(draft));
  }, [step, email, password, firstName, secondName, locationId, requestedLocationName, acceptPrivacy, acceptTerms]);

  useEffect(() => {
    fetch("/api/public/locations")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.locations)) setLocations(data.locations as Location[]);
      })
      .catch(() => undefined);
  }, []);

  const submitLocationRequest = async ({ showSuccessModal = true }: { showSuccessModal?: boolean } = {}) => {
    const first = firstName.trim();
    const second = secondName.trim();
    const loc = requestedLocationName.trim();
    if (!first || !second) {
      setMessage("Enter first and second name before requesting a location.");
      return false;
    }
    if (!email.trim()) {
      setMessage("Enter your email before requesting a location.");
      return false;
    }
    if (!loc) {
      setMessage("Enter a location name to request.");
      return false;
    }
    setRequestingLocation(true);
    const resp = await fetch("/api/location-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requesterEmail: email.trim().toLowerCase(),
        requesterFullName: `${first} ${second}`.trim(),
        requestedLocationName: loc,
        requesterUserId: null,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    setRequestingLocation(false);
    if (!resp.ok) {
      setMessage(data?.error ?? "Failed to submit location request.");
      return false;
    }
    setRequestedLocationName("");
    if (showSuccessModal) {
      setInfoModal({
        title: "Location request submitted",
        body: "Your account can still be created now. The new location will be checked by the Super User and corrected if needed.",
      });
    }
    return true;
  };

  const validateStepOne = async () => {
    if (!email.trim()) {
      setMessage("Enter your email to create an account.");
      return false;
    }
    if (!password || password.length < 6) {
      setMessage("Choose a password with at least 6 characters.");
      return false;
    }
    const first = firstName.trim();
    const second = secondName.trim();
    if (!first || !second) {
      setMessage("Enter your first and second name so we can check for an existing profile before signup.");
      return false;
    }
    if (!locationId.trim() && !requestedLocationName.trim()) {
      setMessage("Select a location to continue, or enter a new one for review.");
      return false;
    }
    return true;
  };

  const onContinue = async () => {
    setMessage(null);
    const ok = await validateStepOne();
    if (!ok) return;
    setStep(2);
  };

  const onSignUp = async () => {
    setMessage(null);
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    setBusy(true);
    const okStepOne = await validateStepOne();
    if (!okStepOne) {
      setBusy(false);
      return;
    }
    if (!acceptPrivacy || !acceptTerms) {
      setBusy(false);
      setMessage("You must accept the Privacy Policy and Terms & Conditions before creating an account.");
      return;
    }

    const first = firstName.trim();
    const second = secondName.trim();
    const selectedLocation = locationId.trim();
    if (!first || !second) {
      setBusy(false);
      setMessage("Enter your first and second name so we can check for an existing profile before signup.");
      return;
    }
    if (!selectedLocation && !requestedLocationName.trim()) {
      setBusy(false);
      setMessage("Select a location to continue, or enter a new one for review.");
      return;
    }
    const pendingRequestedLocationName: string | null = requestedLocationName.trim() || null;
    if (!selectedLocation && pendingRequestedLocationName) {
      const requested = await submitLocationRequest({ showSuccessModal: false });
      if (!requested) {
        setBusy(false);
        return;
      }
    }
    const fullName = `${first} ${second}`.trim();
    const { data } = await client
      .from("players")
      .select("id,full_name,display_name,claimed_by,location_id,is_archived")
      .or(`full_name.ilike.%${first}%${second}%,full_name.ilike.%${second}%${first}%,display_name.ilike.${first}`)
      .limit(10);

    const unclaimed = (data ?? []).filter((p) => !p.claimed_by);
    const activeCandidate = unclaimed.find((p) => !p.is_archived);
    const archivedCandidate = unclaimed.find((p) => p.is_archived);
    const candidate = activeCandidate ?? archivedCandidate ?? null;

    let pendingClaimPayload: PendingClaimPayload | null = null;

    if (candidate && !candidate.claimed_by) {
      pendingClaimPayload = {
        type: "existing",
        playerId: candidate.id,
        fullName,
        locationId: !candidate.location_id && selectedLocation ? selectedLocation : undefined,
        requestedLocationName: pendingRequestedLocationName,
        restoreArchived: Boolean(candidate.is_archived),
      };
    } else if ((data ?? []).some((p) => p.claimed_by)) {
      setBusy(false);
      setMessage("An existing account/profile already appears to be linked for this name. Sign in with your existing account or contact support.");
      return;
    } else {
      pendingClaimPayload = {
        type: "create",
        firstName: first,
        secondName: second,
        locationId: selectedLocation,
        requestedLocationName: pendingRequestedLocationName,
      };
    }

    if (!pendingClaimPayload) {
      setBusy(false);
      setMessage("You must claim or create a profile before signing up.");
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem("pending_claim", JSON.stringify(pendingClaimPayload));
    }

    const acceptedAt = new Date().toISOString();
    const { data: signUpData, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getEmailRedirectUrl(),
        data: {
          privacy_policy_accepted: true,
          privacy_policy_version: "2026-03-03",
          terms_accepted: true,
          terms_version: "2026-03-03",
          legal_accepted_at: acceptedAt,
          requested_location_name: pendingRequestedLocationName,
          selected_location_id: selectedLocation || null,
        },
      },
    });
    setBusy(false);
    if (error) {
      const authError = error as Error & { code?: string; status?: number };
      setMessage(mapSignUpError(authError.message, authError.code, authError.status));
      return;
    }

    const createdUserId = signUpData.user?.id ?? null;
    if (createdUserId) {
      try {
        const finalizeResp = await fetch("/api/auth/finalize-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            createdUserId,
            email,
            payload: pendingClaimPayload,
          }),
        });
        const finalizeJson = await finalizeResp.json().catch(() => ({}));
        if (!finalizeResp.ok) {
          throw new Error(finalizeJson?.error ?? "Signup finalization failed.");
        }
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("pending_claim");
        }
      } catch {
        // Keep the local fallback so first sign-in can retry if immediate setup fails.
      }
    }

    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
    }
    await logAudit("auth_sign_up", { entityType: "auth", summary: "User account created." });
    setInfoModal({
      title: "Account created",
      body:
        pendingClaimPayload.type === "existing"
          ? pendingRequestedLocationName
            ? "Your account was created successfully. A matching player profile already exists, so a claim request was sent for Super User review. Your new location request is also pending review."
            : "Your account was created successfully. A matching player profile already exists, so a claim request was sent for Super User review."
          : pendingRequestedLocationName
            ? "Your account and player profile were created successfully. Check your email if verification is enabled, then sign in. Your new location request is pending Super User review."
            : "Your account and player profile were created successfully. If email verification is enabled, verify your email first and then sign in.",
      closeLabel: "Go to sign in",
      redirectTo: "/auth/sign-in?signup=created",
    });
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.16),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f4_48%,_#fff8ef_100%)] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <AuthTopNav onBack={() => router.back()} />
        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <section className={`${cardClass} overflow-hidden`}>
            <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-teal-700">
                  Rack &amp; Frame Club
                </div>
                <div className="space-y-3">
                  <h1 className="max-w-xl text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                    Join your club for quick matches, local competitions, and player results.
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                    Create your account to track your player profile, take part in club events, and keep up with scores, rankings, and notifications in one place.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Play Faster</p>
                    <p className="mt-1 text-sm text-slate-700">Jump into quick matches and scoring without messy setup.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stay Organised</p>
                    <p className="mt-1 text-sm text-slate-700">Keep player profiles, locations, results, and approvals in one club system.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Built For Clubs</p>
                    <p className="mt-1 text-sm text-slate-700">Designed for social clubs running local tournaments and weekly play.</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  We check whether your player profile already exists. If it does, the Super User can review and link it. If not, your profile is created as part of sign-up.
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-0 rounded-[30px] bg-gradient-to-br from-teal-200/40 via-transparent to-amber-200/50 blur-2xl" />
                <div className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_30px_70px_rgba(15,23,42,0.18)]">
                  <Image
                    src={rackAndFramePhoto}
                    alt="Rack and Frame club"
                    className="h-[280px] w-full object-cover object-center sm:h-[360px]"
                    priority
                  />
                  <div className="border-t border-slate-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">What happens next?</p>
                    <ol className="mt-2 space-y-2 text-sm text-slate-600">
                      <li>1. Enter your details and choose your club location.</li>
                      <li>2. We check for an existing player profile match.</li>
                      <li>3. You verify your email and sign in to start using the club app.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={`${cardClass} space-y-4`}>
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Create account</p>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Set up your player login</h2>
              <p className="text-sm leading-6 text-slate-600">
                {step === 1
                  ? "Tell us who you are, where you play, and we’ll get your account ready."
                  : "Review your details, accept the club terms, and finish creating your account."}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className={`rounded-2xl border px-3 py-2 text-sm ${step === 1 ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                <span className="font-semibold">1.</span> Your details
              </div>
              <div className={`rounded-2xl border px-3 py-2 text-sm ${step === 2 ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                <span className="font-semibold">2.</span> Club terms
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span className="font-semibold">3.</span> Email confirm
              </div>
            </div>

            {step === 1 ? (
              <>
                <div className="grid gap-3">
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
                      placeholder="Choose a secure password"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">First name</label>
                      <input className={fieldClass} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Second name</label>
                      <input className={fieldClass} placeholder="Second name" value={secondName} onChange={(e) => setSecondName(e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Club location</label>
                  <select
                    className={fieldClass}
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="">Select location (required)</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-3 text-xs leading-5 text-slate-600">
                    Can’t see your club yet? Add it below. Your account can still be created and the Super User can tidy the location name afterwards.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      className={`${fieldClass} min-w-0 flex-1`}
                      placeholder="Enter new club or venue name"
                      value={requestedLocationName}
                      onChange={(e) => setRequestedLocationName(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => void submitLocationRequest()}
                      disabled={requestingLocation}
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm disabled:opacity-60"
                    >
                      {requestingLocation ? "Submitting..." : "Add new location"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Review your details</p>
                  <div className="mt-2 space-y-1">
                    <p>{email.trim()}</p>
                    <p>{firstName.trim()} {secondName.trim()}</p>
                    <p>{locations.find((l) => l.id === locationId)?.name ?? (requestedLocationName.trim() || "Location not selected")}</p>
                  </div>
                </div>
                <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-700">
                  Under-18 players do not create login accounts directly. A parent, guardian, or club admin should create and manage under-18 player profiles instead.
                </p>
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={acceptPrivacy}
                      onChange={(e) => setAcceptPrivacy(e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      I have read and accept the{" "}
                      <a href={privacyPolicyUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-700 underline">
                        Privacy Policy
                      </a>
                      .
                    </span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={acceptTerms}
                      onChange={(e) => setAcceptTerms(e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      I have read and accept the{" "}
                      <a href={termsUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-700 underline">
                        Terms &amp; Conditions
                      </a>
                      .
                    </span>
                  </label>
                </div>
              </>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              {step === 1 ? (
                <button type="button" onClick={() => void onContinue()} className="rounded-2xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800">
                  Continue
                </button>
              ) : (
                <>
                  <button type="button" onClick={onSignUp} disabled={busy} className="rounded-2xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60">
                    {busy ? "Please wait..." : "Create account"}
                  </button>
                  <button type="button" onClick={() => setStep(1)} disabled={busy} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
                    Back
                  </button>
                </>
              )}
              <Link href="/auth/sign-in" className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-medium text-slate-700 shadow-sm">
                Already registered? Sign in
              </Link>
            </div>
            <MessageModal message={message} onClose={() => setMessage(null)} />
          </section>
        </div>
      </div>
      <InfoModal
        open={Boolean(infoModal)}
        title={infoModal?.title ?? ""}
        description={infoModal?.body ?? ""}
        closeLabel={infoModal?.closeLabel ?? "OK"}
        onClose={() => {
          const redirectTo = infoModal?.redirectTo;
          setInfoModal(null);
          if (redirectTo) router.push(redirectTo);
        }}
      />
    </main>
  );
}
