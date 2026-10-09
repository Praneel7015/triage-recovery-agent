import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Record against `npm start`. If someone leaves `next dev` running, hide the
  // red issue badge rather than putting it on camera.
  devIndicators: false,
};

export default nextConfig;
