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

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let active = true;

    const check = async () => {
      const { data } = await client.auth.getSession();
      if (!active) return;

      if (data.session) {
        const userId = data.session.user?.id;
        if (userId) {
          const { data: appUser, error } = await client
            .from("app_users")
            .select("id")
            .eq("id", userId)
            .maybeSingle();
          if (!active) return;
          if (error || !appUser) {
            await client.auth.signOut();
            const query = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
            const next = `${pathname}${query ? `?${query}` : ""}`;
            router.replace(`/auth/sign-in?next=${encodeURIComponent(next)}`);
            setAllowed(false);
            setReady(true);
            return;
          }
        }
        setAllowed(true);
        setReady(true);
        return;
      }

      const query = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
      const next = `${pathname}${query ? `?${query}` : ""}`;
      router.replace(`/auth/sign-in?next=${encodeURIComponent(next)}`);
      setAllowed(false);
      setReady(true);
    };

    check();

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        setAllowed(true);
      } else {
        const query = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
        const next = `${pathname}${query ? `?${query}` : ""}`;
        router.replace(`/auth/sign-in?next=${encodeURIComponent(next)}`);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname, router]);

  useEffect(() => {
    if (!ready || !allowed) return;
    logUsagePageView(pathname || "/");
  }, [ready, allowed, pathname]);

  if (!ready) return <p className="rounded-xl border border-slate-200 bg-white p-4">Checking session...</p>;
  if (!allowed) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">Redirecting to sign in...</p>;

  return <>{children}</>;
}
