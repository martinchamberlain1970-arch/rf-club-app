"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { supabase } from "@/lib/supabase";
import usePremiumStatus from "@/components/usePremiumStatus";
import useAdminStatus from "@/components/useAdminStatus";
import ScreenHeader from "@/components/ScreenHeader";
import { logAudit } from "@/lib/audit";
import ConfirmModal from "@/components/ConfirmModal";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";

type Sport = "snooker" | "pool_8_ball" | "pool_9_ball";
type Mode = "singles" | "doubles";
type CompetitionFormat = "knockout" | "league";
type Player = { id: string; display_name: string; full_name?: string | null };
type TeamPick = { player1: string; player2: string };
type Location = { id: string; name: string };
const BEST_OF_OPTIONS = [1, 3, 5, 7, 9, 11, 13, 15];

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export default function NewEventPage() {
  const router = useRouter();
  const premium = usePremiumStatus();
  const admin = useAdminStatus();
  const competitionCreateAllowed = admin.isAdmin || admin.isSuper;
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [sport, setSport] = useState<Sport>("pool_8_ball");
  const [competitionFormat, setCompetitionFormat] = useState<CompetitionFormat>("knockout");
  const [mode, setMode] = useState<Mode>("singles");
  const [bestOf, setBestOf] = useState("1");
  const [bestOfSemi, setBestOfSemi] = useState("5");
  const [bestOfFinal, setBestOfFinal] = useState("7");
  const [roundBestOfEnabled, setRoundBestOfEnabled] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [teams, setTeams] = useState<TeamPick[]>([
    { player1: "", player2: "" },
    { player1: "", player2: "" },
  ]);
  const [doublesSearch, setDoublesSearch] = useState("");
  const [activeDoublesSlot, setActiveDoublesSlot] = useState<{ team: number; slot: "player1" | "player2" } | null>(null);
  const [appAssignOpeningBreak, setAppAssignOpeningBreak] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupDeadline, setSignupDeadline] = useState("");
  const [signupMaxEntries, setSignupMaxEntries] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title: string; description: string } | null>(null);
  const [adminLocationId, setAdminLocationId] = useState<string | null>(null);
  const hasDraftChanges = !!(
    name.trim() ||
    venue.trim() ||
    locationId ||
    selected.length > 0 ||
    teams.some((t) => t.player1 || t.player2) ||
    bestOf !== "1" ||
    bestOfSemi !== "5" ||
    bestOfFinal !== "7" ||
    roundBestOfEnabled ||
    competitionFormat !== "knockout" ||
    mode !== "singles" ||
    appAssignOpeningBreak ||
    signupOpen ||
    signupDeadline ||
    signupMaxEntries
  );

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const load = async () => {
      const [{ data, error }, locRes, authRes] = await Promise.all([
        client.from("players").select("id,display_name,full_name").eq("is_archived", false).order("display_name"),
        client.from("locations").select("id,name").order("name"),
        client.auth.getUser(),
      ]);
      if (!active) return;
      if (error || !data) {
        setMessage(error?.message ?? "Failed to load players.");
        return;
      }
      setPlayers(data as Player[]);
      const currentUserId = authRes.data.user?.id ?? null;
      if (currentUserId) {
        const myPlayer = await client.from("players").select("location_id").eq("claimed_by", currentUserId).maybeSingle();
        if (!myPlayer.error) {
          setAdminLocationId(myPlayer.data?.location_id ?? null);
        }
      }
      if (!locRes.error && locRes.data) {
        const allLocations = locRes.data as Location[];
        if (admin.isSuper) {
          setLocations(allLocations);
        } else {
          const scoped = adminLocationId ? allLocations.filter((l) => l.id === adminLocationId) : allLocations;
          setLocations(scoped);
          if (adminLocationId) setLocationId(adminLocationId);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [admin.isSuper, adminLocationId]);

  const selectedCount = useMemo(() => selected.length, [selected.length]);
  const canUseAutoBreaker = !premium.loading && premium.unlocked;
  const canUseRoundBestOf = !premium.loading && premium.unlocked;
  const selectedTeamPlayers = useMemo(
    () => teams.flatMap((t) => [t.player1, t.player2]).filter(Boolean),
    [teams]
  );
  const isTeamPlayerTakenElsewhere = (
    candidateId: string,
    teamIndex: number,
    slot: "player1" | "player2"
  ) => {
    for (let i = 0; i < teams.length; i += 1) {
      if (i === teamIndex) {
        const otherSlot = slot === "player1" ? "player2" : "player1";
        if (teams[i][otherSlot] === candidateId) return true;
      } else if (teams[i].player1 === candidateId || teams[i].player2 === candidateId) {
        return true;
      }
    }
    return false;
  };

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const updateTeam = (idx: number, key: "player1" | "player2", value: string) => {
    setTeams((prev) => prev.map((t, i) => (i === idx ? { ...t, [key]: value } : t)));
  };

  const addTeam = () => setTeams((prev) => [...prev, { player1: "", player2: "" }]);
  const removeTeam = (idx: number) => {
    setTeams((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const createKnockoutMatches = (competitionId: string, best: number, ids: string[], appBreak: boolean) => {
    const bracketSize = nextPowerOfTwo(ids.length);
    const byeCount = bracketSize - ids.length;
    const rows: Array<{
      competition_id: string;
      round_no: number;
      match_no: number;
      best_of: number;
      status: "pending" | "bye";
      match_mode: "singles";
      player1_id: string;
      player2_id: string;
      opening_break_player_id: string | null;
      winner_player_id: string | null;
    }> = [];
    let matchNo = 1;

    // Assign BYEs directly to real players first, to avoid BYE vs BYE rows.
    for (let i = 0; i < byeCount; i += 1) {
      const playerId = ids[i];
      rows.push({
        competition_id: competitionId,
        round_no: 1,
        match_no: matchNo++,
        best_of: best,
        status: "bye",
        match_mode: "singles",
        // matches_mode_shape_ck requires both singles player columns to be non-null.
        player1_id: playerId,
        player2_id: playerId,
        opening_break_player_id: null,
        winner_player_id: playerId,
      });
    }

    const remaining = ids.slice(byeCount);
    for (let i = 0; i < remaining.length; i += 2) {
      rows.push({
        competition_id: competitionId,
        round_no: 1,
        match_no: matchNo++,
        best_of: best,
        status: "pending",
        match_mode: "singles",
        player1_id: remaining[i],
        player2_id: remaining[i + 1],
        opening_break_player_id: appBreak
          ? (Math.random() < 0.5 ? remaining[i] : remaining[i + 1])
          : null,
        winner_player_id: null,
      });
    }

    return rows;
  };

  const createKnockoutDoubles = (competitionId: string, best: number, picks: TeamPick[], appBreak: boolean) => {
    const rows: Array<{
      competition_id: string;
      round_no: number;
      match_no: number;
      best_of: number;
      status: "pending";
      match_mode: "doubles";
      team1_player1_id: string;
      team1_player2_id: string;
      team2_player1_id: string;
      team2_player2_id: string;
      opening_break_player_id: string | null;
      winner_player_id: string | null;
    }> = [];
    for (let i = 0; i < picks.length; i += 2) {
      const a = picks[i];
      const b = picks[i + 1];
      const breakChoices = [a.player1, a.player2, b.player1, b.player2];
      rows.push({
        competition_id: competitionId,
        round_no: 1,
        match_no: (i / 2) + 1,
        best_of: best,
        status: "pending",
        match_mode: "doubles",
        team1_player1_id: a.player1,
        team1_player2_id: a.player2,
        team2_player1_id: b.player1,
        team2_player2_id: b.player2,
        opening_break_player_id: appBreak ? breakChoices[Math.floor(Math.random() * breakChoices.length)] : null,
        winner_player_id: null,
      });
    }
    return rows;
  };

  const onCreate = async () => {
    setMessage(null);
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    if (!competitionCreateAllowed) {
      setMessage("Competition setup is available to the club administrator only.");
      return;
    }
    if (!locationId) {
      setMessage("Select a location before creating a competition.");
      return;
    }
    if (!admin.isSuper && !adminLocationId) {
      setMessage("Your admin profile must be linked to a location before creating competitions.");
      return;
    }
    if (!admin.isSuper && adminLocationId && locationId !== adminLocationId) {
      setMessage("Administrators can only create competitions at their own location.");
      return;
    }
    const best = Number(bestOf);
    const semi = Number(bestOfSemi);
    const final = Number(bestOfFinal);
    if (!name.trim()) {
      setMessage("Competition name is required.");
      return;
    }
    if (!Number.isInteger(best) || best < 1) {
      setMessage("Best Of must be a positive whole number.");
      return;
    }
    if (roundBestOfEnabled) {
      if (!premium.unlocked) {
        setMessage("Round-specific Best Of is a Premium feature.");
        return;
      }
      if (!Number.isInteger(semi) || semi < best) {
        setMessage("Semi-final Best Of must be a whole number and not less than opening round.");
        return;
      }
      if (!Number.isInteger(final) || final < semi) {
        setMessage("Final Best Of must be a whole number and not less than semi-final.");
        return;
      }
    }
    const validTeams = teams.filter((t) => t.player1 && t.player2);
    const uniqueTeamPlayerCount = new Set(selectedTeamPlayers).size;

    if (competitionFormat === "league" && mode === "doubles") {
      setMessage("League competition currently supports singles only.");
      return;
    }
    if (!signupOpen && mode === "singles" && selected.length < 2) {
      setMessage("Select at least 2 players.");
      return;
    }
    if (competitionFormat === "knockout" && mode === "doubles" && !signupOpen) {
      if (validTeams.length < 2) {
        setMessage("Create at least 2 doubles teams.");
        return;
      }
      if (selectedTeamPlayers.length !== uniqueTeamPlayerCount) {
        setMessage("Each doubles player can only be selected once.");
        return;
      }
      if ((validTeams.length & (validTeams.length - 1)) !== 0) {
        setMessage("Doubles knockout currently requires 2, 4, 8... teams (power of two).");
        return;
      }
    }
    if (competitionFormat === "knockout" && !premium.unlocked && mode === "singles" && selected.length > 4) {
      setMessage("Free tier supports knockout up to 4 players.");
      return;
    }
    if (!premium.unlocked && mode === "doubles") {
      setMessage("Doubles is a Premium feature.");
      return;
    }
    if (appAssignOpeningBreak && !canUseAutoBreaker) {
      setMessage("Auto-Select Opening Breaker is a Premium feature.");
      return;
    }
    if (!signupOpen && mode === "singles" && selected.length < 2) {
      setMessage(`${competitionFormat === "league" ? "League" : "Competition"} requires at least 2 players.`);
      return;
    }
    if (signupMaxEntries && Number.parseInt(signupMaxEntries, 10) <= 0) {
      setMessage("Max sign-up entries must be greater than zero.");
      return;
    }
    const knockoutRoundBestOf = canUseRoundBestOf && roundBestOfEnabled
      ? {
          round1: best,
          semi_final: semi,
          final,
        }
      : {};

    setSaving(true);
    const compRes = await client
      .from("competitions")
      .insert({
        name: name.trim(),
        venue: venue.trim() || null,
        location_id: locationId,
        sport_type: sport,
        competition_format: competitionFormat,
        best_of: best,
        match_mode: mode,
        is_practice: false,
        include_in_stats: true,
        app_assign_opening_break: appAssignOpeningBreak,
        knockout_round_best_of: knockoutRoundBestOf,
        signup_open: signupOpen,
        signup_deadline: signupDeadline ? new Date(signupDeadline).toISOString() : null,
        max_entries: signupMaxEntries ? Number.parseInt(signupMaxEntries, 10) : null,
        is_archived: false,
        is_completed: false,
      })
      .select("id")
      .single();

    if (compRes.error || !compRes.data) {
      setSaving(false);
      setMessage(compRes.error?.message ?? "Failed to create competition.");
      return;
    }
    const competitionId = compRes.data.id as string;
    const singlesReady = mode === "singles" && selected.length >= 2;
    const doublesReady = mode === "doubles" && validTeams.length >= 2;
    const matches =
      competitionFormat === "knockout"
        ? (mode === "singles"
            ? (singlesReady ? createKnockoutMatches(competitionId, best, selected, appAssignOpeningBreak) : [])
            : (doublesReady ? createKnockoutDoubles(competitionId, best, validTeams, appAssignOpeningBreak) : []))
        : [];

    if (matches.length > 0) {
      const mRes = await client.from("matches").insert(matches);
      if (mRes.error) {
        await client.from("competitions").delete().eq("id", competitionId);
        setSaving(false);
        setMessage(mRes.error.message);
        return;
      }
    }

    if (competitionFormat === "league" && mode === "singles" && selected.length > 0 && admin.userId) {
      const entryRows = selected.map((playerId) => ({
        competition_id: competitionId,
        requester_user_id: admin.userId as string,
        player_id: playerId,
        status: "approved" as const,
        reviewed_by_user_id: admin.userId as string,
        reviewed_at: new Date().toISOString(),
      }));
      const entryRes = await client.from("competition_entries").insert(entryRows);
      if (entryRes.error) {
        await client.from("competitions").delete().eq("id", competitionId);
        setSaving(false);
        setMessage(entryRes.error.message);
        return;
      }
    }

    await logAudit("competition_created", {
      entityType: "competition",
      entityId: competitionId,
      summary: `${name.trim()} created (${competitionFormat}, ${mode}, best of ${best}).`,
      meta: {
        sport,
        format: competitionFormat,
        mode,
        bestOf: best,
        roundSpecificBestOf: roundBestOfEnabled ? { semi: semi, final: final } : null,
        locationId,
        entrants: mode === "singles" ? selected.length : validTeams.length,
      },
    });

    setSaving(false);
    router.push("/events?tab=open");
  };

  const onCreateClick = () => {
    setCreateConfirmOpen(true);
  };

  const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const fieldClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900";
  const mutedCardClass = "rounded-xl border border-slate-200 bg-slate-50 p-3";
  const pillBaseClass = "rounded-xl px-3 py-1.5 text-sm font-medium transition";
  const pillActiveClass = `${pillBaseClass} border border-teal-700 bg-teal-700 text-white`;
  const pillIdleClass = `${pillBaseClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const primaryButtonClass = "rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60";
  const sportAccentClass =
    sport === "snooker"
      ? "rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-4"
      : sport === "pool_9_ball"
        ? "rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4"
        : "rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4";
  const competitionSummary = [
    { label: "Sport", value: sport === "snooker" ? "Snooker" : sport === "pool_9_ball" ? "Pool (9-ball)" : "Pool (8-ball)" },
    { label: "Competition", value: competitionFormat === "knockout" ? "Knockout" : "League" },
    { label: "Format", value: mode === "singles" ? "Singles" : "Doubles" },
    { label: "Opening round", value: `Best of ${bestOf}` },
    { label: "Entries", value: mode === "singles" ? `${selected.length} selected` : `${teams.filter((t) => t.player1 && t.player2).length} teams` },
  ];

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Create Competition"
            eyebrow="Competition"
            subtitle="Set up a club knockout or league competition for snooker and pool."
            warnOnNavigate={hasDraftChanges}
            warnMessage="You have unsaved competition setup. Leave this screen and lose your changes?"
          />

          {!admin.loading && !admin.isAdmin ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Competition setup is available to the club administrator only.
            </section>
          ) : null}

          {!admin.loading && !admin.isAdmin ? null : !competitionCreateAllowed ? null : (
          <section className={`${cardClass} space-y-4`}>
            <div className={sportAccentClass}>
              <p className="text-sm font-semibold text-slate-900">Competition setup</p>
              <p className="mt-1 text-sm text-slate-600">
                Choose the location, competition type, match format, and player list. Knockout builds fixtures immediately; league creates the club league shell and approved field.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {competitionSummary.map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/80 bg-white/80 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Competition name</label>
              <input className={fieldClass} placeholder="Competition name" value={name} onChange={(e) => setName(e.target.value)} />
              <p className="mt-1 text-xs text-slate-500">Use a short club-friendly title such as Friday Cup, Singles Ladder Night, or Winter Knockout.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Location</label>
              <select
                className={fieldClass}
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  const selected = locations.find((loc) => loc.id === e.target.value);
                  setVenue(selected?.name ?? "");
                }}
              >
                <option value="">Select location (required)</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Sport</label>
                <select className={fieldClass} value={sport} onChange={(e) => setSport(e.target.value as Sport)}>
                  <option value="pool_8_ball">Pool (8-ball)</option>
                  <option value="pool_9_ball">Pool (9-ball)</option>
                  <option value="snooker">Snooker</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Competition type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={competitionFormat === "knockout" ? pillActiveClass : pillIdleClass}
                    onClick={() => setCompetitionFormat("knockout")}
                  >
                    Knockout
                  </button>
                  <button
                    type="button"
                    className={competitionFormat === "league" ? pillActiveClass : pillIdleClass}
                    onClick={() => {
                      setCompetitionFormat("league");
                      setMode("singles");
                      setRoundBestOfEnabled(false);
                    }}
                  >
                    League
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Format</label>
                <div className="flex gap-2">
                  <button type="button" className={mode === "singles" ? pillActiveClass : pillIdleClass} onClick={() => setMode("singles")}>
                    Singles
                  </button>
                  <button
                    type="button"
                    className={mode === "doubles" ? pillActiveClass : pillIdleClass}
                    onClick={() => premium.unlocked && competitionFormat === "knockout" && setMode("doubles")}
                    disabled={!premium.unlocked || competitionFormat === "league"}
                  >
                    Doubles{competitionFormat === "league" ? " (Knockout only)" : premium.unlocked ? "" : " (Premium)"}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Match length</label>
                <select className={fieldClass} value={bestOf} onChange={(e) => setBestOf(e.target.value)}>
                  {BEST_OF_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      Best of {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {competitionFormat === "knockout" ? (
            <div className={mutedCardClass}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">Round-specific match lengths</p>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <span>Enable</span>
                  <input
                    type="checkbox"
                    checked={roundBestOfEnabled}
                    disabled={!canUseRoundBestOf}
                    onChange={(e) => setRoundBestOfEnabled(e.target.checked)}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Opening round</label>
                  <select
                    disabled={!roundBestOfEnabled}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:opacity-60"
                    value={bestOf}
                    onChange={(e) => setBestOf(e.target.value)}
                  >
                    {BEST_OF_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        Best of {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Semi-final</label>
                  <select
                    disabled={!roundBestOfEnabled || !premium.unlocked}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:opacity-60"
                    value={bestOfSemi}
                    onChange={(e) => setBestOfSemi(e.target.value)}
                  >
                    {BEST_OF_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        Best of {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Final</label>
                  <select
                    disabled={!roundBestOfEnabled || !premium.unlocked}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:opacity-60"
                    value={bestOfFinal}
                    onChange={(e) => setBestOfFinal(e.target.value)}
                  >
                    {BEST_OF_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        Best of {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {!premium.loading && !premium.unlocked ? (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Round-specific match lengths are a Premium feature.
                </p>
              ) : null}
            </div>
            ) : (
              <div className={mutedCardClass}>
                <p className="text-sm font-medium text-slate-700">League format</p>
                <p className="mt-1 text-sm text-slate-600">
                  Club leagues are created as a competition shell with an approved player field. League fixtures are managed inside the league competition rather than auto-building a knockout bracket.
                </p>
              </div>
            )}
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="text-sm font-medium text-slate-700">
                Auto-select opening breaker
                {!canUseAutoBreaker ? <span className="ml-2 text-xs text-amber-700">(Premium)</span> : null}
              </span>
              <input
                type="checkbox"
                checked={appAssignOpeningBreak}
                disabled={!canUseAutoBreaker}
                onChange={(e) => setAppAssignOpeningBreak(e.target.checked)}
              />
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">Open player sign-ups</span>
                <input type="checkbox" checked={signupOpen} onChange={(e) => setSignupOpen(e.target.checked)} />
              </div>
              {signupOpen ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Sign-up deadline (optional)</label>
                    <input
                      type="datetime-local"
                      className={fieldClass}
                      value={signupDeadline}
                      onChange={(e) => setSignupDeadline(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Maximum entries (optional)</label>
                    <input
                      type="number"
                      min={1}
                      className={fieldClass}
                      value={signupMaxEntries}
                      onChange={(e) => setSignupMaxEntries(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            {mode === "singles" ? (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Pick players ({selectedCount} selected)</p>
                <div className={`${mutedCardClass} space-y-2`}>
                  <input
                    className={fieldClass}
                    placeholder="Search players"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {selected.length === 0 ? (
                      <span className="text-xs text-slate-500">No players selected yet.</span>
                    ) : (
                      selected.map((id) => {
                        const p = players.find((x) => x.id === id);
                        const label = p?.full_name?.trim() ? p.full_name : p?.display_name ?? "Player";
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => toggle(id)}
                            className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700"
                          >
                            {label} ✕
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                    {players
                      .filter((p) => {
                        const label = (p.full_name?.trim() ? p.full_name : p.display_name).toLowerCase();
                        return label.includes(search.trim().toLowerCase());
                      })
                      .map((p) => {
                        const label = p.full_name?.trim() ? p.full_name : p.display_name;
                        const selectedRow = selected.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggle(p.id)}
                            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${selectedRow ? "bg-slate-50 text-slate-700" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            <span>{label}</span>
                            {selectedRow ? <span className="text-xs text-emerald-700">Selected</span> : null}
                          </button>
                        );
                      })}
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${mutedCardClass} space-y-3`}>
                <p className="text-sm font-medium text-slate-700">Build doubles teams ({teams.length})</p>
                {teams.map((t, idx) => (
                  <div key={`team-${idx}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    {(["player1", "player2"] as const).map((slot) => {
                      const value = t[slot];
                      const label = value
                        ? players.find((p) => p.id === value)?.full_name?.trim() ||
                          players.find((p) => p.id === value)?.display_name ||
                          "Player"
                        : `Team ${idx + 1} · ${slot === "player1" ? "Player 1" : "Player 2"}`;
                      return (
                        <button
                          key={`${idx}-${slot}`}
                          type="button"
                          onClick={() => setActiveDoublesSlot({ team: idx, slot })}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                            activeDoublesSlot?.team === idx && activeDoublesSlot.slot === slot
                              ? "border-teal-600 bg-teal-50 text-teal-900"
                              : "border-slate-300 bg-white text-slate-700"
                          }`}
                        >
                          <span>{label}</span>
                          {value ? (
                            <span
                              className="text-xs text-slate-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateTeam(idx, slot, "");
                              }}
                            >
                              ✕
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => removeTeam(idx)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
                      disabled={teams.length <= 2}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                  <input
                    className={fieldClass}
                    placeholder="Search players"
                    value={doublesSearch}
                    onChange={(e) => setDoublesSearch(e.target.value)}
                  />
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                    {players
                      .filter((p) => {
                        const label = (p.full_name?.trim() ? p.full_name : p.display_name).toLowerCase();
                        return label.includes(doublesSearch.trim().toLowerCase());
                      })
                      .map((p) => {
                        const label = p.full_name?.trim() ? p.full_name : p.display_name;
                        const disabled = !activeDoublesSlot || isTeamPlayerTakenElsewhere(p.id, activeDoublesSlot.team, activeDoublesSlot.slot);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => activeDoublesSlot && updateTeam(activeDoublesSlot.team, activeDoublesSlot.slot, p.id)}
                            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${
                              disabled ? "text-slate-400" : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span>{label}</span>
                            {isTeamPlayerTakenElsewhere(p.id, activeDoublesSlot?.team ?? 0, activeDoublesSlot?.slot ?? "player1") ? (
                              <span className="text-xs text-emerald-700">Selected</span>
                            ) : null}
                          </button>
                        );
                      })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addTeam}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  Add another team
                </button>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Ready to launch</p>
              <p className="mt-1 text-sm text-slate-600">
                {competitionFormat === "knockout"
                  ? "The app will create the competition shell and build the knockout event using the setup above."
                  : "The app will create the league competition and approve the selected player field using the setup above."}
              </p>
              <button type="button" onClick={onCreateClick} disabled={saving} className={`mt-3 ${primaryButtonClass}`}>
                {saving ? "Creating..." : "Create competition"}
              </button>
            </div>
            <MessageModal message={message} onClose={() => setMessage(null)} />
          </section>
          )}
        </RequireAuth>
        <ConfirmModal
          open={createConfirmOpen}
          title="Create this competition?"
          description={
            competitionFormat === "knockout"
              ? "This will create the knockout competition and take you to the event."
              : "This will create the league competition and take you to the event."
          }
          confirmLabel="Create Competition"
          cancelLabel="Cancel"
          onCancel={() => {
            setCreateConfirmOpen(false);
          }}
          onConfirm={async () => {
            setCreateConfirmOpen(false);
            await onCreate();
          }}
        />
        <InfoModal
          open={Boolean(infoModal)}
          title={infoModal?.title ?? ""}
          description={infoModal?.description ?? ""}
          onClose={() => setInfoModal(null)}
        />
      </div>
    </main>
  );
}
