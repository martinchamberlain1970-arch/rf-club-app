"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";
import useAdminStatus from "@/components/useAdminStatus";
import ConfirmModal from "@/components/ConfirmModal";
import MessageModal from "@/components/MessageModal";

type BackupPayload = {
  version: string;
  exported_at: string;
  players: Record<string, unknown>[];
  competitions: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  frames: Record<string, unknown>[];
  result_submissions?: Record<string, unknown>[];
};

export default function BackupPage() {
  const admin = useAdminStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepAccounts, setKeepAccounts] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [cloudFiles, setCloudFiles] = useState<Array<{ name: string; updated_at: string | null }>>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: "default" | "danger";
    resolve?: (value: boolean) => void;
  }>({ open: false, title: "", description: "" });

  const askConfirm = (
    title: string,
    description: string,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    tone: "default" | "danger" = "default"
  ) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({
        open: true,
        title,
        description,
        confirmLabel,
        cancelLabel,
        tone,
        resolve,
      });
    });

  const closeConfirm = (result: boolean) => {
    const resolver = confirmState.resolve;
    setConfirmState({ open: false, title: "", description: "" });
    resolver?.(result);
  };

  const loadCloudBackups = async (id: string) => {
    const client = supabase;
    if (!client) return;
    const list = await client.storage.from("backups").list(id, { limit: 50, sortBy: { column: "updated_at", order: "desc" } });
    if (list.error) {
      setMessage(list.error.message);
      return;
    }
    setCloudFiles((list.data ?? []).map((f) => ({ name: f.name, updated_at: f.updated_at })));
  };

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const run = async () => {
      const userRes = await client.auth.getUser();
      if (userRes.data?.user) {
        setUserId(userRes.data.user.id);
        await loadCloudBackups(userRes.data.user.id);
      }
    };
    run();
  }, []);

  const exportBackup = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const [pRes, cRes, mRes, fRes, sRes] = await Promise.all([
      client.from("players").select("*"),
      client.from("competitions").select("*"),
      client.from("matches").select("*"),
      client.from("frames").select("*"),
      client.from("result_submissions").select("*"),
    ]);
    if (pRes.error || cRes.error || mRes.error || fRes.error || sRes.error) {
      setBusy(false);
      setMessage(pRes.error?.message || cRes.error?.message || mRes.error?.message || fRes.error?.message || sRes.error?.message || "Failed to export.");
      return;
    }
    const payload: BackupPayload = {
      version: "1",
      exported_at: new Date().toISOString(),
      players: pRes.data ?? [],
      competitions: cRes.data ?? [],
      matches: mRes.data ?? [],
      frames: fRes.data ?? [],
      result_submissions: sRes.data ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rack-frame-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
    setMessage("Backup exported.");
  };

  const exportToCloud = async () => {
    const client = supabase;
    if (!client || !userId) {
      setMessage("Supabase is not configured.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const [pRes, cRes, mRes, fRes, sRes] = await Promise.all([
      client.from("players").select("*"),
      client.from("competitions").select("*"),
      client.from("matches").select("*"),
      client.from("frames").select("*"),
      client.from("result_submissions").select("*"),
    ]);
    if (pRes.error || cRes.error || mRes.error || fRes.error || sRes.error) {
      setBusy(false);
      setMessage(pRes.error?.message || cRes.error?.message || mRes.error?.message || fRes.error?.message || sRes.error?.message || "Failed to export.");
      return;
    }
    const payload: BackupPayload = {
      version: "1",
      exported_at: new Date().toISOString(),
      players: pRes.data ?? [],
      competitions: cRes.data ?? [],
      matches: mRes.data ?? [],
      frames: fRes.data ?? [],
      result_submissions: sRes.data ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const path = `${userId}/${filename}`;
    const upload = await client.storage.from("backups").upload(path, blob, { upsert: true, contentType: "application/json" });
    if (upload.error) {
      setBusy(false);
      setMessage(upload.error.message);
      return;
    }
    await loadCloudBackups(userId);
    setBusy(false);
    setMessage("Backup saved to cloud.");
  };

  const restoreFromCloud = async (name: string) => {
    const client = supabase;
    if (!client || !userId) return;
    const ok = await askConfirm(
      "Restore this backup?",
      "This will upsert players, competitions, matches, and frames by ID. Existing data may be overwritten.",
      "Restore",
      "Cancel",
      "danger"
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const file = await client.storage.from("backups").download(`${userId}/${name}`);
    if (file.error || !file.data) {
      setBusy(false);
      setMessage(file.error?.message ?? "Failed to download backup.");
      return;
    }
    try {
      const text = await file.data.text();
      const payload = JSON.parse(text) as BackupPayload;
      const batch = async (table: string, rows: Record<string, unknown>[]) => {
        if (!rows.length) return;
        const res = await client.from(table).upsert(rows, { onConflict: "id" });
        if (res.error) throw res.error;
      };
      await batch("players", payload.players);
      await batch("competitions", payload.competitions);
      await batch("matches", payload.matches);
      await batch("frames", payload.frames);
      if (payload.result_submissions) {
        await batch("result_submissions", payload.result_submissions);
      }
      setMessage("Restore complete.");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  const downloadFromCloud = async (name: string) => {
    const client = supabase;
    if (!client || !userId) return;
    const file = await client.storage.from("backups").download(`${userId}/${name}`);
    if (file.error || !file.data) {
      setMessage(file.error?.message ?? "Failed to download backup.");
      return;
    }
    const url = URL.createObjectURL(file.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restoreBackup = async (file: File | null) => {
    if (!file) return;
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    const ok = await askConfirm(
      "Restore backup?",
      "This will upsert players, competitions, matches, and frames by ID. Existing data may be overwritten.",
      "Restore",
      "Cancel",
      "danger"
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;
      if (!payload || !payload.players || !payload.competitions || !payload.matches || !payload.frames) {
        throw new Error("Invalid backup file.");
      }
      const batch = async (table: string, rows: Record<string, unknown>[]) => {
        if (!rows.length) return;
        const res = await client.from(table).upsert(rows, { onConflict: "id" });
        if (res.error) throw res.error;
      };
      await batch("players", payload.players);
      await batch("competitions", payload.competitions);
      await batch("matches", payload.matches);
      await batch("frames", payload.frames);
      if (payload.result_submissions) {
        await batch("result_submissions", payload.result_submissions);
      }
      setMessage("Restore complete.");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  const clearAllData = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    if (!admin.isSuper) {
      setMessage("Only the Super User can clear all data.");
      return;
    }
    const ok = await askConfirm(
      "Clear all data?",
      "All match and player data will be permanently deleted. An automatic backup will run first.",
      "Clear all data",
      "Cancel",
      "danger"
    );
    if (!ok) return;
    if (confirmText !== "DELETE ALL DATA") {
      setMessage('Type "DELETE ALL DATA" to continue.');
      return;
    }

    setBusy(true);
    setMessage(null);
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setBusy(false);
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/clear-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        keepAccounts,
        confirmText,
      }),
    });
    const json = await resp.json();
    setBusy(false);
    if (!resp.ok) {
      setMessage(json?.error ?? "Clear data failed.");
      return;
    }
    setConfirmText("");
    setCloudFiles([]);
    setMessage(
      `Data cleared. Automatic backup saved: ${json?.backupPath}${keepAccounts ? " · User accounts kept." : " · User accounts removed (Super User kept)."}` 
    );
    if (userId) await loadCloudBackups(userId);
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Data Management"
            eyebrow="Data"
            subtitle="Backup, restore, and controlled data reset."
          />
          {!admin.loading && !admin.isAdmin ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Data Management is available to the club administrator only.
            </section>
          ) : null}
          {!admin.loading && !admin.isAdmin ? null : (
          <>
          <MessageModal message={message} onClose={() => setMessage(null)} />
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <p className="text-slate-700">Export a full backup of players, events, matches, and frames.</p>
            <button
              type="button"
              onClick={exportBackup}
              disabled={busy}
              className="rounded-xl bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Export backup (JSON)
            </button>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <p className="text-slate-700">Save a backup to Supabase Storage (bucket: backups).</p>
            <button
              type="button"
              onClick={exportToCloud}
              disabled={busy || !userId}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Save to cloud
            </button>
            <div className="space-y-2">
              {cloudFiles.length === 0 ? (
                <p className="text-sm text-slate-600">No cloud backups yet.</p>
              ) : (
                cloudFiles.map((f) => (
                  <div key={f.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <span className="text-sm text-slate-700">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => restoreFromCloud(f.name)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFromCloud(f.name)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      Download
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <p className="text-slate-700">Restore a previous backup. This will upsert by ID and may overwrite existing records.</p>
            <input
              type="file"
              accept="application/json"
              onChange={(e) => restoreBackup(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </section>
          {admin.isSuper ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm space-y-3">
              <h3 className="text-lg font-semibold text-rose-900">Clear Data (Super User only)</h3>
              <p className="text-sm text-rose-800">
                This permanently removes players, locations, events, matches, frames, and requests. An automatic backup is created first.
              </p>
              <label className="flex items-center gap-2 text-sm text-rose-900">
                <input
                  type="checkbox"
                  checked={keepAccounts}
                  onChange={(e) => setKeepAccounts(e.target.checked)}
                  disabled={busy}
                />
                Keep users/accounts (recommended). Super User account is always kept.
              </label>
              <input
                className="w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm"
                placeholder='Type DELETE ALL DATA to confirm'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                onClick={clearAllData}
                disabled={busy}
                className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? "Working..." : "Clear All Data"}
              </button>
            </section>
          ) : null}
          </>
          )}
        </RequireAuth>
      </div>
      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel={confirmState.cancelLabel}
        tone={confirmState.tone}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
    </main>
  );
}
