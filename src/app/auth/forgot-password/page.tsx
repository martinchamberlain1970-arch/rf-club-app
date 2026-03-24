"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldClass = "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200";
  const cardClass = "rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    const client = supabase;
    if (!client) {
      setBusy(false);
      setError("Supabase is not configured.");
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const redirectTo = origin ? `${origin}/auth/reset-password` : undefined;
    const { error: resetError } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    setBusy(false);
    if (resetError) {
      setError(`Could not send reset link: ${resetError.message}`);
      return;
    }
    setMessage("If an account exists for that email, a password reset link has been sent.");
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.16),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f4_48%,_#fff8ef_100%)] p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <section className={`${cardClass} space-y-5`}>
          <div className="space-y-3">
            <div className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-teal-700">
              Password reset
            </div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">Reset your club password</h1>
            <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Enter your email address and we will send a password reset link. The link will bring you back here to choose a new password.
            </p>
          </div>

          <form onSubmit={onSubmit} className="max-w-xl space-y-4">
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
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={busy} className="rounded-2xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60">
                {busy ? "Sending..." : "Send reset link"}
              </button>
              <Link href="/auth/sign-in" className="text-sm font-semibold text-slate-600 underline underline-offset-4">
                Back to sign in
              </Link>
            </div>
          </form>

          {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        </section>
      </div>
    </main>
  );
}
