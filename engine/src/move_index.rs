//! Move -> NN policy logit index (architecture §5.3).
//!
//! Mirrors `training/chesskers/move_index.py`; both must agree with the spec
//! (verified by the unit test below and its Python twin). Layout:
//!   fromIndex = from.y*8 + from.x   (0..63)
//!   toIndex   = to.y*8 + to.x       (0..63)
//!   baseIndex = fromIndex*64 + toIndex   (0..4095)
//!   moveIndex = baseIndex + promotionOffset
//! where the promotion buckets are queen:0, rook:4096, bishop:8192, knight:12288.
//! Non-promotion moves live in bucket 0 (max index 16383 < POLICY_SIZE).

use crate::state::{Move, PromotionChoice};

/// Length of the policy logits vector: 4096 (from×to) × 4 promotion buckets.
pub const POLICY_SIZE: usize = 16384;

#[inline]
fn promotion_offset(promotion: Option<PromotionChoice>) -> usize {
    match promotion {
        None | Some(PromotionChoice::Queen) => 0,
        Some(PromotionChoice::Rook) => 4096,
        Some(PromotionChoice::Bishop) => 8192,
        Some(PromotionChoice::Knight) => 12288,
    }
}

/// Flat policy index for `mv` (0..POLICY_SIZE-1).
#[inline]
pub fn move_index(mv: &Move) -> usize {
    let from = usize::from(mv.from.y) * 8 + usize::from(mv.from.x);
    let to = usize::from(mv.to.y) * 8 + usize::from(mv.to.x);
    from * 64 + to + promotion_offset(mv.promotion)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Coord;

    fn mv(fx: u8, fy: u8, tx: u8, ty: u8, promo: Option<PromotionChoice>) -> Move {
        Move {
            from: Coord { x: fx, y: fy },
            to: Coord { x: tx, y: ty },
            promotion: promo,
        }
    }

    // Golden indices — hand-computed from §5.3; mirrored in Python parity test.
    #[test]
    fn matches_spec_golden_indices() {
        assert_eq!(move_index(&mv(0, 0, 0, 0, None)), 0);
        // (3,1)->(3,3): from=11, to=27, base=11*64+27=731
        assert_eq!(move_index(&mv(3, 1, 3, 3, None)), 731);
        // (0,6)->(0,7) rook promo: from=48, to=56, base=3128, +4096
        assert_eq!(move_index(&mv(0, 6, 0, 7, Some(PromotionChoice::Rook))), 7224);
        // queen promo shares bucket 0 with the base index by design
        assert_eq!(
            move_index(&mv(0, 6, 0, 7, Some(PromotionChoice::Queen))),
            3128
        );
        // max index stays in range
        assert_eq!(
            move_index(&mv(7, 7, 7, 7, Some(PromotionChoice::Knight))),
            4095 + 12288
        );
        assert!(move_index(&mv(7, 7, 7, 7, Some(PromotionChoice::Knight))) < POLICY_SIZE);
    }
}
