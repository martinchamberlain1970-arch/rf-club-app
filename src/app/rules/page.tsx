"use client";

import { useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";

type RuleEntry = { title: string; tags: string; summary: string };
type DisputeTopic = { label: string; quickCheck: string; action: string };

const poolRuleEntries: RuleEntry[] = [
  { title: "Lag and break order", tags: "start lag break", summary: "Winner of the lag chooses to break or can pass the break. Alternate break format depends on event settings." },
  { title: "Legal break requirements", tags: "break legal foul rack", summary: "On the break, a legal shot usually requires at least one object ball pocketed or enough balls driven to rails based on the game format." },
  { title: "Open table after break (8-ball)", tags: "8-ball open table solids stripes", summary: "After a legal break in 8-ball, table is open unless a called group is established by a legal called shot." },
  { title: "Called shots", tags: "call shot pocket", summary: "In call-shot games, player must clearly indicate the intended ball and pocket when not obvious." },
  { title: "Standard fouls", tags: "foul cue ball scratch no rail", summary: "Common fouls include: no first contact on a legal object ball, scratch, no rail after contact, push shot, and double hit." },
  { title: "Ball in hand", tags: "penalty foul ball in hand", summary: "Most fouls award ball in hand to the incoming player. Placement location depends on the game and local event rules." },
  { title: "Jump and masse restrictions", tags: "jump masse cue", summary: "Jump or masse shots can be restricted by event equipment rules. Confirm whether jump cues are allowed." },
  { title: "8-ball loss conditions", tags: "8-ball lose game", summary: "Typical instant-loss examples: pocketing 8-ball early, pocketing 8-ball with a foul, or pocketing 8-ball in wrong pocket." },
  { title: "9-ball win conditions", tags: "9-ball lowest first contact", summary: "Legal hit must contact the lowest-numbered ball first. Pocketing 9-ball legally wins the rack." },
  { title: "Stalemate and unsportsmanlike conduct", tags: "stalemate sportsmanship dispute", summary: "Referee or event director may declare stalemate/re-rack or penalties for unsportsmanlike behavior." },
  { title: "Dispute process", tags: "dispute referee ruling", summary: "Pause play, agree facts, and consult official rule source/event director before continuing." },
];

const disputeTopics: DisputeTopic[] = [
  { label: "Break", quickCheck: "Was the break legal for your game format (pocketed ball and/or required rails)?", action: "If unclear, replay facts and apply event format rule. If still disputed, pause and consult official WPA rules." },
  { label: "Foul", quickCheck: "Did cue ball contact legal object first, and did a ball reach rail/pocket after contact?", action: "If foul confirmed, apply the game's ball-in-hand penalty rule and resume with incoming player." },
  { label: "8-Ball", quickCheck: "Was 8-ball pocketed legally (correct timing, pocket, and no foul)?", action: "Illegal 8-ball outcomes are usually loss of rack. Confirm call-shot and pocket requirements in your rule set." },
  { label: "9-Ball", quickCheck: "Was lowest numbered ball contacted first, and was shot otherwise legal?", action: "If legal and 9-ball was pocketed, rack is won. If foul occurred, apply ball-in-hand to opponent." },
  { label: "Conduct", quickCheck: "Did either player delay, distract, or act unsportsmanlike?", action: "Pause play and record incident. Event director/referee can issue warnings, penalties, or forfeits." },
];

const worldRuleEntries: RuleEntry[] = [
  { title: "World Rules scope", tags: "uk world rules blackball", summary: "World Rules are still used in many UK local leagues. Always confirm league house rules before match start." },
  { title: "Two visits after foul", tags: "two visits foul", summary: "A common World Rules principle is two visits after a standard foul. Confirm exceptions in your local league sheet." },
  { title: "Skill shot and free shot usage", tags: "free shot skill shot", summary: "Leagues can differ on free-shot handling after fouls. Confirm whether nominated ball can also open tactical options." },
  { title: "8-ball finish conditions", tags: "black ball finish loss", summary: "Check local wording for black-ball timing and pocket calls. Early or illegal black usually loses the frame." },
  { title: "Foul and cue-ball placement", tags: "foul in hand baulk", summary: "Cue-ball placement after fouls varies by league variant. Confirm whether placement is full table or restricted area." },
];

const worldDisputeTopics: DisputeTopic[] = [
  { label: "Visits", quickCheck: "Was the foul type and resulting number of visits applied correctly for your league variant?", action: "Confirm local World Rules sheet, then apply the correct visit count before resuming play." },
  { label: "Free Shot", quickCheck: "Was free-shot entitlement awarded only when conditions were met?", action: "Re-check foul context and league notes; if unclear, agree replay point and continue." },
  { label: "Black Ball", quickCheck: "Was the black pocketed at legal time and in the declared pocket?", action: "Apply immediate frame result per local World Rules definition." },
];

const ultimateRuleEntries: RuleEntry[] = [
  { title: "Ultimate format note", tags: "ultimate pool format", summary: "Ultimate Pool is based on International Rules with event-specific overlays." },
  { title: "Timed match overlays", tags: "timer clock shot clock", summary: "Many Ultimate events use time controls. Track event timer and tie-break procedure before starting." },
  { title: "Referee-led calls", tags: "referee official decision", summary: "Official event referee rulings take priority for close hits, fouls, and procedural decisions." },
  { title: "Event-specific regulations", tags: "event rules supplements", summary: "Check event handbook for penalties, pace-of-play, and final-rack procedures." },
];

const ultimateDisputeTopics: DisputeTopic[] = [
  { label: "Timer", quickCheck: "Was shot-clock/time-control procedure applied correctly for this event stage?", action: "Use official event timing rules and referee instruction to resolve." },
  { label: "Procedure", quickCheck: "Was the dispute a rules issue or event-procedure issue?", action: "For procedure, apply event handbook first; for table rules, use International base rules." },
  { label: "Referee", quickCheck: "Was an official ruling already given?", action: "Record ruling and continue. Escalate only through the event's formal protest path." },
];

const snookerRuleEntries: RuleEntry[] = [
  { title: "Frame start and break-off", tags: "break-off baulk d", summary: "Cue ball starts in hand in the 'D'. A legal break-off must strike a red first or be a valid miss/foul under event rules." },
  { title: "Ball values", tags: "points red yellow green brown blue pink black", summary: "Red=1, Yellow=2, Green=3, Brown=4, Blue=5, Pink=6, Black=7. Highest total after final black wins frame." },
  { title: "Order of play", tags: "red colour sequence", summary: "Pot a red, then a colour, then red again while reds remain. After all reds are gone, colours are potted in order: yellow to black." },
  { title: "Colour respotting", tags: "respot spot occupied", summary: "Colours are respotted after being potted while reds remain. If a spot is occupied, use the highest available spot." },
  { title: "Common fouls", tags: "foul in-off miss wrong ball touch", summary: "Typical fouls: striking wrong ball first, in-off, no ball to cushion after contact, push/double hit, or touching balls/clothing interference." },
  { title: "Foul points", tags: "penalty points 4 5 6 7", summary: "Foul penalty is at least 4 points, or the value of the ball involved (up to 7), awarded to opponent." },
  { title: "Free ball", tags: "snooker free ball after foul", summary: "If player is snookered after a foul, referee may call a free ball. Nominated ball then counts as ball-on for that shot." },
  { title: "Miss rule", tags: "foul and a miss", summary: "If player misses ball-on without a reasonable attempt, 'foul and a miss' may be called and balls can be replaced." },
  { title: "Snookered and escapes", tags: "snooker escape cushion", summary: "When snookered, player must attempt to hit the ball-on legally. Tactical escapes are part of safety play." },
  { title: "Re-spotted black", tags: "tie final black respot", summary: "If scores are level after final black, black is respotted and a coin toss determines who plays first." },
  { title: "Conceding and forfeits", tags: "concede forfeit frame", summary: "Frames can be conceded, but unsporting concessions or referee decisions can result in forfeits under event rules." },
];

const snookerDisputeTopics: DisputeTopic[] = [
  { label: "Foul", quickCheck: "Was the correct ball-on struck first, and did any in-off/touching or push/double-hit occur?", action: "Apply foul points (minimum 4 or higher ball value) to opponent and restore turn under normal snooker rules." },
  { label: "Miss", quickCheck: "Did the striker fail to hit ball-on and was there a reasonable attempt made?", action: "If 'foul and a miss' applies, replace balls and replay from referee/agreed position." },
  { label: "Free Ball", quickCheck: "After a foul, is striker fully snookered on all legal balls-on?", action: "If yes, free ball can be nominated and scored as ball-on for that stroke." },
  { label: "Respot", quickCheck: "Was colour respotted correctly when required and were occupied spots handled in order?", action: "Replace on own spot if free; otherwise highest available spot per standard respot sequence." },
  { label: "Final Black", quickCheck: "Are frame scores level after black sequence was completed?", action: "Use re-spotted black procedure and continue until one player scores or concedes." },
];

export default function RulesPage() {
  const sportOptions = ["Pool", "Snooker"] as const;
  const poolRuleSetOptions = ["International", "World Rules", "Ultimate"] as const;
  const [sportTab, setSportTab] = useState(0);
  const [poolRuleSetTab, setPoolRuleSetTab] = useState(0);
  const [query, setQuery] = useState("");
  const [disputeTab, setDisputeTab] = useState(0);

  const poolRuleSetLabel = poolRuleSetTab === 1 ? "World Rules" : poolRuleSetTab === 2 ? "Ultimate Notes" : "International";
  const poolRules = poolRuleSetTab === 1 ? worldRuleEntries : poolRuleSetTab === 2 ? ultimateRuleEntries : poolRuleEntries;
  const poolDisputes = poolRuleSetTab === 1 ? worldDisputeTopics : poolRuleSetTab === 2 ? ultimateDisputeTopics : disputeTopics;
  const allRules = sportTab === 0 ? poolRules : snookerRuleEntries;
  const allDisputes = sportTab === 0 ? poolDisputes : snookerDisputeTopics;
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? allRules.filter((r) => `${r.title} ${r.tags} ${r.summary}`.toLowerCase().includes(q)) : allRules),
    [allRules, q]
  );
  const safeDisputeTab = Math.min(disputeTab, Math.max(0, allDisputes.length - 1));
  const selectedDispute = allDisputes[safeDisputeTab];
  const title = sportTab === 0 ? "Pool Rules" : "Snooker Rules";
  const cardBaseClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillActiveClass = `${pillBaseClass} border-teal-700 bg-teal-700 text-white`;
  const pillInactiveClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <ScreenHeader
            title={title}
            eyebrow="Rules"
            subtitle="Quick reference and dispute wizard."
          />

          <section className={`${cardBaseClass} space-y-3`}>
            <h2 className="text-xl font-semibold text-slate-900">Rule filters</h2>
            <div className="flex flex-wrap gap-2">
              {sportOptions.map((o, i) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    setSportTab(i);
                    setDisputeTab(0);
                  }}
                  className={sportTab === i ? pillActiveClass : pillInactiveClass}
                >
                  {o}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                value={sportTab}
                onChange={(e) => {
                  setSportTab(Number(e.target.value));
                  setDisputeTab(0);
                }}
              >
                {sportOptions.map((o, i) => <option key={o} value={i}>{o}</option>)}
              </select>
              {sportTab === 0 ? (
                <select
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                  value={poolRuleSetTab}
                  onChange={(e) => {
                    setPoolRuleSetTab(Number(e.target.value));
                    setDisputeTab(0);
                  }}
                >
                  {poolRuleSetOptions.map((o, i) => <option key={o} value={i}>{o}</option>)}
                </select>
              ) : <div />}
            </div>
            <p className="text-sm text-slate-700">
              {sportTab === 0
                ? `Quick reference only. Active pool ruleset: ${poolRuleSetLabel}. Use Official for formal rulings.`
                : "Quick reference only. Use Official for formal snooker rulings."}
            </p>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={sportTab === 0 ? "Search rules (e.g. foul, break, 8-ball)" : "Search rules (e.g. miss, free ball, respot)"}
            />
            <p className="text-sm text-slate-600">{filtered.length} rule topic{filtered.length === 1 ? "" : "s"}</p>
          </section>

          <section className={`${cardBaseClass} space-y-3`}>
            <h2 className="text-xl font-semibold text-slate-900">Dispute Wizard</h2>
            <select
              className="rounded-xl border border-slate-300 bg-white px-3 py-2"
              value={safeDisputeTab}
              onChange={(e) => setDisputeTab(Number(e.target.value))}
            >
              {allDisputes.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}
            </select>
            <p className="text-sm text-slate-700">Quick check: {selectedDispute.quickCheck}</p>
            <p className="text-sm text-slate-700">What to do: {selectedDispute.action}</p>
          </section>

          <section className="space-y-3">
            {filtered.map((rule) => (
              <article key={rule.title} className={cardBaseClass}>
                <h3 className="text-lg font-semibold text-slate-900">{rule.title}</h3>
                <p className="mt-1 text-slate-700">{rule.summary}</p>
              </article>
            ))}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
