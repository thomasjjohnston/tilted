//! Card representation: a card is a u8 in 0..52, card = rank * 4 + suit,
//! rank 0 = deuce .. 12 = ace, suit 0..4 (clubs, diamonds, hearts, spades).

pub type Card = u8;

pub const RANK_CHARS: [char; 13] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
pub const SUIT_CHARS: [char; 4] = ['c', 'd', 'h', 's'];

#[inline]
pub fn rank(c: Card) -> u8 {
    c / 4
}

#[inline]
pub fn suit(c: Card) -> u8 {
    c % 4
}

pub fn card_to_string(c: Card) -> String {
    format!("{}{}", RANK_CHARS[rank(c) as usize], SUIT_CHARS[suit(c) as usize])
}

pub fn parse_card(s: &str) -> Result<Card, String> {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() != 2 {
        return Err(format!("bad card: {s}"));
    }
    let r = RANK_CHARS
        .iter()
        .position(|&c| c == chars[0].to_ascii_uppercase())
        .ok_or_else(|| format!("bad rank in: {s}"))?;
    let su = SUIT_CHARS
        .iter()
        .position(|&c| c == chars[1].to_ascii_lowercase())
        .ok_or_else(|| format!("bad suit in: {s}"))?;
    Ok((r * 4 + su) as Card)
}

/// Parse space- or comma-separated cards, e.g. "Ah Kd" or "2c,7h,Ts".
pub fn parse_cards(s: &str) -> Result<Vec<Card>, String> {
    s.split(|c| c == ' ' || c == ',')
        .filter(|t| !t.is_empty())
        .map(parse_card)
        .collect()
}

/// The 169 canonical preflop hand classes.
/// Index: pair -> rank*169-triangular scheme is overkill; we use the standard
/// 13x13 grid flattened: `high*13 + low` for suited (high > low), `low*13 + high`
/// for offsuit, diagonal for pairs. high/low are ranks 0..12.
pub fn preflop_class(c1: Card, c2: Card) -> u8 {
    let (r1, r2) = (rank(c1), rank(c2));
    let (hi, lo) = if r1 >= r2 { (r1, r2) } else { (r2, r1) };
    if r1 == r2 {
        hi * 13 + lo // diagonal
    } else if suit(c1) == suit(c2) {
        hi * 13 + lo // upper triangle: suited
    } else {
        lo * 13 + hi // lower triangle: offsuit
    }
}

/// Human-readable name for a preflop class index, e.g. "AKs", "T9o", "77".
pub fn preflop_class_name(class: u8) -> String {
    let row = class / 13;
    let col = class % 13;
    if row == col {
        format!("{}{}", RANK_CHARS[row as usize], RANK_CHARS[col as usize])
    } else if row > col {
        format!("{}{}s", RANK_CHARS[row as usize], RANK_CHARS[col as usize])
    } else {
        format!("{}{}o", RANK_CHARS[col as usize], RANK_CHARS[row as usize])
    }
}

/// Number of specific two-card combos in a preflop class (6 pairs, 4 suited, 12 offsuit).
pub fn preflop_class_combos(class: u8) -> u8 {
    let row = class / 13;
    let col = class % 13;
    if row == col {
        6
    } else if row > col {
        4
    } else {
        12
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_cards() {
        for c in 0..52u8 {
            assert_eq!(parse_card(&card_to_string(c)).unwrap(), c);
        }
    }

    #[test]
    fn preflop_classes() {
        let aa = preflop_class(parse_card("Ah").unwrap(), parse_card("As").unwrap());
        assert_eq!(preflop_class_name(aa), "AA");
        assert_eq!(preflop_class_combos(aa), 6);
        let aks = preflop_class(parse_card("Ah").unwrap(), parse_card("Kh").unwrap());
        assert_eq!(preflop_class_name(aks), "AKs");
        assert_eq!(preflop_class_combos(aks), 4);
        let t9o = preflop_class(parse_card("Td").unwrap(), parse_card("9c").unwrap());
        assert_eq!(preflop_class_name(t9o), "T9o");
        assert_eq!(preflop_class_combos(t9o), 12);
        // Order independence
        let ako1 = preflop_class(parse_card("Ac").unwrap(), parse_card("Kd").unwrap());
        let ako2 = preflop_class(parse_card("Kd").unwrap(), parse_card("Ac").unwrap());
        assert_eq!(ako1, ako2);
    }
}
