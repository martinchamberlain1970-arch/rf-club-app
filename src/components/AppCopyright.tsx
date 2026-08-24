"use client";

import { usePathname } from "next/navigation";

export default function AppCopyright() {
  const pathname = usePathname();
  if (pathname.startsWith("/display/")) return null;
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">
      © {new Date().getFullYear()} Martin Chamberlain. Rack &amp; Frame. All rights reserved.
    </footer>
  );
}
