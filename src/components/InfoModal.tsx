"use client";

type InfoModalProps = {
  open: boolean;
  title: string;
  description: string;
  closeLabel?: string;
  onClose: () => void;
};

export default function InfoModal({ open, title, description, closeLabel = "OK", onClose }: InfoModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-700">{description}</p>
        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
