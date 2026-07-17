import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

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
        <SiteHeader />
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
