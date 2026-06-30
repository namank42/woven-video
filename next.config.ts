import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const sfxOrigin =
  process.env.SFX_ORIGIN?.replace(/\/$/, "") ?? "https://woven-sfx.vercel.app";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  async rewrites() {
    return [
      {
        source: "/sfx",
        destination: `${sfxOrigin}/`,
      },
      {
        source: "/sfx/:path*",
        destination: `${sfxOrigin}/:path*`,
      },
    ];
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
