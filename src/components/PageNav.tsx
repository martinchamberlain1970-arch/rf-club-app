"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import useAdminStatus from "@/components/useAdminStatus";
import ConfirmModal from "@/components/ConfirmModal";

type PageNavProps = {
  warnOnNavigate?: boolean;
  warnMessage?: string;
};

type GtFilterQuery<T> = {
  gt: (column: string, value: string) => T;
};

export default function PageNav({ warnOnNavigate = false, warnMessage = "You have unsaved changes. Leave this screen?" }: PageNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const admin = useAdminStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingNav, setPendingNav] = useState<"back" | "home" | null>(null);
  const storageKey = useMemo(() => (admin.userId ? `notifications_last_read_${admin.userId}` : "notifications_last_read"), [admin.userId]);
  const dismissedKey = useMemo(
    () => (admin.userId ? `notifications_dismissed_${admin.userId}` : "notifications_dismissed"),
    [admin.userId]
  );
  const performNavigation = (target: "back" | "home") => {
    if (target === "back") router.back();
    else router.push("/dashboard");
  };

  const requestNavigation = (target: "back" | "home") => {
    if (!warnOnNavigate) {
      performNavigation(target);
      return;
    }
    setPendingNav(target);
  };

  const onSignOut = async () => {
    const client = supabase;
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("rf_signing_out", "1");
    }
    if (client) {
      try {
        await client.auth.signOut();
      } catch {
        // Fall through to local storage cleanup and redirect.
      }
    }
    if (typeof window !== "undefined") {
      const localKeys = Object.keys(window.localStorage);
      for (const key of localKeys) {
        if (key.startsWith("sb-") && key.includes("-auth-token")) {
          window.localStorage.removeItem(key);
        }
      }
      const sessionKeys = Object.keys(window.sessionStorage);
      for (const key of sessionKeys) {
        if (key.startsWith("sb-") && key.includes("-auth-token")) {
          window.sessionStorage.removeItem(key);
        }
      }
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(dismissedKey);
      window.localStorage.removeItem("pending_claim");
      window.sessionStorage.removeItem("signup_draft_v1");
      window.location.replace("/auth/sign-in?signed_out=1");
      return;
    }
    router.replace("/auth/sign-in?signed_out=1");
  };

  const onNotifications = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    }
    router.push("/notifications");
  };

  const superManagementRoutes = ["/players", "/signup-requests", "/backup", "/audit", "/usage", "/locations", "/results"];
  const isSuperManagementPage = Boolean(admin.isSuper && pathname && superManagementRoutes.includes(pathname));

  const showBack = !isSuperManagementPage;

  useEffect(() => {
    const load = async () => {
      const client = supabase;
      if (!client || admin.loading) return;
      if (!admin.userId) return;
      const lastRead = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      const applyCreatedFilter = <T extends GtFilterQuery<T>>(query: T) => (lastRead ? query.gt("created_at", lastRead) : query);
      const applyResultFilter = <T extends GtFilterQuery<T>>(query: T) => (lastRead ? query.gt("submitted_at", lastRead) : query);
      if (admin.isSuper) {
        const dismissed = typeof window !== "undefined" ? new Set<string>(JSON.parse(window.localStorage.getItem(dismissedKey) ?? "[]")) : new Set<string>();
        const { data: resultRows } = await applyResultFilter(
          client.from("result_submissions").select("id").eq("status", "pending")
        );
        const { data: claimRows } = await applyCreatedFilter(
          client.from("player_claim_requests").select("id").eq("status", "pending")
        );
        const { data: updateRows } = await applyCreatedFilter(
          client.from("player_update_requests").select("id").eq("status", "pending")
        );
        const { data: adminReqRows } = await applyCreatedFilter(
          client.from("admin_requests").select("id").eq("status", "pending")
        );
        const { data: premiumRows } = await applyCreatedFilter(
          client.from("premium_requests").select("id").eq("status", "pending")
        );
        const { data: locationReqRows } = await applyCreatedFilter(
          client.from("location_requests").select("id").eq("status", "pending")
        );
        const ids = [
          ...(resultRows ?? []).map((r: { id: string }) => `result:${r.id}`),
          ...(claimRows ?? []).map((r: { id: string }) => `claim:${r.id}`),
          ...(updateRows ?? []).map((r: { id: string }) => `update:${r.id}`),
          ...(adminReqRows ?? []).map((r: { id: string }) => `admin:${r.id}`),
          ...(premiumRows ?? []).map((r: { id: string }) => `premium:${r.id}`),
          ...(locationReqRows ?? []).map((r: { id: string }) => `location:${r.id}`),
        ];
        setPendingCount(ids.filter((id) => !dismissed.has(id)).length);
      } else if (admin.isAdmin) {
        const dismissed = typeof window !== "undefined" ? new Set<string>(JSON.parse(window.localStorage.getItem(dismissedKey) ?? "[]")) : new Set<string>();
        const { data: resultRows } = await applyResultFilter(
          client.from("result_submissions").select("id").eq("status", "pending")
        );
        const ids = [...(resultRows ?? []).map((r: { id: string }) => `result:${r.id}`)];
        setPendingCount(ids.filter((id) => !dismissed.has(id)).length);
      } else {
        const dismissed = typeof window !== "undefined" ? new Set<string>(JSON.parse(window.localStorage.getItem(dismissedKey) ?? "[]")) : new Set<string>();
        const { data: resultRows } = await applyResultFilter(
          client
            .from("result_submissions")
            .select("id")
            .in("status", ["pending", "approved", "rejected"])
            .eq("submitted_by_user_id", admin.userId)
        );
        const { data: claimRows } = await applyCreatedFilter(
          client
            .from("player_claim_requests")
            .select("id")
            .in("status", ["pending", "approved", "rejected"])
            .eq("requester_user_id", admin.userId)
        );
        const { data: updateRows } = await applyCreatedFilter(
          client
            .from("player_update_requests")
            .select("id")
            .in("status", ["pending", "approved", "rejected"])
            .eq("requester_user_id", admin.userId)
        );
        const { data: adminReqRows } = await applyCreatedFilter(
          client
            .from("admin_requests")
            .select("id")
            .in("status", ["pending", "approved", "rejected"])
            .eq("requester_user_id", admin.userId)
        );
        const { data: premiumRows } = await applyCreatedFilter(
          client
            .from("premium_requests")
            .select("id")
            .in("status", ["pending", "approved", "rejected"])
            .eq("requester_user_id", admin.userId)
        );
        const ids = [
          ...(resultRows ?? []).map((r: { id: string }) => `result:${r.id}`),
          ...(claimRows ?? []).map((r: { id: string }) => `claim:${r.id}`),
          ...(updateRows ?? []).map((r: { id: string }) => `update:${r.id}`),
          ...(adminReqRows ?? []).map((r: { id: string }) => `admin:${r.id}`),
          ...(premiumRows ?? []).map((r: { id: string }) => `premium:${r.id}`),
        ];
        setPendingCount(ids.filter((id) => !dismissed.has(id)).length);
      }
    };
    load();
  }, [admin.loading, admin.isAdmin, admin.isSuper, admin.userId, storageKey, dismissedKey]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isSuperManagementPage ? (
        <>
          <button
            type="button"
            onClick={() => router.push("/signup-requests")}
            className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-2 text-slate-700"
          >
            Signup
          </button>
          <button
            type="button"
            onClick={() => router.push("/players")}
            className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-2 text-slate-700"
          >
            Users
          </button>
          <button
            type="button"
            onClick={() => router.push("/results")}
            className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-2 text-slate-700"
          >
            Results
          </button>
          <button
            type="button"
            onClick={() => router.push("/audit")}
            className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-2 text-slate-700"
          >
            Audit
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={onNotifications}
        className="relative whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-2 text-slate-700"
        aria-label="Notifications"
      >
        🔔
        {pendingCount > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-xs font-semibold text-white">
            {pendingCount}
          </span>
        ) : null}
      </button>
      {showBack ? (
        <button type="button" onClick={() => requestNavigation("back")} className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-4 py-2 text-slate-700">
          Back
        </button>
      ) : null}
      <button type="button" onClick={() => requestNavigation("home")} className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-4 py-2 text-slate-700">
        Home
      </button>
      <button type="button" onClick={onSignOut} className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-4 py-2 text-slate-700">
        Sign out
      </button>
      <ConfirmModal
        open={Boolean(pendingNav)}
        title="Unsaved changes"
        description={warnMessage}
        confirmLabel="Leave screen"
        cancelLabel="Stay"
        onConfirm={() => {
          if (pendingNav) performNavigation(pendingNav);
          setPendingNav(null);
        }}
        onCancel={() => setPendingNav(null)}
      />
    </div>
  );
}
