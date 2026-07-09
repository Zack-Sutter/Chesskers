//! ONNX-backed position evaluation (architecture §5.6).
//! ponytail: tract-onnx instead of ort — pure Rust, no MSVC link pain on Windows; swap to ort if we need ORT EPs (CUDA/DirectML).

use crate::board::Board;
use crate::encoder::{encode, BOARD_DIM, NUM_PLANES};
use crate::move_index::{move_index, POLICY_SIZE};
use crate::search::expand_moves;
use crate::state::Move;
use std::fmt;
use std::path::Path;
use std::sync::Arc;
use tract_onnx::prelude::*;

pub type GameState = Board;

#[derive(Debug, Clone, PartialEq)]
pub struct EvalResult {
    pub value: f32,
    pub policy: Vec<(Move, f32)>,
}

#[derive(Debug)]
pub enum EvalError {
    Tract(TractError),
    InvalidOutput(String),
}

impl fmt::Display for EvalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tract(e) => write!(f, "{e}"),
            Self::InvalidOutput(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for EvalError {}

impl From<TractError> for EvalError {
    fn from(e: TractError) -> Self {
        Self::Tract(e)
    }
}

pub trait Evaluator {
    fn evaluate(&mut self, state: &GameState) -> Result<EvalResult, EvalError>;
}

pub struct OnnxEvaluator {
    model: Arc<TypedRunnableModel>,
}

impl OnnxEvaluator {
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, EvalError> {
        let model = tract_onnx::onnx()
            .model_for_path(path)?
            .with_input_fact(
                0,
                InferenceFact::dt_shape(f32::datum_type(), tvec!(1, NUM_PLANES, BOARD_DIM, BOARD_DIM)),
            )?
            .into_optimized()?
            .into_runnable()?;
        Ok(Self { model })
    }
}

impl Evaluator for OnnxEvaluator {
    fn evaluate(&mut self, state: &GameState) -> Result<EvalResult, EvalError> {
        let flat = encode(state);
        let input = Tensor::from_shape(&[1, NUM_PLANES, BOARD_DIM, BOARD_DIM], &flat)
            .map_err(|e| EvalError::InvalidOutput(e.to_string()))?;

        let outputs = self.model.run(tvec!(input.into()))?;
        let value = outputs[0]
            .to_plain_array_view::<f32>()
            .map_err(|e| EvalError::InvalidOutput(e.to_string()))?
            .iter()
            .next()
            .copied()
            .ok_or_else(|| EvalError::InvalidOutput("empty value output".into()))?;

        if !value.is_finite() {
            return Err(EvalError::InvalidOutput(format!(
                "non-finite value: {value}"
            )));
        }

        // Dual-head models (v002+) emit a second output: 16384 policy logits.
        // Value-only models (v001) have one output -> empty policy (MCTS falls
        // back to uniform priors).
        let policy = if outputs.len() > 1 {
            let logits = outputs[1]
                .to_plain_array_view::<f32>()
                .map_err(|e| EvalError::InvalidOutput(e.to_string()))?;
            let logits = logits.as_slice().ok_or_else(|| {
                EvalError::InvalidOutput("policy output not contiguous".into())
            })?;
            if logits.len() != POLICY_SIZE {
                return Err(EvalError::InvalidOutput(format!(
                    "policy output len {} != {POLICY_SIZE}",
                    logits.len()
                )));
            }
            softmax_legal(state, logits)
        } else {
            Vec::new()
        };

        Ok(EvalResult { value, policy })
    }
}

/// Softmax the policy logits over just the legal (promotion-expanded) moves.
fn softmax_legal(board: &Board, logits: &[f32]) -> Vec<(Move, f32)> {
    let moves = expand_moves(board);
    if moves.is_empty() {
        return Vec::new();
    }
    let raw: Vec<f32> = moves.iter().map(|m| logits[move_index(m)]).collect();
    let max = raw.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = raw.iter().map(|v| (v - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    if sum <= 0.0 || !sum.is_finite() {
        // Degenerate logits -> uniform.
        let p = 1.0 / moves.len() as f32;
        return moves.into_iter().map(|m| (m, p)).collect();
    }
    moves
        .into_iter()
        .zip(exps)
        .map(|(m, e)| (m, e / sum))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::GoldenFixture;
    use std::fs;
    use std::path::PathBuf;

    fn dummy_model_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/dummy.onnx")
    }

    fn initial_board() -> Board {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/initial_board.json");
        let json = fs::read_to_string(path).unwrap();
        let fixture = GoldenFixture::from_json(&json).unwrap();
        Board::from_serialized(&fixture.board)
    }

    #[test]
    fn loads_dummy_onnx_and_returns_finite_value() {
        let path = dummy_model_path();
        assert!(path.is_file(), "missing {}", path.display());

        let mut evaluator = OnnxEvaluator::from_file(&path).unwrap();
        let value = evaluator.evaluate(&initial_board()).unwrap().value;
        assert!(value.is_finite());
        assert!((-1.0..=1.0).contains(&value), "value {value} outside [-1, 1]");
    }
}
