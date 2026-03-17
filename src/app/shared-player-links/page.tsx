"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";
import { supabase } from "@/lib/supabase";

type ClubPlayer = {
  id: string;
  display_name: string;
  full_name: string | null;
  location_name: string | null;
  linked_email: string | null;
};

type LeaguePlayer = {
  id: string;
  display_name: string;
  full_name: string | null;
  location_name: string | null;
  linked_email: string | null;
};

type ExistingLink = {
  source_player_id: string;
  league_player_id: string;
  source_app: "club";
};

type Suggestion = {
  clubPlayer: ClubPlayer;
  leaguePlayer: LeaguePlayer;
  score: number;
  confidence: "High" | "Medium" | "Low";
  matchedCount: number;
  totalFields: number;
  matchedFields: string[];
};

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function firstName(value: string) {
  return normalize(value).split(" ")[0] ?? "";
}

function surname(value: string) {
  const parts = normalize(value).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function buildSuggestion(clubPlayer: ClubPlayer, leaguePlayer: LeaguePlayer): Suggestion | null {
  const clubName = clubPlayer.full_name?.trim() || clubPlayer.display_name;
  const leagueName = leaguePlayer.full_name?.trim() || leaguePlayer.display_name;
  const clubNorm = normalize(clubName);
  const leagueNorm = normalize(leagueName);
  const clubSurname = surname(clubName);
  const leagueSurname = surname(leagueName);
  if (!clubSurname || !leagueSurname || clubSurname !== leagueSurname) return null;

  let score = 0;
  const matchedFields: string[] = [];
  let matchedCount = 0;
  const totalFields = 4;

  if (clubNorm === leagueNorm) {
    score += 70;
    matchedFields.push("Exact name");
    matchedCount += 1;
  } else if (firstName(clubName) === firstName(leagueName)) {
    score += 35;
    matchedFields.push("Surname + first name");
    matchedCount += 1;
  } else {
    score -= 15;
  }

  if (clubPlayer.linked_email && leaguePlayer.linked_email) {
    if (normalize(clubPlayer.linked_email) === normalize(leaguePlayer.linked_email)) {
      score += 40;
      matchedFields.push("Linked email");
      matchedCount += 1;
    } else {
      score -= 10;
    }
  }

  if (clubPlayer.location_name && leaguePlayer.location_name) {
    if (normalize(clubPlayer.location_name) === normalize(leaguePlayer.location_name)) {
      score += 15;
      matchedFields.push("Club/location");
      matchedCount += 1;
    } else {
      score -= 5;
    }
  }

  const clubDisplay = normalize(clubPlayer.display_name);
  const leagueDisplay = normalize(leaguePlayer.display_name);
  if (clubDisplay && leagueDisplay && clubDisplay === leagueDisplay) {
    score += 10;
    matchedFields.push("Display name");
    matchedCount += 1;
  }

  if (score < 35) return null;
  const confidence: Suggestion["confidence"] = score >= 80 ? "High" : score >= 55 ? "Medium" : "Low";
  return { clubPlayer, leaguePlayer, score, confidence, matchedCount, totalFields, matchedFields };
}

export default function SharedPlayerLinksPage() {
  const [clubPlayers, setClubPlayers] = useState<ClubPlayer[]>([]);
  const [leaguePlayers, setLeaguePlayers] = useState<LeaguePlayer[]>([]);
  const [existingLinks, setExistingLinks] = useState<ExistingLink[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    const client = supabase;
    if (!client) return;
    const sessionRes = await client.auth.getSession();
    const token = sessionRes.data.session?.access_token;
    if (!token) {
      setMessage("You need to be signed in as Super User.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/rating/shared-link-candidates", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      clubPlayers?: ClubPlayer[];
      leaguePlayers?: LeaguePlayer[];
      existingLinks?: ExistingLink[];
    };
    setLoading(false);
    if (!res.ok) {
      setMessage(body.error ?? "Failed to load shared player link candidates.");
      return;
    }
    setClubPlayers(body.clubPlayers ?? []);
    setLeaguePlayers(body.leaguePlayers ?? []);
    setExistingLinks(body.existingLinks ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const leagueById = useMemo(() => new Map(leaguePlayers.map((player) => [player.id, player])), [leaguePlayers]);
  const clubById = useMemo(() => new Map(clubPlayers.map((player) => [player.id, player])), [clubPlayers]);
  const linkedClubIds = useMemo(() => new Set(existingLinks.map((link) => link.source_player_id)), [existingLinks]);
  const linkedLeagueIds = useMemo(() => new Set(existingLinks.map((link) => link.league_player_id)), [existingLinks]);

  const suggestions = useMemo(() => {
    return clubPlayers
      .filter((clubPlayer) => !linkedClubIds.has(clubPlayer.id))
      .flatMap((clubPlayer) =>
        leaguePlayers
          .filter((leaguePlayer) => !linkedLeagueIds.has(leaguePlayer.id))
          .map((leaguePlayer) => buildSuggestion(clubPlayer, leaguePlayer))
          .filter((row): row is Suggestion => Boolean(row))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
      )
      .sort((a, b) => b.score - a.score);
  }, [clubPlayers, leaguePlayers, linkedClubIds, linkedLeagueIds]);

  const createLink = async (clubPlayerId: string, leaguePlayerId: string) => {
    const client = supabase;
    if (!client) return;
    const sessionRes = await client.auth.getSession();
    const token = sessionRes.data.session?.access_token;
    if (!token) {
      setMessage("You need to be signed in as Super User.");
      return;
    }
    setBusyKey(`${clubPlayerId}:${leaguePlayerId}`);
    const res = await fetch("/api/rating/link-player", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clubPlayerId, leaguePlayerId }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyKey(null);
    if (!res.ok) {
      setMessage(body.error ?? "Failed to create shared player link.");
      return;
    }
    setMessage("Shared Elo link created.");
    await load();
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Shared Player Links"
            eyebrow="System"
            subtitle="Link club players to league players so official snooker Elo stays aligned across both apps."
          />
          <MessageModal message={message} onClose={() => setMessage(null)} />

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Existing Links</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{existingLinks.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unlinked Club Players</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{clubPlayers.filter((p) => !linkedClubIds.has(p.id)).length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Suggested Links</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{suggestions.length}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-700">
              Suggestions are ranked by exact name, linked email, club/location, and display name. Each row shows confidence plus how many key fields matched exactly.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Suggested Links</h2>
            {loading ? <p className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">Loading suggestions...</p> : null}
            {!loading && suggestions.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-slate-600">No link suggestions at the moment.</p>
            ) : null}
            {suggestions.map((suggestion) => (
              <article key={`${suggestion.clubPlayer.id}:${suggestion.leaguePlayer.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="grid flex-1 gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Club app</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{suggestion.clubPlayer.full_name?.trim() || suggestion.clubPlayer.display_name}</p>
                      <p className="text-sm text-slate-600">{suggestion.clubPlayer.location_name ?? "No location"}</p>
                      <p className="text-sm text-slate-600">{suggestion.clubPlayer.linked_email ?? "No linked email"}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">League app</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{suggestion.leaguePlayer.full_name?.trim() || suggestion.leaguePlayer.display_name}</p>
                      <p className="text-sm text-slate-600">{suggestion.leaguePlayer.location_name ?? "No location"}</p>
                      <p className="text-sm text-slate-600">{suggestion.leaguePlayer.linked_email ?? "No linked email"}</p>
                    </div>
                  </div>
                  <div className="min-w-[240px] rounded-2xl border border-cyan-200 bg-cyan-50 p-3">
                    <p className="text-sm font-semibold text-cyan-900">
                      Confidence: {suggestion.confidence} ({suggestion.score})
                    </p>
                    <p className="mt-1 text-sm text-cyan-800">
                      Matched {suggestion.matchedCount} of {suggestion.totalFields} key fields
                    </p>
                    <p className="mt-2 text-sm text-cyan-800">Matches: {suggestion.matchedFields.join(", ") || "None"}</p>
                    <button
                      type="button"
                      onClick={() => void createLink(suggestion.clubPlayer.id, suggestion.leaguePlayer.id)}
                      disabled={busyKey === `${suggestion.clubPlayer.id}:${suggestion.leaguePlayer.id}`}
                      className="mt-3 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {busyKey === `${suggestion.clubPlayer.id}:${suggestion.leaguePlayer.id}` ? "Linking..." : "Create link"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Existing Links</h2>
            {existingLinks.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-slate-600">No shared player links yet.</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Club player</th>
                      <th className="px-4 py-3 font-semibold">League player</th>
                      <th className="px-4 py-3 font-semibold">Club email</th>
                      <th className="px-4 py-3 font-semibold">League email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {existingLinks.map((link) => {
                      const clubPlayer = clubById.get(link.source_player_id);
                      const leaguePlayer = leagueById.get(link.league_player_id);
                      return (
                        <tr key={`${link.source_player_id}:${link.league_player_id}`} className="bg-white">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{clubPlayer?.full_name?.trim() || clubPlayer?.display_name || link.source_player_id}</p>
                            <p className="text-slate-500">{clubPlayer?.location_name ?? "No location"}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{leaguePlayer?.full_name?.trim() || leaguePlayer?.display_name || link.league_player_id}</p>
                            <p className="text-slate-500">{leaguePlayer?.location_name ?? "No location"}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{clubPlayer?.linked_email ?? "No linked email"}</td>
                          <td className="px-4 py-3 text-slate-600">{leaguePlayer?.linked_email ?? "No linked email"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
