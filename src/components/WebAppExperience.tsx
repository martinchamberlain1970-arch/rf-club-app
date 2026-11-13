"use client";

import { useEffect, useState } from "react";

export default function WebAppExperience({ appName }: { appName: string }) {
  const [online, setOnline] = useState(true);
  const [recovered, setRecovered] = useState(false);
  const [shareMessage, setShareMessage] = useState("");

  useEffect(() => {
    setOnline(navigator.onLine);
    const wentOffline = () => {
      setRecovered(false);
      setOnline(false);
    };
    const cameOnline = () => {
      setOnline(true);
      setRecovered(true);
      window.setTimeout(() => setRecovered(false), 4000);
    };
    window.addEventListener("offline", wentOffline);
    window.addEventListener("online", cameOnline);
    return () => {
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("online", cameOnline);
    };
  }, []);

  const shareCurrentPage = async () => {
    const shareData = { title: document.title || appName, text: `Open this page in ${appName}`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(window.location.href);
        setShareMessage("Link copied");
        window.setTimeout(() => setShareMessage(""), 2500);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareMessage("Unable to share this page");
      window.setTimeout(() => setShareMessage(""), 3000);
    }
  };

  return (
    <>
      {!online ? (
        <div role="status" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-[200] bg-amber-400 px-4 py-3 text-center text-sm font-bold text-amber-950 shadow-lg">
          You’re offline. Keep this screen open—reconnect before submitting or approving changes.
        </div>
      ) : recovered ? (
        <div role="status" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-[200] bg-emerald-600 px-4 py-3 text-center text-sm font-bold text-white shadow-lg">
          You’re back online. You can continue safely.
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void shareCurrentPage()}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-[60] grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-[#0b1730] text-xl text-white shadow-xl transition hover:bg-teal-700 focus:outline-none focus:ring-4 focus:ring-cyan-200"
        aria-label="Share this page"
        title="Share this page"
      >
        ↗
      </button>
      {shareMessage ? <div role="status" className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-4 z-[61] rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white shadow-lg">{shareMessage}</div> : null}
    </>
  );
}
