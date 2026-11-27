import type { NextConfig } from "next";
import withPWAInit, { runtimeCaching } from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  workboxOptions: {
    runtimeCaching: [
      { urlPattern: /\/api\/campaigns\/(?:open\/)?[\da-f-]+(?:\?|$)/i, handler: "NetworkOnly" },
      { urlPattern: /\/api\/jobs\/(?:email\/open\/[\da-f-]+|[^/]+\/campaign-communications)(?:\?|$)/i, handler: "NetworkOnly" },
      { urlPattern: /\/api\/jobs\/[^/]+\/quote-history(?:\?|$)/, handler: "NetworkOnly" },
      { urlPattern: /\/api\/calendar\//, handler: "NetworkOnly" },
      { urlPattern: /\/api\/(?:dead-followups|jobs\/[^/]+\/dead-followup)(?:[/?]|$)/, handler: "NetworkOnly" },
      { urlPattern: /\/api\/install-planning(?:\?|$)/, handler: "NetworkOnly" },
      { urlPattern: /\/api\/gm-reports/, handler: "NetworkOnly" },
      { urlPattern: /\/jobs\/reports\/weekly-gm/, handler: "NetworkOnly" },
      { urlPattern: /\/api\/finance\//, handler: "NetworkOnly" },
      { urlPattern: /\/jobs\/finance\//, handler: "NetworkOnly" },
      ...runtimeCaching,
    ],
  },
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {},
  async headers() {
    return ["/partner/set-password", "/partner/forgot-password"].map(
      (source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      }),
    );
  },
};

export default withPWA(nextConfig);
