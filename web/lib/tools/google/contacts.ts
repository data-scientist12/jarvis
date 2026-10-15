import { z } from "zod";
import type { people_v1 } from "googleapis";
import { defineTool, fail, ok, type JarvisTool } from "@/lib/tools/types";
import { guard, looksLikeEmail, peopleClient, uniq } from "./util";

type Person = people_v1.Schema$Person;

interface Contact {
  name: string;
  emails: string[];
  phones: string[];
}

function toContact(p: Person): Contact {
  return {
    name: p.names?.[0]?.displayName ?? "",
    emails: uniq((p.emailAddresses ?? []).map((e) => e.value ?? "").filter(Boolean)),
    phones: uniq((p.phoneNumbers ?? []).map((e) => e.value ?? "").filter(Boolean)),
  };
}

function mergeContacts(list: Contact[]): Contact[] {
  const byKey = new Map<string, Contact>();
  for (const c of list) {
    if (!c.name && !c.emails.length) continue;
    const key = c.emails[0]?.toLowerCase() ?? c.name.toLowerCase();
    const prev = byKey.get(key);
    if (prev) {
      prev.emails = uniq([...prev.emails, ...c.emails]);
      prev.phones = uniq([...prev.phones, ...c.phones]);
      if (!prev.name) prev.name = c.name;
    } else byKey.set(key, { ...c });
  }
  return [...byKey.values()];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const sim = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

function similarity(query: string, c: Contact): number {
  const q = query.toLowerCase().trim();
  const candidates = [c.name.toLowerCase(), ...c.emails.map((e) => e.split("@")[0].toLowerCase())].filter(Boolean);
  let best = 0;
  const qTokens = q.split(/\s+/).filter(Boolean);
  for (const cand of candidates) {
    best = Math.max(best, sim(q, cand));
    if (cand.includes(q) || q.includes(cand)) best = Math.max(best, 0.8);
    const cTokens = cand.split(/[\s._-]+/).filter(Boolean);
    for (const qt of qTokens) for (const ct of cTokens) {
      let s = sim(qt, ct);
      if (qt.length >= 3 && (ct.startsWith(qt) || qt.startsWith(ct))) s = Math.max(s, 0.75);
      best = Math.max(best, s * (qTokens.length > 1 ? 0.9 : 1));
    }
  }
  return best;
}

const READ_MASK = "names,emailAddresses,phoneNumbers";

const contactsSearch = defineTool({
  name: "contacts_search",
  description:
    "Look up a person's email address and phone by name in the user's Google Contacts (and people they have emailed). ALWAYS use this to resolve names to emails before emailing, inviting or sharing with someone. If the input is already an email address it is returned as-is. If nothing matches it suggests close names.",
  risk: "read",
  connector: "contacts",
  inputSchema: z.object({ name: z.string().min(1).describe("Person's name (first name, full name, or part of it) or an email address.") }),
  title: (i) => `Looking up ${i.name} in contacts`,
  execute: (input, ctx) =>
    guard("contacts", async () => {
      const q = input.name.trim();
      if (looksLikeEmail(q)) {
        const email = q.replace(/^.*<|>.*$/g, "").trim() || q;
        return ok(`${email} is already an email address`, {
          data: { people: [{ name: "", emails: [email], phones: [] }] },
          card: { type: "contact", people: [{ name: email, emails: [email], phones: [] }] },
        });
      }
      const people = await peopleClient(ctx);
      // The People API requires an empty "warm-up" search before the first real search to refresh its cache.
      await Promise.allSettled([people.people.searchContacts({ query: "", readMask: READ_MASK, pageSize: 1 }), people.otherContacts.search({ query: "", readMask: "names,emailAddresses", pageSize: 1 })]);
      const [mine, other] = await Promise.allSettled([
        people.people.searchContacts({ query: q, readMask: READ_MASK, pageSize: 10 }),
        people.otherContacts.search({ query: q, readMask: "names,emailAddresses", pageSize: 10 }),
      ]);
      if (mine.status === "rejected" && other.status === "rejected") throw mine.reason;
      const found: Contact[] = [];
      if (mine.status === "fulfilled") for (const r of mine.value.data.results ?? []) if (r.person) found.push(toContact(r.person));
      if (other.status === "fulfilled") for (const r of other.value.data.results ?? []) if (r.person) found.push(toContact(r.person));
      const merged = mergeContacts(found).slice(0, 10);
      if (merged.length) {
        return ok(`Found ${merged.length} contact${merged.length === 1 ? "" : "s"} matching “${q}”: ${merged.slice(0, 3).map((c) => `${c.name || "?"} <${c.emails[0] ?? "no email"}>`).join(", ")}`, {
          data: { people: merged },
          suggestion: merged.length > 1 ? "Several people match; confirm with the user which one if it is ambiguous." : undefined,
          card: { type: "contact", people: merged },
        });
      }

      // No exact hit: fuzzy-match against everyone we can list.
      const all: Contact[] = [];
      try {
        let pageToken: string | undefined;
        let pages = 0;
        do {
          const r = await people.people.connections.list({ resourceName: "people/me", personFields: READ_MASK, pageSize: 1000, pageToken });
          for (const p of r.data.connections ?? []) all.push(toContact(p));
          pageToken = r.data.nextPageToken ?? undefined;
        } while (pageToken && ++pages < 3);
      } catch {
        /* fall through with what we have */
      }
      try {
        const r = await people.otherContacts.list({ readMask: "names,emailAddresses", pageSize: 1000 });
        for (const p of r.data.otherContacts ?? []) all.push(toContact(p));
      } catch {
        /* optional */
      }
      const ranked = mergeContacts(all)
        .map((c) => ({ c, score: similarity(q, c) }))
        .filter((x) => x.score >= 0.55 && x.c.emails.length)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (ranked.length) {
        const didYouMean = ranked.map((r) => ({ name: r.c.name, emails: r.c.emails }));
        const names = ranked.map((r) => `${r.c.name || r.c.emails[0]} <${r.c.emails[0]}>`).join(", ");
        return fail(`No contact named “${q}”.`, "contact_not_found", `Ask the user whether they meant: ${names}`, { didYouMean });
      }
      return fail(`No contact named “${q}” and nothing similar.`, "contact_not_found", "Ask the user for the person's email address.", { didYouMean: [] });
    }),
});

export const contactsTools: JarvisTool[] = [contactsSearch];
