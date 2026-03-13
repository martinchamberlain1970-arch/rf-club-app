import { supabase } from "@/lib/supabase";

type AuditOptions = {
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  meta?: Record<string, unknown> | null;
};

export async function logAudit(action: string, options?: AuditOptions): Promise<void> {
  const client = supabase;
  if (!client) return;
  try {
    await client.rpc("log_audit", {
      p_action: action,
      p_entity_type: options?.entityType ?? null,
      p_entity_id: options?.entityId ?? null,
      p_summary: options?.summary ?? null,
      p_meta: options?.meta ?? {},
    });
  } catch {
    // Never block user actions if audit logging fails.
  }
}
