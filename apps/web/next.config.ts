import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // In Docker the nginx gateway sends /api to the API. In local dev there is no
  // gateway, so Next proxies it; the browser always talks to one origin.
  // Clickjacking: no page may be framed by another site, except the read-only, always-anonymous
  // gallery embed, which exists to be framed.
  async headers() {
    return [
      { source: "/((?!embed/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      { source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/embed.js", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }, { key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
