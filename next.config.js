/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Geolocation is used by the technician app (same origin only).
    value: "geolocation=(self), camera=(), microphone=(), payment=(self)",
  },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

// Optional non-obvious admin path. When ADMIN_BASENAME is set to something
// other than "admin", the console is served from that secret slug and the
// literal /admin path is hidden (see middleware.ts).
const adminBase = (process.env.ADMIN_BASENAME || "admin").replace(/^\/|\/$/g, "");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the native Postgres driver external so it is required from
  // node_modules at runtime AND traced into the serverless function bundle
  // (a dynamic/variable import alone is invisible to the file tracer, which
  // otherwise leaves `pg` out of the deploy → "cannot find module 'pg'").
  serverExternalPackages: ["pg"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    if (!adminBase || adminBase === "admin") return [];
    // Serve the /admin route tree from the secret slug (URL stays on the slug).
    return [
      { source: `/${adminBase}`, destination: "/admin" },
      { source: `/${adminBase}/:path*`, destination: "/admin/:path*" },
    ];
  },
};

module.exports = nextConfig;
