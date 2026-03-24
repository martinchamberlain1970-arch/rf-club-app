"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function readRecoveryParams() {
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const type = hash.get("type");
  if (!accessToken || !refreshToken || type !== "recovery") return null;
  return { accessToken, refreshToken };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldClass = "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200";
  const cardClass = "rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur";

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const client = supabase;
      if (!client) {
        if (!mounted) return;
        setError("Supabase is not configured.");
        setBusy(false);
        return;
      }

      const recovery = readRecoveryParams();
      if (recovery) {
        const { error: sessionError } = await client.auth.setSession({
          access_token: recovery.accessToken,
          refresh_token: recovery.refreshToken,
        });
        if (sessionError) {
          if (!mounted) return;
          setError(`Reset link could not be validated: ${sessionError.message}`);
          setBusy(false);
          return;
        }
        if (typeof window !== "undefined") {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }

      const { data } = await client.auth.getSession();
      if (!mounted) return;
      if (!data.session) {
        setError("This reset link is not active. Open the latest reset email and try again.");
      } else {
        setReady(true);
      }
      setBusy(false);
    };

    init();
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters for the new password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    const client = supabase;
    if (!client) {
      setError("Supabase is not configured.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await client.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(`Could not reset password: ${updateError.message}`);
      return;
    }
    setMessage("Password updated. Redirecting to sign in...");
    setTimeout(() => router.replace("/auth/sign-in?reset=success"), 1200);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.16),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f4_48%,_#fff8ef_100%)] p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <section className={`${cardClass} space-y-5`}>
          <div className="space-y-3">
            <div className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-teal-700">
              Choose new password
            </div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">Set a new club password</h1>
            <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Use the reset link from your email to open this page, then choose a new password for your account.
            </p>
          </div>

          {busy && !ready && !error ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">Checking reset link...</div> : null}
          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          {ready ? (
            <form onSubmit={onSubmit} className="max-w-xl space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={fieldClass}
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Confirm new password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={fieldClass}
                  placeholder="Repeat new password"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={busy} className="rounded-2xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60">
                  {busy ? "Saving..." : "Save new password"}
                </button>
                <Link href="/auth/sign-in" className="text-sm font-semibold text-slate-600 underline underline-offset-4">
                  Back to sign in
                </Link>
              </div>
            </form>
          ) : null}

          {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
        </section>
      </div>
    </main>
  );
}
