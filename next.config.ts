import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "http://127.0.0.1",
    "http://localhost",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3005",
    "http://localhost:3005",
  ],
};

export default nextConfig;
