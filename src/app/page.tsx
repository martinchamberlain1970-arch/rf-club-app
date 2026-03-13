"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import ConfirmModal from "@/components/ConfirmModal";

const coreActionLinks = [
  { href: "/quick-match", title: "Quick Match", desc: "Start a local practice or social match." },
  { href: "/events/new", title: "Create Competition", desc: "Set up a knockout competition for your club." },
  { href: "/events", title: "Events", desc: "See active, completed, and archived competitions." },
  { href: "/players", title: "Players", desc: "Register and manage club players." },
  { href: "/results", title: "Results", desc: "Review and approve submitted match results." },
  { href: "/notifications", title: "Notifications", desc: "Check inbox updates and pending actions." },
  { href: "/stats", title: "Stats", desc: "View club rankings, form, and performance summaries." },
] as const;

const supportLinks = [
  { href: "/rules", title: "Rules" },
  { href: "/help", title: "Help" },
  { href: "/help#report-an-issue", title: "Report An Issue" },
  { href: "/welcome-tour", title: "Welcome Tour" },
  { href: "/legal", title: "Legal" },
] as const;

const adminToolLinks = [
  { href: "/signups", title: "Competition Sign-ups", desc: "Review open sign-ups and player entry requests." },
  { href: "/live", title: "Live Overview", desc: "See active matches and competition progress at a glance." },
] as const;

const systemToolLinks = [
  { href: "/locations", title: "Locations", desc: "Review and tidy club and venue records." },
  { href: "/signup-requests", title: "Signup Requests", desc: "Review pending access, profile, and child requests." },
  { href: "/backup", title: "Data Management", desc: "Run maintenance and data cleanup tools." },
  { href: "/audit", title: "Audit Log", desc: "Check important account and system actions." },
  { href: "/usage", title: "Usage Analytics", desc: "Review app activity and usage trends." },
] as const;

export default function HomePage() {
  const router = useRouter();
  const admin = useAdminStatus();
  const [completionMessage] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const complete = params.get("complete");
    const event = params.get("event");
    const winner = params.get("winner");
    return complete === "1" && event && winner ? `${event} is now complete. Winner: ${winner}.` : null;
  });
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userPlayerId, setUserPlayerId] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [secondName, setSecondName] = useState("");
  const [pendingClaim, setPendingClaim] = useState<{ id: string; name: string } | null>(null);
  const [claimStatusOpen, setClaimStatusOpen] = useState(false);
  const [pendingAdminRequest, setPendingAdminRequest] = useState<{ id: string; createdAt: string } | null>(null);
  const [openEventsCount, setOpenEventsCount] = useState<number | null>(null);
  const [resultsQueueCount, setResultsQueueCount] = useState<number | null>(null);
  const [pendingRequestsCount, setPendingRequestsCount] = useState<number | null>(null);
  const [pendingResultSubmissionsCount, setPendingResultSubmissionsCount] = useState<number>(0);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    resolve?: (value: boolean) => void;
  }>({ open: false, title: "", description: "" });

  const quickMatchAllowed = Boolean(admin.userId);
  const createCompetitionAllowed = admin.isAdmin || admin.isSuper;
  const visibleCoreLinks = coreActionLinks.filter((item) => {
    if (item.href === "/quick-match") return quickMatchAllowed;
    if (item.href === "/events/new") return createCompetitionAllowed;
    if (item.href === "/players") return admin.isAdmin || admin.isSuper;
    if (item.href === "/results") return admin.isAdmin || admin.isSuper;
    if (item.href === "/stats") return admin.isAdmin || admin.isSuper;
    return true;
  });
  const visibleSupportLinks = supportLinks.filter((item) => {
    if (item.href === "/welcome-tour") return !admin.isSuper;
    return true;
  });
  const visibleAdminTools = adminToolLinks.filter((item) => {
    if (item.href === "/signups") return admin.isAdmin && !admin.isSuper;
    return admin.isAdmin || admin.isSuper;
  });
  const visibleSystemTools = admin.isSuper ? systemToolLinks : [];
  const dashboardLinks = [...visibleCoreLinks, ...visibleAdminTools, ...visibleSystemTools];
  const cardBaseClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const subtleCardClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillSecondaryClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const pillPrimaryClass = `${pillBaseClass} border-teal-700 bg-teal-700 text-white hover:bg-teal-800`;
  const pillWarningClass = `${pillBaseClass} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`;
  const actionLinkClass = "mt-2 inline-flex items-center rounded-full border border-teal-700 bg-teal-700 px-3 py-1 text-sm font-medium text-white transition hover:bg-teal-800";

  const primaryCardClass = (href: string) => {
    if (admin.isSuper) {
      if (href === "/signup-requests") return `${cardBaseClass} border-l-4 border-l-amber-500 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md`;
      if (href === "/players") return `${cardBaseClass} border-l-4 border-l-teal-600 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md`;
      return `${cardBaseClass} border-l-4 border-l-indigo-500 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md`;
    }
    if (href === "/quick-match") return `${cardBaseClass} border-l-4 border-l-teal-600 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md`;
    if (href === "/events/new") return `${cardBaseClass} border-l-4 border-l-emerald-600 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md`;
    return `${cardBaseClass} border-l-4 border-l-slate-400 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md`;
  };

  const askConfirm = (title: string, description: string, confirmLabel = "Confirm", cancelLabel = "Cancel") =>
    new Promise<boolean>((resolve) => {
      setConfirmState({ open: true, title, description, confirmLabel, cancelLabel, resolve });
    });

  const closeConfirm = (result: boolean) => {
    const resolver = confirmState.resolve;
    setConfirmState({ open: false, title: "", description: "" });
    resolver?.(result);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const complete = params.get("complete");
    const event = params.get("event");
    const winner = params.get("winner");
    if (complete === "1" && event && winner) {
      params.delete("complete");
      params.delete("event");
      params.delete("winner");
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, []);

  useEffect(() => {
    const common = [
      "/quick-match",
      "/events",
      "/events/new",
      "/signups",
      "/players",
      "/results",
      "/signup-requests",
      "/notifications",
      "/stats",
      "/live",
      "/rules",
      "/help",
      "/premium",
      "/legal",
    ];
    common.forEach((path) => router.prefetch(path));
  }, [router]);

  useEffect(() => {
    const run = async () => {
      const client = supabase;
      if (!client) return;
      const { data } = await client.auth.getUser();
      const userId = data.user?.id;
      const authEmail = data.user?.email ?? null;
      setUserEmail(authEmail);
      if (!userId) return;
      const linkRes = await client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle();
      const linkedPlayerId = linkRes.data?.linked_player_id ?? null;
      const { data: player } = linkedPlayerId
        ? await client
            .from("players")
            .select("id,display_name,full_name,location_id")
            .eq("id", linkedPlayerId)
            .maybeSingle()
        : await client
            .from("players")
            .select("id,display_name,full_name,location_id")
            .eq("claimed_by", userId)
            .maybeSingle();
      const emailName =
        authEmail
          ?.split("@")[0]
          ?.split(/[._-]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ") ?? null;
      const name = player?.full_name?.trim() ? player.full_name : player?.display_name ?? emailName;
      setUserName(name);
      setUserPlayerId(player?.id ?? null);
      if (admin.isSuper) {
        setPendingClaim(null);
        setPendingAdminRequest(null);
        return;
      }
      const { data: pending } = await client
        .from("player_claim_requests")
        .select("id,requested_full_name,player_id,status")
        .eq("requester_user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);
      const pendingRow = pending?.[0];
      const pendingName = pendingRow?.requested_full_name ?? null;
      setPendingClaim(pendingRow && pendingName ? { id: pendingRow.id, name: pendingName } : null);
      const { data: pendingAdmin } = await client
        .from("admin_requests")
        .select("id,created_at,status")
        .eq("requester_user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);
      const adminRow = pendingAdmin?.[0] as { id: string; created_at: string } | undefined;
      setPendingAdminRequest(adminRow ? { id: adminRow.id, createdAt: adminRow.created_at } : null);

    };
    run();
  }, [admin.isSuper]);

  useEffect(() => {
    const run = async () => {
      const client = supabase;
      if (!client) return;
      const { count: openCount } = await client
        .from("competitions")
        .select("id", { count: "exact", head: true })
        .eq("is_archived", false)
        .eq("is_completed", false);
      setOpenEventsCount(openCount ?? 0);

      if (admin.isAdmin || admin.isSuper) {
        const { count: resultsCount } = await client
          .from("result_submissions")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending");
        setResultsQueueCount(resultsCount ?? 0);
      } else {
        setResultsQueueCount(null);
      }

      if (admin.isSuper) {
        const tables = [
          "player_claim_requests",
          "player_update_requests",
          "premium_requests",
          "admin_requests",
          "location_requests",
          "profile_merge_requests",
          "player_deletion_requests",
        ];
        const counts = await Promise.all(tables.map((table) => client.from(table).select("id", { count: "exact", head: true }).eq("status", "pending")));
        setPendingRequestsCount(counts.reduce((sum, result) => sum + (result.count ?? 0), 0));
        setPendingResultSubmissionsCount(0);
        return;
      }

      if (admin.isAdmin) {
        const tables = ["player_claim_requests", "player_update_requests", "premium_requests"];
        const counts = await Promise.all(tables.map((table) => client.from(table).select("id", { count: "exact", head: true }).eq("status", "pending")));
        setPendingRequestsCount(counts.reduce((sum, result) => sum + (result.count ?? 0), 0));
        setPendingResultSubmissionsCount(0);
        return;
      }

      const userId = admin.userId;
      if (!userId) {
        setPendingRequestsCount(0);
        setPendingResultSubmissionsCount(0);
        return;
      }
      const [
        { count: adminReqCount },
        { count: premiumReqCount },
        { count: profileUpdateReqCount },
        { count: profileDeletionReqCount },
        { count: profileMergeReqCount },
        { count: resultSubmissionsReqCount },
      ] = await Promise.all([
        client.from("admin_requests").select("id", { count: "exact", head: true }).eq("requester_user_id", userId).eq("status", "pending"),
        client.from("premium_requests").select("id", { count: "exact", head: true }).eq("requester_user_id", userId).eq("status", "pending"),
        client.from("player_update_requests").select("id", { count: "exact", head: true }).eq("requester_user_id", userId).eq("status", "pending"),
        client.from("player_deletion_requests").select("id", { count: "exact", head: true }).eq("requester_user_id", userId).eq("status", "pending"),
        client.from("profile_merge_requests").select("id", { count: "exact", head: true }).eq("requester_user_id", userId).eq("status", "pending"),
        client.from("result_submissions").select("id", { count: "exact", head: true }).eq("submitted_by_user_id", userId).eq("status", "pending"),
      ]);
      const pendingResultCount = resultSubmissionsReqCount ?? 0;
      setPendingRequestsCount(
        (pendingClaim ? 1 : 0) +
          (adminReqCount ?? 0) +
          (premiumReqCount ?? 0) +
          (profileUpdateReqCount ?? 0) +
          (profileDeletionReqCount ?? 0) +
          (profileMergeReqCount ?? 0) +
          pendingResultCount
      );
      setPendingResultSubmissionsCount(pendingResultCount);
    };
    run();
  }, [admin.isAdmin, admin.isSuper, admin.userId, pendingClaim]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (admin.loading || admin.isSuper) return;
    if (!admin.userId || !userPlayerId) return;
    const key = `profile_onboarding_prompt_seen_${admin.userId}_${userPlayerId}`;
    const seen = window.localStorage.getItem(key);
    if (!seen) {
      queueMicrotask(() => {
        setShowProfilePrompt(true);
      });
    }
  }, [admin.loading, admin.isSuper, admin.userId, userPlayerId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (admin.loading || admin.isAdmin) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("claimStatus") !== "1") return;
    if (pendingClaim) {
      queueMicrotask(() => {
        setClaimStatusOpen(true);
      });
    }
    params.delete("claimStatus");
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", next);
  }, [admin.loading, admin.isAdmin, pendingClaim]);

  const submitClaimRequest = async () => {
    setProfileMessage(null);
    const client = supabase;
    if (!client) {
      setProfileMessage("Supabase is not configured.");
      return;
    }
    const first = firstName.trim();
    const second = secondName.trim();
    if (!first || !second) {
      setProfileMessage("Enter your first and second name to continue.");
      return;
    }
    const { data: userRes } = await client.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) {
      setProfileMessage("You must be signed in to submit a profile check.");
      return;
    }
    const fullName = `${first} ${second}`;
    const patternA = `%${first}%${second}%`;
    const patternB = `%${second}%${first}%`;
    const { data: candidates } = await client
      .from("players")
      .select("id,full_name,claimed_by")
      .eq("is_archived", false)
      .or(`full_name.ilike.${patternA},full_name.ilike.${patternB}`)
      .limit(1);
    const candidate = candidates?.[0];
    if (candidate && !candidate.claimed_by) {
      const ok = await askConfirm(
        "Possible profile match",
        `We found a possible match: "${candidate.full_name ?? fullName}". Is this you?`,
        "Yes, that's me",
        "No"
      );
      if (!ok) {
        setProfileMessage("Profile claim cancelled. If this is not you, ask an administrator to create your profile.");
        return;
      }
      const { error } = await client.from("player_claim_requests").insert({
        player_id: candidate.id,
        requester_user_id: userId,
        requested_full_name: candidate.full_name ?? fullName,
        status: "pending",
      });
      if (error) {
        setProfileMessage(`Claim request failed: ${error.message}`);
        return;
      }
      setPendingClaim({ id: candidate.id, name: candidate.full_name ?? fullName });
      setProfileMessage("Claim request sent for administrator approval.");
      setProfileModalOpen(false);
      return;
    }

    const { data: created, error: createError } = await client
      .from("players")
      .insert({
        display_name: first,
        first_name: first,
        nickname: null,
        full_name: fullName,
        is_archived: false,
        claimed_by: null,
      })
      .select("id")
      .single();
    if (createError || !created?.id) {
      setProfileMessage(createError?.message ?? "Unable to create your profile for review.");
      return;
    }
    const { error: claimError } = await client.from("player_claim_requests").insert({
      player_id: created.id,
      requester_user_id: userId,
      requested_full_name: fullName,
      status: "pending",
    });
    if (claimError) {
      setProfileMessage(`Profile created, but claim request failed: ${claimError.message}`);
      return;
    }
    setPendingClaim({ id: created.id, name: fullName });
    setProfileMessage("Profile created and sent for administrator approval.");
    setProfileModalOpen(false);
  };

  const cancelPendingClaim = async () => {
    const client = supabase;
    if (!client || !pendingClaim) return;
    const { error } = await client
      .from("player_claim_requests")
      .update({ status: "rejected" })
      .eq("id", pendingClaim.id)
      .eq("status", "pending");
    if (error) {
      setProfileMessage(`Failed to cancel claim: ${error.message}`);
      return;
    }
    setPendingClaim(null);
    setProfileMessage("Claim request cancelled.");
    setClaimStatusOpen(false);
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-teal-50 via-slate-50 to-amber-50 p-3 sm:p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Dashboard</p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
                  {admin.isSuper
                    ? "Rack & Frame System Dashboard"
                    : "Rack & Frame Club Dashboard"}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  {admin.isSuper
                    ? "Manage approvals, users, and system tools."
                    : "Run quick matches, competitions, players, and results for your club."}
                </p>
              </div>
              <PageNav />
            </div>
          </section>
          {completionMessage ? (
            <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
              {completionMessage}
            </section>
          ) : null}
          <section className={subtleCardClass}>
            <p className="text-sm font-semibold text-slate-900">{admin.isSuper ? "System Status" : "Club Status"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!admin.isSuper ? (
                <Link href="/events" className={pillSecondaryClass}>
                  Open events: {openEventsCount ?? "-"}
                </Link>
              ) : null}
              {(admin.isAdmin || admin.isSuper) && (
                <Link href="/results" className={(resultsQueueCount ?? 0) > 0 ? pillPrimaryClass : pillSecondaryClass}>
                  Results queue: {resultsQueueCount ?? "-"}
                </Link>
              )}
              {pendingRequestsCount !== null && (
                <Link
                  href={admin.isSuper ? "/players" : admin.isAdmin ? "/players" : "/notifications"}
                  className={pendingRequestsCount > 0 ? pillWarningClass : pillSecondaryClass}
                >
                  {admin.isSuper ? "Pending governance requests" : "Pending requests"}: {pendingRequestsCount}
                </Link>
              )}
            </div>
          </section>
          <section className={subtleCardClass}>
            <p className="text-sm text-slate-600">{admin.isSuper ? "Account" : "User Profile"}</p>
            <div className="flex flex-wrap items-center gap-2">
              {userPlayerId ? (
                <Link href={`/players/${userPlayerId}`} className="text-lg font-semibold text-slate-900 underline-offset-4 hover:underline">
                  {admin.isSuper
                    ? userName || "Super User account"
                    : admin.isAdmin
                      ? userName || "Administrator account"
                      : userName
                        ? `Logged in as ${userName}`
                        : "No player profile linked"}
                </Link>
              ) : (
                <p className="text-lg font-semibold text-slate-900">
                  {admin.isSuper
                    ? userName || "Super User account"
                    : admin.isAdmin
                      ? userName || "Administrator account"
                      : userName
                        ? `Logged in as ${userName}`
                        : "No player profile linked"}
                </p>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  admin.isSuper
                    ? "bg-amber-100 text-amber-800"
                    : admin.isAdmin
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                {admin.isSuper ? "Super User" : admin.isAdmin ? "Administrator" : "User"}
              </span>
            </div>
            {userEmail ? <p className="text-sm text-slate-600">Logged in: {userEmail}</p> : null}
            {admin.isSuper ? (
              <p className="mt-2 text-sm text-slate-700">
                Focus: approvals, account governance, audit visibility, and system maintenance.
              </p>
            ) : null}
            {!admin.isSuper && userPlayerId ? (
              <Link href={`/players/${userPlayerId}`} className={actionLinkClass}>
                View my profile
              </Link>
            ) : null}
            {!admin.isAdmin && !userName ? (
                  <button type="button" onClick={() => setProfileModalOpen(true)} className={actionLinkClass}>
                    Link my player profile
                  </button>
                ) : null}
            {!admin.isAdmin && !userName && pendingClaim ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-sm text-amber-700">Claim pending approval for {pendingClaim.name}.</p>
                <button
                  type="button"
                  onClick={() => setClaimStatusOpen(true)}
                  className="text-sm text-teal-700 underline underline-offset-4"
                >
                  View claim status
                </button>
              </div>
            ) : null}
            {!admin.isAdmin ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">Profile and account status</p>
                <p className="text-xs text-slate-600">Use your player profile for account changes and access requests.</p>
                {(pendingRequestsCount ?? 0) > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    You have {(pendingRequestsCount ?? 0)} pending request{(pendingRequestsCount ?? 0) === 1 ? "" : "s"}.
                    <Link href="/notifications" className="ml-2 underline underline-offset-2">
                      View status
                    </Link>
                  </div>
                ) : null}
                {pendingResultSubmissionsCount > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Result submission pending approval ({pendingResultSubmissionsCount}).
                    <Link href="/notifications" className="ml-2 underline underline-offset-2">
                      View status
                    </Link>
                  </div>
                ) : null}
                {pendingAdminRequest ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Club admin request pending since{" "}
                    {new Date(pendingAdminRequest.createdAt).toLocaleString()}.
                  </p>
                ) : null}
                {!pendingAdminRequest && userPlayerId ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Club admin is for organisers, not every player.</p>
                    <p className="mt-1">
                      Request this only if you help run competitions, review results, and manage player activity for your club.
                    </p>
                    <Link href={`/players/${userPlayerId}`} className={`${actionLinkClass} mt-3`}>
                      Go to my profile to request club admin access
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}
            {profileMessage ? <p className="mt-2 text-sm text-slate-700">{profileMessage}</p> : null}
          </section>

          <section className="space-y-3">
            <div className="grid gap-2 sm:gap-3 sm:grid-cols-3">
              {dashboardLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={primaryCardClass(item.href)}
                >
                  <h2 className="text-base sm:text-lg font-semibold text-slate-900">{item.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{item.desc}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-teal-700">Open</p>
                </Link>
              ))}
            </div>

            {visibleSupportLinks.length ? (
              <div className={cardBaseClass}>
                <p className="text-sm font-semibold text-slate-900">Support</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {visibleSupportLinks.map((item) => (
                    <Link key={item.href} href={item.href} className={pillSecondaryClass}>
                      {item.title}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            <p className="text-center text-xs uppercase tracking-[0.18em] text-slate-500">
              Designed and developed by Martin Chamberlain
            </p>
          </section>

          {profileModalOpen && !admin.isAdmin ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
                <h2 className="text-lg font-semibold text-slate-900">Profile check</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Enter your first and second name. We’ll check for an unclaimed profile and send a claim request for approval.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="Second name"
                    value={secondName}
                    onChange={(e) => setSecondName(e.target.value)}
                  />
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                    onClick={() => setProfileModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-teal-700 px-3 py-2 text-sm font-medium text-white"
                    onClick={submitClaimRequest}
                  >
                    Submit for approval
                  </button>
                </div>
                {profileMessage ? <p className="mt-3 text-sm text-amber-800">{profileMessage}</p> : null}
              </div>
            </div>
          ) : null}

          {claimStatusOpen && pendingClaim && !admin.isAdmin ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
                <h2 className="text-lg font-semibold text-slate-900">Claim status</h2>
                <p className="mt-1 text-sm text-slate-600">Awaiting administrator approval for:</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{pendingClaim.name}</p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                    onClick={() => setClaimStatusOpen(false)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white"
                    onClick={cancelPendingClaim}
                  >
                    Cancel request
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </RequireAuth>
      </div>
      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel={confirmState.cancelLabel}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
      <ConfirmModal
        open={showProfilePrompt}
        title="Review your profile"
        description="Would you like to review your profile now and optionally upload a profile picture?"
        confirmLabel="Review now"
        cancelLabel="Later"
        onConfirm={() => {
          if (typeof window !== "undefined" && admin.userId && userPlayerId) {
            const key = `profile_onboarding_prompt_seen_${admin.userId}_${userPlayerId}`;
            window.localStorage.setItem(key, "1");
          }
          setShowProfilePrompt(false);
          if (userPlayerId) router.push(`/players/${userPlayerId}?prompt=photo`);
        }}
        onCancel={() => {
          if (typeof window !== "undefined" && admin.userId && userPlayerId) {
            const key = `profile_onboarding_prompt_seen_${admin.userId}_${userPlayerId}`;
            window.localStorage.setItem(key, "1");
          }
          setShowProfilePrompt(false);
        }}
      />
    </main>
  );
}
