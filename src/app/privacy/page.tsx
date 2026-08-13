"use client";

export default function PrivacyPage() {
  const effectiveDate = "March 17, 2026";
  const lastUpdatedDate = "August 14, 2026";
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
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-600">Effective date: {effectiveDate} · Last updated: {lastUpdatedDate}</p>
        <p className="text-slate-700">
          Rack &amp; Frame processes account and match data to provide match management, player profiles, rankings, and competition features.
          By using the service, you consent to the data practices described in this policy.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>We collect account data such as email address, role, linked player profile, and club-location association.</li>
          <li>We collect player-profile data, match data, competition and league entries, fixture schedules, submissions, approvals, and notifications.</li>
          <li>We use this data to run fixtures, results, stats, rankings, handicap review, approvals, reschedule requests, and governance workflows.</li>
          <li>For competitions that require players to arrange their own fixtures, an entrant&apos;s email address and phone number may be shown privately to their scheduled opponents and authorized competition managers.</li>
          <li>Entrants without an app account may receive a private fixture link. Anyone holding that link can see that entrant&apos;s fixtures and opponent contact details and can submit a result for organizer approval, so the link must not be shared publicly.</li>
          <li>League fixtures may include scheduled play windows and automated void handling if a deadline passes without a valid submitted result.</li>
          <li>Snooker handicap and rating data may be stored and reviewed so handicapped competitions and league fixtures can be administered correctly.</li>
          <li>Under-18 profiles use safeguarding controls including guardian consent requirements.</li>
          <li>You can request profile updates or deletion; governance actions are reviewed by authorized roles.</li>
          <li>Support requests, audit events, and admin actions may be logged to help operate, secure, and improve the service.</li>
        </ul>
        <p className="text-slate-700">
          For the full website-hosted policy text, please refer to your published policy URL configured by the Super User.
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
