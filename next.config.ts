import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [
      "./data/reference/**/*",
      "./fixtures/*.wav",
      "./engine/*.py",
      "./analyzers/*.py",
      "./agent/*.py",
      "./requirements.txt",
    ],
  },
};
export default nextConfig;
