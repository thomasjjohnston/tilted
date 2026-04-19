import { users } from './schema.js';
import type { Database } from './connection.js';

// Hardcoded MVP user IDs — stable across environments
export const USER_TJ_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
export const USER_SL_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

export async function seedUsers(db: Database) {
  await db.insert(users).values([
    { userId: USER_TJ_ID, displayName: 'Thomas Johnston' },
    { userId: USER_SL_ID, displayName: 'Stephen Layton' },
  ]).onConflictDoNothing();

  // Update name if already seeded with old name
  const { eq } = await import('drizzle-orm');
  await db.update(users)
    .set({ displayName: 'Stephen Layton' })
    .where(eq(users.userId, USER_SL_ID));
}
