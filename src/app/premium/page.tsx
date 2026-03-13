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
  const [voucherCode, setVoucherCode] = useState("");
  const [redeemingVoucher, setRedeemingVoucher] = useState(false);
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
    "Doubles support for quick matches and competitions",
    "Full stats suite: Table, Head-to-Head, and Predictor",
    "Live Overview for active competitions",
    "Round-specific match lengths",
    "Auto-select opening breaker",
    "Break & Run / Run Out tracking",
    "Any future Premium club-play upgrades",
  ];
  const comparisonRows: {
    feature: string;
    freePlayer: string;
    premiumPlayer: string;
    freeAdmin: string;
    premiumAdmin: string;
  }[] = [
    { feature: "Quick Match", freePlayer: "Included", premiumPlayer: "Included", freeAdmin: "Included", premiumAdmin: "Included" },
    { feature: "View events, results, rules, and notifications", freePlayer: "Included", premiumPlayer: "Included", freeAdmin: "Included", premiumAdmin: "Included" },
    { feature: "Create competitions", freePlayer: "Not included", premiumPlayer: "Not included", freeAdmin: "Included", premiumAdmin: "Included" },
    { feature: "Run club admin workflows", freePlayer: "Not included", premiumPlayer: "Not included", freeAdmin: "Included", premiumAdmin: "Included" },
    { feature: "Doubles", freePlayer: "Not included", premiumPlayer: "Included", freeAdmin: "Not included", premiumAdmin: "Included" },
    { feature: "Stats screen", freePlayer: "Not included", premiumPlayer: "Included", freeAdmin: "Not included", premiumAdmin: "Included" },
    { feature: "Live Overview", freePlayer: "Not included", premiumPlayer: "Included", freeAdmin: "Not included", premiumAdmin: "Included" },
    { feature: "Auto-select opening breaker", freePlayer: "Not included", premiumPlayer: "Included", freeAdmin: "Not included", premiumAdmin: "Included" },
    { feature: "Round-specific match lengths", freePlayer: "Not included", premiumPlayer: "Not included", freeAdmin: "Not included", premiumAdmin: "Included" },
    { feature: "Break & Run / Run Out tracking", freePlayer: "Not included", premiumPlayer: "Included", freeAdmin: "Not included", premiumAdmin: "Included" },
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
            subtitle={isSuperAdmin ? "Manage premium approvals and access." : "Premium unlocks the advanced extras on top of the standard club roles."}
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
                  <p className="mt-1 text-2xl font-bold text-slate-900">One-off £12.99</p>
                  <p className="text-sm text-slate-600">No subscription · one account upgrade</p>
                  <p className="mt-2 text-slate-700">
                    Premium does not replace roles. Player, Club Admin, and Super User stay the same. Premium adds the advanced extras to Player or Club Admin accounts.
                  </p>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="font-semibold text-slate-900">How access works</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    <li>Player accounts can use Quick Match and normal club viewing features on the free plan.</li>
                    <li>Club Admin accounts can create competitions and run their club on the free plan.</li>
                    <li>Premium adds advanced extras like doubles, stats, live overview, and enhanced match tools.</li>
                    <li>Super User always keeps full access and is not governed by Premium status.</li>
                  </ul>
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
                  <p className="font-semibold text-slate-900">Free and Premium feature matrix</p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-700">
                          <th className="py-2 pr-4 font-semibold">Feature</th>
                          <th className="py-2 pr-4 font-semibold">Free Player</th>
                          <th className="py-2 pr-4 font-semibold text-teal-700">Premium Player</th>
                          <th className="py-2 pr-4 font-semibold">Free Club Admin</th>
                          <th className="py-2 font-semibold text-teal-700">Premium Club Admin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonRows.map((row) => (
                          <tr key={row.feature} className="border-b border-slate-100 text-slate-700">
                            <td className="py-2 pr-4 font-medium text-slate-900">{row.feature}</td>
                            <td className="py-2 pr-4">{planCell(row.freePlayer)}</td>
                            <td className="py-2 pr-4">{planCell(row.premiumPlayer, true)}</td>
                            <td className="py-2 pr-4">{planCell(row.freeAdmin)}</td>
                            <td className="py-2">{planCell(row.premiumAdmin, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {!premium.loading && !premium.unlocked ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="font-semibold text-slate-900">Request Premium</p>
                      <p className="mt-1 text-sm text-slate-600">
                        Request a Premium upgrade for this account at £12.99. Requests are reviewed by the Super User.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={onRequestPremium}
                          disabled={requestStatus === "pending"}
                          className={buttonPrimaryClass}
                        >
                          {requestStatus === "pending" ? "Premium request pending" : "Request Premium (£12.99)"}
                        </button>
                        <span className="text-sm text-slate-600">Premium can be turned on or off by the Super User for standard users and Club Admin accounts.</span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="font-semibold text-slate-900">Have a voucher code?</p>
                      <p className="mt-1 text-sm text-slate-700">
                        If you have a Rack &amp; Frame voucher code, enter it here to unlock Premium for free.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={voucherCode}
                          onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                          placeholder="Enter voucher code"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:flex-1"
                        />
                        <button
                          type="button"
                          disabled={redeemingVoucher || !voucherCode.trim()}
                          onClick={async () => {
                            const client = supabase;
                            if (!client) {
                              setMessage("Supabase is not configured.");
                              return;
                            }
                            const { data } = await client.auth.getSession();
                            const token = data.session?.access_token;
                            if (!token) {
                              setMessage("You must be signed in.");
                              return;
                            }
                            setRedeemingVoucher(true);
                            const resp = await fetch("/api/premium/redeem-voucher", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({ voucherCode }),
                            });
                            const json = await resp.json().catch(() => ({}));
                            setRedeemingVoucher(false);
                            if (!resp.ok) {
                              setMessage(json?.error ?? "Failed to redeem voucher code.");
                              return;
                            }
                            setVoucherCode("");
                            setRequestStatus("none");
                            setMessage("Voucher accepted. Premium is now active on your account.");
                            window.location.reload();
                          }}
                          className={buttonPrimaryClass}
                        >
                          {redeemingVoucher ? "Checking..." : "Apply Voucher"}
                        </button>
                      </div>
                    </div>
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
