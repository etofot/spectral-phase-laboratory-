import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./instruments.css";
import "./overlays.css";
export const metadata: Metadata = {
  title: "PhaseLab — Спектральная лаборатория",
  description:
    "Измерительное рабочее место для спектрально-фазового сведения. Частотный анализ, фазоскоп, микро-EQ и проверенные A/B-коррекции.",
  icons: { icon: "/phaselab.svg" },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
