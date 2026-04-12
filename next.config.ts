import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  assetPrefix: "./",
  trailingSlash: true,   // ⭐ IMPORTANT FIX
  images: {
    unoptimized: true,
  },
};

export default nextConfig;