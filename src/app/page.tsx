"use client";

import Image from "next/image";
import Link from "next/link";
import rackAndFramePhoto from "@/photo/rackandframe.png";

const featureCards = [
  {
    title: "Quick Match",
    description: "Run local practice and social matches with fast score entry.",
  },
  {
    title: "Club Competitions",
    description: "Create, publish, and manage knockout events for your club.",
  },
  {
    title: "Player Profiles",
    description: "Track players, results, notifications, and access requests in one place.",
  },
] as const;

export default function LandingPage() {
  const cardClass = "rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.16),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f4_48%,_#fff8ef_100%)] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <section className={`${cardClass} overflow-hidden`}>
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div className="space-y-4">
                <div className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-teal-700">
                  Rack &amp; Frame Club
                </div>
                <div className="space-y-3">
                  <h1 className="max-w-lg text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                    Quick matches, local competitions, and player results in one club app.
                  </h1>
                  <p className="max-w-md text-base leading-7 text-slate-600 sm:text-lg">
                    Rack &amp; Frame is built for social clubs running cue-sports nights, competitions, and player activity without the admin clutter.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {featureCards.map((card) => (
                    <div key={card.title} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">{card.title}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  New here? Create your account to join your club, link your player profile, and start using Rack &amp; Frame.
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-0 rounded-[30px] bg-gradient-to-br from-teal-200/40 via-transparent to-amber-200/50 blur-2xl" />
                <div className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_30px_70px_rgba(15,23,42,0.18)]">
                  <Image
                    src={rackAndFramePhoto}
                    alt="Rack and Frame club"
                    className="h-[320px] w-full object-contain bg-slate-100 object-center sm:h-[500px]"
                    priority
                  />
                  <div className="border-t border-slate-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">Ready to get started?</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Sign in if you already have an account, or register now to start using quick matches, club competitions, and player features.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={`${cardClass} space-y-4 lg:max-w-md lg:justify-self-end`}>
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Get Started</p>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Welcome to Rack &amp; Frame</h2>
              <p className="text-sm leading-6 text-slate-600">
                Choose an option below to sign in, create your account, or jump back into the app if you are already registered.
              </p>
            </div>

            <div className="grid gap-3">
              <Link
                href="/auth/sign-in"
                className="rounded-2xl bg-teal-700 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                Sign in
              </Link>
              <Link
                href="/auth/sign-up"
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Create account
              </Link>
              <Link
                href="/dashboard"
                className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-center text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
              >
                I’m already signed in
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              If something is broken or doesn&apos;t look right, use the <Link href="/help#report-an-issue" className="font-semibold text-teal-700 underline underline-offset-4">Report an issue</Link> section in Help.
            </div>

            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              Designed and developed by Martin Chamberlain
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
