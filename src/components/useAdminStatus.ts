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
      const { data } = await client.auth.getUser();
      if (!active) return;
      const email = data.user?.email?.toLowerCase() ?? "";
      const isOwner = Boolean(ownerEmail && email && email === ownerEmail);
      const metadataRole = data.user?.user_metadata?.role ?? null;
      let appRole: string | null = null;
      if (data.user?.id) {
        const { data: appUser } = await client.from("app_users").select("role").eq("id", data.user.id).maybeSingle();
        appRole = (appUser?.role as string | null) ?? null;
      }
      const isSuper = isOwner || parseSuperRole(metadataRole) || parseSuperRole(appRole);
      setState({
        loading: false,
        isAdmin: isSuper || parseRole(metadataRole) || parseRole(appRole),
        userId: data.user?.id ?? null,
        email: data.user?.email ?? null,
        isSuper,
      });
    };
    run();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
