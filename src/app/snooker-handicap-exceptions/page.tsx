"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import MessageModal from "@/components/MessageModal";
import { supabase } from "@/lib/supabase";

type PlayerRow = {
  id: string;
  display_name: string;
  full_name: string | null;
  location_id: string | null;
  age_band: string | null;
  snooker_handicap: number | null;
  snooker_handicap_base: number | null;
  rated_matches_snooker: number | null;
};

type AppUserRow = {
  id: string;
  email: string;
  linked_player_id: string | null;
};

type LocationRow = { id: string; name: string };
type CompetitionRow = { id: string; name: string; handicap_enabled: boolean | null; sport_type: string; competition_format: string };
type EntryRow = { id: string; player_id: string; competition_id: string; status: string };

function formatHandicap(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not set";
  if (value > 0) return `+${value}`;
  return String(value);
}

function seedRatingFromHandicap(handicap: number) {
  return Math.round(1000 - handicap * 5);
}

export default function SnookerHandicapExceptionsPage() {
  const admin = useAdminStatus();
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [appUsers, setAppUsers] = useState<AppUserRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [handicapByPlayerId, setHandicapByPlayerId] = useState<Record<string, string>>({});
  const [refreshingOfficial, setRefreshingOfficial] = useState(false);

  const load = async () => {
    const client = supabase;
    if (!client) return;

    const [playerRes, appUserRes, locationRes, competitionRes, entryRes] = await Promise.all([
      client
        .from("players")
        .select("id,display_name,full_name,location_id,age_band,snooker_handicap,snooker_handicap_base,rated_matches_snooker")
        .eq("is_archived", false)
        .order("display_name"),
      client.from("app_users").select("id,email,linked_player_id"),
      client.from("locations").select("id,name").order("name"),
      client.from("competitions").select("id,name,handicap_enabled,sport_type,competition_format"),
      client.from("competition_entries").select("id,player_id,competition_id,status"),
    ]);

    if (playerRes.error || appUserRes.error || locationRes.error || competitionRes.error || entryRes.error) {
      setMessage(
        playerRes.error?.message ||
          appUserRes.error?.message ||
          locationRes.error?.message ||
          competitionRes.error?.message ||
          entryRes.error?.message ||
          "Failed to load handicap exceptions."
      );
      return;
    }

    setPlayers(((playerRes.data ?? []) as unknown) as PlayerRow[]);
    setAppUsers(((appUserRes.data ?? []) as unknown) as AppUserRow[]);
    setLocations(((locationRes.data ?? []) as unknown) as LocationRow[]);
    setCompetitions(((competitionRes.data ?? []) as unknown) as CompetitionRow[]);
    setEntries(((entryRes.data ?? []) as unknown) as EntryRow[]);
  };

  useEffect(() => {
    void load();
  }, []);

  const locationNameById = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);
  const emailByPlayerId = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of appUsers) {
      if (user.linked_player_id && user.email) map.set(user.linked_player_id, user.email);
    }
    return map;
  }, [appUsers]);

  const handicappedCompetitionIds = useMemo(
    () =>
      new Set(
        competitions
          .filter((competition) => competition.sport_type === "snooker" && competition.handicap_enabled)
          .map((competition) => competition.id)
      ),
    [competitions]
  );

  const handicappedEntrySummaryByPlayerId = useMemo(() => {
    const map = new Map<string, { total: number; pending: number; approved: number }>();
    for (const entry of entries) {
      if (!handicappedCompetitionIds.has(entry.competition_id)) continue;
      const current = map.get(entry.player_id) ?? { total: 0, pending: 0, approved: 0 };
      current.total += 1;
      if (entry.status === "pending") current.pending += 1;
      if (entry.status === "approved") current.approved += 1;
      map.set(entry.player_id, current);
    }
    return map;
  }, [entries, handicappedCompetitionIds]);

  const exceptionRows = useMemo(() => {
    return [...players]
      .filter((player) => (player.snooker_handicap === null || player.snooker_handicap === undefined) && player.age_band !== "under_18")
      .map((player) => ({
        player,
        interest: handicappedEntrySummaryByPlayerId.get(player.id) ?? { total: 0, pending: 0, approved: 0 },
      }))
      .sort((a, b) => {
        if (b.interest.total !== a.interest.total) return b.interest.total - a.interest.total;
        const aName = a.player.full_name?.trim() || a.player.display_name;
        const bName = b.player.full_name?.trim() || b.player.display_name;
        return aName.localeCompare(bName);
      });
  }, [players, handicappedEntrySummaryByPlayerId]);

  const assignHandicap = async (player: PlayerRow) => {
    const raw = (handicapByPlayerId[player.id] ?? "").trim();
    if (!raw) {
      setMessage("Enter a starting snooker handicap first.");
      return;
    }
    const handicap = Number(raw);
    if (!Number.isInteger(handicap) || handicap % 4 !== 0) {
      setMessage("Snooker handicap must be a whole number in multiples of 4.");
      return;
    }

    const client = supabase;
    if (!client) return;
    const sessionRes = await client.auth.getSession();
    const token = sessionRes.data.session?.access_token;
    if (!token) {
      setMessage("You need to be signed in as the Super User to assign handicaps.");
      return;
    }

    setBusyId(player.id);
    setMessage(null);
    const res = await fetch("/api/admin/assign-snooker-handicap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ playerId: player.id, handicap }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; seededRating?: number | null };
    setBusyId(null);
    if (!res.ok) {
      setMessage(body.error ?? "Unable to assign snooker handicap.");
      return;
    }
    setHandicapByPlayerId((current) => ({ ...current, [player.id]: "" }));
    setMessage(
      `Assigned ${formatHandicap(handicap)} to ${player.full_name?.trim() || player.display_name}.`
        + (body.seededRating !== null && body.seededRating !== undefined ? ` Starting snooker Elo seeded at ${body.seededRating}.` : "")
    );
    await load();
  };

  const refreshOfficialSnookerRatings = async () => {
    const client = supabase;
    if (!client) return;
    const sessionRes = await client.auth.getSession();
    const token = sessionRes.data.session?.access_token;
    if (!token) {
      setMessage("You need to be signed in to refresh official snooker ratings.");
      return;
    }
    setRefreshingOfficial(true);
    setMessage(null);
    const res = await fetch("/api/rating/refresh-snooker-from-league", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; updated?: number };
    setRefreshingOfficial(false);
    if (!res.ok) {
      setMessage(body.error ?? "Failed to refresh official snooker ratings.");
      return;
    }
    setMessage(`Official snooker Elo and handicaps refreshed for ${body.updated ?? 0} mapped player(s).`);
    await load();
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Snooker Handicap Exceptions"
            eyebrow="System"
            subtitle="Allocate first-time snooker handicaps outside signup. New current, baseline, and starting Elo are seeded here."
          />
          <MessageModal message={message} onClose={() => setMessage(null)} />

          {!admin.loading && !admin.isSuper ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
              Super User access only.
            </section>
          ) : null}

          {admin.isSuper ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Players Needing Handicap</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{exceptionRows.length}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Handicapped Snooker Entries Waiting</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">
                      {exceptionRows.reduce((sum, row) => sum + row.interest.pending, 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Seed Rule</p>
                    <p className="mt-1 text-sm text-slate-700">Snooker Elo = 1000 - (handicap x 5)</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-cyan-900">Official league sync</p>
                    <p className="text-sm text-cyan-800">
                      Pull current official snooker Elo and handicap figures from the league app for all mapped club players.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshOfficialSnookerRatings()}
                    disabled={refreshingOfficial}
                    className="rounded-xl border border-cyan-300 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-60"
                  >
                    {refreshingOfficial ? "Refreshing..." : "Refresh official snooker Elo"}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-700">
                  Use this exceptions list when a new adult player registers without a snooker handicap. Assign the starting handicap once, and the
                  app will seed <strong>Current</strong>, <strong>Baseline</strong>, and starting <strong>Snooker Elo</strong>. After that, normal
                  Elo reviews can manage changes.
                </p>
              </section>

              <section className="space-y-3">
                {exceptionRows.map(({ player, interest }) => {
                  const label = player.full_name?.trim() || player.display_name;
                  const suggestedSeed = (handicapByPlayerId[player.id] ?? "").trim();
                  return (
                    <div key={player.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <p className="text-lg font-semibold text-slate-900">{label}</p>
                          <p className="text-sm text-slate-600">
                            {locationNameById.get(player.location_id ?? "") ?? "No location"} · {emailByPlayerId.get(player.id) ?? "No linked email"}
                          </p>
                          <p className="text-sm text-slate-600">
                            Rated snooker matches: {player.rated_matches_snooker ?? 0}
                            {interest.total ? ` · Handicapped snooker entries: ${interest.total}` : ""}
                            {interest.pending ? ` · Pending entry approvals: ${interest.pending}` : ""}
                          </p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[140px_auto] sm:items-center">
                          <input
                            type="number"
                            step={4}
                            value={handicapByPlayerId[player.id] ?? ""}
                            onChange={(event) =>
                              setHandicapByPlayerId((current) => ({ ...current, [player.id]: event.target.value }))
                            }
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200"
                            placeholder="e.g. +16"
                          />
                          <button
                            type="button"
                            disabled={busyId === player.id}
                            onClick={() => void assignHandicap(player)}
                            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                          >
                            {busyId === player.id ? "Assigning..." : "Set starting handicap"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          Current {formatHandicap(player.snooker_handicap)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          Baseline {formatHandicap(player.snooker_handicap_base)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          Seeded Elo {suggestedSeed && Number.isFinite(Number(suggestedSeed)) ? seedRatingFromHandicap(Number(suggestedSeed)) : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {!exceptionRows.length ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 shadow-sm">
                    No active adult players are currently missing a snooker handicap.
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
