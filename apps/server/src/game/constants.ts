/** Number of hands dealt per round. */
export const HANDS_PER_ROUND = 10;

/** Default starting stack. */
export const STARTING_STACK = 2000;

/** Default blind sizes. */
export const BLIND_SMALL = 5;
export const BLIND_BIG = 10;

/** Minimum chips required to play a round as BB: HANDS_PER_ROUND * BLIND_BIG */
export const MIN_CHIPS_FOR_ROUND = HANDS_PER_ROUND * BLIND_BIG;

/** How long an invite link/code stays redeemable. */
export const INVITE_TTL_DAYS = 7;

/** Length of an invite code. */
export const INVITE_CODE_LENGTH = 8;
