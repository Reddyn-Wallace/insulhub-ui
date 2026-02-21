import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  /* config options here */
  // @ts-ignore - Silence Turbopack/Webpack conflict
  turbopack: {},
};

export default withPWA(nextConfig);
