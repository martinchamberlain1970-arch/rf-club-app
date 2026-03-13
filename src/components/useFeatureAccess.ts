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
      const isSuper = Boolean(superAdminEmail && email && email === superAdminEmail);
      if (!userId) {
        setState({ loading: false, quickMatchEnabled: false, competitionCreateEnabled: false });
        return;
      }
      if (isSuper) {
        setState({ loading: false, quickMatchEnabled: true, competitionCreateEnabled: true });
        return;
      }

      const { data: appUser } = await client.from("app_users").select("role").eq("id", userId).maybeSingle();

      const role = (appUser?.role ?? "").toLowerCase();
      const isAdmin = role === "admin" || role === "owner";
      setState({
        loading: false,
        quickMatchEnabled: true,
        competitionCreateEnabled: isAdmin,
      });
    };

    run();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
