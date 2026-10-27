"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Photo = { path: string; originalBytes: number; optimisedBytes: number | null; originalUrl: string; optimisedUrl: string | null };
export default function PhotoOptimisationPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [message, setMessage] = useState("Loading owner-only photo tools…");
  const [busy, setBusy] = useState(false);
  const [references, setReferences] = useState({ original: 0, optimised: 0, other: 0 });
  const [allowed, setAllowed] = useState(false);
  async function request(body?: { path: string; action: string }) {
    const session = await supabase?.auth.getSession();
    const token = session?.data.session?.access_token;
    if (!token) throw new Error("Please sign in with the owner account first.");
    const response = await fetch("/api/admin/photo-optimisation", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Photo operation failed.");
    return result;
  }
  async function refresh() {
    const result = await request();
    setPhotos(result.photos);
    setReferences(result.references);
    setAllowed(true);
  }
  useEffect(() => { void refresh().then(() => setMessage("Review the copies before activating them. Originals are retained.")).catch(error => setMessage(error.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(action: string) {
    setBusy(true);
    let playerCount = 0;
    let requestCount = 0;
    try {
      for (let i = 0; i < photos.length; i++) {
        setMessage(`${action}: ${i + 1} of ${photos.length}`);
        const result = await request({ action, path: photos[i].path });
        playerCount += result.players || 0;
        requestCount += result.requests || 0;
      }
      await refresh();
      setMessage(`${action} complete: ${photos.length} photos checked; ${playerCount} player references and ${requestCount} pending requests updated. Originals retained.`);
    } catch (error) { setMessage(`Stopped: ${error instanceof Error ? error.message : "Unknown error"} You can safely retry.`); }
    finally { setBusy(false); }
  }
  const original = photos.reduce((sum, photo) => sum + photo.originalBytes, 0);
  const optimised = photos.reduce((sum, photo) => sum + (photo.optimisedBytes || 0), 0);
  const prepared = photos.filter(photo => photo.optimisedUrl).length;
  return <main className="mx-auto max-w-6xl p-6 text-slate-900">
    <h1 className="text-3xl font-bold">Player photo optimisation</h1>
    <p className="my-3">Owner tools · Originals remain available for rollback. Activation preserves approval status and newer uploads.</p>
    <p role="status" className="my-4 rounded bg-slate-100 p-4">{message}</p>
    {allowed && <>
      <p>Active references: {references.optimised} optimised · {references.original} original · {references.other} external or unrecognised.</p>
      <p className="my-4 font-semibold">{photos.length} originals · {(original / 1e6).toFixed(2)} MB · {prepared} optimised copies · {(optimised / 1e6).toFixed(2)} MB{prepared === photos.length && original > 0 ? ` · ${(100 * (1 - optimised / original)).toFixed(1)}% smaller` : ""}</p>
      <div className="mb-6 flex flex-wrap gap-3">
        <button disabled={busy} onClick={() => void run("prepare")} className="rounded bg-slate-800 px-4 py-3 text-white disabled:opacity-40">Prepare optimised copies</button>
        <button disabled={busy || prepared !== photos.length || !photos.length} onClick={() => void run("activate")} className="rounded bg-teal-700 px-4 py-3 text-white disabled:opacity-40">Activate reviewed copies</button>
        <button disabled={busy} onClick={() => void run("rollback")} className="rounded border px-4 py-3 disabled:opacity-40">Restore original photos</button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">{photos.map((photo, index) => <section key={photo.path} className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-bold">Photo {index + 1} · {(photo.originalBytes / 1000).toFixed(0)} KB → {photo.optimisedBytes === null ? "not prepared" : `${(photo.optimisedBytes / 1000).toFixed(0)} KB`}</h2>
        <div className="grid grid-cols-2 gap-3">{[{ label: "Original", url: photo.originalUrl }, { label: "Optimised", url: photo.optimisedUrl }].map(item => <div key={item.label}><p>{item.label}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={`Photo ${index + 1} ${item.label}`} loading="lazy" className="mt-2 h-48 w-full rounded object-contain bg-slate-100" /></a>}</div>)}</div>
      </section>)}</div>
    </>}
  </main>;
}
