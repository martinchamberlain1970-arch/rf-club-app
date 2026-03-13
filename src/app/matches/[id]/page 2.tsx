"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import { supabase } from "@/lib/supabase";

type Match = {
  id: string;
  competition_id: string;
  best_of: number;
  status: "pending" | "in_progress" | "complete" | "bye";
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
};

type Player = { id: string; display_name: string };
type Competition = { id: string; name: string; sport_type: "snooker" | "pool_8_ball" };

export default function MatchPage() {
  const params = useParams();
  const matchId = String(params.id ?? "");
  const [match, setMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    let active = true;
    const load = async () => {
      const mRes = await client.from("matches").select("*").eq("id", matchId).single();
      if (!active) return;
      if (mRes.error || !mRes.data) {
        setMessage(mRes.error?.message ?? "Failed to load match.");
        return;
      }
      const m = mRes.data as Match;
      setMatch(m);
      const [pRes, cRes] = await Promise.all([
        client.from("players").select("id,display_name"),
        client.from("competitions").select("id,name,sport_type").eq("id", m.competition_id).single(),
      ]);
      if (!active) return;
      if (pRes.data) setPlayers(pRes.data as Player[]);
      if (cRes.data) setCompetition(cRes.data as Competition);
    };
    load();
    return () => {
      active = false;
    };
  }, [matchId]);

  const nameMap = useMemo(() => new Map(players.map((p) => [p.id, p.display_name])), [players]);
  const vsLabel = useMemo(() => {
    if (!match) return "";
    if (match.match_mode === "doubles") {
      const t1 = `${nameMap.get(match.team1_player1_id ?? "") ?? "TBC"} & ${nameMap.get(match.team1_player2_id ?? "") ?? "TBC"}`;
      const t2 = `${nameMap.get(match.team2_player1_id ?? "") ?? "TBC"} & ${nameMap.get(match.team2_player2_id ?? "") ?? "TBC"}`;
      return `${t1} vs ${t2}`;
    }
    return `${nameMap.get(match.player1_id ?? "") ?? "TBC"} vs ${nameMap.get(match.player2_id ?? "") ?? "TBC"}`;
  }, [match, nameMap]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold text-slate-900">Match</h1>
            <PageNav />
          </div>
          {message ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">{message}</p> : null}
          {match ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-600">{competition?.name ?? "Event"}</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">{vsLabel}</p>
              <p className="mt-1 text-slate-700">Best of {match.best_of} {competition?.sport_type === "snooker" ? "frames" : "racks"}</p>
              <p className="mt-1 text-slate-700">Status: {match.status}</p>
              <p className="mt-3 text-sm text-slate-600">Scoring screen is next step in the rebuild.</p>
            </section>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
