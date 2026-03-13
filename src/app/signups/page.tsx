"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";

type KnockoutEvent = {
  id: string;
  name: string;
  competition_type: string;
  match_mode: "singles" | "doubles" | "triples";
  format_label: "scratch" | "handicap";
  age_min: number | null;
  sport_type: "snooker" | "billiards";
  signup_open: boolean;
  published: boolean;
  is_active: boolean;
  sort_order: number;
};

type KnockoutSignup = {
  id: string;
  event_id: string;
  user_id: string;
  player_id: string | null;
  status: "entered" | "withdrawn";
  created_at: string;
};

type AppUser = { id: string; linked_player_id: string | null };

type Player = { id: string; display_name: string; full_name: string | null };

export default function KnockoutSignupPage() {
  const admin = useAdminStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<KnockoutEvent[]>([]);
  const [signups, setSignups] = useState<KnockoutSignup[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);

  const playerNameById = useMemo(
    () => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])),
    [players]
  );

  const mySignupByEventId = useMemo(() => {
    const map = new Map<string, KnockoutSignup>();
    if (!userId) return map;
    for (const s of signups) {
      if (s.user_id === userId && s.status === "entered") map.set(s.event_id, s);
    }
    return map;
  }, [signups, userId]);

  const entryCountByEventId = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of signups) {
      if (s.status !== "entered") continue;
      map.set(s.event_id, (map.get(s.event_id) ?? 0) + 1);
    }
    return map;
  }, [signups]);

  const reload = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    const authRes = await client.auth.getUser();
    const uid = authRes.data.user?.id ?? null;
    setUserId(uid);
    if (!uid) return;

    const [eventsRes, signupsRes, appUserRes, playersRes] = await Promise.all([
      client
        .from("league_knockout_events")
        .select("id,name,competition_type,match_mode,format_label,age_min,sport_type,signup_open,published,is_active,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      client
        .from("league_knockout_signups")
        .select("id,event_id,user_id,player_id,status,created_at")
        .order("created_at", { ascending: false }),
      client.from("app_users").select("id,linked_player_id").eq("id", uid).maybeSingle(),
      client.from("players").select("id,display_name,full_name").eq("is_archived", false),
    ]);

    const firstError =
      eventsRes.error?.message || signupsRes.error?.message || appUserRes.error?.message || playersRes.error?.message || null;
    if (firstError) {
      setMessage(firstError);
      return;
    }

    setEvents((eventsRes.data ?? []) as KnockoutEvent[]);
    setSignups((signupsRes.data ?? []) as KnockoutSignup[]);
    setLinkedPlayerId(((appUserRes.data as AppUser | null)?.linked_player_id ?? null) as string | null);
    setPlayers((playersRes.data ?? []) as Player[]);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const enter = async (eventId: string) => {
    const client = supabase;
    if (!client || !userId) return;
    if (!linkedPlayerId) {
      setMessage("Link your player profile before entering a cup.");
      return;
    }
    const existing = signups.find((s) => s.event_id === eventId && s.user_id === userId);
    if (existing && existing.status === "entered") {
      setMessage("You are already entered.");
      return;
    }
    if (existing) {
      const { error } = await client
        .from("league_knockout_signups")
        .update({ status: "entered", player_id: linkedPlayerId })
        .eq("id", existing.id);
      if (error) {
        setMessage(error.message);
        return;
      }
    } else {
      const { error } = await client.from("league_knockout_signups").insert({
        event_id: eventId,
        user_id: userId,
        player_id: linkedPlayerId,
        status: "entered",
      });
      if (error) {
        setMessage(error.message);
        return;
      }
    }
    await reload();
  };

  const withdraw = async (eventId: string) => {
    const client = supabase;
    if (!client || !userId) return;
    const existing = signups.find((s) => s.event_id === eventId && s.user_id === userId && s.status === "entered");
    if (!existing) return;
    const { error } = await client.from("league_knockout_signups").update({ status: "withdrawn" }).eq("id", existing.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    await reload();
  };

  const visibleEvents = useMemo(
    () => (admin.isSuper ? events : events.filter((e) => e.published)),
    [events, admin.isSuper]
  );

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Knockout Sign-ups"
            eyebrow="League"
            subtitle="Enter league knockout competitions when sign-ups are open."
          />
          <MessageModal message={message} onClose={() => setMessage(null)} />

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">If entries are open, click <strong>Enter</strong>. You can withdraw later.</p>
          </section>

          <section className="space-y-3">
            {visibleEvents.map((event) => {
              const mySignup = mySignupByEventId.get(event.id) ?? null;
              const open = event.published && event.signup_open && event.is_active;
              return (
                <div key={event.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{event.name}</p>
                      <p className="text-sm text-slate-600">
                        {event.sport_type === "billiards" ? "Billiards" : "Snooker"} · {event.match_mode} · {event.format_label}
                        {event.age_min ? ` · ${event.age_min}+` : ""}
                      </p>
                      <p className="text-xs text-slate-500">Entries: {entryCountByEventId.get(event.id) ?? 0}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full border px-2 py-0.5 ${event.published ? "border-emerald-300 bg-emerald-100 text-emerald-900" : "border-slate-300 bg-slate-100 text-slate-700"}`}>
                        {event.published ? "Published" : "Draft"}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 ${event.signup_open ? "border-teal-300 bg-teal-100 text-teal-900" : "border-slate-300 bg-slate-100 text-slate-700"}`}>
                        {event.signup_open ? "Sign-ups open" : "Sign-ups closed"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {mySignup ? (
                      <button
                        type="button"
                        onClick={() => void withdraw(event.id)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        Withdraw
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void enter(event.id)}
                        disabled={!open}
                        className="rounded-lg bg-fuchsia-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Enter
                      </button>
                    )}
                    {!open ? <span className="text-xs text-slate-500">Entries are not open.</span> : null}
                  </div>

                  {admin.isSuper ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Current entries</p>
                      <div className="mt-1 space-y-1 text-sm text-slate-700">
                        {signups
                          .filter((s) => s.event_id === event.id && s.status === "entered")
                          .map((s) => (
                            <div key={s.id}>{playerNameById.get(s.player_id ?? "") ?? s.user_id}</div>
                          ))}
                        {signups.filter((s) => s.event_id === event.id && s.status === "entered").length === 0 ? (
                          <p className="text-xs text-slate-500">No entries yet.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {visibleEvents.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">
                No knockout competitions are available yet.
              </div>
            ) : null}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
