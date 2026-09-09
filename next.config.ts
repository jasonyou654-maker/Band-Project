import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Pages serves this project from /Band-Project rather than a custom
  // application server. Keep the normal server-capable build unchanged.
  ...(process.env.GITHUB_PAGES === "true"
    ? {
        output: "export",
        basePath: "/Band-Project",
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
