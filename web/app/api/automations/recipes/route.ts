import { RECIPES } from "@/lib/automations/recipes";
import { authed, json } from "@/lib/security/http";


export async function GET() {
  const user = await authed();
  if (user instanceof Response) return user;
  return json({ recipes: RECIPES });
}
