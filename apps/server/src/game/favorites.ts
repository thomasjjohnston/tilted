import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { favorites } from '../db/schema.js';
import { logEvent } from '../events/logger.js';

export async function toggleFavorite(
  db: Database,
  userId: string,
  handId: string,
  favorite: boolean,
): Promise<void> {
  if (favorite) {
    await db.insert(favorites)
      .values({ userId, handId })
      .onConflictDoNothing();
    await logEvent(db, userId, 'favorite_added', { hand_id: handId });
  } else {
    await db.delete(favorites).where(
      and(eq(favorites.userId, userId), eq(favorites.handId, handId)),
    );
  }
}
