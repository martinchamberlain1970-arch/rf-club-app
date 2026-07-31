"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type PublicCompetition = {
  id: string;
  name: string;
  venue: string | null;
  sportType: "snooker" | "pool_8_ball" | "pool_9_ball";
  competitionFormat: "knockout" | "league";
  matchMode: "singles" | "doubles";
  signupDeadline: string | null;
  maxEntries: number | null;
  entryCount: number;
  acceptingSignups: boolean;
  closedReason: string | null;
  entryFeePence: number | null;
};

const sportNames = {
  snooker: "Snooker",
  pool_8_ball: "8-ball pool",
  pool_9_ball: "9-ball pool",
};

export default function PublicCompetitionSignupPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = String(params.id ?? "");
  const [competition, setCompetition] = useState<PublicCompetition | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(() => searchParams.get("payment") === "success");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/public/competitions/${id}/signup`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Unable to load this competition.");
        setCompetition(data.competition as PublicCompetition);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load this competition."))
      .finally(() => setLoading(false));
  }, [id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const response = await fetch(`/api/public/competitions/${id}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, phone, note, website }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data?.error ?? "Unable to submit your entry.");
      return;
    }
    if (typeof data?.checkoutUrl === "string") {
      window.location.assign(data.checkoutUrl);
      return;
    }
    setSubmitted(true);
  };

  const resumePayment = async () => {
    const signupId = searchParams.get("signup");
    if (!signupId) return;
    setError("");
    setBusy(true);
    const response = await fetch(`/api/public/competitions/${id}/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signupId }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok || typeof data?.checkoutUrl !== "string") {
      setError(data?.error ?? "Unable to restart payment.");
      return;
    }
    window.location.assign(data.checkoutUrl);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-emerald-950 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 text-center text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">Rack &amp; Frame</p>
          <h1 className="mt-2 text-3xl font-bold">Competition entry</h1>
        </div>

        <section className="rounded-[28px] bg-white p-5 shadow-2xl sm:p-7">
          {loading ? <p className="text-center text-slate-600">Loading competition…</p> : null}

          {!loading && competition ? (
            <>
              <div className="border-b border-slate-200 pb-5">
                <h2 className="text-2xl font-bold text-slate-950">{competition.name}</h2>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-900">
                    {sportNames[competition.sportType]}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                    {competition.competitionFormat} · {competition.matchMode}
                  </span>
                </div>
                {competition.venue ? <p className="mt-3 text-sm text-slate-600">Venue: {competition.venue}</p> : null}
                {competition.signupDeadline ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Entries close: {new Date(competition.signupDeadline).toLocaleString("en-GB")}
                  </p>
                ) : null}
                {competition.entryFeePence ? (
                  <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950">
                    Entry fee: £{(competition.entryFeePence / 100).toFixed(2)} · secure payment by Stripe
                  </p>
                ) : null}
              </div>

              {submitted ? (
                <div className="py-10 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-800">✓</div>
                  <h3 className="mt-4 text-2xl font-bold text-slate-950">Entry received!</h3>
                  <p className="mt-2 text-slate-600">
                    {searchParams.get("payment") === "success"
                      ? "Thank you. Stripe is confirming your £10 payment and the organiser will see it against your entry automatically."
                      : "Your entry has been sent to the competition organiser. They’ll contact you if they need anything else."}
                  </p>
                </div>
              ) : searchParams.get("payment") === "cancelled" && searchParams.get("signup") ? (
                <div className="py-8 text-center">
                  <h3 className="text-xl font-semibold text-slate-950">Your entry is saved</h3>
                  <p className="mt-2 text-slate-600">Payment was cancelled, so the £10 entry fee is still outstanding.</p>
                  {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
                  <button type="button" onClick={() => void resumePayment()} disabled={busy} className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-base font-semibold text-white disabled:opacity-60">
                    {busy ? "Preparing secure payment…" : "Return to Stripe and pay £10.00"}
                  </button>
                </div>
              ) : competition.acceptingSignups ? (
                <form onSubmit={submit} className="mt-5 space-y-4">
                  <p className="text-sm text-slate-600">No app account is needed. Enter your details below and the organiser will add you to the competition.</p>
                  <label className="block text-sm font-medium text-slate-800">
                    Full name
                    <input required maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-800">
                      Mobile number
                      <input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
                    </label>
                    <label className="block text-sm font-medium text-slate-800">
                      Email
                      <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
                    </label>
                  </div>
                  <p className="-mt-2 text-xs text-slate-500">Please provide at least a mobile number or email address.</p>
                  <label className="block text-sm font-medium text-slate-800">
                    Note <span className="font-normal text-slate-500">(optional)</span>
                    <textarea maxLength={500} rows={3} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
                  </label>
                  <label className="hidden" aria-hidden="true">
                    Website
                    <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
                  </label>
                  {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
                  <button disabled={busy} className="w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60">
                    {busy
                      ? "Preparing secure payment…"
                      : competition.entryFeePence
                        ? `Sign up and pay £${(competition.entryFeePence / 100).toFixed(2)}`
                        : "Sign up to this competition"}
                  </button>
                  <p className="text-center text-xs text-slate-500">Your details will only be used by the organiser to manage this competition and contact you about your entry.</p>
                </form>
              ) : (
                <div className="py-8 text-center">
                  <h3 className="text-xl font-semibold text-slate-950">Entries are not available</h3>
                  <p className="mt-2 text-slate-600">{competition.closedReason}</p>
                </div>
              )}
            </>
          ) : null}

          {!loading && !competition && error ? <p role="alert" className="text-center text-red-700">{error}</p> : null}
        </section>
        <p className="mt-5 text-center text-xs text-slate-400">
          Already use Rack &amp; Frame? <Link href="/signups" className="text-emerald-300 underline">Sign in and enter here</Link>
        </p>
      </div>
    </main>
  );
}
