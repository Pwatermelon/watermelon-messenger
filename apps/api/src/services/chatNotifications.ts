import { eq } from "drizzle-orm";
import { db, chatMembers } from "../db";
import { notifyUser } from "./webPush";

export async function notifyChatMembersExcept(
  chatId: string,
  exceptUserId: string,
  title: string,
  body: string
): Promise<void> {
  const members = await db
    .select({ userId: chatMembers.userId, muted: chatMembers.muted })
    .from(chatMembers)
    .where(eq(chatMembers.chatId, chatId));
  for (const m of members) {
    if (m.userId !== exceptUserId && !m.muted) {
      notifyUser(m.userId, title, body).catch(() => {});
    }
  }
}
