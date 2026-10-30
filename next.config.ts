import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: false, // MapLibre/deck no deben montarse dos veces en dev
  // brain/data se lee con fs en runtime nodejs: inclúyelo en el bundle serverless de Vercel
  outputFileTracingIncludes: { "/api/**": ["./brain/data/**"] },
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["twilio"],
};
export default nextConfig;
