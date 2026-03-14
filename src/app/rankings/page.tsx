"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";

type DisciplineFilter = "snooker" | "pool";
type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  is_archived?: boolean;
  location_id?: string | null;
  rating_pool?: number | null;
  rating_snooker?: number | null;
  peak_rating_pool?: number | null;
  peak_rating_snooker?: number | null;
  rated_matches_pool?: number | null;
  rated_matches_snooker?: number | null;
};
type Location = { id: string; name: string };

export default function RankingsPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [discipline, setDiscipline] = useState<DisciplineFilter>("snooker");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    const run = async () => {
      const [playerRes, locationRes] = await Promise.all([
        client
          .from("players")
          .select(
            "id,display_name,full_name,is_archived,location_id,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker"
          )
          .eq("is_archived", false),
        client.from("locations").select("id,name").order("name"),
      ]);

      if (!active) return;
      if (playerRes.error || locationRes.error) {
        setMessage(playerRes.error?.message || locationRes.error?.message || "Failed to load rankings.");
        return;
      }
      setPlayers((playerRes.data ?? []) as Player[]);
      setLocations((locationRes.data ?? []) as Location[]);
    };

    run();
    return () => {
      active = false;
    };
  }, []);

  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);
  const filteredPlayers = useMemo(() => {
    const visible = locationFilter === "all" ? players : players.filter((player) => player.location_id === locationFilter);
    return [...visible].sort((a, b) => {
      const aRating = discipline === "snooker" ? a.rating_snooker ?? 1000 : a.rating_pool ?? 1000;
      const bRating = discipline === "snooker" ? b.rating_snooker ?? 1000 : b.rating_pool ?? 1000;
      if (bRating !== aRating) return bRating - aRating;
      return (a.full_name?.trim() || a.display_name).localeCompare(b.full_name?.trim() || b.display_name);
    });
  }, [discipline, locationFilter, players]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Player Rankings"
            eyebrow="Stats"
            subtitle="Elo-style leaderboards for active players, with discipline and location filters."
          />
          {message ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">{message}</p> : null}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[180px] flex-col gap-1 text-sm text-slate-700">
                Discipline
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={discipline}
                  onChange={(e) => setDiscipline(e.target.value as DisciplineFilter)}
                >
                  <option value="snooker">Snooker</option>
                  <option value="pool">Pool (8-ball and 9-ball)</option>
                </select>
              </label>
              <label className="flex min-w-[220px] flex-col gap-1 text-sm text-slate-700">
                Location
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                >
                  <option value="all">All locations</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Ratings use the current Elo-style values stored on each player profile. Singles results feed the rating model; doubles, BYE, and walkover outcomes are excluded.
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {discipline === "snooker" ? "Snooker" : "Pool"} rankings
              </p>
              <p className="text-sm text-slate-600">{filteredPlayers.length} active players</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-white">
                  <tr className="text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">Rank</th>
                    <th className="px-4 py-3 font-medium">Player</th>
                    <th className="px-4 py-3 font-medium">Location</th>
                    <th className="px-4 py-3 font-medium">Rating</th>
                    <th className="px-4 py-3 font-medium">Peak</th>
                    <th className="px-4 py-3 font-medium">Rated matches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredPlayers.map((player, index) => {
                    const rating = discipline === "snooker" ? player.rating_snooker ?? 1000 : player.rating_pool ?? 1000;
                    const peak = discipline === "snooker" ? player.peak_rating_snooker ?? 1000 : player.peak_rating_pool ?? 1000;
                    const ratedMatches =
                      discipline === "snooker" ? player.rated_matches_snooker ?? 0 : player.rated_matches_pool ?? 0;
                    const playerName = player.full_name?.trim() ? player.full_name : player.display_name;
                    return (
                      <tr key={player.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">#{index + 1}</td>
                        <td className="px-4 py-3">
                          <Link href={`/players/${player.id}`} className="font-medium text-teal-700 underline">
                            {playerName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{locationMap.get(player.location_id ?? "") ?? "Not set"}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{Math.round(rating)}</td>
                        <td className="px-4 py-3 text-slate-600">{Math.round(peak)}</td>
                        <td className="px-4 py-3 text-slate-600">{ratedMatches}</td>
                      </tr>
                    );
                  })}
                  {!filteredPlayers.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        No players match the current ranking filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
