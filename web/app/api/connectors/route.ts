import { googleConfigured } from "@/lib/auth";
import { CONNECTORS, grantedConnectors } from "@/lib/auth/scopes";
import { getGoogleAccount, getGoogleAuth } from "@/lib/google/client";
import { authed, json } from "@/lib/security/http";


const g = globalThis as unknown as { __jarvisGoogleEmail?: Map<string, { at: number; email: string | undefined }> };
const emailCache = (g.__jarvisGoogleEmail ??= new Map());

async function googleEmailFor(userId: string, fallback: string): Promise<string | undefined> {
  const hit = emailCache.get(userId);
  if (hit && Date.now() - hit.at < 3600_000) return hit.email;
  let email: string | undefined;
  try {
    const auth = await getGoogleAuth(userId);
    const { token } = await auth.getAccessToken();
    if (token) {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) email = ((await r.json()) as { email?: string }).email;
    }
  } catch {
    /* fall through to the account email */
  }
  email = email ?? fallback;
  emailCache.set(userId, { at: Date.now(), email });
  return email;
}

export async function GET() {
  const user = await authed();
  if (user instanceof Response) return user;
  const account = await getGoogleAccount(user.id);
  const granted = account ? grantedConnectors(account.scope) : [];
  return json({
    googleConfigured,
    googleConnected: Boolean(account),
    googleEmail: account ? await googleEmailFor(user.id, user.email) : undefined,
    connectors: CONNECTORS.map((c) => ({ id: c.id, name: c.name, description: c.description, granted: granted.includes(c.id) })),
  });
}
