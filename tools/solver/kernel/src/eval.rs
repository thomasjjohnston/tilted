//! Fast 7-card hand evaluator.
//!
//! Returns a u32 score where higher = stronger. Score layout:
//! category (4 bits) << 20 | tiebreak (20 bits). Categories:
//! 8=straight flush, 7=quads, 6=full house, 5=flush, 4=straight,
//! 3=trips, 2=two pair, 1=one pair, 0=high card.
//!
//! Correctness is anchored by a differential test against a brute-force
//! best-of-21 five-card evaluator (see tests below).

use crate::cards::{rank, suit, Card};

/// Detect the top of a straight in a 13-bit rank mask (bit 12 = ace).
/// Returns Some(high_rank) or None. Handles the wheel (A2345 -> high 3, i.e. the five).
#[inline]
fn straight_high(mask: u16) -> Option<u8> {
    // Ace-low: add a virtual bit below deuce.
    let m = ((mask & 0x1000) >> 12) | (mask << 1); // bit0 = ace-low, bit1..13 = 2..A
    let mut run = 0u8;
    let mut best: Option<u8> = None;
    for r in 0..14u8 {
        if (m >> r) & 1 == 1 {
            run += 1;
            if run >= 5 {
                best = Some(r - 1); // convert back: bit r corresponds to rank r-1
            }
        } else {
            run = 0;
        }
    }
    best
}

/// Pack up to five rank values (each 0..12, 4 bits) into the tiebreak field, high first.
#[inline]
fn pack(ranks: &[u8]) -> u32 {
    let mut v = 0u32;
    for &r in ranks {
        v = (v << 4) | (r as u32);
    }
    // Left-align to exactly 5 nibbles so shorter lists compare correctly.
    v << (4 * (5 - ranks.len()))
}

pub fn eval7(cards: &[Card; 7]) -> u32 {
    let mut rank_counts = [0u8; 13];
    let mut suit_counts = [0u8; 4];
    let mut suit_masks = [0u16; 4];
    let mut rank_mask: u16 = 0;
    for &c in cards {
        let r = rank(c);
        let s = suit(c);
        rank_counts[r as usize] += 1;
        suit_counts[s as usize] += 1;
        suit_masks[s as usize] |= 1 << r;
        rank_mask |= 1 << r;
    }

    // Flush / straight flush.
    for s in 0..4 {
        if suit_counts[s] >= 5 {
            if let Some(high) = straight_high(suit_masks[s]) {
                return (8 << 20) | pack(&[high]);
            }
            // Top five ranks of the flush suit.
            let mut ranks: Vec<u8> = (0..13u8).rev().filter(|&r| (suit_masks[s] >> r) & 1 == 1).collect();
            ranks.truncate(5);
            return (5 << 20) | pack(&ranks);
        }
    }

    // Collect rank multiplicities, highest rank first within each group.
    let mut quads = Vec::new();
    let mut trips = Vec::new();
    let mut pairs = Vec::new();
    let mut singles = Vec::new();
    for r in (0..13u8).rev() {
        match rank_counts[r as usize] {
            4 => quads.push(r),
            3 => trips.push(r),
            2 => pairs.push(r),
            1 => singles.push(r),
            _ => {}
        }
    }

    if let Some(&q) = quads.first() {
        // Kicker: best remaining rank of any multiplicity.
        let kicker = (0..13u8).rev().find(|&r| r != q && rank_counts[r as usize] > 0).unwrap();
        return (7 << 20) | pack(&[q, kicker]);
    }

    // Full house: trips + best pair (or second trips acting as the pair).
    if !trips.is_empty() && (trips.len() >= 2 || !pairs.is_empty()) {
        let t = trips[0];
        let p = if trips.len() >= 2 {
            trips[1].max(*pairs.first().unwrap_or(&0))
        } else {
            pairs[0]
        };
        return (6 << 20) | pack(&[t, p]);
    }

    if let Some(high) = straight_high(rank_mask) {
        return (4 << 20) | pack(&[high]);
    }

    if let Some(&t) = trips.first() {
        let kickers: Vec<u8> = singles.iter().copied().take(2).collect();
        let mut v = vec![t];
        v.extend(kickers);
        return (3 << 20) | pack(&v);
    }

    if pairs.len() >= 2 {
        let (p1, p2) = (pairs[0], pairs[1]);
        // Kicker may be a single or the third pair's rank.
        let kicker = (0..13u8)
            .rev()
            .find(|&r| r != p1 && r != p2 && rank_counts[r as usize] > 0)
            .unwrap();
        return (2 << 20) | pack(&[p1, p2, kicker]);
    }

    if let Some(&p) = pairs.first() {
        let mut v = vec![p];
        v.extend(singles.iter().copied().take(3));
        return (1 << 20) | pack(&v);
    }

    let tops: Vec<u8> = singles.iter().copied().take(5).collect();
    pack(&tops) // category 0
}

/// Compare two 7-card hands: positive if a wins, 0 tie, negative if b wins.
pub fn compare7(a: &[Card; 7], b: &[Card; 7]) -> i32 {
    let (ea, eb) = (eval7(a), eval7(b));
    if ea > eb {
        1
    } else if ea < eb {
        -1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::parse_cards;
    use rand::seq::SliceRandom;
    use rand::SeedableRng;

    /// Brute-force reference: evaluate the best 5-card hand out of 21 combos
    /// using an independent, dead-simple 5-card evaluator.
    fn eval5_ref(c: &[Card; 5]) -> u32 {
        let mut rank_counts = [0u8; 13];
        let mut suits = [0u8; 4];
        let mut mask = 0u16;
        for &card in c {
            rank_counts[rank(card) as usize] += 1;
            suits[suit(card) as usize] += 1;
            mask |= 1 << rank(card);
        }
        let is_flush = suits.iter().any(|&s| s == 5);
        let s_high = straight_high(mask).filter(|_| mask.count_ones() == 5);
        let mut groups: Vec<(u8, u8)> = (0..13u8)
            .filter(|&r| rank_counts[r as usize] > 0)
            .map(|r| (rank_counts[r as usize], r))
            .collect();
        // Sort by (count, rank) descending: primary grouping order for tiebreaks.
        groups.sort_by(|a, b| b.cmp(a));
        let ranks_by_group: Vec<u8> = groups.iter().map(|&(_, r)| r).collect();
        let category = if is_flush && s_high.is_some() {
            8
        } else if groups[0].0 == 4 {
            7
        } else if groups[0].0 == 3 && groups.len() >= 2 && groups[1].0 == 2 {
            6
        } else if is_flush {
            5
        } else if s_high.is_some() {
            4
        } else if groups[0].0 == 3 {
            3
        } else if groups[0].0 == 2 && groups[1].0 == 2 {
            2
        } else if groups[0].0 == 2 {
            1
        } else {
            0
        };
        if category == 8 || category == 4 {
            (category << 20) | pack(&[s_high.unwrap()])
        } else {
            (category << 20) | pack(&ranks_by_group)
        }
    }

    fn eval7_ref(cards: &[Card; 7]) -> u32 {
        let mut best = 0;
        for i in 0..7 {
            for j in (i + 1)..7 {
                let five: Vec<Card> = (0..7).filter(|&k| k != i && k != j).map(|k| cards[k]).collect();
                let arr: [Card; 5] = five.try_into().unwrap();
                best = best.max(eval5_ref(&arr));
            }
        }
        best
    }

    #[test]
    fn known_hands() {
        let cases: Vec<(&str, u32)> = vec![
            ("Ah Kh Qh Jh Th 2c 3d", 8), // royal (straight flush)
            ("5h 4h 3h 2h Ah 9c 9d", 8), // steel wheel
            ("9c 9d 9h 9s Kd 2c 3c", 7), // quads
            ("9c 9d 9h Ks Kd 2c 3c", 6), // full house
            ("Ah 9h 7h 4h 2h Kc Qd", 5), // flush
            ("9c 8d 7h 6s 5d Ac Kd", 4), // straight
            ("5h 4d 3c 2s Ad Kc 9h", 4), // wheel straight
            ("9c 9d 9h Ks Qd 2c 3c", 3), // trips
            ("9c 9d Kh Ks Qd 2c 3c", 2), // two pair
            ("9c 9d Kh Qs Jd 2c 3c", 1), // pair
            ("Ac Kd 9h 7s 5d 3c 2h", 0), // high card
        ];
        for (s, cat) in cases {
            let cards: [Card; 7] = parse_cards(s).unwrap().try_into().unwrap();
            assert_eq!(eval7(&cards) >> 20, cat, "category mismatch for {s}");
        }
    }

    #[test]
    fn differential_vs_bruteforce() {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(42);
        let mut deck: Vec<Card> = (0..52).collect();
        for _ in 0..20_000 {
            deck.shuffle(&mut rng);
            let a: [Card; 7] = deck[0..7].try_into().unwrap();
            let fast = eval7(&a);
            let slow = eval7_ref(&a);
            assert_eq!(
                fast >> 20,
                slow >> 20,
                "category mismatch on {:?}",
                a.iter().map(|&c| crate::cards::card_to_string(c)).collect::<Vec<_>>()
            );
            // Compare two random hands sharing a board: ordering must agree.
            let b: [Card; 7] = [deck[7], deck[8], deck[2], deck[3], deck[4], deck[5], deck[6]];
            let fast_cmp = compare7(&a, &b);
            let slow_cmp = {
                let (ra, rb) = (eval7_ref(&a), eval7_ref(&b));
                if ra > rb { 1 } else if ra < rb { -1 } else { 0 }
            };
            assert_eq!(fast_cmp, slow_cmp, "ordering mismatch");
        }
    }
}
