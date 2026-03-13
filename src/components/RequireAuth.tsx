"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logUsagePageView } from "@/lib/usage";

type RequireAuthProps = {
  children: ReactNode;
};

export default function RequireAuth({ children }: RequireAuthProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(() => !supabase);
  const [allowed, setAllowed] = useState(() => !supabase);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const SESSION_TIMEOUT_MS = 7000;
    const superAdminEmail =
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
      process.env.NEXT_PUBLIC_OWNER_EMAIL?.trim().toLowerCase() ??
      "";
    const buildNextPath = () => {
      const query = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
      return `${pathname}${query ? `?${query}` : ""}`;
    };
    const redirectToSignIn = () => {
      if (!active) return;
      if (typeof window !== "undefined" && window.sessionStorage.getItem("rf_signing_out") === "1") {
        window.sessionStorage.removeItem("rf_signing_out");
        router.replace("/auth/sign-in?signed_out=1");
      } else {
        const next = buildNextPath();
        router.replace(`/auth/sign-in?next=${encodeURIComponent(next)}`);
      }
      setAllowed(false);
      setReady(true);
    };
    const armTimeout = () => {
      timeoutId = setTimeout(() => {
        if (!active) return;
        setTimedOut(true);
        redirectToSignIn();
      }, SESSION_TIMEOUT_MS);
    };
    const clearTimeoutGuard = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const check = async () => {
      armTimeout();
      const { data } = await client.auth.getSession();
      clearTimeoutGuard();
      if (!active) return;

      if (data.session) {
        const userId = data.session.user?.id;
        if (userId) {
          const { data: appUser, error } = await client
            .from("app_users")
            .select("id,linked_player_id,role")
            .eq("id", userId)
            .maybeSingle();
          if (!active) return;
          if (error || !appUser) {
            redirectToSignIn();
            return;
          }
          const sessionEmail = data.session.user?.email?.trim().toLowerCase() ?? "";
          const isSuper = Boolean(superAdminEmail && sessionEmail && sessionEmail === superAdminEmail);
          const role = typeof appUser.role === "string" ? appUser.role.toLowerCase() : "";
          const isAdmin = role === "admin" || role === "owner";
          const hasLinkedPlayer = Boolean(appUser.linked_player_id);
          if (!hasLinkedPlayer && !isSuper && !isAdmin && pathname !== "/") {
            router.replace("/?setup=profile");
            setAllowed(false);
            setReady(true);
            return;
          }
        }
        setAllowed(true);
        setReady(true);
        return;
      }

      redirectToSignIn();
    };

    check();

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      clearTimeoutGuard();
      if (!active) return;
      if (session) {
        setTimedOut(false);
        setAllowed(true);
        setReady(true);
      } else {
        redirectToSignIn();
      }
    });

    return () => {
      active = false;
      clearTimeoutGuard();
      listener.subscription.unsubscribe();
    };
  }, [pathname, router]);

  useEffect(() => {
    if (!ready || !allowed) return;
    logUsagePageView(pathname || "/");
  }, [ready, allowed, pathname]);

  if (!ready) {
    return (
      <p className={`rounded-xl p-4 ${timedOut ? "border border-amber-200 bg-amber-50 text-amber-900" : "border border-slate-200 bg-white"}`}>
        {timedOut ? "Session check timed out. Redirecting to sign in..." : "Checking session..."}
      </p>
    );
  }
  if (!allowed) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">Redirecting to sign in...</p>;

  return <>{children}</>;
}
