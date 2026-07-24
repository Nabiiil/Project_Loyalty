import type { NextConfig } from "next";

// When NEXT_PUBLIC_APP_URL points to a non-localhost host (e.g. your LAN IP for
// cross-device QR testing), tell the Next.js dev server to accept that origin.
function devOrigins(): string[] {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return [];
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" ? [] : [hostname];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: devOrigins(),
};

export default nextConfig;
