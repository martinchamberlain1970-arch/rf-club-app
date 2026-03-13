"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import ScreenHeader from "@/components/ScreenHeader";
import { logAudit } from "@/lib/audit";
import InfoModal from "@/components/InfoModal";
import MessageModal from "@/components/MessageModal";

type Location = { id: string; name: string };
type Player = { id: string; display_name: string; full_name: string | null; location_id: string | null; claimed_by: string | null };
type AppUserRole = "owner" | "admin" | "user";

export default function LocationsPage() {
  const admin = useAdminStatus();
  const canManageLocations = admin.isSuper;
  const [locations, setLocations] = useState<Location[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [userRolesById, setUserRolesById] = useState<Record<string, AppUserRole>>({});
  const [selectedLocationId, setSelectedLocationId] = useState<string>("all");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; description: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    const [locRes, playerRes] = await Promise.all([
      client.from("locations").select("id,name").order("name"),
      client.from("players").select("id,display_name,full_name,location_id,claimed_by").eq("is_archived", false).order("display_name"),
    ]);
    if (locRes.error) {
      setMessage(locRes.error.message);
    } else {
      setLocations((locRes.data ?? []) as Location[]);
    }
    if (!playerRes.error) {
      const loadedPlayers = (playerRes.data ?? []) as Player[];
      setPlayers(loadedPlayers);
      const claimedUserIds = Array.from(new Set(loadedPlayers.map((p) => p.claimed_by).filter(Boolean))) as string[];
      if (claimedUserIds.length > 0) {
        const userRes = await client.from("app_users").select("id,role").in("id", claimedUserIds);
        if (!userRes.error && userRes.data) {
          const roleMap: Record<string, AppUserRole> = {};
          userRes.data.forEach((u) => {
            roleMap[u.id as string] = (u.role as AppUserRole) ?? "user";
          });
          setUserRolesById(roleMap);
        } else {
          setUserRolesById({});
        }
      } else {
        setUserRolesById({});
      }
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const playersByLocation = useMemo(() => {
    const map = new Map<string, Player[]>();
    players.forEach((p) => {
      if (!p.location_id) return;
      if (!map.has(p.location_id)) map.set(p.location_id, []);
      map.get(p.location_id)!.push(p);
    });
    return map;
  }, [players]);

  const visibleLocations = useMemo(() => {
    if (selectedLocationId === "all") return locations;
    return locations.filter((l) => l.id === selectedLocationId);
  }, [locations, selectedLocationId]);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManageLocations) {
      setMessage("Only the Super User can manage locations.");
      return;
    }
    const client = supabase;
    if (!client) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Enter a location name.");
      return;
    }
    setSaving(true);
    const { error } = await client.from("locations").insert({ name: trimmed });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setName("");
    setInfoModal({ title: "Location Added", description: `Location \"${trimmed}\" was added successfully.` });
    await logAudit("location_created", {
      entityType: "location",
      summary: `Location created: ${trimmed}.`,
    });
    await load();
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Locations" eyebrow="Locations" subtitle="Manage venue locations and linked players." />

          <MessageModal message={message ?? (!supabase ? "Supabase is not configured." : null)} onClose={() => setMessage(null)} />

          {canManageLocations ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Add location</h2>
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={onAdd}>
                <input
                  className="min-w-[260px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2"
                  placeholder="Location name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-medium text-white">
                  {saving ? "Saving..." : "Add"}
                </button>
              </form>
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-700">Only the Super User can add or manage locations.</p>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Locations and players</h2>
            <div className="mt-3 max-w-sm">
              <label className="text-sm font-medium text-slate-700">Filter location</label>
              <select
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
              >
                <option value="all">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 space-y-3">
              {visibleLocations.length === 0 ? <p className="text-sm text-slate-600">No locations yet.</p> : null}
              {visibleLocations.map((loc) => {
                const linkedPlayers = playersByLocation.get(loc.id) ?? [];
                return (
                  <div key={loc.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-900">{loc.name}</p>
                      <span className="text-xs text-slate-500">{linkedPlayers.length} players</span>
                    </div>
                    {linkedPlayers.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {linkedPlayers.map((p) => {
                          const role = p.claimed_by ? userRolesById[p.claimed_by] : undefined;
                          const roleBadge =
                            role === "owner" ? "Super User" : role === "admin" ? "Administrator" : null;
                          return (
                            <div key={p.id} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700">
                              <Link href={`/players/${p.id}`} className="underline">
                                {p.full_name ?? p.display_name}
                              </Link>
                              {roleBadge ? (
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                  {roleBadge}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">No players linked.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </RequireAuth>
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
