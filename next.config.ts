import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Pages is rendered into a project-site artifact by
  // scripts/render-pages.sh. Vinext currently serves the route at `/`, so the
  // renderer applies the repository prefix to the generated asset URLs.
  ...(process.env.GITHUB_PAGES === "true"
    ? {
        output: "export",
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
