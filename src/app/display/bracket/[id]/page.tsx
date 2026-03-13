"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Competition = {
  id: string;
  name: string;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  competition_format: "knockout" | "league";
  best_of: number;
  knockout_round_best_of?: {
    round1?: number;
    semi_final?: number;
    final?: number;
  } | null;
};
type Match = {
  id: string;
  round_no: number | null;
  match_no: number | null;
  best_of: number;
  status: "pending" | "in_progress" | "complete" | "bye";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id?: string | null;
  team1_player2_id?: string | null;
  team2_player1_id?: string | null;
  team2_player2_id?: string | null;
  winner_player_id: string | null;
};
type Player = { id: string; display_name: string; full_name: string | null };
type Frame = { match_id: string; winner_player_id: string | null; is_walkover_award: boolean };
type BracketNode = {
  id: string;
  roundNo: number;
  matchNo: number;
  bestOf: number;
  status: Match["status"] | "tbc";
  p1: string;
  p2: string;
  scoreText?: string | null;
  scoreLeft?: number | null;
  scoreRight?: number | null;
};

const DEFAULT_CARD_HEIGHT = 112;
const DEFAULT_STEP = 136;

function getRoundLabel(roundNo: number, totalRounds: number): string {
  if (totalRounds <= 1) return "Final";
  if (roundNo === totalRounds) return "Final";
  if (roundNo === totalRounds - 1) return "Semi-final";
  if (roundNo === totalRounds - 2) return "Quarter-final";
  if (roundNo === totalRounds - 3) return "Last 16";
  return `Round ${roundNo}`;
}

function getRoundBestOf(
  roundNo: number,
  totalRounds: number,
  fallback: number,
  cfg: Competition["knockout_round_best_of"]
): number {
  if (!cfg) return fallback;
  if (roundNo >= totalRounds) return cfg.final ?? fallback;
  if (roundNo === totalRounds - 1) return cfg.semi_final ?? fallback;
  return cfg.round1 ?? fallback;
}

function resolveWinnerSide(m: Match): 1 | 2 | 0 {
  if (!m.winner_player_id) return 0;
  if (m.team1_player1_id || m.team1_player2_id || m.team2_player1_id || m.team2_player2_id) {
    if (m.winner_player_id === m.team1_player1_id || m.winner_player_id === m.team1_player2_id) return 1;
    if (m.winner_player_id === m.team2_player1_id || m.winner_player_id === m.team2_player2_id) return 2;
    return 0;
  }
  if (m.winner_player_id === m.player1_id) return 1;
  if (m.winner_player_id === m.player2_id) return 2;
  return 0;
}

export default function BracketDisplayPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tvMode, setTvMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [page, setPage] = useState(0);

  const refresh = async () => {
    const client = supabase;
    if (!client) return;
    const [cRes, mRes, pRes] = await Promise.all([
      client.from("competitions").select("id,name,sport_type,competition_format,best_of,knockout_round_best_of").eq("id", id).single(),
      client
        .from("matches")
        .select("id,round_no,match_no,best_of,status,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id")
        .eq("competition_id", id)
        .order("round_no")
        .order("match_no"),
      client.from("players").select("id,display_name,full_name"),
    ]);
    const matchIds = ((mRes.data ?? []) as Match[]).map((m) => m.id);
    if (matchIds.length) {
      const fRes = await client
        .from("frames")
        .select("match_id,winner_player_id,is_walkover_award")
        .in("match_id", matchIds);
      if (fRes.data) setFrames(fRes.data as Frame[]);
    } else {
      setFrames([]);
    }
    if (cRes.data) setCompetition(cRes.data as Competition);
    if (mRes.data) setMatches(mRes.data as Match[]);
    if (pRes.data) setPlayers(pRes.data as Player[]);
    if (cRes.error) setMessage(cRes.error.message);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [id]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      await document.exitFullscreen().catch(() => undefined);
    }
  };

  const nameMap = useMemo(
    () => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])),
    [players]
  );
  const round1MatchCount = useMemo(
    () => Math.max(1, matches.filter((m) => (m.round_no ?? 1) === 1).reduce((max, m) => Math.max(max, m.match_no ?? 1), 1)),
    [matches]
  );

  const getDisplayMatchNo = (roundNo: number, roundMatchNo: number) => {
    let offset = 0;
    for (let r = 1; r < roundNo; r += 1) {
      offset += Math.max(1, Math.floor(round1MatchCount / Math.pow(2, r - 1)));
    }
    return offset + roundMatchNo;
  };
  const bracketRounds = useMemo(() => {
    if (!competition || competition.competition_format !== "knockout") return [];
    const byKey = new Map<string, Match>();
    matches.forEach((m) => {
      byKey.set(`${m.round_no ?? 1}-${m.match_no ?? 1}`, m);
    });
    const totalRounds = Math.max(1, Math.log2(round1MatchCount * 2));
    const out: BracketNode[][] = [];
    for (let roundNo = 1; roundNo <= totalRounds; roundNo += 1) {
      const matchCount = Math.max(1, Math.floor(round1MatchCount / Math.pow(2, roundNo - 1)));
      const row: BracketNode[] = [];
      for (let matchNo = 1; matchNo <= matchCount; matchNo += 1) {
        const live = byKey.get(`${roundNo}-${matchNo}`);
        let p1 = nameMap.get(live?.player1_id ?? "") ?? "TBC";
        let p2 = nameMap.get(live?.player2_id ?? "") ?? "TBC";
        const status: BracketNode["status"] = live?.status ?? "tbc";
        let scoreText: string | null = null;
        let scoreLeft: number | null = null;
        let scoreRight: number | null = null;
        if (!live && roundNo > 1) {
          const prevA = byKey.get(`${roundNo - 1}-${(matchNo * 2) - 1}`);
          const prevB = byKey.get(`${roundNo - 1}-${matchNo * 2}`);
          const prevASide = prevA ? resolveWinnerSide(prevA) : 0;
          const prevBSide = prevB ? resolveWinnerSide(prevB) : 0;
          const prevAWinner = prevA && (prevA.status === "complete" || prevA.status === "bye") && prevASide
            ? (
                prevA.team1_player1_id || prevA.team2_player1_id
                  ? (
                      prevASide === 1
                        ? `${nameMap.get(prevA.team1_player1_id ?? "") ?? "TBC"} & ${nameMap.get(prevA.team1_player2_id ?? "") ?? "TBC"}`
                        : `${nameMap.get(prevA.team2_player1_id ?? "") ?? "TBC"} & ${nameMap.get(prevA.team2_player2_id ?? "") ?? "TBC"}`
                    )
                  : (nameMap.get(prevA.winner_player_id ?? "") ?? "TBC")
              )
            : "TBC";
          const prevBWinner = prevB && (prevB.status === "complete" || prevB.status === "bye") && prevBSide
            ? (
                prevB.team1_player1_id || prevB.team2_player1_id
                  ? (
                      prevBSide === 1
                        ? `${nameMap.get(prevB.team1_player1_id ?? "") ?? "TBC"} & ${nameMap.get(prevB.team1_player2_id ?? "") ?? "TBC"}`
                        : `${nameMap.get(prevB.team2_player1_id ?? "") ?? "TBC"} & ${nameMap.get(prevB.team2_player2_id ?? "") ?? "TBC"}`
                    )
                  : (nameMap.get(prevB.winner_player_id ?? "") ?? "TBC")
              )
            : "TBC";
          p1 = prevAWinner;
          p2 = prevBWinner;
        }
        if (status === "bye" && live?.player1_id && live.player1_id === live.player2_id) {
          p2 = "BYE";
        }
        if (live && (live.team1_player1_id || live.team2_player1_id)) {
          const t1a = nameMap.get(live.team1_player1_id ?? "") ?? "TBC";
          const t1b = nameMap.get(live.team1_player2_id ?? "") ?? "TBC";
          const t2a = nameMap.get(live.team2_player1_id ?? "") ?? "TBC";
          const t2b = nameMap.get(live.team2_player2_id ?? "") ?? "TBC";
          p1 = `${t1a} & ${t1b}`;
          p2 = `${t2a} & ${t2b}`;
        }
        if (live) {
          const allFrames = frames.filter((f) => f.match_id === live.id);
          const relevant = allFrames.filter((f) => !f.is_walkover_award);
          const isWalkover = allFrames.length > 0 && allFrames.every((f) => f.is_walkover_award);
          let team1 = 0;
          let team2 = 0;
          for (const f of relevant) {
            if (live.team1_player1_id || live.team2_player1_id) {
              const winTeam1 = f.winner_player_id === live.team1_player1_id || f.winner_player_id === live.team1_player2_id;
              const winTeam2 = f.winner_player_id === live.team2_player1_id || f.winner_player_id === live.team2_player2_id;
              if (winTeam1) team1 += 1;
              if (winTeam2) team2 += 1;
            } else {
              if (f.winner_player_id === live.player1_id) team1 += 1;
              if (f.winner_player_id === live.player2_id) team2 += 1;
            }
          }
          if (live.status === "bye") {
            const target = Math.floor((live.best_of ?? 1) / 2) + 1;
            team1 = target;
            team2 = 0;
          } else if (isWalkover) {
            const target = Math.floor((live.best_of ?? 1) / 2) + 1;
            const winnerIsTeam1 = live.winner_player_id === live.player1_id || live.winner_player_id === live.team1_player1_id || live.winner_player_id === live.team1_player2_id;
            team1 = winnerIsTeam1 ? target : 0;
            team2 = winnerIsTeam1 ? 0 : target;
          }
          scoreLeft = team1;
          scoreRight = team2;
          scoreText = `${team1}-${team2}`;
        }
        row.push({
          id: live?.id ?? `tbc-${roundNo}-${matchNo}`,
          roundNo,
          matchNo,
          bestOf: live?.best_of ?? getRoundBestOf(roundNo, totalRounds, competition.best_of, competition.knockout_round_best_of),
          status,
          p1,
          p2,
          scoreText,
          scoreLeft,
          scoreRight,
        });
      }
      out.push(row);
    }
    return out;
  }, [competition, matches, nameMap, round1MatchCount, frames]);
  const totalBracketRounds = bracketRounds.length;
  const roundsPerPage = tvMode ? 4 : totalBracketRounds;
  const totalPages = Math.max(1, Math.ceil(totalBracketRounds / roundsPerPage));
  const pagedRounds = useMemo(() => {
    if (totalBracketRounds <= roundsPerPage) return bracketRounds;
    const start = page * roundsPerPage;
    return bracketRounds.slice(start, start + roundsPerPage);
  }, [bracketRounds, page, roundsPerPage, totalBracketRounds]);

  const layout = useMemo(() => {
    const rows = Math.max(1, pagedRounds[0]?.length ?? 1);
    if (!tvMode) return { step: DEFAULT_STEP, card: DEFAULT_CARD_HEIGHT };
    const headerSpace = 220;
    const available = Math.max(400, viewportHeight - headerSpace);
    const step = Math.max(96, Math.floor(available / rows));
    const card = Math.max(72, Math.min(120, step - 20));
    return { step, card };
  }, [tvMode, viewportHeight, pagedRounds]);

  useEffect(() => {
    if (!tvMode || totalPages <= 1) return;
    const timer = window.setInterval(() => {
      setPage((p) => (p + 1) % totalPages);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [tvMode, totalPages]);

  const currentScoreRound = useMemo(() => {
    if (!matches.length) return 1;
    const byRound = new Map<number, Match[]>();
    for (const m of matches) {
      const r = m.round_no ?? 1;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r)!.push(m);
    }
    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    for (const r of rounds) {
      const list = byRound.get(r)!;
      const allDone = list.every((m) => m.status === "complete" || m.status === "bye");
      if (!allDone) return r;
    }
    return totalBracketRounds || 1;
  }, [matches, totalBracketRounds]);
  const completedRounds = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const m of matches) {
      const r = m.round_no ?? 1;
      const prev = map.get(r) ?? true;
      const done = m.status === "complete" || m.status === "bye";
      map.set(r, prev && done);
    }
    return map;
  }, [matches]);

  if (!competition) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-slate-200">
            {message ?? "Loading bracket..."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#111827] text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-slate-400">Tournament Bracket</p>
              <h1 className="text-3xl font-semibold">{competition.name}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setTvMode((v) => !v)} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                {tvMode ? "Standard View" : "TV Mode"}
              </button>
              <button type="button" onClick={toggleFullscreen} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <button type="button" onClick={refresh} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                Refresh
              </button>
              <button type="button" onClick={() => window.close()} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
                Close
              </button>
            </div>
          </div>

          <div className={`tv-scroll overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/70 shadow-sm ${tvMode ? "p-6" : "p-4"}`}>
            {totalPages > 1 ? (
              <div className="mb-3 flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => (p - 1 + totalPages) % totalPages)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => (p + 1) % totalPages)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1"
                  >
                    Next
                  </button>
                </div>
                <span>Page {page + 1} of {totalPages}</span>
              </div>
            ) : null}
            <div className="flex min-w-max gap-6 py-2 pr-10">
              {pagedRounds.map((round, roundIndex) => (
                <div key={roundIndex} className={`shrink-0 ${tvMode ? "w-64" : "w-72"}`}>
                  <h3 className={`mb-2 h-6 text-center font-semibold tracking-wide text-slate-200 ${tvMode ? "text-base" : "text-sm"}`}>
                    {getRoundLabel(roundIndex + 1 + (page * roundsPerPage), totalBracketRounds)}
                  </h3>
                  <div
                    className="relative"
                    style={{ height: `${Math.max(1, pagedRounds[0]?.length ?? 1) * layout.step}px` }}
                  >
                    {round.map((node) => {
                      const block = Math.pow(2, roundIndex);
                      const centerY = ((node.matchNo - 0.5) * block * layout.step);
                      const top = centerY - (layout.card / 2);
                      return (
                        <div key={`${node.roundNo}-${node.matchNo}`} className="absolute left-0 right-0" style={{ top: `${top}px` }}>
                          <article className={`rounded-2xl border border-slate-600 bg-gradient-to-br from-slate-900/90 to-slate-800/80 shadow-lg ${tvMode ? "p-3" : "p-3"}`} style={{ height: `${layout.card}px` }}>
                            {tvMode ? (
                              <div className="flex h-full items-center justify-between gap-3">
                                <div className="flex flex-col justify-center gap-1">
                                  <p className="text-base font-semibold text-white leading-tight">{node.p1}</p>
                                  <p className="text-xs uppercase tracking-wide text-slate-400">vs</p>
                                  <p className="text-base font-semibold text-white leading-tight">{node.p2}</p>
                                </div>
                                {node.roundNo === currentScoreRound || completedRounds.get(node.roundNo) ? (
                                  <div className="flex flex-col items-center justify-center rounded-lg border border-emerald-400/50 bg-emerald-500/25 px-3 py-2 text-sm font-semibold text-emerald-100">
                                    <span className="text-sm">{node.scoreLeft ?? 0}</span>
                                    <span className="text-[10px] text-emerald-100/80">-</span>
                                    <span className="text-sm">{node.scoreRight ?? 0}</span>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs font-semibold text-slate-300">
                                  Match {getDisplayMatchNo(node.roundNo, node.matchNo)}
                                </p>
                                <p className="mt-1 text-sm font-semibold text-white">{node.p1} vs {node.p2}</p>
                                <p className="mt-1 text-xs text-slate-300">Best of {node.bestOf}</p>
                                {node.scoreText ? (
                                  <p className="mt-1 text-xs text-emerald-200">Score {node.scoreText}</p>
                                ) : null}
                              </div>
                            )}
                          </article>
                          {roundIndex < pagedRounds.length - 1 ? (
                            <div className="pointer-events-none absolute -right-6 top-1/2 h-px w-6 -translate-y-1/2 bg-amber-300/80" />
                          ) : null}
                        </div>
                      );
                    })}
                    {roundIndex < pagedRounds.length - 1
                      ? Array.from({ length: Math.floor(round.length / 2) }, (_, pairIdx) => {
                          const a = (pairIdx * 2) + 1;
                          const b = a + 1;
                          const block = Math.pow(2, roundIndex);
                          const centerA = ((a - 0.5) * block * layout.step);
                          const centerB = ((b - 0.5) * block * layout.step);
                          return (
                            <div
                              key={`join-${roundIndex}-${pairIdx}`}
                              className="pointer-events-none absolute -right-6 w-px bg-amber-300/80"
                              style={{ top: `${centerA}px`, height: `${centerB - centerA}px` }}
                            />
                          );
                        })
                      : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <style jsx global>{`
            .tv-scroll::-webkit-scrollbar {
              height: 6px;
            }
            .tv-scroll::-webkit-scrollbar-track {
              background: rgba(15, 23, 42, 0.35);
            }
            .tv-scroll::-webkit-scrollbar-thumb {
              background: rgba(148, 163, 184, 0.5);
              border-radius: 6px;
            }
          `}</style>
      </div>
    </main>
  );
}
