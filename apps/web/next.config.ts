import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // In Docker the nginx gateway sends /api to the API. In local dev there is no
  // gateway, so Next proxies it; the browser always talks to one origin.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
