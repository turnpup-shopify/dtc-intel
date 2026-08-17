import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swipe File",
  description: "Landing page copy swipe file — sourced, scored, searchable.",
};

const NAV = [
  { href: "/review", label: "Review" },
  { href: "/hooks", label: "Hooks" },
  { href: "/landing", label: "Landing Pages" },
  { href: "/library", label: "Library" },
  { href: "/search", label: "Search" },
  { href: "/companies", label: "Companies" },
  { href: "/diagnostics", label: "Diagnostics" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <nav className="flex items-center gap-1 px-4 h-12">
            <Link href="/review" className="font-semibold tracking-tight mr-4 text-sm">
              swipe<span style={{ color: "var(--accent)" }}>file</span>
            </Link>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 text-sm rounded hover:bg-white/5 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
