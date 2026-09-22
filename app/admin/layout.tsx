import type { ReactNode } from "react";
import { Onest } from "next/font/google";
import "./admin.css";

const onest = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-ui", display: "swap" });

export const metadata = { title: "Панель салона", robots: { index: false, follow: false } };

export default function AdminRoot({ children }: { children: ReactNode }) {
  return <div className={`${onest.variable} admin-root`}>{children}</div>;
}
