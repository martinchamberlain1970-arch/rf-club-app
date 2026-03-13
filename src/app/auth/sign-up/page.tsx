"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import ConfirmModal from "@/components/ConfirmModal";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";

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
      autoRequestAdmin?: boolean;
      restoreArchived?: boolean;
    }
  | {
      type: "create";
      firstName: string;
      secondName: string;
      locationId?: string;
      requestedLocationName?: string | null;
      autoRequestAdmin?: boolean;
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
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    resolve?: (value: boolean) => void;
  }>({ open: false, title: "", description: "" });
  const privacyPolicyUrl = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim() || "/privacy";
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL?.trim() || "/terms";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

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

  const askConfirm = (title: string, description: string, confirmLabel = "Yes", cancelLabel = "No") =>
    new Promise<boolean>((resolve) => {
      setConfirmState({ open: true, title, description, confirmLabel, cancelLabel, resolve });
    });

  const closeConfirm = (result: boolean) => {
    const resolver = confirmState.resolve;
    setConfirmState({ open: false, title: "", description: "" });
    resolver?.(result);
  };

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

  const isFirstUserAtLocation = async (locationId: string) => {
    const client = supabase;
    if (!client) return false;
    const { data: locationPlayers, error: locationPlayersError } = await client
      .from("players")
      .select("id")
      .eq("location_id", locationId)
      .eq("is_archived", false);
    if (locationPlayersError) return false;
    const ids = (locationPlayers ?? []).map((p) => p.id);
    if (!ids.length) return true;
    const { data: linkedAdmins, error: linkedAdminsError } = await client
      .from("app_users")
      .select("id")
      .in("linked_player_id", ids)
      .in("role", ["admin", "owner"])
      .limit(1);
    if (linkedAdminsError) return false;
    return (linkedAdmins ?? []).length === 0;
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
    const autoRequestAdmin = selectedLocation ? await isFirstUserAtLocation(selectedLocation) : false;
    if (autoRequestAdmin) {
      setInfoModal({
        title: "First account-linked user at this location",
        body: "You are the first account-linked user at this location. An admin-access request can be submitted for Super User approval after sign-in.",
      });
    }
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
      const ok = await askConfirm(
        candidate.is_archived ? "Archived profile found" : "Existing profile found",
        candidate.is_archived
          ? `An archived profile exists for "${fullName}". Do you want to request restore and claim it after you sign in?`
          : `A profile already exists for "${fullName}". Would you like to claim it after you sign in?`,
        candidate.is_archived ? "Restore & claim" : "Claim profile",
        "Cancel"
      );
      if (ok) {
        if (!candidate.location_id && selectedLocation) {
          pendingClaimPayload = {
            type: "existing",
            playerId: candidate.id,
            fullName,
            locationId: selectedLocation,
            requestedLocationName: pendingRequestedLocationName,
            autoRequestAdmin,
            restoreArchived: Boolean(candidate.is_archived),
          };
        } else {
          pendingClaimPayload = {
            type: "existing",
            playerId: candidate.id,
            fullName,
            requestedLocationName: pendingRequestedLocationName,
            autoRequestAdmin,
            restoreArchived: Boolean(candidate.is_archived),
          };
        }
      } else {
        const createOk = await askConfirm(
          "Create a new profile?",
          "No claim selected. Would you like to create a new profile after you sign in?",
          "Create profile",
          "Cancel"
        );
        if (createOk) {
          pendingClaimPayload = {
            type: "create",
            firstName: first,
            secondName: second,
            locationId: selectedLocation,
            requestedLocationName: pendingRequestedLocationName,
            autoRequestAdmin,
          };
        }
      }
    } else if ((data ?? []).some((p) => p.claimed_by)) {
      setBusy(false);
      setMessage("An existing account/profile already appears to be linked for this name. Sign in with your existing account or contact support.");
      return;
    } else {
      const createOk = await askConfirm(
        "No matching profile found",
        "Would you like to create a new profile after you sign in? (If a previous profile was permanently deleted, a new profile will be created.)",
        "Create profile",
        "Cancel"
      );
      if (createOk) {
        pendingClaimPayload = {
          type: "create",
          firstName: first,
          secondName: second,
          locationId: selectedLocation,
          requestedLocationName: pendingRequestedLocationName,
          autoRequestAdmin,
        };
      }
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
        if (pendingClaimPayload.type === "existing") {
          await client.from("player_claim_requests").insert({
            player_id: pendingClaimPayload.playerId,
            requester_user_id: createdUserId,
            requested_full_name: pendingClaimPayload.fullName,
            status: "pending",
          });
          if (pendingClaimPayload.locationId) {
            await client.from("player_update_requests").insert({
              player_id: pendingClaimPayload.playerId,
              requester_user_id: createdUserId,
              requested_full_name: null,
              requested_location_id: pendingClaimPayload.locationId,
              status: "pending",
            });
          }
        } else {
          const effectiveAgeBand = pendingClaimPayload.ageBand ?? "18_plus";
          const createdFullName =
            effectiveAgeBand === "18_plus"
              ? `${pendingClaimPayload.firstName} ${pendingClaimPayload.secondName ?? ""}`.trim()
              : pendingClaimPayload.firstName;
          const createdPlayer = await client
            .from("players")
            .insert({
              display_name: pendingClaimPayload.firstName,
              first_name: pendingClaimPayload.firstName,
              nickname: null,
              full_name: createdFullName,
              is_archived: false,
              claimed_by: null,
              location_id: effectiveAgeBand === "18_plus" ? pendingClaimPayload.locationId ?? null : null,
              age_band: effectiveAgeBand,
              guardian_consent: effectiveAgeBand === "18_plus" ? false : Boolean(pendingClaimPayload.guardianConsent),
              guardian_consent_at:
                effectiveAgeBand === "18_plus"
                  ? null
                  : Boolean(pendingClaimPayload.guardianConsent)
                    ? new Date().toISOString()
                    : null,
              guardian_name: pendingClaimPayload.guardianName ?? null,
              guardian_email: pendingClaimPayload.guardianEmail ?? null,
              guardian_user_id: pendingClaimPayload.guardianUserId ?? null,
            })
            .select("id")
            .single();
          if (!createdPlayer.error && createdPlayer.data?.id) {
            await client.from("player_claim_requests").insert({
              player_id: createdPlayer.data.id,
              requester_user_id: createdUserId,
              requested_full_name: createdFullName,
              status: "pending",
            });
          }
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
      body: pendingRequestedLocationName
        ? "Your account was created successfully. Check your email if verification is enabled, then sign in. Your new location request is pending Super User review."
        : "Your account was created successfully. If email verification is enabled, verify your email first. Then sign in to complete your profile linking and continue.",
      closeLabel: "Go to sign in",
      redirectTo: "/auth/sign-in?signup=created",
    });
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-md space-y-4">
        <AuthTopNav onBack={() => router.back()} />
        <h1 className="text-3xl font-bold text-slate-900">Create Account</h1>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">First-time setup</p>
            <p className="text-sm text-slate-600">
              {step === 1
                ? "Complete your account details and profile check."
                : "Review legal terms and finish account creation."}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Steps</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"><span className="font-semibold text-slate-900">1.</span> Enter details</div>
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"><span className="font-semibold text-slate-900">2.</span> Legal agreement</div>
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"><span className="font-semibold text-slate-900">3.</span> Create account</div>
            </div>
          </div>
          {step === 1 ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" placeholder="Second name" value={secondName} onChange={(e) => setSecondName(e.target.value)} />
              </div>
              <div>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
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
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs text-slate-600">
                    Location not listed? Enter a new one below. The account can still be created and the Super User can review or rename the location afterwards.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="Enter new location name"
                      value={requestedLocationName}
                      onChange={(e) => setRequestedLocationName(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => void submitLocationRequest()}
                      disabled={requestingLocation}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
                    >
                      {requestingLocation ? "Submitting..." : "Check location"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Review your details</p>
                <p className="mt-1">{email.trim()}</p>
                <p>{firstName.trim()} {secondName.trim()}</p>
                <p>{locations.find((l) => l.id === locationId)?.name ?? (requestedLocationName.trim() || "Location not selected")}</p>
              </div>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                Under-18 players do not create login accounts directly. A parent/guardian or administrator should create and manage under-18 player profiles.
              </p>
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <label className="flex items-start gap-2">
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
                <label className="flex items-start gap-2">
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
          <div className="flex flex-wrap gap-2">
            {step === 1 ? (
              <button type="button" onClick={() => void onContinue()} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white">
                Continue
              </button>
            ) : (
              <>
                <button type="button" onClick={onSignUp} disabled={busy} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {busy ? "Please wait..." : "Create account"}
                </button>
                <button type="button" onClick={() => setStep(1)} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                  Back
                </button>
              </>
            )}
            <Link href="/auth/sign-in" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
              Back to sign in
            </Link>
          </div>
          <MessageModal message={message} onClose={() => setMessage(null)} />
        </section>
      </div>
      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel={confirmState.cancelLabel}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
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
