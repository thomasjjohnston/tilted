/**
 * Errors that represent an illegal *game* action by the caller (below
 * min-raise, not your turn, over-committing the shared stack, etc.) as
 * opposed to a server fault. The Fastify error handler (app.ts) maps
 * these to HTTP 422 with the message intact, so the client can surface a
 * real error instead of a silent 500 that makes a rejected raise look
 * like the hand "bounced back" (beta feedback S7-4).
 */
export class GameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameRuleError';
  }
}
