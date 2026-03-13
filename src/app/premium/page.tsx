"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import usePremiumStatus from "@/components/usePremiumStatus";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";

type PremiumRequest = {
  id: string;
  requester_user_id: string;
  status: string;
  admin_approved: boolean | null;
  guardian_consent: boolean | null;
  created_at: string;
};

type AppUser = {
  id: string;
  email: string | null;
  linked_player_id: string | null;
};

type LinkedPlayer = {
  id: string;
  display_name: string;
  full_name: string | null;
  age_band?: string | null;
  guardian_consent?: boolean | null;
};

export default function PremiumPage() {
  const premium = usePremiumStatus();
  const admin = useAdminStatus();
  const [requestStatus, setRequestStatus] = useState<"none" | "pending" | "requested">("none");
  const [message, setMessage] = useState<string | null>(null);
  const [isMinor, setIsMinor] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [superRequests, setSuperRequests] = useState<PremiumRequest[]>([]);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [players, setPlayers] = useState<LinkedPlayer[]>([]);

  const isSuperAdmin = admin.isSuper;
  const cardBaseClass = "rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm";
  const pillBaseClass = "rounded-full border px-3 py-1 text-sm transition";
  const pillPrimaryClass = `${pillBaseClass} border-teal-700 bg-teal-700 text-white hover:bg-teal-800`;
  const pillSecondaryClass = `${pillBaseClass} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const buttonPrimaryClass = "rounded-xl bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60";
  const buttonSuccessClass = "rounded-lg bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-800 disabled:opacity-60";
  const buttonSecondaryClass = "rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50";
  const premiumHighlights = [
    "Full stats suite: Table, Head-to-Head, and Predictor",
    "Live Overview for active events",
    "Doubles support in quick match and competitions",
    "League competitions and larger knockout draws",
    "Round-specific best-of lengths",
    "Auto-Select Opening Breaker",
    "Break & Run / Run Out tracking",
    "All future Premium upgrades",
  ];
  const comparisonRows: { feature: string; free: string; premium: string }[] = [
    { feature: "Quick Match (singles)", free: "Included", premium: "Included" },
    { feature: "Create knockout competitions", free: "Up to 4 players", premium: "Large draws + BYE support" },
    { feature: "Doubles (2v2)", free: "Not included", premium: "Included" },
    { feature: "League competitions", free: "Not included", premium: "Included" },
    { feature: "Stats screen", free: "Not included", premium: "Full access" },
    { feature: "Live Overview", free: "Not included", premium: "Included" },
    { feature: "Auto-Select Opening Breaker", free: "Not included", premium: "Included" },
    { feature: "Round-specific best-of lengths", free: "Not included", premium: "Included" },
    { feature: "Break & Run / Run Out tracking", free: "Not included", premium: "Included" },
  ];
  const isIncluded = (value: string) => !value.toLowerCase().includes("not included");
  const planCell = (value: string, highlight = false) => {
    const included = isIncluded(value);
    return (
      <span className={`inline-flex items-center gap-2 ${highlight ? "text-teal-700" : "text-slate-700"}`}>
        <span
          aria-hidden="true"
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
            included ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          }`}
        >
          {included ? "✓" : "✕"}
        </span>
        <span className={highlight ? "font-medium" : undefined}>{value}</span>
      </span>
    );
  };

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    client.auth.getUser().then(async (res) => {
      const userId = res.data.user?.id;
      if (!userId) return;
      const [reqRes, linkRes] = await Promise.all([
        client.from("premium_requests").select("id,status").eq("requester_user_id", userId).eq("status", "pending").limit(1),
        client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle(),
      ]);
      if (!reqRes.error) setRequestStatus(reqRes.data?.[0] ? "pending" : "none");
      const linkedId = linkRes.data?.linked_player_id;
      if (linkedId) {
        const playerRes = await client.from("players").select("age_band,guardian_consent").eq("id", linkedId).maybeSingle();
        const band = playerRes.data?.age_band ?? "18_plus";
        setIsMinor(band !== "18_plus");
        setGuardianConsent(Boolean(playerRes.data?.guardian_consent));
      }
    });
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const client = supabase;
    if (!client) return;
    const run = async () => {
      const [reqRes, userRes, playerRes] = await Promise.all([
        client
          .from("premium_requests")
          .select("id,requester_user_id,status,admin_approved,guardian_consent,created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
        client.from("app_users").select("id,email,linked_player_id"),
        client.from("players").select("id,display_name,full_name,age_band,guardian_consent"),
      ]);
      if (!reqRes.error && reqRes.data) setSuperRequests(reqRes.data as PremiumRequest[]);
      if (!userRes.error && userRes.data) setAppUsers(userRes.data as AppUser[]);
      if (!playerRes.error && playerRes.data) setPlayers(playerRes.data as LinkedPlayer[]);
    };
    run();
  }, [isSuperAdmin]);

  const onRequestPremium = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    const { data } = await client.auth.getUser();
    const userId = data.user?.id;
    if (!userId) {
      setMessage("You must be signed in.");
      return;
    }
    if (isMinor && !guardianConsent) {
      setMessage("Guardian consent must be confirmed before requesting Premium.");
      return;
    }
    const { error } = await client.from("premium_requests").insert({
      requester_user_id: userId,
      status: "pending",
      guardian_consent: isMinor ? guardianConsent : false,
      admin_approved: false,
    });
    if (error) {
      setMessage(`Failed to request Premium: ${error.message}`);
      return;
    }
    setRequestStatus("pending");
    setMessage("Premium request submitted for approval.");
  };

  const onSuperApprove = async (reqId: string, userId: string, isMinorReq: boolean, guardianOk: boolean) => {
    const client = supabase;
    if (!client) return;
    if (!isSuperAdmin) return;
    if (isMinorReq && !guardianOk) {
      setMessage("Guardian consent is required before approving Premium for minors.");
      return;
    }
    const { data: sessionRes } = await client.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMessage("You must be signed in.");
      return;
    }
    const resp = await fetch("/api/admin/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, enabled: true }),
    });
    if (!resp.ok) {
      const data = await resp.json();
      setMessage(data?.error ?? "Failed to update premium.");
      return;
    }
    await client.from("premium_requests").update({ status: "approved", approved_by_super_at: new Date().toISOString() }).eq("id", reqId);
    setMessage("Premium approved.");
    const next = superRequests.filter((r) => r.id !== reqId);
    setSuperRequests(next);
  };

  const onSuperReject = async (reqId: string) => {
    const client = supabase;
    if (!client) return;
    await client.from("premium_requests").update({ status: "rejected" }).eq("id", reqId);
    setSuperRequests((prev) => prev.filter((r) => r.id !== reqId));
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Premium"
            eyebrow="Premium"
            subtitle={isSuperAdmin ? "Manage premium approvals and access." : "Unlock the full Rack & Frame experience."}
          />

          <section className={`${cardBaseClass} space-y-2`}>
            {isSuperAdmin ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">Super User Premium Approvals</p>
                  <span className={superRequests.length > 0 ? pillPrimaryClass : pillSecondaryClass}>
                    Pending: {superRequests.length}
                  </span>
                </div>
                {superRequests.length === 0 ? (
                  <p className="text-sm text-slate-600">No pending Premium requests.</p>
                ) : (
                  <div className="space-y-2">
                    {superRequests.map((req) => {
                      const requester = appUsers.find((u) => u.id === req.requester_user_id);
                      const linked = players.find((p) => p.id === requester?.linked_player_id);
                      const name = linked?.full_name?.trim() ? linked.full_name : linked?.display_name;
                      const label = name ? `${name} (${requester?.email ?? "Unknown email"})` : requester?.email ?? req.requester_user_id;
                      const isMinorReq = Boolean(linked?.age_band && linked.age_band !== "18_plus");
                      const guardianOk = Boolean(req.guardian_consent ?? linked?.guardian_consent);
                      return (
                        <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <div>
                            <p className="text-slate-900">{label}</p>
                            <p className="text-xs text-slate-500">
                              {req.admin_approved ? "Admin approved" : "Awaiting admin approval"}
                              {isMinorReq ? guardianOk ? " · Guardian consent confirmed" : " · Guardian consent required" : ""}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => onSuperApprove(req.id, req.requester_user_id, isMinorReq, guardianOk)}
                              disabled={!req.admin_approved || (isMinorReq && !guardianOk)}
                              className={buttonSuccessClass}
                            >
                              Approve Premium
                            </button>
                            <button
                              type="button"
                              onClick={() => onSuperReject(req.id)}
                              className={buttonSecondaryClass}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                {!premium.loading && premium.trialActive ? (
                  <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-semibold text-emerald-900">
                      Free Premium Trial Active · {premium.trialDaysLeft} {premium.trialDaysLeft === 1 ? "day" : "days"} left
                    </p>
                    <p className="mt-1 text-sm text-emerald-800">
                      Premium features are currently unlocked on your account until{" "}
                      {premium.trialEndsAt ? new Date(premium.trialEndsAt).toLocaleDateString() : "trial expiry"}.
                    </p>
                  </section>
                ) : null}
                <section className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-teal-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Premium Unlock</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">One-off £9.99</p>
                  <p className="text-sm text-slate-600">Usually £12.99 · no subscription</p>
                  <p className="mt-2 text-slate-700">
                    Upgrade once and run your club with the full professional toolkit.
                  </p>
                </section>

                <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">What you get with Premium</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {premiumHighlights.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="font-semibold text-slate-900">Free vs Premium</p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-700">
                          <th className="py-2 pr-4 font-semibold">Feature</th>
                          <th className="py-2 pr-4 font-semibold">Free</th>
                          <th className="py-2 font-semibold text-teal-700">Premium</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonRows.map((row) => (
                          <tr key={row.feature} className="border-b border-slate-100 text-slate-700">
                            <td className="py-2 pr-4 font-medium text-slate-900">{row.feature}</td>
                            <td className="py-2 pr-4">{planCell(row.free)}</td>
                            <td className="py-2">{planCell(row.premium, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {!premium.loading && !premium.unlocked ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onRequestPremium}
                      disabled={requestStatus === "pending"}
                      className={buttonPrimaryClass}
                    >
                      {requestStatus === "pending" ? "Premium request pending" : "Request Premium"}
                    </button>
                    <span className="text-sm text-slate-600">Requests are reviewed by the super user.</span>
                  </div>
                ) : !premium.loading && premium.unlocked ? (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
                    {premium.trialActive ? "Premium trial is active on your account." : "Premium is active on your account."}
                  </p>
                ) : null}
              </>
            )}
            <MessageModal message={message} onClose={() => setMessage(null)} />
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
