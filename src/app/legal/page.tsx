"use client";

import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";

export default function LegalPage() {
  const privacyPolicyUrl = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim() || "/privacy";
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL?.trim() || "/terms";
  const cardBaseClass = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm";
  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <ScreenHeader title="Legal & Credits" eyebrow="Legal" subtitle="Policy, notices, and support information." />
          <section className={`${cardBaseClass} border-amber-200 space-y-3`}>
            <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900">
              Rack &amp; Frame - Professional Match Management for Pool &amp; Snooker.
            </h2>
            <h3 className="text-2xl sm:text-3xl text-slate-900">Legal &amp; Credits</h3>
            <p className="text-slate-800">Copyright © 2026 Rack &amp; Frame. All rights reserved.</p>
            <p className="text-slate-800">Brand, app name, and visual identity are proprietary.</p>
            <p className="text-slate-800">
              Privacy Policy:{" "}
              <a href={privacyPolicyUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-700 underline">
                View policy
              </a>
            </p>
            <p className="text-slate-800">
              Terms &amp; Conditions:{" "}
              <a href={termsUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-700 underline">
                View terms
              </a>
            </p>
            <p className="text-slate-800">Third-party notices: none at this time.</p>
            <p className="pt-2 text-slate-900">
              Version 1.0.0
              <br />
              Support: rackandframe.app@gmail.com
            </p>
          </section>

          <section className="rounded-2xl border border-transparent bg-transparent p-1 sm:p-2">
            <p className="text-xl sm:text-2xl text-slate-900">
              Thank you for using Rack &amp; Frame - Professional Match Management for Pool &amp; Snooker.
            </p>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
