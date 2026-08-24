import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rack & Frame Club",
    short_name: "Rack & Frame",
    description: "Run club cue-sports competitions, fixtures, results, and rankings.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#0f766e",
    orientation: "any",
    categories: ["sports", "utilities"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/pwa/notification-badge.svg", sizes: "any", type: "image/svg+xml", purpose: "monochrome" },
    ],
  };
}
