import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./index";

/** Current session or null (server components / route handlers). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Session or redirect to /login (pages). */
export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Session or a 401 Response (API routes). Usage: const s = await requireApiSession(); if (s instanceof Response) return s; */
export async function requireApiSession() {
  const s = await getSession();
  if (!s) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  return s;
}
