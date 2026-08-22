import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Triage — Revenue Recovery Agent",
  description: "AI-powered recovery agent for failed Indian Autopay payments. Diagnoses before treating.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${mono.variable} font-mono bg-zinc-950 text-zinc-100 min-h-screen`}>
        <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-6">
          <Link href="/" className="text-sm font-bold tracking-widest text-emerald-400 hover:text-emerald-300">
            TRIAGE
          </Link>
          <span className="text-xs text-zinc-500">Revenue Recovery Agent · Razorpay AI Buildathon 2026</span>
          <nav className="ml-auto flex gap-4 text-xs text-zinc-400">
            <Link href="/" className="hover:text-zinc-100">Scoreboard</Link>
            <Link href="/cases" className="hover:text-zinc-100">Cases</Link>
          </nav>
        </header>
        <main className="px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
