"use client";

import { useEffect } from "react";

export default function PwaSetup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    const reloadForUpdatedWorker = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdatedWorker);

    let registration: ServiceWorkerRegistration | null = null;
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    document.addEventListener("visibilitychange", checkForUpdate);

    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((nextRegistration) => {
        registration = nextRegistration;
        void nextRegistration.update();
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", reloadForUpdatedWorker);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  return null;
}
