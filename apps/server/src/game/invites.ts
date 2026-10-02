import { randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { invites, users } from '../db/schema.js';
import { env } from '../env.js';
import { logEvent } from '../events/logger.js';
import { INVITE_CODE_LENGTH, INVITE_TTL_DAYS } from './constants.js';
import {
  MatchAlreadyActiveError, announceNewMatch, createMatchTx,
} from './match.js';

// No 0/O, 1/I/L: codes get read aloud and typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const DAY_MS = 24 * 60 * 60 * 1000;

export type InviteErrorCode =
  | 'not_found'       // unknown code (or hidden: inviter deleted)
  | 'expired'
  | 'used'            // redeemed by someone else
  | 'own_invite'
  | 'already_playing'; // the pair already has an active match

/** A caller-fault invite failure; the API maps `code` to an HTTP status. */
export class InviteError extends Error {
  constructor(public readonly code: InviteErrorCode, message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

export interface InviteView {
  code: string;
  url: string;
  expires_at: string;
}

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Accept what people actually type or paste: lowercase, spaces, dashes. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function inviteUrl(code: string): string {
  return `${env.PUBLIC_BASE_URL}/i/${code}`;
}

function toView(row: { code: string; expiresAt: Date }): InviteView {
  return { code: row.code, url: inviteUrl(row.code), expires_at: row.expiresAt.toISOString() };
}

/**
 * Create a single-use invite. Idempotent on (inviter, clientTxId): a retry
 * returns the invite the first call made.
 */
export async function createInvite(
  db: Database,
  inviterUserId: string,
  clientTxId: string,
  now: Date = new Date(),
): Promise<InviteView> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.invites.findFirst({
      where: and(eq(invites.inviterUserId, inviterUserId), eq(invites.clientTxId, clientTxId)),
    });
    if (existing) return toView(existing);

    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
    // The code is random, so a collision is astronomically unlikely; the
    // unique constraint is the authority and we simply try another.
    for (let attempt = 0; attempt < 5; attempt++) {
      const [row] = await tx.insert(invites)
        .values({ code: generateInviteCode(), inviterUserId, clientTxId, expiresAt })
        .onConflictDoNothing()
        .returning();
      if (row) {
        await logEvent(tx, inviterUserId, 'invite_created', { invite_id: row.inviteId });
        return toView(row);
      }
      // The conflict may have been a concurrent retry with our clientTxId.
      const raced = await tx.query.invites.findFirst({
        where: and(eq(invites.inviterUserId, inviterUserId), eq(invites.clientTxId, clientTxId)),
      });
      if (raced) return toView(raced);
    }
    throw new Error('Could not allocate an invite code');
  });
}

/**
 * Redeem an invite: starts a match between the redeemer and the inviter in
 * the same transaction that marks the invite used. Redeeming is the
 * redeemer's consent; the inviter consented by sending it.
 *
 * Idempotent for the same redeemer: a retry returns the same match.
 */
export async function redeemInvite(
  db: Database,
  rawCode: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ matchId: string }> {
  const code = normalizeInviteCode(rawCode);

  const outcome = await db.transaction(async (tx) => {
    // Lock the invite row: two people tapping the same link must not both win.
    await tx.execute(sql`SELECT 1 FROM invites WHERE code = ${code} FOR UPDATE`);
    const invite = await tx.query.invites.findFirst({ where: eq(invites.code, code) });
    if (!invite) throw new InviteError('not_found', 'That invite code was not found.');

    if (invite.redeemedByUserId) {
      if (invite.redeemedByUserId === userId && invite.matchId) {
        return { matchId: invite.matchId, created: null };
      }
      throw new InviteError('used', 'That invite has already been used.');
    }
    if (invite.inviterUserId === userId) {
      throw new InviteError('own_invite', 'That is your own invite. Send it to a friend.');
    }
    if (invite.expiresAt.getTime() <= now.getTime()) {
      throw new InviteError('expired', 'That invite has expired. Ask for a new one.');
    }
    const inviter = await tx.query.users.findFirst({ where: eq(users.userId, invite.inviterUserId) });
    if (!inviter || inviter.deletedAt) {
      throw new InviteError('not_found', 'That invite code was not found.');
    }

    let created;
    try {
      created = await createMatchTx(tx, userId, invite.inviterUserId);
    } catch (e) {
      if (e instanceof MatchAlreadyActiveError) {
        throw new InviteError('already_playing', `You already have a match in progress with ${inviter.displayName}.`);
      }
      throw e;
    }

    await tx.update(invites)
      .set({ redeemedByUserId: userId, redeemedAt: now, matchId: created.match.matchId })
      .where(and(eq(invites.inviteId, invite.inviteId), isNull(invites.redeemedByUserId)));
    await logEvent(tx, userId, 'invite_redeemed', {
      invite_id: invite.inviteId,
      inviter_user_id: invite.inviterUserId,
      match_id: created.match.matchId,
    });
    return { matchId: created.match.matchId, created, inviterUserId: invite.inviterUserId };
  });

  if (outcome.created && outcome.inviterUserId) {
    await announceNewMatch(db, outcome.created, userId, outcome.inviterUserId);
  }
  return { matchId: outcome.matchId };
}

export type InvitePreview =
  | { status: 'open'; inviterFirstName: string; expiresOn: string }
  | { status: 'expired' | 'used' | 'not_found' };

/**
 * What the public landing page may show for a code: the inviter's first
 * name and the expiry date, nothing else. Read-only.
 */
export async function getInvitePreview(
  db: Database,
  rawCode: string,
  now: Date = new Date(),
): Promise<InvitePreview> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { status: 'not_found' };
  const invite = await db.query.invites.findFirst({ where: eq(invites.code, code) });
  if (!invite) return { status: 'not_found' };
  if (invite.redeemedByUserId) return { status: 'used' };
  if (invite.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
  const inviter = await db.query.users.findFirst({ where: eq(users.userId, invite.inviterUserId) });
  if (!inviter || inviter.deletedAt) return { status: 'not_found' };
  return {
    status: 'open',
    inviterFirstName: inviter.displayName.split(' ')[0] || inviter.displayName,
    expiresOn: invite.expiresAt.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }),
  };
}
