import type { NextConfig } from "next";

// PC 向け管理画面（ui-spec 1.2: 想定最小ビューポート 1280px）。
// 画像最適化・国際化などの追加機能は現時点で使用しない。
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
