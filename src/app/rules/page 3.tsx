"use client";

import { useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";

type SportFilter = "pool" | "snooker" | "all";
type RuleItem = {
  id: string;
  sport: "pool" | "snooker";
  title: string;
  body: string;
};

const POOL_RULES: RuleItem[] = [
  {
    id: "pool-lag",
    sport: "pool",
    title: "Lag and break order",
    body: "Winner of the lag chooses to break or pass. Alternate-break formats depend on event settings.",
  },
  {
    id: "pool-legal-break",
    sport: "pool",
    title: "Legal break requirements",
    body: "A legal break usually needs at least one object ball potted or enough object balls driven to cushions, depending on format.",
  },
  {
    id: "pool-open-table",
    sport: "pool",
    title: "Open table after break (8-ball)",
    body: "After a legal break in 8-ball, table remains open unless a legal called shot establishes a group.",
  },
  {
    id: "pool-called-shots",
    sport: "pool",
    title: "Called shots",
    body: "In call-shot formats, the player should clearly call ball and pocket when not obvious.",
  },
  {
    id: "pool-fouls",
    sport: "pool",
    title: "Fouls and penalties",
    body: "Common fouls include cue-ball scratch, no rail after contact, wrong first contact, and illegal shot execution. Apply event penalty rule.",
  },
  {
    id: "pool-loss-of-rack",
    sport: "pool",
    title: "Loss of rack (8-ball)",
    body: "Typical loss conditions include potting the 8-ball early, potting it in the wrong pocket, or fouling while potting it.",
  },
  {
    id: "pool-rules-note",
    sport: "pool",
    title: "Rules source note",
    body: "This is a quick-reference summary. For formal decisions, use the current official WPA/blackball event rulebook in force for your match.",
  },
];

const SNOOKER_RULES: RuleItem[] = [
  {
    id: "snooker-order",
    sport: "snooker",
    title: "Order of play",
    body: "Players alternate red then colour while reds remain. After reds are cleared, colours are potted in order.",
  },
  {
    id: "snooker-colours",
    sport: "snooker",
    title: "Colours sequence",
    body: "After reds: yellow, green, brown, blue, pink, black.",
  },
  {
    id: "snooker-fouls",
    sport: "snooker",
    title: "Common fouls",
    body: "Fouls include missing the ball-on, cue-ball in-off, touching/moving balls illegally, push shots, and jump-off-table outcomes.",
  },
  {
    id: "snooker-miss",
    sport: "snooker",
    title: "Foul and a miss",
    body: "When a miss is called, balls can be replaced and the shot replayed subject to referee/event interpretation.",
  },
  {
    id: "snooker-free-ball",
    sport: "snooker",
    title: "Free ball",
    body: "After a foul that leaves the striker snookered, a free ball may be nominated and played as the ball-on where allowed.",
  },
  {
    id: "snooker-rules-note",
    sport: "snooker",
    title: "Rules source note",
    body: "This is a quick-reference summary. For formal decisions, use the current official WPBSA/competition rulebook in force.",
  },
];

const ALL_RULES: RuleItem[] = [...POOL_RULES, ...SNOOKER_RULES];

const DISPUTE_STEPS: Array<{ id: string; title: string; text: string }> = [
  {
    id: "break",
    title: "Break",
    text: "Confirm your format’s legal-break condition first (ball potted and/or balls to cushions). If unclear, pause and replay facts before continuing.",
  },
  {
    id: "foul",
    title: "Foul",
    text: "Confirm ball-on, first legal contact, rail requirement, and cue-ball outcome. Then apply event penalty (ball-in-hand/free-ball/foul points).",
  },
  {
    id: "eight-ball",
    title: "8-Ball",
    text: "Check if the 8-ball was legal for timing, pocket, and cue-ball status. If any fail condition applies, resolve as loss of rack under your format.",
  },
];

export default function RulesPage() {
  const [sport, setSport] = useState<SportFilter>("pool");
  const [topic, setTopic] = useState("all");
  const [dispute, setDispute] = useState("break");

  const visibleRules = useMemo(() => {
    const bySport =
      sport === "pool" ? POOL_RULES : sport === "snooker" ? SNOOKER_RULES : ALL_RULES;
    return bySport.filter((r) => topic === "all" || r.id === topic);
  }, [sport, topic]);

  const topicOptions = useMemo(() => {
    const list = sport === "pool" ? POOL_RULES : sport === "snooker" ? SNOOKER_RULES : ALL_RULES;
    return [{ id: "all", label: "All topics" }, ...list.map((r) => ({ id: r.id, label: r.title }))];
  }, [sport]);

  const activeDispute = DISPUTE_STEPS.find((d) => d.id === dispute) ?? DISPUTE_STEPS[0];

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold text-slate-900">
              {sport === "snooker" ? "Snooker Rules" : sport === "pool" ? "International Pool Rules" : "Rules"}
            </h1>
            <PageNav />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <p className="text-slate-700">
              Quick reference only. For formal rulings, always use the official rulebook for your event.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                value={sport}
                onChange={(e) => {
                  setSport(e.target.value as SportFilter);
                  setTopic("all");
                }}
              >
                <option value="pool">Pool</option>
                <option value="snooker">Snooker</option>
                <option value="all">All sports</option>
              </select>
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                {topicOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <p className="text-sm text-slate-600">{visibleRules.length} rule topics</p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-2xl font-semibold text-slate-900">Dispute Wizard</h2>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={dispute}
              onChange={(e) => setDispute(e.target.value)}
            >
              {DISPUTE_STEPS.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            <p className="text-slate-700">{activeDispute.text}</p>
          </section>

          <section className="space-y-3">
            {visibleRules.map((r) => (
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
