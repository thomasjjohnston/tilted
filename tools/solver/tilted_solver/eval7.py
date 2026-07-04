"""Pure-Python 7-card evaluator mirroring kernel/src/eval.rs.

Same score layout: category << 20 | packed tiebreak ranks, so scores are
comparable across the two implementations (pinned by conformance tests).
"""

from __future__ import annotations


def _straight_high(mask: int) -> int | None:
    m = ((mask & 0x1000) >> 12) | (mask << 1)
    run = 0
    best = None
    for r in range(14):
        if (m >> r) & 1:
            run += 1
            if run >= 5:
                best = r - 1
        else:
            run = 0
    return best


def _pack(ranks: list[int]) -> int:
    v = 0
    for r in ranks:
        v = (v << 4) | r
    return v << (4 * (5 - len(ranks)))


def eval7(cards: list[int]) -> int:
    """cards: seven ints 0..51 (rank*4+suit). Higher score = stronger hand."""
    rank_counts = [0] * 13
    suit_counts = [0] * 4
    suit_masks = [0] * 4
    rank_mask = 0
    for c in cards:
        r, s = c // 4, c % 4
        rank_counts[r] += 1
        suit_counts[s] += 1
        suit_masks[s] |= 1 << r
        rank_mask |= 1 << r

    for s in range(4):
        if suit_counts[s] >= 5:
            high = _straight_high(suit_masks[s])
            if high is not None:
                return (8 << 20) | _pack([high])
            ranks = [r for r in range(12, -1, -1) if (suit_masks[s] >> r) & 1][:5]
            return (5 << 20) | _pack(ranks)

    quads = [r for r in range(12, -1, -1) if rank_counts[r] == 4]
    trips = [r for r in range(12, -1, -1) if rank_counts[r] == 3]
    pairs = [r for r in range(12, -1, -1) if rank_counts[r] == 2]
    singles = [r for r in range(12, -1, -1) if rank_counts[r] == 1]

    if quads:
        q = quads[0]
        kicker = next(r for r in range(12, -1, -1) if r != q and rank_counts[r] > 0)
        return (7 << 20) | _pack([q, kicker])

    if trips and (len(trips) >= 2 or pairs):
        t = trips[0]
        p = max(trips[1], pairs[0]) if len(trips) >= 2 and pairs else (trips[1] if len(trips) >= 2 else pairs[0])
        return (6 << 20) | _pack([t, p])

    high = _straight_high(rank_mask)
    if high is not None:
        return (4 << 20) | _pack([high])

    if trips:
        return (3 << 20) | _pack([trips[0]] + singles[:2])

    if len(pairs) >= 2:
        p1, p2 = pairs[0], pairs[1]
        kicker = next(r for r in range(12, -1, -1) if r not in (p1, p2) and rank_counts[r] > 0)
        return (2 << 20) | _pack([p1, p2, kicker])

    if pairs:
        return (1 << 20) | _pack([pairs[0]] + singles[:3])

    return _pack(singles[:5])
