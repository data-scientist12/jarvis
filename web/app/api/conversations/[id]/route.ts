import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { authed, json, jsonError } from "@/lib/security/http";


export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const [row] = await db.select().from(schema.conversation)
    .where(and(eq(schema.conversation.id, id), eq(schema.conversation.userId, user.id))).limit(1);
  if (!row) return jsonError(404, "not_found");
  return json({ id: row.id, title: row.title, messages: row.messages });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  await db.delete(schema.conversation).where(and(eq(schema.conversation.id, id), eq(schema.conversation.userId, user.id)));
  return json({ ok: true });
}
