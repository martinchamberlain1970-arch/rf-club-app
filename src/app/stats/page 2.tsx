"use client";

import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import usePremiumStatus from "@/components/usePremiumStatus";

export default function StatsPage() {
  const premium = usePremiumStatus();
  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold text-slate-900">Stats</h1>
            <PageNav />
          </div>
          {!premium.loading && !premium.unlocked ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Stats is a Premium feature.
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-slate-700">Stats table/predictor is next in the rebuild sequence.</p>
            </section>
          )}
        </RequireAuth>
      </div>
    </main>
  );
}
