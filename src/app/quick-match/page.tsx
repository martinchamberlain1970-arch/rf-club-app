"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import useAdminStatus from "@/components/useAdminStatus";
import usePremiumStatus from "@/components/usePremiumStatus";
import useFeatureAccess from "@/components/useFeatureAccess";
import { supabase } from "@/lib/supabase";
import ScreenHeader from "@/components/ScreenHeader";
import { logAudit } from "@/lib/audit";
import ConfirmModal from "@/components/ConfirmModal";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";

type Player = { id: string; display_name: string; full_name: string | null; avatar_url?: string | null };
type Location = { id: string; name: string };
type Sport = "snooker" | "pool_8_ball";
type Mode = "singles" | "doubles";
const BEST_OF_OPTIONS = [1, 3, 5, 7, 9, 11, 13, 15];

export default function QuickMatchPage() {
  const router = useRouter();
  const admin = useAdminStatus();
  const premium = usePremiumStatus();
  const features = useFeatureAccess();
  const [players, setPlayers] = useState<Player[]>([]);
  const [singlesSelected, setSinglesSelected] = useState<string[]>([]);
  const [singlesSearch, setSinglesSearch] = useState("");
  const [team1Player1, setTeam1Player1] = useState("");
  const [team1Player2, setTeam1Player2] = useState("");
  const [team2Player1, setTeam2Player1] = useState("");
  const [team2Player2, setTeam2Player2] = useState("");
  const [name, setName] = useState("Practice match");
  const [sport, setSport] = useState<Sport>("pool_8_ball");
  const [mode, setMode] = useState<Mode>("singles");
  const [bestOf, setBestOf] = useState("1");
  const [appAssignOpeningBreak, setAppAssignOpeningBreak] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
  const [doublesSearch, setDoublesSearch] = useState("");
  const [activeDoublesSlot, setActiveDoublesSlot] = useState<"t1p1" | "t1p2" | "t2p1" | "t2p2" | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title: string; description: string } | null>(null);
  const quickMatchAllowed = admin.isSuper || (admin.isAdmin && features.quickMatchEnabled);
  const hasAdminPower = quickMatchAllowed;
  const player1 = singlesSelected[0] ?? "";
  const player2 = singlesSelected[1] ?? "";
  const hasDraftChanges = !!(
    name.trim() !== "Practice match" ||
    sport !== "pool_8_ball" ||
    mode !== "singles" ||
    bestOf !== "1" ||
    appAssignOpeningBreak ||
    player1 ||
    player2 ||
    team1Player1 ||
    team1Player2 ||
    team2Player1 ||
    team2Player2
  );

  const doublesSlots = [team1Player1, team1Player2, team2Player1, team2Player2];
  const doublesComplete = doublesSlots.every(Boolean);
  const doublesDistinct = new Set(doublesSlots.filter(Boolean)).size === 4;
  const singlesComplete = singlesSelected.length === 2;
  const canCreate =
    hasAdminPower ||
    (Boolean(linkedPlayerId) &&
      (mode === "singles" ? singlesComplete : doublesComplete && doublesDistinct));
  const canUseAutoBreaker = !premium.loading && premium.unlocked;

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const load = async () => {
      const { data: userRes } = await client.auth.getUser();
      const uid = userRes.user?.id ?? null;
      if (uid) {
        const { data: appUser } = await client.from("app_users").select("linked_player_id").eq("id", uid).maybeSingle();
        const linkedId = appUser?.linked_player_id ?? null;
        if (linkedId) {
          setLinkedPlayerId(linkedId);
        } else {
          const { data: linked } = await client
            .from("players")
            .select("id")
            .eq("claimed_by", uid)
            .maybeSingle();
          setLinkedPlayerId(linked?.id ?? null);
        }
      }
      const { data, error } = await client.from("players").select("id,display_name,full_name,avatar_url").eq("is_archived", false).order("display_name");
      const locRes = await client.from("locations").select("id,name").order("name");
      if (!active) return;
      if (error || !data) {
        setMessage(error?.message ?? "Failed to load players.");
        return;
      }
      setPlayers(data as Player[]);
      if (!locRes.error && locRes.data) {
        setLocations(locRes.data as Location[]);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const doublesTaken = useMemo(
    () => [team1Player1, team1Player2, team2Player1, team2Player2].filter(Boolean),
    [team1Player1, team1Player2, team2Player1, team2Player2]
  );

  const setDoublesSlot = (slot: "t1p1" | "t1p2" | "t2p1" | "t2p2", value: string) => {
    if (slot === "t1p1") setTeam1Player1(value);
    if (slot === "t1p2") setTeam1Player2(value);
    if (slot === "t2p1") setTeam2Player1(value);
    if (slot === "t2p2") setTeam2Player2(value);
  };

  const onCreate = async () => {
    setMessage(null);
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    if (!quickMatchAllowed) {
      setMessage("Quick Match is disabled for your account. Ask the Super User to enable it.");
      return;
    }
    if (!hasAdminPower && !linkedPlayerId) {
      setMessage("Complete the profile check to link your player profile before creating a quick match.");
      return;
    }
    if (!locationId) {
      setMessage("Select a location before creating a quick match.");
      return;
    }
    if (!premium.loading && !premium.unlocked && mode === "doubles") {
      setMessage("Doubles is a Premium feature.");
      return;
    }
    if (appAssignOpeningBreak && !canUseAutoBreaker) {
      setMessage("Auto-Select Opening Breaker is a Premium feature.");
      return;
    }
    const best = Number(bestOf);
    if (!Number.isInteger(best) || best < 1) {
      setMessage("Best Of must be a positive whole number.");
      return;
    }
    if (mode === "singles" && !canCreate) {
      setMessage("Select Player 1 and Player 2 (different players).");
      return;
    }
    if (mode === "doubles") {
      if (!doublesComplete) {
        setMessage("Select 2 players per team.");
        return;
      }
      if (!doublesDistinct) {
        setMessage("Each doubles player can only be selected once.");
        return;
      }
    }
    setSaving(true);
    const selectedLocation = locations.find((l) => l.id === locationId);
    const compRes = await client
      .from("competitions")
      .insert({
        name: name.trim() || "Practice match",
        venue: selectedLocation?.name ?? null,
        location_id: locationId,
        sport_type: sport,
        competition_format: "knockout",
        best_of: best,
        match_mode: mode,
        is_practice: true,
        include_in_stats: true,
        app_assign_opening_break: appAssignOpeningBreak,
        knockout_round_best_of: {},
        is_archived: false,
        is_completed: false,
      })
      .select("id")
      .single();

    if (compRes.error || !compRes.data) {
      setSaving(false);
      setMessage(compRes.error?.message ?? "Failed to create quick match.");
      return;
    }

    const competitionId = compRes.data.id as string;
    const base = {
      competition_id: competitionId,
      round_no: 1,
      match_no: 1,
      best_of: best,
      status: "pending",
      match_mode: mode,
      opening_break_player_id: null as string | null,
    };
    const payload =
      mode === "singles"
        ? {
            ...base,
            player1_id: player1,
            player2_id: player2,
            opening_break_player_id: appAssignOpeningBreak
              ? ((best + player1.length + player2.length) % 2 === 0 ? player1 : player2)
              : null,
          }
        : {
            ...base,
            team1_player1_id: team1Player1,
            team1_player2_id: team1Player2,
            team2_player1_id: team2Player1,
            team2_player2_id: team2Player2,
            opening_break_player_id: appAssignOpeningBreak
              ? [team1Player1, team1Player2, team2Player1, team2Player2][(best + team1Player1.length + team2Player2.length) % 4]
              : null,
          };

    const matchRes = await client.from("matches").insert(payload).select("id").single();
    if (matchRes.error || !matchRes.data) {
      await client.from("competitions").delete().eq("id", competitionId);
      setSaving(false);
      setMessage(matchRes.error?.message ?? "Failed to create match fixture.");
      return;
    }

    await logAudit("quick_match_created", {
      entityType: "competition",
      entityId: competitionId,
      summary: `Quick match created (${mode}, best of ${best}).`,
      meta: { sport, mode, bestOf: best, locationId, matchId: matchRes.data.id as string },
    });

    setSaving(false);
    router.push(`/matches/${matchRes.data.id as string}`);
  };

  const onCreateClick = () => {
    setCreateConfirmOpen(true);
  };

  const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const fieldClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900";
  const mutedCardClass = "rounded-xl border border-slate-200 bg-slate-50 p-3";
  const pillBaseClass = "rounded-full px-3 py-1.5 text-sm font-medium transition";
  const pillActiveClass = `${pillBaseClass} border border-teal-700 bg-teal-700 text-white`;
  const pillIdleClass = `${pillBaseClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const primaryButtonClass = "rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60";

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Quick Match"
            eyebrow="Match"
            subtitle="Set up a local match in a few steps and go straight to scoring."
            warnOnNavigate={hasDraftChanges}
            warnMessage="You have unsaved quick match setup. Leave this screen and lose your changes?"
          />

          {!admin.loading && !features.loading && !quickMatchAllowed ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Quick Match is disabled for your account. Ask the Super User to enable this feature.
            </section>
          ) : null}

          {quickMatchAllowed ? (
          <section className={`${cardClass} space-y-4`}>
            {!hasAdminPower && !linkedPlayerId ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Link your player profile before creating a quick match.
              </p>
            ) : null}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Fast match setup</p>
              <p className="mt-1 text-sm text-slate-600">
                Choose the location, pick the sport and players, then open the scoring screen.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Match title</label>
              <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
              <p className="mt-1 text-xs text-slate-500">Use a short label such as Table 1 Practice, Friday Race, or Club Warm-up.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Location</label>
              <select className={fieldClass} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Select location (required)</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Sport</label>
                <select className={fieldClass} value={sport} onChange={(e) => setSport(e.target.value as Sport)}>
                  <option value="snooker">Snooker</option>
                  <option value="pool_8_ball">Pool (8-ball)</option>
                </select>
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
                    onClick={() => premium.unlocked && setMode("doubles")}
                    disabled={!premium.unlocked}
                  >
                    Doubles{premium.unlocked ? "" : " (Premium)"}
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
            {mode === "singles" ? (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Pick two players</p>
                <div className={`${mutedCardClass} space-y-2`}>
                  <input
                    className={fieldClass}
                    placeholder="Search players"
                    value={singlesSearch}
                    onChange={(e) => setSinglesSearch(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {singlesSelected.length === 0 ? (
                      <span className="text-xs text-slate-500">No players selected yet.</span>
                    ) : (
                      singlesSelected.map((id) => {
                        const p = players.find((x) => x.id === id);
                        const label = p?.full_name?.trim() ? p.full_name : p?.display_name ?? "Player";
                        const locked = false;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => !locked && setSinglesSelected((prev) => prev.filter((x) => x !== id))}
                            className={`rounded-full border px-3 py-1 text-xs ${
                              locked
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                : "border-slate-300 bg-slate-50 text-slate-700"
                            }`}
                          >
                            {label} ✕
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                    {players
                      .filter((p) => {
                        const label = (p.full_name?.trim() ? p.full_name : p.display_name).toLowerCase();
                        return label.includes(singlesSearch.trim().toLowerCase());
                      })
                      .map((p) => {
                        const label = p.full_name?.trim() ? p.full_name : p.display_name;
                        const selected = singlesSelected.includes(p.id);
                        const disabled = selected || singlesSelected.length >= 2;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => setSinglesSelected((prev) => [...prev, p.id])}
                            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${disabled ? "text-slate-400" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            <span>{label}</span>
                            {selected ? <span className="text-xs text-emerald-700">Selected</span> : null}
                          </button>
                        );
                      })}
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${mutedCardClass} space-y-3`}>
                <p className="text-sm font-medium text-slate-700">Build the two doubles teams</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { key: "t1p1", label: "Team 1 · Player 1", value: team1Player1 },
                    { key: "t1p2", label: "Team 1 · Player 2", value: team1Player2 },
                    { key: "t2p1", label: "Team 2 · Player 1", value: team2Player1 },
                    { key: "t2p2", label: "Team 2 · Player 2", value: team2Player2 },
                  ].map((slot) => {
                    const label = slot.value
                      ? players.find((p) => p.id === slot.value)?.full_name?.trim() ||
                        players.find((p) => p.id === slot.value)?.display_name ||
                        "Player"
                      : slot.label;
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        onClick={() => setActiveDoublesSlot(slot.key as "t1p1" | "t1p2" | "t2p1" | "t2p2")}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                          activeDoublesSlot === slot.key ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"
                        }`}
                      >
                        <span>{label}</span>
                        {slot.value ? (
                          <span
                            className="text-xs text-slate-500"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDoublesSlot(slot.key as "t1p1" | "t1p2" | "t2p1" | "t2p2", "");
                            }}
                          >
                            ✕
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
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
                        const disabled = doublesTaken.includes(p.id) || !activeDoublesSlot;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => activeDoublesSlot && setDoublesSlot(activeDoublesSlot, p.id)}
                            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${
                              disabled ? "text-slate-400" : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span>{label}</span>
                            {doublesTaken.includes(p.id) ? <span className="text-xs text-emerald-700">Selected</span> : null}
                          </button>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onCreateClick}
              disabled={saving || !canCreate}
              className={primaryButtonClass}
            >
              {saving ? "Creating..." : "Start match"}
            </button>
            <MessageModal message={message} onClose={() => setMessage(null)} />
          </section>
          ) : null}
        </RequireAuth>
        <ConfirmModal
          open={createConfirmOpen}
          title="Start this match?"
          description="This will create the match and open the scoring screen."
          confirmLabel="Start Match"
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
