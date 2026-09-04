import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {},
  async headers() {
    return ["/partner/set-password","/partner/forgot-password"].map(source=>({source,headers:[
      {key:"Cache-Control",value:"private, no-store"},
      {key:"Referrer-Policy",value:"no-referrer"},
      {key:"X-Robots-Tag",value:"noindex, nofollow"},
    ]}));
  },
};

export default withPWA(nextConfig);
