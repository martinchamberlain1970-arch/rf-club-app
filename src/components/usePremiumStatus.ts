"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type PremiumState = {
  loading: boolean;
  unlocked: boolean;
  trialActive: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number;
};

function parseFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

export default function usePremiumStatus(): PremiumState {
  const [state, setState] = useState<PremiumState>({
    loading: Boolean(supabase),
    unlocked: false,
    trialActive: false,
    trialEndsAt: null,
    trialDaysLeft: 0,
  });

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    const refresh = async () => {
      const { data } = await client.auth.getUser();
      if (!active) return;
      const userId = data.user?.id;
      const email = data.user?.email?.trim().toLowerCase() ?? "";
      const superEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
      if (!userId) {
        setState({ loading: false, unlocked: false, trialActive: false, trialEndsAt: null, trialDaysLeft: 0 });
        return;
      }

      let premiumUnlocked = parseFlag(data.user?.user_metadata?.premium_unlocked);
      let trialEndsAt: string | null = null;
      let trialActive = false;
      let trialDaysLeft = 0;

      const nowMs = Date.now();
      const applyTrialFrom = (row: { trial_started_at?: string | null; trial_ends_at?: string | null; created_at?: string | null }) => {
        const derivedEndMs = (() => {
          if (row.trial_ends_at) return Date.parse(row.trial_ends_at);
          const start = row.trial_started_at ?? row.created_at;
          if (!start) return Number.NaN;
          return Date.parse(start) + 14 * 24 * 60 * 60 * 1000;
        })();
        if (Number.isFinite(derivedEndMs)) {
          trialEndsAt = new Date(derivedEndMs).toISOString();
          trialActive = nowMs < derivedEndMs;
          trialDaysLeft = trialActive ? Math.max(1, Math.ceil((derivedEndMs - nowMs) / (24 * 60 * 60 * 1000))) : 0;
        }
      };

      const fullRes = await client
        .from("app_users")
        .select("premium_unlocked,trial_started_at,trial_ends_at,created_at")
        .eq("id", userId)
        .maybeSingle();

      if (!fullRes.error && fullRes.data) {
        premiumUnlocked = premiumUnlocked || parseFlag((fullRes.data as { premium_unlocked?: unknown }).premium_unlocked);
        applyTrialFrom(fullRes.data as { trial_started_at?: string | null; trial_ends_at?: string | null; created_at?: string | null });
      } else {
        const fallbackRes = await client.from("app_users").select("premium_unlocked,created_at").eq("id", userId).maybeSingle();
        if (!fallbackRes.error && fallbackRes.data) {
          premiumUnlocked = premiumUnlocked || parseFlag((fallbackRes.data as { premium_unlocked?: unknown }).premium_unlocked);
          applyTrialFrom(fallbackRes.data as { created_at?: string | null });
        }
      }
      const roleRes = await client.from("app_users").select("role").eq("id", userId).maybeSingle();
      const appRole = (roleRes.data?.role ?? "").toLowerCase();
      const isSuper = Boolean(superEmail && email && email === superEmail) || appRole === "owner" || appRole === "super";

      setState({
        loading: false,
        unlocked: isSuper || premiumUnlocked || trialActive,
        trialActive: !isSuper && trialActive,
        trialEndsAt: !isSuper ? trialEndsAt : null,
        trialDaysLeft: !isSuper ? trialDaysLeft : 0,
      });
    };

    refresh();
    const { data: sub } = client.auth.onAuthStateChange(async () => {
      await refresh();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
