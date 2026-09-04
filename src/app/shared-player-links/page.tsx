import Link from "next/link";

export default function SharedPlayerLinksRetiredPage() {
  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <section className="mx-auto max-w-2xl rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Club-only ratings</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Shared player links have been retired</h1>
        <p className="mt-3 text-slate-700">
          Rack &amp; Frame club Elo and league-app Elo are now separate. Results in one system cannot change ratings in the other.
        </p>
        <Link href="/rankings" className="mt-5 inline-flex rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white">
          View club rankings
        </Link>
      </section>
    </main>
  );
}
