//! ONNX-backed position evaluation (architecture §5.6).
//! ponytail: tract-onnx instead of ort — pure Rust, no MSVC link pain on Windows; swap to ort if we need ORT EPs (CUDA/DirectML).

use crate::board::Board;
use crate::encoder::{encode, BOARD_DIM, NUM_PLANES};
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

        Ok(EvalResult {
            value,
            policy: Vec::new(),
        })
    }
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
