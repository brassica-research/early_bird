import { cookies } from "next/headers";
import { getInitializedStore } from "@/lib/store";
import {
  TECH_COOKIE,
  getTechSecret,
  readSessionSubject,
} from "@/lib/auth";
import type { TechnicianAccount } from "@/lib/types";

// ---------------------------------------------------------------------------
// Reads the authenticated technician from the signed session cookie. Routes
// use THIS for identity — never a tech id from the request body — so a caller
// can only ever act as themselves.
// ---------------------------------------------------------------------------

export async function getSessionTechId(): Promise<string | null> {
  const secret = getTechSecret();
  if (!secret) return null;
  const jar = await cookies();
  const token = jar.get(TECH_COOKIE)?.value;
  return readSessionSubject(secret, token);
}

export async function getSessionTech(): Promise<TechnicianAccount | null> {
  const id = await getSessionTechId();
  if (!id) return null;
  const store = await getInitializedStore();
  return store.getTechAccountById(id);
}
