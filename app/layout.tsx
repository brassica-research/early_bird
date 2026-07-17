import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Early Bird — On-Site Home Diagnostics, Troubleshooting & Repair",
  description:
    "Same-week, on-site help for plumbing, electrical, appliances, HVAC & air quality, basic home repair, and internet/connectivity. Describe your issue and book a technician.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="container nav-inner">
            <Link href="/" className="brand">
              <span className="logo">🐦</span>
              <span>Early Bird</span>
            </Link>
            <div className="nav-links">
              <Link href="/#services">Services</Link>
              <Link href="/#how">How it works</Link>
              <Link href="/admin">Admin</Link>
              <Link href="/intake" className="btn btn-primary" style={{ padding: "9px 16px" }}>
                Book a visit
              </Link>
            </div>
          </div>
        </nav>
        {children}
        <footer className="footer">
          <div className="container spread">
            <div>
              <strong>Early Bird</strong> · On-site home diagnostics,
              troubleshooting & repair
            </div>
            <div>We catch the problem early. 🌅</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
