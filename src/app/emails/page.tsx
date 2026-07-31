"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";

type EmailMeta = {
  recipient?: string;
  bcc?: string;
  subject?: string;
  provider?: string;
  sender?: string;
  competition?: string;
  message_id?: string;
  error?: string;
};

type EmailRow = {
  id: string;
  created_at: string;
  action: "email_invitation_sent" | "email_invitation_failed";
  summary: string | null;
  meta: EmailMeta | null;
};

export default function EmailsPage() {
  const admin = useAdminStatus();
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (admin.loading) return;
      if (!admin.isSuper) {
        setLoading(false);
        return;
      }
      if (!supabase) {
        setMessage("Supabase is not configured.");
        setLoading(false);
        return;
      }
      const result = await supabase
        .from("audit_logs")
        .select("id,created_at,action,summary,meta")
        .in("action", ["email_invitation_sent", "email_invitation_failed"])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (result.error) setMessage(result.error.message);
      else setRows((result.data ?? []) as EmailRow[]);
      setLoading(false);
    };
    load();
  }, [admin.loading, admin.isSuper]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return rows;
    return rows.filter((row) =>
      [row.meta?.recipient, row.meta?.subject, row.meta?.competition, row.summary]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value))
    );
  }, [query, rows]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Email History" eyebrow="Admin" subtitle="Registration emails sent by Rack & Frame." />
          {!admin.loading && !admin.isSuper ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              Only the Super User can access Email History.
            </section>
          ) : null}
          {admin.isSuper ? (
            <>
              <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
                <p><strong>Outbox:</strong> no_reply@greenhithelegionsocialclub.com via Zoho SMTP</p>
                <p><strong>Reply-to:</strong> greenhithelegion@live.co.uk</p>
                <p><strong>Automatic BCC:</strong> rackandframe.app@gmail.com</p>
                <p className="mt-2 text-teal-800">This history records emails attempted after this feature was introduced.</p>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <input
                  className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  placeholder="Search recipient, subject, or competition..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <MessageModal message={message} onClose={() => setMessage(null)} />
                {loading ? <p className="text-sm text-slate-600">Loading email history...</p> : null}
                {!loading && filtered.length === 0 ? <p className="text-sm text-slate-600">No recorded emails yet.</p> : null}
                {!loading && filtered.length ? (
                  <div className="overflow-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left">When</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-left">Recipient</th>
                          <th className="px-3 py-2 text-left">Subject</th>
                          <th className="px-3 py-2 text-left">Competition</th>
                          <th className="px-3 py-2 text-left">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((row) => {
                          const sent = row.action === "email_invitation_sent";
                          return (
                            <tr key={row.id} className="border-t border-slate-200 align-top">
                              <td className="whitespace-nowrap px-3 py-2 text-slate-700">{new Date(row.created_at).toLocaleString()}</td>
                              <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${sent ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{sent ? "Sent" : "Failed"}</span></td>
                              <td className="px-3 py-2 text-slate-900">{row.meta?.recipient ?? "-"}</td>
                              <td className="px-3 py-2 text-slate-700">{row.meta?.subject ?? "-"}</td>
                              <td className="px-3 py-2 text-slate-700">{row.meta?.competition ?? "-"}</td>
                              <td className="px-3 py-2 text-slate-600">{sent ? `BCC: ${row.meta?.bcc ?? "-"}` : row.meta?.error ?? row.summary ?? "Unknown error"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
