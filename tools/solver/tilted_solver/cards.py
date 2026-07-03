"""Card utilities mirroring the Rust kernel's conventions.

A card is an int 0..51: card = rank * 4 + suit, rank 0 = deuce .. 12 = ace,
suits in order (clubs, diamonds, hearts, spades). Keep in lockstep with
kernel/src/cards.rs — conformance tests hold the two implementations together.
"""

from __future__ import annotations

RANK_CHARS = "23456789TJQKA"
SUIT_CHARS = "cdhs"


def parse_card(s: str) -> int:
    s = s.strip()
    if len(s) != 2:
        raise ValueError(f"bad card: {s!r}")
    rank = RANK_CHARS.index(s[0].upper())
    suit = SUIT_CHARS.index(s[1].lower())
    return rank * 4 + suit


def parse_cards(s: str) -> list[int]:
    return [parse_card(t) for t in s.replace(",", " ").split() if t]


def card_str(c: int) -> str:
    return RANK_CHARS[c // 4] + SUIT_CHARS[c % 4]


def cards_str(cards: list[int]) -> str:
    return " ".join(card_str(c) for c in cards)


def rank(c: int) -> int:
    return c // 4


def suit(c: int) -> int:
    return c % 4


def preflop_class(c1: int, c2: int) -> int:
    """The 169-class index; must match kernel/src/cards.rs exactly."""
    r1, r2 = rank(c1), rank(c2)
    hi, lo = max(r1, r2), min(r1, r2)
    if r1 == r2:
        return hi * 13 + lo
    if suit(c1) == suit(c2):
        return hi * 13 + lo
    return lo * 13 + hi


def preflop_class_name(cls: int) -> str:
    row, col = cls // 13, cls % 13
    if row == col:
        return RANK_CHARS[row] * 2
    if row > col:
        return f"{RANK_CHARS[row]}{RANK_CHARS[col]}s"
    return f"{RANK_CHARS[col]}{RANK_CHARS[row]}o"
