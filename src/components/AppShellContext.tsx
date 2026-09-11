"use client";

import { createContext, useContext } from "react";

export type AppShellContextValue = {
  enabled: boolean;
  openNavigation: () => void;
  registerNavigationGuard: (enabled: boolean, message: string) => () => void;
};

const AppShellContext = createContext<AppShellContextValue>({
  enabled: false,
  openNavigation: () => undefined,
  registerNavigationGuard: () => () => undefined,
});

export function AppShellContextProvider({
  value,
  children,
}: {
  value: AppShellContextValue;
  children: React.ReactNode;
}) {
  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell() {
  return useContext(AppShellContext);
}
