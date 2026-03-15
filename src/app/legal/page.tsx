"use client";

import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";

export default function LegalPage() {
  const privacyPolicyUrl = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim() || "/privacy";
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL?.trim() || "/terms";
  const cardBaseClass = "rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm";
  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <ScreenHeader title="Legal & Credits" eyebrow="Legal" subtitle="Policy, notices, and support information." />
          <section className="rounded-3xl border border-slate-200 bg-gradient-to-r from-amber-50 via-white to-teal-50 p-5 sm:p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
                  Legal
                </span>
                <div>
                  <h2 className="text-3xl font-semibold text-slate-900 sm:text-4xl">Rack &amp; Frame</h2>
                  <p className="mt-2 max-w-2xl text-slate-700">
                    Policy, credits, ownership, and support details for the current Rack &amp; Frame release.
                  </p>
                </div>
              </div>
              <div className="grid min-w-[220px] flex-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Version</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">1.0.0</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Support</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">rackandframe.app@gmail.com</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Third-party notices</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">None at this time</p>
                </div>
              </div>
            </div>
          </section>

          <section className={`${cardBaseClass} space-y-4`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Ownership</p>
                <p className="mt-2 text-slate-800">Copyright © 2026 Rack &amp; Frame. All rights reserved.</p>
                <p className="mt-2 text-slate-800">Brand, app name, and visual identity are proprietary.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Credits</p>
                <p className="mt-2 text-slate-800">
                  Rack &amp; Frame was designed and developed by Martin Chamberlain for local social-club cue sports, including quick matches,
                  player profiles, and club competitions.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Policies</p>
                <div className="mt-3 space-y-3 text-slate-800">
                  <p>
                    Privacy Policy:{" "}
                    <a href={privacyPolicyUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-700 underline">
                      View policy
                    </a>
                  </p>
                  <p>
                    Terms &amp; Conditions:{" "}
                    <a href={termsUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-700 underline">
                      View terms
                    </a>
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Support</p>
                <p className="mt-3 text-slate-800">For support, bug reports, or questions about the product, contact:</p>
                <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <a
                    href="mailto:rackandframe.app@gmail.com"
                    className="break-all font-medium text-teal-700 underline"
                  >
                    rackandframe.app@gmail.com
                  </a>
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-transparent bg-transparent px-1 py-2">
            <p className="text-xl text-slate-900 sm:text-2xl">
              Thank you for using Rack &amp; Frame - Professional Match Management for Pool &amp; Snooker.
            </p>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
