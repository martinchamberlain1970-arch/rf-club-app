"use client";

import { useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";

type SportFilter = "all" | "pool" | "snooker";
type RuleItem = {
  id: string;
  sport: "pool" | "snooker";
  title: string;
  body: string;
};

const RULES: RuleItem[] = [
  { id: "pool-break", sport: "pool", title: "Legal break requirements (Pool)", body: "A legal break usually requires at least one ball potted or the required number of object balls reaching a cushion, based on event format." },
  { id: "pool-open", sport: "pool", title: "Open table after break (8-ball)", body: "After a legal break, table is open unless a called group is established by a legal called shot." },
  { id: "pool-foul", sport: "pool", title: "Common fouls (Pool)", body: "Typical fouls include no rail after contact, potting the cue ball, wrong first contact, or illegal shot execution." },
  { id: "pool-called", sport: "pool", title: "Called shots", body: "In call-shot formats, the player must clearly indicate intended ball and pocket when not obvious." },
  { id: "pool-8ball", sport: "pool", title: "8-ball loss conditions", body: "Typical loss conditions include potting the 8-ball early, potting it in the wrong pocket, or cue-ball foul while potting it." },
  { id: "snooker-red", sport: "snooker", title: "Order of play (Snooker)", body: "Players alternate between a red and a colour while reds remain. After all reds are gone, colours are played in sequence." },
  { id: "snooker-foul", sport: "snooker", title: "Common fouls (Snooker)", body: "Fouls include missing the ball-on, potting the cue ball, touching balls illegally, or causing the cue ball to jump off the table." },
  { id: "snooker-miss", sport: "snooker", title: "Foul and a miss", body: "When the referee calls a miss, balls may be replaced and the shot replayed, depending on the situation and rule interpretation." },
  { id: "snooker-freeball", sport: "snooker", title: "Free ball", body: "If snookered after a foul, a free ball may be nominated and treated as a red (or as the ball-on where applicable)." },
  { id: "snooker-endgame", sport: "snooker", title: "Endgame colours", body: "After all reds are potted, colours are potted in order: yellow, green, brown, blue, pink, black." },
];

const DISPUTE = [
  { id: "break", title: "Break", text: "Check if the break met your format requirements. If unclear, replay facts and apply event format rule." },
  { id: "foul", title: "Foul", text: "Identify ball-on, first contact, cue-ball path, and cushion requirement. Resolve with agreed event interpretation." },
  { id: "conduct", title: "Conduct", text: "Pause play for disputes on behaviour, time, or etiquette. Apply venue/event code and record decision." },
];

export default function RulesPage() {
  const [sport, setSport] = useState<SportFilter>("all");
  const [topic, setTopic] = useState("all");
  const [disputeId, setDisputeId] = useState("break");

  const filtered = useMemo(() => {
    return RULES.filter((r) => (sport === "all" || r.sport === sport) && (topic === "all" || r.id === topic));
  }, [sport, topic]);

  const dispute = DISPUTE.find((d) => d.id === disputeId) ?? DISPUTE[0];

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold text-slate-900">Rules</h1>
            <PageNav />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <p className="text-slate-700">
              Quick reference only. For formal rulings, use official governing-body rules.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2" value={sport} onChange={(e) => setSport(e.target.value as SportFilter)}>
                <option value="all">All sports</option>
                <option value="pool">Pool</option>
                <option value="snooker">Snooker</option>
              </select>
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2" value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="all">All topics</option>
                {RULES.filter((r) => sport === "all" || r.sport === sport).map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
            </div>
            <p className="text-sm text-slate-600">{filtered.length} topics</p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-2xl font-semibold text-slate-900">Dispute Wizard</h2>
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2" value={disputeId} onChange={(e) => setDisputeId(e.target.value)}>
              {DISPUTE.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
            <p className="text-slate-700">{dispute.text}</p>
          </section>

          <section className="space-y-3">
            {filtered.map((r) => (
              <article key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-xl font-semibold text-slate-900">{r.title}</h3>
                <p className="mt-1 text-slate-700">{r.body}</p>
              </article>
            ))}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
