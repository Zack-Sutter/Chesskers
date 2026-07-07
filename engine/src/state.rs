use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PieceType {
    Pawn,
    Rook,
    Bishop,
    Knight,
    Queen,
    King,
    Checkers,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Team {
    #[serde(rename = "w")]
    White,
    #[serde(rename = "b")]
    Black,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Coord {
    pub x: u8,
    pub y: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SerializedPiece {
    pub x: u8,
    pub y: u8,
    #[serde(rename = "type")]
    pub piece_type: PieceType,
    pub team: Team,
    #[serde(rename = "hasMoved")]
    pub has_moved: bool,
    #[serde(rename = "enPassant", default, skip_serializing_if = "Option::is_none")]
    pub en_passant: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SerializedBoard {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u8,
    pub pieces: Vec<SerializedPiece>,
    #[serde(rename = "totalTurns")]
    pub total_turns: u32,
    #[serde(
        rename = "checkersHopPosition",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub checkers_hop_position: Option<Coord>,
    #[serde(rename = "winningTeam", default, skip_serializing_if = "Option::is_none")]
    pub winning_team: Option<Team>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PromotionChoice {
    Queen,
    Rook,
    Bishop,
    Knight,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Move {
    pub from: Coord,
    pub to: Coord,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promotion: Option<PromotionChoice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixtureAction {
    #[serde(rename = "move")]
    pub mv: Move,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingPromotion {
    pub x: u8,
    pub y: u8,
    pub team: Team,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegalMovesExpect {
    pub from: Coord,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include: Option<Vec<Coord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<Coord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exact: Option<Vec<Coord>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PieceAtExpect {
    pub x: u8,
    pub y: u8,
    #[serde(rename = "type")]
    pub piece_type: PieceType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixtureExpect {
    #[serde(rename = "winningTeam", default, skip_serializing_if = "Option::is_none")]
    pub winning_team: Option<Team>,
    #[serde(rename = "pieceCount", default, skip_serializing_if = "Option::is_none")]
    pub piece_count: Option<usize>,
    #[serde(rename = "legalMovesFrom", default, skip_serializing_if = "Option::is_none")]
    pub legal_moves_from: Option<Vec<LegalMovesExpect>>,
    #[serde(rename = "applyOk", default, skip_serializing_if = "Option::is_none")]
    pub apply_ok: Option<bool>,
    #[serde(rename = "totalTurns", default, skip_serializing_if = "Option::is_none")]
    pub total_turns: Option<u32>,
    #[serde(
        rename = "checkersHopPosition",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub checkers_hop_position: Option<Option<Coord>>,
    #[serde(rename = "pendingPromotion", default, skip_serializing_if = "Option::is_none")]
    pub pending_promotion: Option<Option<PendingPromotion>>,
    #[serde(rename = "pieceAt", default, skip_serializing_if = "Option::is_none")]
    pub piece_at: Option<Vec<PieceAtExpect>>,
    #[serde(rename = "noPieceAt", default, skip_serializing_if = "Option::is_none")]
    pub no_piece_at: Option<Vec<Coord>>,
    #[serde(rename = "noPieceType", default, skip_serializing_if = "Option::is_none")]
    pub no_piece_type: Option<PieceType>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoldenFixture {
    pub name: String,
    pub board: SerializedBoard,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<FixtureAction>,
    pub expect: FixtureExpect,
}

#[derive(Debug)]
pub enum ParseError {
    Json(serde_json::Error),
    UnsupportedSchemaVersion(u8),
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(e) => write!(f, "{e}"),
            Self::UnsupportedSchemaVersion(v) => {
                write!(f, "unsupported schemaVersion: {v}")
            }
        }
    }
}

impl std::error::Error for ParseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(e) => Some(e),
            Self::UnsupportedSchemaVersion(_) => None,
        }
    }
}

impl From<serde_json::Error> for ParseError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl SerializedBoard {
    pub fn from_json(json: &str) -> Result<Self, ParseError> {
        let board: Self = serde_json::from_str(json)?;
        board.validate()?;
        Ok(board)
    }

    fn validate(&self) -> Result<(), ParseError> {
        if self.schema_version != 1 {
            return Err(ParseError::UnsupportedSchemaVersion(self.schema_version));
        }
        Ok(())
    }
}

impl GoldenFixture {
    pub fn from_json(json: &str) -> Result<Self, ParseError> {
        let fixture: Self = serde_json::from_str(json)?;
        fixture.board.validate()?;
        Ok(fixture)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
    }

    #[test]
    fn parses_all_fixture_files() {
        let dir = fixtures_dir();
        let entries = fs::read_dir(&dir).unwrap_or_else(|e| panic!("read {}: {e}", dir.display()));

        let mut count = 0;
        for entry in entries {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            count += 1;
            let json = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
            let fixture = GoldenFixture::from_json(&json)
                .unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
            assert_eq!(fixture.board.schema_version, 1);
            assert_eq!(fixture.name, path.file_stem().unwrap().to_str().unwrap());
        }
        assert_eq!(count, 13, "expected 13 fixture JSON files");
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let json = r#"{"schemaVersion":2,"pieces":[],"totalTurns":1}"#;
        let err = SerializedBoard::from_json(json).unwrap_err();
        assert!(matches!(
            err,
            ParseError::UnsupportedSchemaVersion(2)
        ));
    }
}
