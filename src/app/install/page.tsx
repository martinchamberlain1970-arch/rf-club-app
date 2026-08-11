"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPage() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() =>
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setMessage("Rack & Frame is installed.");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setMessage("Installation started.");
    setInstallPrompt(null);
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Install Rack & Frame" eyebrow="App" subtitle="Add the Club app to your phone, tablet, or computer." />
          <section className="rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-6 shadow-sm">
            <Image src="/pwa/icon-192.png" width={96} height={96} alt="Rack & Frame" className="h-24 w-24 rounded-3xl shadow-sm" priority />
            <h2 className="mt-4 text-xl font-semibold text-slate-950">Use it like a downloaded app</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Installation gives Rack & Frame its own home-screen icon and standalone app window. Your existing login continues to work.</p>
            {installed ? (
              <p className="mt-4 rounded-xl bg-emerald-100 px-4 py-3 font-medium text-emerald-900">Already installed on this device.</p>
            ) : installPrompt ? (
              <button type="button" onClick={() => void install()} className="mt-4 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white">Install app</button>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <p><strong>iPhone/iPad:</strong> open this page in Safari, tap Share, then “Add to Home Screen”.</p>
                <p className="mt-2"><strong>Android/Chrome:</strong> open the browser menu and choose “Install app” or “Add to Home screen”.</p>
                <p className="mt-2"><strong>Computer:</strong> use the install icon in the browser address bar.</p>
              </div>
            )}
            {message ? <p className="mt-3 text-sm font-medium text-teal-800">{message}</p> : null}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
