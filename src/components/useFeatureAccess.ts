"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type FeatureAccessState = {
  loading: boolean;
  quickMatchEnabled: boolean;
  competitionCreateEnabled: boolean;
};

export default function useFeatureAccess(): FeatureAccessState {
  const [state, setState] = useState<FeatureAccessState>({
    loading: Boolean(supabase),
    quickMatchEnabled: false,
    competitionCreateEnabled: false,
  });

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ?? "";

    const run = async () => {
      const { data } = await client.auth.getUser();
      if (!active) return;
      const userId = data.user?.id ?? null;
      const email = data.user?.email?.trim().toLowerCase() ?? "";
      if (!userId) {
        setState({ loading: false, quickMatchEnabled: false, competitionCreateEnabled: false });
        return;
      }
      const { data: appUser } = await client.from("app_users").select("role").eq("id", userId).maybeSingle();

      const role = (appUser?.role ?? "").toLowerCase();
      const isSuper = Boolean(superAdminEmail && email && email === superAdminEmail) || role === "owner" || role === "super";
      const isAdmin = isSuper || role === "admin" || role === "owner";
      setState({
        loading: false,
        quickMatchEnabled: true,
        competitionCreateEnabled: isAdmin || isSuper,
      });
    };

    run();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
