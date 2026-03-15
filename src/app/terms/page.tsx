"use client";

export default function TermsPage() {
  const effectiveDate = "March 3, 2026";
  const onClose = () => {
    if (typeof window === "undefined") return;
    if (window.opener) {
      window.close();
      return;
    }
    window.history.back();
  };
  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Terms &amp; Conditions</h1>
        <p className="text-sm text-slate-600">Effective date: {effectiveDate} · Last updated: {effectiveDate}</p>
        <p className="text-slate-700">
          These terms govern use of Rack &amp; Frame. By creating an account and using the platform, you agree to follow these terms.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>You are responsible for accurate match reporting and lawful use of the platform.</li>
          <li>Governance decisions (approvals, role changes, profile actions) are controlled by authorized account roles.</li>
          <li>Premium functionality may require approval and can vary by account role and subscription state.</li>
          <li>Snooker Elo updates from valid approved singles results only; no-show, walkover, void, and doubles outcomes are excluded.</li>
          <li>Snooker handicap is reviewed from Elo and may be overridden manually by the Super User when needed.</li>
          <li>Accounts and profiles may be suspended or removed for misuse, fraud, or policy violations.</li>
        </ul>
        <p className="text-slate-700">
          For the full website-hosted terms text, please refer to your published terms URL configured by the Super User.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
        >
          Close page
        </button>
      </div>
    </main>
  );
}
