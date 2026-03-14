"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type AdminState = { loading: boolean; isAdmin: boolean; userId: string | null; email: string | null; isSuper: boolean };

function parseRole(value?: string | null): boolean {
  if (!value) return false;
  return value.toLowerCase() === "admin" || value.toLowerCase() === "owner";
}

function parseSuperRole(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "owner" || normalized === "super";
}

export default function useAdminStatus(): AdminState {
  const [state, setState] = useState<AdminState>({
    loading: Boolean(supabase),
    isAdmin: false,
    userId: null,
    email: null,
    isSuper: false,
  });
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const ownerEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ?? process.env.NEXT_PUBLIC_OWNER_EMAIL?.trim().toLowerCase() ?? "";
    let active = true;
    const run = async () => {
      if (active) {
        setState((current) => ({ ...current, loading: true }));
      }
      const { data } = await client.auth.getSession();
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      const email = sessionUser?.email?.toLowerCase() ?? "";
      const isOwner = Boolean(ownerEmail && email && email === ownerEmail);
      const metadataRole = sessionUser?.user_metadata?.role ?? null;
      let appRole: string | null = null;
      if (sessionUser?.id) {
        const { data: appUser } = await client.from("app_users").select("role").eq("id", sessionUser.id).maybeSingle();
        appRole = (appUser?.role as string | null) ?? null;
      }
      const isSuper = isOwner || parseSuperRole(metadataRole) || parseSuperRole(appRole);
      setState({
        loading: false,
        isAdmin: isSuper || parseRole(metadataRole) || parseRole(appRole),
        userId: sessionUser?.id ?? null,
        email: sessionUser?.email ?? null,
        isSuper,
      });
    };
    run();
    const { data: sub } = client.auth.onAuthStateChange(async () => {
      await run();
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
