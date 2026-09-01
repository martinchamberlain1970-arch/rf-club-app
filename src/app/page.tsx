"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import ConfirmModal from "@/components/ConfirmModal";
import { buildSharedLinkSuggestion, SharedLinkPlayer } from "@/lib/shared-player-links";

const coreActionLinks = [
  { href: "/quick-match", title: "Quick Match", desc: "Start a local practice or social match." },
  { href: "/events/new", title: "Create Competition", desc: "Set up a knockout competition for your club." },
  { href: "/events", title: "Events", desc: "See active, completed, and archived competitions." },
  { href: "/players", title: "Players", desc: "Register and manage club players." },
  { href: "/results", title: "Results", desc: "Review and approve submitted match results." },
  { href: "/notifications", title: "Notifications", desc: "Check inbox updates and pending actions." },
  { href: "/stats", title: "Stats", desc: "View club rankings, form, and performance summaries." },
  { href: "/high-breaks", title: "High Breaks", desc: "See the dedicated snooker high-break table." },
  { href: "/rankings", title: "Rankings", desc: "Browse Elo-style player leaderboards by discipline." },
] as const;

const supportLinks = [
  { href: "/install", title: "Install App" },
  { href: "/rules", title: "Rules" },
  { href: "/help", title: "Help" },
  { href: "/help#report-an-issue", title: "Report An Issue" },
  { href: "/premium", title: "Premium" },
  { href: "/welcome-tour", title: "Welcome Tour" },
  { href: "/legal", title: "Legal" },
] as const;

const adminToolLinks = [
  { href: "/signups", title: "Competition Sign-ups", desc: "Review open sign-ups and player entry requests." },
  { href: "/live", title: "Live Overview", desc: "See active matches and competition progress at a glance." },
  { href: "/table-bookings", title: "Table Bookings", desc: "Manage pool and snooker reservations and captain access." },
] as const;

const systemToolLinks = [
  { href: "/locations", title: "Locations", desc: "Review and tidy club and venue records." },
  { href: "/signup-requests", title: "Signup Requests", desc: "Review pending access, profile, and child requests." },
  { href: "/snooker-handicap-exceptions", title: "Handicap Exceptions", desc: "Set first-time snooker handicaps and seed starting Elo." },
  { href: "/shared-player-links", title: "Shared Player Links", desc: "Review suggested club-to-league player matches and create Elo links." },
  { href: "/reschedules", title: "Fixture week requests", desc: "Review requests to play one week early or later." },
  { href: "/weekly-reviews", title: "Weekly Reviews", desc: "Generate, publish and share weekly league reports." },
  { href: "/backup", title: "Data Management", desc: "Run maintenance and data cleanup tools." },
  { href: "/audit", title: "Audit Log", desc: "Check important account and system actions." },
  { href: "/emails", title: "System Email Activity", desc: "Track registration, password-reset and table-booking emails." },
  { href: "/usage", title: "Accounts & Activity", desc: "See registrations, login activity, and what each person uses." },
] as const;

type PriorityTone = "teal" | "emerald" | "indigo" | "amber" | "violet";
type PriorityCard = {
  href: string;
  title: string;
  value: number;
  tone: PriorityTone;
  detail: string;
};
type DashboardLink = { href: string; title: string; desc: string };
type ExperienceMode = "player" | "manage";
type HomeTableBooking = {
  id: string;
  startsAt: string;
  endsAt: string;
  tableName: string;
  title: string;
  status: "pending" | "booked" | "rejected";
};

const playerExperienceLinks = [
  { href: "/my-fixtures", title: "My Fixtures", desc: "Weekly view, all fixtures, results and tables.", symbol: "PLAY" },
  { href: "/table-bookings", title: "Table Bookings", desc: "View your bookings or reserve a pool or snooker table.", symbol: "BOOK" },
  { href: "/events", title: "Competitions", desc: "Open events, draws and tables.", symbol: "PLAY" },
  { href: "/rankings", title: "Rankings", desc: "See where you stand.", symbol: "RANK" },
  { href: "/high-breaks", title: "High Breaks", desc: "Club snooker break table.", symbol: "BREAK" },
  { href: "/quick-match", title: "Quick Match", desc: "Start a social or practice match.", symbol: "START" },
  { href: "/notifications", title: "Updates", desc: "Results, requests and messages.", symbol: "NEWS" },
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
  const [userMissingAvatar, setUserMissingAvatar] = useState(false);
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
  const [sharedLinkSuggestionsCount, setSharedLinkSuggestionsCount] = useState<number>(0);
  const [sharedLinksMonthlyReviewDue, setSharedLinksMonthlyReviewDue] = useState(false);
  const [tableBookingsLoading, setTableBookingsLoading] = useState(true);
  const [upcomingTableBookings, setUpcomingTableBookings] = useState<HomeTableBooking[]>([]);
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>("manage");
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
  const canManage = admin.isAdmin || admin.isSuper;
  const isManageMode = canManage && experienceMode === "manage";
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
  const allDashboardLinks: DashboardLink[] = [
    ...(userPlayerId
      ? [{ href: "/my-fixtures", title: "My Fixtures", desc: "Open weekly fixtures, your full schedule, results and league tables." }]
      : []),
    ...visibleCoreLinks,
    ...visibleAdminTools,
  ];
  const primaryHrefOrder = admin.isSuper
    ? ["/my-fixtures", "/events", "/events/new", "/results", "/players", "/live"]
    : admin.isAdmin
      ? ["/my-fixtures", "/events", "/events/new", "/signups", "/results", "/players"]
      : ["/my-fixtures", "/events", "/quick-match", "/notifications", "/rankings", "/high-breaks"];
  const dashboardPrimaryLinks = (() => {
    const selected: DashboardLink[] = [];
    const selectedHrefs = new Set<string>();
    for (const href of primaryHrefOrder) {
      const link = allDashboardLinks.find((item) => item.href === href);
      if (link && !selectedHrefs.has(link.href)) {
        selected.push(link);
        selectedHrefs.add(link.href);
      }
    }
    for (const link of allDashboardLinks) {
      if (selected.length >= 6) break;
      if (!selectedHrefs.has(link.href)) {
        selected.push(link);
        selectedHrefs.add(link.href);
      }
    }
    return selected;
  })();
  const primaryDashboardHrefs = new Set(dashboardPrimaryLinks.map((item) => item.href));
  const dashboardMoreLinks = allDashboardLinks.filter((item) => !primaryDashboardHrefs.has(item.href));
  const cardBaseClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const subtleCardClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillSecondaryClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const pillPrimaryClass = `${pillBaseClass} border-teal-700 bg-teal-700 text-white hover:bg-teal-800`;
  const pillWarningClass = `${pillBaseClass} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`;
  const actionLinkClass = "mt-2 inline-flex items-center rounded-full border border-teal-700 bg-teal-700 px-3 py-1 text-sm font-medium text-white transition hover:bg-teal-800";
  const priorityCards = useMemo<PriorityCard[]>(() => {
    if (admin.isSuper) {
      return [
        {
          href: "/results",
          title: "Results Queue",
          value: resultsQueueCount ?? 0,
          tone: "emerald",
          detail: "Pending club result approvals and corrections needing attention.",
        },
        {
          href: "/signup-requests",
          title: "Governance Requests",
          value: pendingRequestsCount ?? 0,
          tone: "amber",
          detail: "Access, profile, child, and other queued requests for review.",
        },
        {
          href: "/shared-player-links",
          title: "Shared Player Links",
          value: sharedLinkSuggestionsCount,
          tone: "indigo",
          detail: "Live club-to-league mapping suggestions waiting to be checked.",
        },
      ];
    }
    if (admin.isAdmin) {
      return [
        {
          href: "/events",
          title: "Open Competitions",
          value: openEventsCount ?? 0,
          tone: "teal",
          detail: "Current club competitions and day-to-day event activity.",
        },
        {
          href: "/results",
          title: "Results Queue",
          value: resultsQueueCount ?? 0,
          tone: "emerald",
          detail: "Submitted match results awaiting club admin review.",
        },
        {
          href: "/notifications",
          title: "Notifications",
          value: pendingRequestsCount ?? 0,
          tone: "violet",
          detail: "Updates affecting approvals, requests, and account actions.",
        },
      ];
    }
    return [
      {
        href: "/events",
        title: "Open Competitions",
        value: openEventsCount ?? 0,
        tone: "teal",
        detail: "What is currently active at club level right now.",
      },
      {
        href: "/notifications",
        title: "Notifications",
        value: pendingRequestsCount ?? 0,
        tone: "violet",
        detail: "Track profile, result, and competition-related updates.",
      },
      {
        href: "/high-breaks",
        title: "High Breaks",
        value: 1,
        tone: "indigo",
        detail: "Jump straight to the dedicated club snooker break table.",
      },
    ];
  }, [admin.isAdmin, admin.isSuper, openEventsCount, pendingRequestsCount, resultsQueueCount, sharedLinkSuggestionsCount]);
  const priorityCardClass = (tone: PriorityTone) => {
    if (tone === "teal") return "border-teal-200 bg-gradient-to-br from-teal-50 to-white";
    if (tone === "emerald") return "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white";
    if (tone === "indigo") return "border-indigo-200 bg-gradient-to-br from-indigo-50 to-white";
    if (tone === "amber") return "border-amber-200 bg-gradient-to-br from-amber-50 to-white";
    return "border-violet-200 bg-gradient-to-br from-violet-50 to-white";
  };
  const priorityValueClass = (tone: PriorityTone) => {
    if (tone === "teal") return "text-teal-700";
    if (tone === "emerald") return "text-emerald-700";
    if (tone === "indigo") return "text-indigo-700";
    if (tone === "amber") return "text-amber-700";
    return "text-violet-700";
  };

  const primaryCardClass = (href: string) => {
    const base = "rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md";
    if (href === "/quick-match") return `${base} border-teal-200 bg-gradient-to-br from-teal-50 to-white`;
    if (href === "/events/new") return `${base} border-emerald-200 bg-gradient-to-br from-emerald-50 to-white`;
    if (href === "/events") return `${base} border-sky-200 bg-gradient-to-br from-sky-50 to-white`;
    if (href === "/players") return `${base} border-indigo-200 bg-gradient-to-br from-indigo-50 to-white`;
    if (href === "/results") return `${base} border-emerald-200 bg-gradient-to-br from-emerald-50 to-white`;
    if (href === "/notifications") return `${base} border-violet-200 bg-gradient-to-br from-violet-50 to-white`;
    if (href === "/stats") return `${base} border-amber-200 bg-gradient-to-br from-amber-50 to-white`;
    if (href === "/high-breaks") return `${base} border-cyan-200 bg-gradient-to-br from-cyan-50 to-white`;
    if (href === "/rankings") return `${base} border-indigo-200 bg-gradient-to-br from-indigo-50 to-white`;
    if (href === "/signups") return `${base} border-amber-200 bg-gradient-to-br from-amber-50 to-white`;
    if (href === "/live") return `${base} border-sky-200 bg-gradient-to-br from-sky-50 to-white`;
    if (href === "/shared-player-links") return `${base} border-indigo-200 bg-gradient-to-br from-indigo-50 to-white`;
    if (href === "/snooker-handicap-exceptions") return `${base} border-teal-200 bg-gradient-to-br from-teal-50 to-white`;
    if (href === "/signup-requests") return `${base} border-amber-200 bg-gradient-to-br from-amber-50 to-white`;
    if (href === "/backup" || href === "/audit" || href === "/usage") return `${base} border-slate-200 bg-gradient-to-br from-slate-50 to-white`;
    return `${base} border-slate-200 bg-gradient-to-br from-slate-50 to-white`;
  };
  const primaryTileBadgeClass = (href: string) => {
    if (href === "/quick-match") return "border-teal-300 bg-teal-100 text-teal-900";
    if (href === "/events/new" || href === "/results") return "border-emerald-300 bg-emerald-100 text-emerald-900";
    if (href === "/events" || href === "/live") return "border-sky-300 bg-sky-100 text-sky-900";
    if (href === "/players" || href === "/rankings" || href === "/shared-player-links") return "border-indigo-300 bg-indigo-100 text-indigo-900";
    if (href === "/notifications") return "border-violet-300 bg-violet-100 text-violet-900";
    if (href === "/stats" || href === "/signups" || href === "/signup-requests") return "border-amber-300 bg-amber-100 text-amber-900";
    if (href === "/high-breaks") return "border-cyan-300 bg-cyan-100 text-cyan-900";
    return "border-slate-300 bg-slate-100 text-slate-800";
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

  const changeExperienceMode = (mode: ExperienceMode) => {
    setExperienceMode(mode);
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
      "/high-breaks",
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
            .select("id,display_name,full_name,location_id,avatar_url")
            .eq("id", linkedPlayerId)
            .maybeSingle()
        : await client
            .from("players")
            .select("id,display_name,full_name,location_id,avatar_url")
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
      setUserMissingAvatar(Boolean(player?.id) && !player?.avatar_url);
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
      if (!admin.userId) {
        setUpcomingTableBookings([]);
        setTableBookingsLoading(false);
        return;
      }
      const client = supabase;
      if (!client) {
        setTableBookingsLoading(false);
        return;
      }
      setTableBookingsLoading(true);
      const session = await client.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setTableBookingsLoading(false);
        return;
      }
      const response = await fetch("/api/table-bookings", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) {
        setUpcomingTableBookings([]);
        setTableBookingsLoading(false);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        tables?: Array<{ id: string; name: string }>;
        reservations?: Array<{
          id: string;
          table_id: string;
          booked_by_user_id: string;
          booked_for_player_id: string;
          starts_at: string;
          ends_at: string;
          purpose: "fixture" | "league_match" | "other";
          notes: string | null;
          status: "pending" | "booked" | "rejected" | "cancelled";
          participant_one: string | null;
          participant_two: string | null;
          team_name: string | null;
        }>;
      };
      const tableNames = new Map((payload.tables ?? []).map((table) => [table.id, table.name]));
      const ownBookings = (payload.reservations ?? [])
        .filter((booking) => (
          booking.booked_by_user_id === admin.userId ||
          Boolean(userPlayerId && booking.booked_for_player_id === userPlayerId)
        ) && booking.status !== "cancelled")
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
        .slice(0, 3)
        .map((booking) => ({
          id: booking.id,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          tableName: tableNames.get(booking.table_id) ?? "Cue table",
          title: booking.purpose === "league_match"
            ? booking.team_name || "Home league match"
            : booking.purpose === "other"
              ? booking.notes || "Other booking"
              : [booking.participant_one, booking.participant_two].filter(Boolean).join(" vs. ") || "Competition fixture",
          status: booking.status,
        })) as HomeTableBooking[];
      setUpcomingTableBookings(ownBookings);
      setTableBookingsLoading(false);
    };
    void run();
  }, [admin.userId, userPlayerId]);

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
        const sessionRes = await client.auth.getSession();
        const token = sessionRes.data.session?.access_token;
        if (token) {
          const sharedRes = await fetch("/api/rating/shared-link-candidates", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const sharedBody = (await sharedRes.json().catch(() => ({}))) as {
            clubPlayers?: SharedLinkPlayer[];
            leaguePlayers?: SharedLinkPlayer[];
            existingLinks?: Array<{ source_player_id: string; league_player_id: string }>;
          };
          if (sharedRes.ok) {
            const clubPlayers = sharedBody.clubPlayers ?? [];
            const leaguePlayers = sharedBody.leaguePlayers ?? [];
            const existingLinks = sharedBody.existingLinks ?? [];
            const linkedClubIds = new Set(existingLinks.map((link) => link.source_player_id));
            const linkedLeagueIds = new Set(existingLinks.map((link) => link.league_player_id));
            const suggestions = clubPlayers
              .filter((clubPlayer) => !linkedClubIds.has(clubPlayer.id))
              .flatMap((clubPlayer) =>
                leaguePlayers
                  .filter((leaguePlayer) => !linkedLeagueIds.has(leaguePlayer.id))
                  .map((leaguePlayer) => buildSharedLinkSuggestion(clubPlayer, leaguePlayer))
                  .filter((row) => Boolean(row))
                  .slice(0, 3)
              );
            setSharedLinkSuggestionsCount(suggestions.length);
          } else {
            setSharedLinkSuggestionsCount(0);
          }
        }
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
        if (typeof window !== "undefined") {
          const lastReviewedAt = window.localStorage.getItem("shared_player_links_last_reviewed_at");
          const thresholdMs = 1000 * 60 * 60 * 24 * 30;
          const due = !lastReviewedAt || Date.now() - new Date(lastReviewedAt).getTime() >= thresholdMs;
          setSharedLinksMonthlyReviewDue(due);
        }
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
    const sessionKey = `profile_photo_prompt_seen_${admin.userId}_${userPlayerId}`;
    if (userMissingAvatar) {
      const seenThisSession = window.sessionStorage.getItem(sessionKey);
      if (!seenThisSession) {
        queueMicrotask(() => {
          setShowProfilePrompt(true);
          window.sessionStorage.setItem(sessionKey, "1");
        });
      }
      return;
    }
    queueMicrotask(() => setShowProfilePrompt(false));
  }, [admin.loading, admin.isSuper, admin.userId, userPlayerId, userMissingAvatar]);

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
    <main className={`min-h-screen p-3 sm:p-6 ${isManageMode ? "bg-slate-950" : "bg-gradient-to-b from-emerald-950 via-teal-950 to-slate-100"}`}>
      <div className={`mx-auto space-y-3 sm:space-y-4 ${isManageMode ? "max-w-6xl" : "max-w-5xl pb-20 sm:pb-0"}`}>
        <RequireAuth>
          <section className={`rounded-3xl border p-4 shadow-lg sm:p-5 ${isManageMode ? "border-slate-700 bg-slate-900 text-white" : "border-emerald-300/30 bg-emerald-950/80 text-white backdrop-blur"}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isManageMode ? "text-amber-300" : "text-emerald-300"}`}>
                  {isManageMode ? "Competition control" : "Your club. Your game."}
                </p>
                <h1 className="text-2xl font-black sm:text-3xl">
                  Rack &amp; Frame
                </h1>
                <p className={`mt-1 text-sm ${isManageMode ? "text-slate-300" : "text-emerald-100"}`}>
                  {isManageMode ? "Run competitions, entrants, fixtures and results." : `Welcome${userName ? `, ${userName.split(" ")[0]}` : ""}. Ready to play?`}
                </p>
              </div>
              <PageNav />
            </div>
            {canManage ? (
              <div className="mt-4 inline-flex rounded-full border border-white/20 bg-black/20 p-1" aria-label="Choose dashboard view">
                <button
                  type="button"
                  onClick={() => changeExperienceMode("player")}
                  aria-pressed={!isManageMode}
                  className={`rounded-full px-4 py-2 text-sm font-bold transition ${!isManageMode ? "bg-white text-emerald-950 shadow" : "text-slate-300 hover:text-white"}`}
                >
                  Player
                </button>
                <button
                  type="button"
                  onClick={() => changeExperienceMode("manage")}
                  aria-pressed={isManageMode}
                  className={`rounded-full px-4 py-2 text-sm font-bold transition ${isManageMode ? "bg-amber-300 text-slate-950 shadow" : "text-emerald-100 hover:text-white"}`}
                >
                  Manage
                </button>
              </div>
            ) : null}
          </section>
          {completionMessage ? (
            <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
              {completionMessage}
            </section>
          ) : null}
          <section className={`${subtleCardClass} ${isManageMode ? "border-slate-700 bg-slate-900 text-white" : "border-emerald-100"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${isManageMode ? "text-slate-400" : "text-slate-500"}`}>Signed in</p>
                {userPlayerId ? (
                  <Link href={`/players/${userPlayerId}`} className={`text-lg font-bold underline-offset-4 hover:underline ${isManageMode ? "text-white" : "text-slate-900"}`}>
                    {userName || (admin.isSuper ? "Super User account" : admin.isAdmin ? "Administrator account" : "Player account")}
                  </Link>
                ) : (
                  <p className={`text-lg font-bold ${isManageMode ? "text-white" : "text-slate-900"}`}>
                    {userName || (admin.isSuper ? "Super User account" : admin.isAdmin ? "Administrator account" : "No player profile linked")}
                  </p>
                )}
                {userEmail ? <p className={`text-xs ${isManageMode ? "text-slate-400" : "text-slate-500"}`}>{userEmail}</p> : null}
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${admin.isSuper ? "bg-amber-100 text-amber-800" : admin.isAdmin ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {admin.isSuper ? "Super User" : admin.isAdmin ? "Administrator" : "Player"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!admin.isSuper ? <Link href="/events" className={pillSecondaryClass}>Open events: {openEventsCount ?? "-"}</Link> : null}
              {(admin.isAdmin || admin.isSuper) ? (
                <Link href="/results" className={(resultsQueueCount ?? 0) > 0 ? pillPrimaryClass : pillSecondaryClass}>
                  Results: {resultsQueueCount ?? "-"}
                </Link>
              ) : null}
              {pendingRequestsCount !== null ? (
                <Link href={admin.isSuper || admin.isAdmin ? "/players" : "/notifications"} className={pendingRequestsCount > 0 ? pillWarningClass : pillSecondaryClass}>
                  Requests: {pendingRequestsCount}
                </Link>
              ) : null}
              {userPlayerId ? <Link href={`/players/${userPlayerId}`} className={pillSecondaryClass}>My profile</Link> : null}
              {!admin.isAdmin && !userName ? (
                <button type="button" onClick={() => setProfileModalOpen(true)} className={pillPrimaryClass}>Link player profile</button>
              ) : null}
            </div>
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
              <div className="mt-3 space-y-2">
                {(pendingRequestsCount ?? 0) > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    You have {(pendingRequestsCount ?? 0)} pending request{(pendingRequestsCount ?? 0) === 1 ? "" : "s"}.
                    <Link href="/notifications" className="ml-2 underline underline-offset-2">
                      View status
                    </Link>
                  </div>
                ) : null}
                {pendingResultSubmissionsCount > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
                  <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <summary className="cursor-pointer font-semibold text-slate-900">Need club admin access?</summary>
                    <p className="mt-2">Request this only if you help run competitions, review results, and manage player activity for your club.</p>
                    <Link href={`/players/${userPlayerId}`} className={`${actionLinkClass} mt-2`}>Request club admin access</Link>
                  </details>
                ) : null}
              </div>
            ) : null}
            {profileMessage ? <p className="mt-2 text-sm text-slate-700">{profileMessage}</p> : null}
          </section>

          {!isManageMode ? (
            <section className="rounded-3xl border border-emerald-200 bg-white p-4 shadow-lg sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">My upcoming table bookings</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">Your reserved table time</h2>
                </div>
                <Link href="/table-bookings" className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-bold text-white">View all / manage</Link>
              </div>
              {tableBookingsLoading ? <p className="mt-4 text-sm text-slate-600">Checking your bookings…</p> : upcomingTableBookings.length ? (
                <div className="mt-4 divide-y divide-slate-200">
                  {upcomingTableBookings.map((booking) => {
                    const start = new Date(booking.startsAt);
                    const end = new Date(booking.endsAt);
                    const date = start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
                    const startTime = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
                    const endTime = end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
                    return (
                      <article key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div>
                          <p className="font-black text-slate-950">{date}, {startTime}–{endTime}</p>
                          <p className="mt-1 text-sm text-slate-700">{booking.tableName} · <strong>{booking.title}</strong></p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${booking.status === "booked" ? "bg-emerald-100 text-emerald-800" : booking.status === "pending" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>
                          {booking.status === "booked" ? "Confirmed" : booking.status}
                        </span>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <p className="text-sm text-slate-700">You have no upcoming table bookings.</p>
                  <Link href="/table-bookings" className="mt-3 inline-flex rounded-full border border-emerald-700 px-4 py-2 text-sm font-bold text-emerald-800">Make a booking</Link>
                </div>
              )}
            </section>
          ) : null}

          {!isManageMode ? (
            <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-xl">
              <div className="bg-gradient-to-r from-emerald-700 to-teal-700 p-5 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100">Player home</p>
                <h2 className="mt-1 text-2xl font-black">Everything you need to play</h2>
                <p className="mt-1 text-sm text-emerald-50">Fixtures, competitions and results without the management clutter.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:p-5">
                {playerExperienceLinks
                  .filter((item) => item.href !== "/my-fixtures" || userPlayerId)
                  .filter((item) => item.href !== "/quick-match" || quickMatchAllowed)
                  .map((item, index) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group min-h-32 rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-lg ${index === 0 ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
                    >
                      <span className="text-[10px] font-black tracking-[0.16em] text-emerald-700">{item.symbol}</span>
                      <h3 className="mt-4 text-lg font-black text-slate-950">{item.title}</h3>
                      <p className="mt-1 text-xs text-slate-600">{item.desc}</p>
                    </Link>
                  ))}
              </div>
            </section>
          ) : null}

          {isManageMode ? (
            <section className={`${subtleCardClass} flex flex-wrap items-center gap-3`}>
              <div className="mr-auto">
                <h2 className="text-base font-bold text-slate-950">Competition shortcuts</h2>
                <p className="mt-0.5 text-xs text-slate-500">Create and manage competitions.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["Create", "/events/new"],
                  ["Entrants", "/signups"],
                  ["Fixtures", "/events"],
                  ["Live", "/live"],
                  ["Results", "/results"],
                  ["Weekly reviews", "/weekly-reviews"],
                ].map(([label, href]) => (
                  <Link key={label} href={href} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-900">
                    {label}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {isManageMode ? <section className={subtleCardClass}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-950">Needs attention</h2>
              <span className="text-xs font-medium text-slate-500">Tap to open</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
              {priorityCards.map((card) => (
                <Link
                  key={`${card.href}|${card.title}`}
                  href={card.href}
                  className={`rounded-xl border p-2.5 sm:p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${priorityCardClass(card.tone)}`}
                >
                  <p className={`text-2xl sm:text-4xl font-black leading-none ${priorityValueClass(card.tone)}`}>{card.value}</p>
                  <p className="mt-2 text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-700 sm:text-xs">{card.title}</p>
                  <p className="mt-2 hidden text-sm text-slate-700 sm:block">{card.detail}</p>
                </Link>
              ))}
            </div>
          </section> : null}

          {isManageMode ? <section className={cardBaseClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-950">Main actions</h2>
                <p className="text-xs text-slate-500">Your most useful shortcuts</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
              {dashboardPrimaryLinks.map((item) => (
                <Link key={item.href} href={item.href} className={`${primaryCardClass(item.href)} min-h-20 p-3 sm:min-h-0 sm:p-4`}>
                  <h3 className="text-sm font-bold text-slate-900 sm:text-lg">{item.title}</h3>
                  <p className="mt-1 hidden text-sm text-slate-600 sm:block">{item.desc}</p>
                  <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:mt-3 sm:px-2.5 sm:py-1 sm:text-xs ${primaryTileBadgeClass(item.href)}`}>
                    Open
                  </span>
                </Link>
              ))}
            </div>
          </section> : null}

          {isManageMode ? <section className="space-y-3">
            {dashboardMoreLinks.length ? (
              <details className={cardBaseClass}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-slate-900">
                  <span>More competition &amp; club tools</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{dashboardMoreLinks.length}</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                  {dashboardMoreLinks.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${primaryCardClass(item.href)} p-3 sm:p-4`}
                    >
                      <h3 className="text-sm font-bold text-slate-900 sm:text-lg">{item.title}</h3>
                      <p className="mt-1 hidden text-sm text-slate-600 sm:block">{item.desc}</p>
                    </Link>
                  ))}
                </div>
              </details>
            ) : null}

            {visibleSystemTools.length ? (
              <details className={cardBaseClass}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-slate-900">
                  <span>System administration</span>
                  <span className="flex items-center gap-2">
                    {sharedLinkSuggestionsCount > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{sharedLinkSuggestionsCount} to review</span> : null}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{visibleSystemTools.length}</span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-slate-600">Governance, records, audit and back-office controls.</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                    {visibleSystemTools.map((item) => (
                      <Link key={item.href} href={item.href} className={`${primaryCardClass(item.href)} p-3 sm:p-4`}>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-bold text-slate-900 sm:text-lg">{item.title}</h3>
                          {item.href === "/shared-player-links" && sharedLinkSuggestionsCount > 0 ? (
                            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
                              {sharedLinkSuggestionsCount}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 hidden text-sm text-slate-600 sm:block">{item.desc}</p>
                      </Link>
                    ))}
                </div>
              </details>
            ) : null}

            {admin.isSuper && sharedLinksMonthlyReviewDue ? (
              <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-cyan-50 p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="max-w-3xl">
                    <p className="text-sm font-semibold text-amber-800">Monthly shared-player-link review is due</p>
                  </div>
                  <Link href="/shared-player-links" className={actionLinkClass}>Review</Link>
                </div>
              </div>
            ) : null}

            {!admin.isSuper ? (
              <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-teal-50 p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold text-teal-800">Premium access</p><p className="text-xs text-slate-600">Advanced competition and player features</p></div>
                  <Link href="/premium" className={actionLinkClass}>View Premium</Link>
                </div>
              </div>
            ) : null}

            {visibleSupportLinks.length ? (
              <details className={cardBaseClass}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-slate-900">
                  <span>Help, installation &amp; support</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{visibleSupportLinks.length}</span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {visibleSupportLinks.map((item) => (
                    <Link key={item.href} href={item.href} className={pillSecondaryClass}>
                      {item.title}
                    </Link>
                  ))}
                </div>
              </details>
            ) : null}

            <p className="text-center text-xs uppercase tracking-[0.18em] text-slate-500">
              Designed and developed by Martin Chamberlain
            </p>
          </section> : (
            <section className="space-y-3">
              {visibleSupportLinks.length ? (
                <details className={cardBaseClass}>
                  <summary className="cursor-pointer font-semibold text-slate-900">Install, help &amp; support</summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {visibleSupportLinks.map((item) => <Link key={item.href} href={item.href} className={pillSecondaryClass}>{item.title}</Link>)}
                  </div>
                </details>
              ) : null}
              <p className="text-center text-xs uppercase tracking-[0.18em] text-slate-500">Designed and developed by Martin Chamberlain</p>
            </section>
          )}

          {!isManageMode ? (
            <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-4 rounded-2xl border border-emerald-200 bg-white/95 p-2 shadow-2xl backdrop-blur sm:hidden" aria-label="Player shortcuts">
              {[
                ["Home", "/"],
                ["Fixtures", userPlayerId ? "/my-fixtures" : "/events"],
                ["Rankings", "/rankings"],
                ["Profile", userPlayerId ? `/players/${userPlayerId}` : "/notifications"],
              ].map(([label, href]) => (
                <Link key={label} href={href} className="rounded-xl px-1 py-2 text-center text-[11px] font-bold text-emerald-950 hover:bg-emerald-50">{label}</Link>
              ))}
            </nav>
          ) : null}

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
        title="Add a profile photo"
        description="Your player profile does not have a photo yet. Open your profile now to upload one."
        confirmLabel="Review now"
        cancelLabel="Later"
        onConfirm={() => {
          if (typeof window !== "undefined" && admin.userId && userPlayerId) {
            const sessionKey = `profile_photo_prompt_seen_${admin.userId}_${userPlayerId}`;
            window.sessionStorage.setItem(sessionKey, "1");
          }
          setShowProfilePrompt(false);
          if (userPlayerId) router.push(`/players/${userPlayerId}?prompt=photo`);
        }}
        onCancel={() => {
          if (typeof window !== "undefined" && admin.userId && userPlayerId) {
            const sessionKey = `profile_photo_prompt_seen_${admin.userId}_${userPlayerId}`;
            window.sessionStorage.setItem(sessionKey, "1");
          }
          setShowProfilePrompt(false);
        }}
      />
    </main>
  );
}
