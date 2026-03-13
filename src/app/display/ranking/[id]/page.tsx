"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  avatar_url?: string | null;
  rating_pool?: number | null;
  rating_snooker?: number | null;
  peak_rating_pool?: number | null;
  peak_rating_snooker?: number | null;
  rated_matches_pool?: number | null;
  rated_matches_snooker?: number | null;
};

export default function RankingDisplayPage() {
  const params = useParams();
  const playerId = String(params.id ?? "");
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const refresh = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const [playerRes, playersRes] = await Promise.all([
      client
        .from("players")
        .select("id,display_name,full_name,avatar_url,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker")
        .eq("id", playerId)
        .maybeSingle(),
      client
        .from("players")
        .select("id,display_name,full_name,avatar_url,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker")
        .eq("is_archived", false),
    ]);
    if (playerRes.error || !playerRes.data) {
      setMessage(playerRes.error?.message ?? "Player profile not found.");
      setLoading(false);
      return;
    }
    setPlayer(playerRes.data as Player);
    setPlayers((playersRes.data ?? []) as Player[]);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await refresh();
    };
    run();

    const client = supabase;
    if (!client) return () => {
      active = false;
    };

    const channel = client
      .channel(`display-ranking-${playerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players" },
        () => {
          run();
        }
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [playerId]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      await document.exitFullscreen().catch(() => undefined);
    }
  };

  const card = useMemo(() => {
    if (!player) return null;
    const byPool = [...players].sort((a, b) => (b.rating_pool ?? 1000) - (a.rating_pool ?? 1000));
    const bySnooker = [...players].sort((a, b) => (b.rating_snooker ?? 1000) - (a.rating_snooker ?? 1000));
    return {
      totalPlayers: players.length,
      poolRank: Math.max(1, byPool.findIndex((p) => p.id === player.id) + 1),
      snookerRank: Math.max(1, bySnooker.findIndex((p) => p.id === player.id) + 1),
      poolRating: player.rating_pool ?? 1000,
      snookerRating: player.rating_snooker ?? 1000,
      poolPeak: player.peak_rating_pool ?? 1000,
      snookerPeak: player.peak_rating_snooker ?? 1000,
      poolMatches: player.rated_matches_pool ?? 0,
      snookerMatches: player.rated_matches_snooker ?? 0,
    };
  }, [player, players]);

  const playerName = player?.full_name?.trim() ? player.full_name : player?.display_name ?? "Player";

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">Ranking Card</p>
            <h1 className="text-3xl font-semibold text-white">{playerName}</h1>
          </div>
          <div className="flex items-center gap-2">
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

        {loading ? <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-slate-200">Loading ranking...</p> : null}
        {message ? <p className="rounded-xl border border-amber-400/60 bg-amber-500/20 p-4 text-amber-100">{message}</p> : null}

        {card && player ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 overflow-hidden rounded-full border border-slate-700 bg-slate-900">
                {player.avatar_url ? <img src={player.avatar_url} alt={playerName} className="h-full w-full object-cover" /> : null}
              </div>
              <div>
                <p className="text-3xl font-semibold text-white">{playerName}</p>
                <p className="text-sm text-slate-300">Active players ranked: {card.totalPlayers}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-300">Pool</p>
                <p className="mt-2 text-5xl font-bold text-white">{Math.round(card.poolRating)}</p>
                <p className="mt-2 text-lg text-emerald-300">Rank #{card.poolRank}</p>
                <p className="mt-1 text-sm text-slate-300">Peak {Math.round(card.poolPeak)} · Rated matches {card.poolMatches}</p>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-300">Snooker</p>
                <p className="mt-2 text-5xl font-bold text-white">{Math.round(card.snookerRating)}</p>
                <p className="mt-2 text-lg text-emerald-300">Rank #{card.snookerRank}</p>
                <p className="mt-1 text-sm text-slate-300">Peak {Math.round(card.snookerPeak)} · Rated matches {card.snookerMatches}</p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">
              Rating uses an Elo-style model: expected result from ratings, then updated after approved completed matches.
              Upsets move rating more than expected wins. BYE and walkover outcomes are excluded.
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

