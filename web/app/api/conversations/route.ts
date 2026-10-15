import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { authed, json } from "@/lib/security/http";


export async function GET() {
  const user = await authed();
  if (user instanceof Response) return user;
  const rows = await db.select({ id: schema.conversation.id, title: schema.conversation.title, updatedAt: schema.conversation.updatedAt })
    .from(schema.conversation).where(eq(schema.conversation.userId, user.id))
    .orderBy(desc(schema.conversation.updatedAt)).limit(30);
  return json({ conversations: rows });
}
