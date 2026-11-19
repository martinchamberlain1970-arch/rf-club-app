import type { ReactNode, SVGProps } from "react";

export type NavIconName =
  | "home"
  | "calendar"
  | "trophy"
  | "users"
  | "chart"
  | "target"
  | "document"
  | "vote"
  | "pin"
  | "shield"
  | "settings"
  | "bell"
  | "play"
  | "help"
  | "menu"
  | "chevron"
  | "close"
  | "logout";

const icons: Record<NavIconName, ReactNode> = {
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></>,
  trophy: <path d="M8 3h8v6a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v6m-4 2h8" />,
  users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m2 11v-3a6 6 0 0 0-2-4" /></>,
  chart: <path d="M4 3v18h17M8 17v-5m5 5V7m5 10V4" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  document: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h5" />,
  vote: <path d="m8 4 3-2 6 6-5 5-6-6Zm-4 9-2 5v3h20v-3l-2-5M8 17h8" />,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
  shield: <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6" />,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  logout: <path d="M9 3H4v18h5m5-14 5 5-5 5M8 12h12" />,
};

export function iconForHref(href: string): NavIconName {
  if (/vote|confirmation/.test(href)) return "vote";
  if (/handicap|rating/.test(href)) return "target";
  if (/table|rankings|stats|usage|breaks|achievement/.test(href)) return "chart";
  if (/fixture|booking|reschedule|playing-window/.test(href)) return "calendar";
  if (/players|signup|roster|team|registration|entry/.test(href)) return "users";
  if (/locations|venues/.test(href)) return "pin";
  if (/events|competition|fame/.test(href)) return "trophy";
  if (/notification|announcement|emails/.test(href)) return "bell";
  if (/audit|legal|backup/.test(href)) return "shield";
  if (/rules|guide|help|install/.test(href)) return "help";
  if (/review|report|document/.test(href)) return "document";
  if (/result|match|live|quick/.test(href)) return "play";
  return "settings";
}

export default function NavIcon({ name, className = "h-5 w-5", ...props }: { name: NavIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      {icons[name]}
    </svg>
  );
}
