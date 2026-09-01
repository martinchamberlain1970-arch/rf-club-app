"use client";

import { useCallback, useEffect, useState } from "react";

export type ExperienceMode = "player" | "manage";

const STORAGE_KEY = "rack-and-frame-experience-mode";
const CHANGE_EVENT = "rack-and-frame-experience-mode-change";

function readSavedMode(fallback: ExperienceMode): ExperienceMode {
  if (typeof window === "undefined") return fallback;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "player" || saved === "manage" ? saved : fallback;
}

export default function useExperienceMode(fallback: ExperienceMode = "manage") {
  const [mode, setModeState] = useState<ExperienceMode>(fallback);

  useEffect(() => {
    queueMicrotask(() => setModeState(readSavedMode(fallback)));

    const syncMode = () => setModeState(readSavedMode(fallback));
    window.addEventListener("storage", syncMode);
    window.addEventListener(CHANGE_EVENT, syncMode);
    return () => {
      window.removeEventListener("storage", syncMode);
      window.removeEventListener(CHANGE_EVENT, syncMode);
    };
  }, [fallback]);

  const setMode = useCallback((nextMode: ExperienceMode) => {
    setModeState(nextMode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextMode);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  }, []);

  return [mode, setMode] as const;
}
