import type { Metadata } from "next";
import "./globals.css";
import PwaSetup from "@/components/PwaSetup";
import AppCopyright from "@/components/AppCopyright";

export const metadata: Metadata = {
  title: "Rack & Frame Club",
  description: "Run club cue-sports competitions, fixtures, results, and rankings.",
  applicationName: "Rack & Frame Club",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Rack & Frame",
  },
  icons: {
    icon: [
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PwaSetup />
        {children}
        <AppCopyright />
      </body>
    </html>
  );
}
