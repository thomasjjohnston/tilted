/**
 * Generates a one-line action sketch from a hand's action log.
 *
 * Examples:
 * - "SB raised, BB 3-bet, SB called; flop checked, turn jam called — BB wins 420"
 * - "SB folded preflop — BB wins 15"
 * - "Checked to river, BB bet, SB called — SB wins 180"
 */

interface SketchAction {
  street: string;
  actingUserId: string;
  actionType: string;
  amount: number;
}

export function generateActionSketch(
  actions: SketchAction[],
  winnerId: string | null,
  pot: number,
  sbUserId: string,
  bbUserId: string,
): string {
  if (actions.length === 0) return '';

  const label = (userId: string) => userId === sbUserId ? 'SB' : 'BB';

  const streetGroups = new Map<string, SketchAction[]>();
  for (const a of actions) {
    const group = streetGroups.get(a.street) ?? [];
    group.push(a);
    streetGroups.set(a.street, group);
  }

  const parts: string[] = [];

  for (const [street, streetActions] of streetGroups) {
    const descriptions: string[] = [];

    for (const a of streetActions) {
      const actor = label(a.actingUserId);
      switch (a.actionType) {
        case 'fold':
          descriptions.push(`${actor} folded`);
          break;
        case 'check':
          descriptions.push(`${actor} checked`);
          break;
        case 'call':
          descriptions.push(`${actor} called${a.amount > 0 ? ` ${a.amount}` : ''}`);
          break;
        case 'bet':
          descriptions.push(`${actor} bet ${a.amount}`);
          break;
        case 'raise':
          descriptions.push(`${actor} raised${a.amount > 0 ? ` to ${a.amount}` : ''}`);
          break;
        case 'all_in':
          descriptions.push(`${actor} jammed`);
          break;
      }
    }

    if (descriptions.length === 2 && descriptions.every(d => d.includes('checked'))) {
      parts.push(`${street} checked`);
    } else {
      parts.push(descriptions.join(', '));
    }
  }

  let sketch = parts.join('; ');

  // Append result
  if (winnerId) {
    sketch += ` — ${label(winnerId)} wins ${pot}`;
  } else {
    sketch += ` — split pot ${pot}`;
  }

  return sketch;
}
