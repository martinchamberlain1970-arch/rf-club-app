import InfoModal from "@/components/InfoModal";

type MessageModalProps = {
  message: string | null;
  title?: string;
  onClose: () => void;
};

function deriveTitle(message: string) {
  const text = message.trim().toLowerCase();

  if (/\bquick match|player 1|player 2|doubles team|best of\b/.test(text)) return "Quick Match Validation";
  if (/\bclaim|profile|guardian|minor|adult|location\b/.test(text)) return "Profile Update";
  if (/\bsubmission|approve|reject|result\b/.test(text)) return "Submission Review";
  if (/\badmin|super user|role|premium\b/.test(text)) return "Access Control";

  const successPrefixes = [
    "progress saved.",
    "claim request submitted for review.",
    "merge request submitted for super user review.",
    "profile created. claim request submitted for approval.",
    "user linked to player profile.",
    "premium request approved by admin. awaiting super user.",
    "premium request rejected.",
    "deletion request rejected.",
  ];
  if (successPrefixes.some((prefix) => text.startsWith(prefix))) return "Success";

  const validationPrefixes = [
    "select ",
    "enter ",
    "best of must",
    "complete the profile check",
    "supabase is not configured",
    "only the ",
    "you must be signed in",
    "doubles is a premium feature",
    "auto-select opening breaker is a premium feature",
    "break & run and run out are premium features",
    "this match is archived.",
    "super user can only approve",
    "guardian consent is required",
  ];
  if (validationPrefixes.some((prefix) => text.startsWith(prefix))) return "Validation Error";

  const actionRequiredPrefixes = [
    "unable to",
    "failed to",
    "duplicate detected",
  ];
  if (actionRequiredPrefixes.some((prefix) => text.startsWith(prefix))) return "Action Required";

  if (/^(failed|error|unable|could not|cannot)\b/.test(text)) return "Action Required";

  if (
    /\b(required|must|select|enter|invalid|duplicate|cannot|can't|should)\b/.test(text) ||
    /not configured/.test(text)
  ) {
    return "Validation Error";
  }

  if (
    /\b(updated|created|approved|submitted|saved|deleted|restored|complete|enabled|disabled|added|linked)\b/.test(text)
  ) {
    return "Success";
  }

  return "Notice";
}

export default function MessageModal({ message, title = "Notice", onClose }: MessageModalProps) {
  return (
    <InfoModal
      open={Boolean(message)}
      title={message ? deriveTitle(message) : title}
      description={message ?? ""}
      onClose={onClose}
    />
  );
}
