// Derives the admin base path from the current URL at runtime, so internal
// admin links work whether the console is served from /admin or a non-obvious
// slug — without ever embedding the slug in a shared/public client bundle.
export function adminBase(): string {
  if (typeof window === "undefined") return "/admin";
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/admin";
}
