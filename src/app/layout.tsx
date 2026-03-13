import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rack & Frame Web",
  description: "Rack & Frame web companion",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
