"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Ledger" },
  { href: "/cases", label: "Case files" },
];

export function Nav() {
  const path = usePathname();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-text">
            <strong>Triage</strong>
            <span>Revenue recovery agent</span>
          </span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={path === href || (href !== "/" && path.startsWith(href)) ? "nav-link active" : "nav-link"}
            >
              {label}
            </Link>
          ))}
        </nav>

        <p className="site-tag">Razorpay Buildathon · Track 03</p>
      </div>
    </header>
  );
}
