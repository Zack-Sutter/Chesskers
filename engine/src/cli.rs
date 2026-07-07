use crate::apply::apply_move;
use crate::board::Board;
use crate::bot::play_random_game;
use crate::evaluator::OnnxEvaluator;
use crate::search::{search_best_move_timed, TimedSearchConfig};
use crate::state::{Move, SerializedBoard, Team};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CliError {
    pub error: String,
}

#[derive(Debug, Deserialize)]
struct ApplyMoveInput {
    board: SerializedBoard,
    #[serde(rename = "move")]
    mv: Move,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TerminalResult {
    pub terminal: bool,
    pub winner: Option<Team>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PlayRandomResult {
    pub terminal: bool,
    pub winner: Option<Team>,
    #[serde(rename = "movesPlayed")]
    pub moves_played: u32,
}

#[derive(Debug, Clone)]
pub struct BestMoveOptions {
    pub model_path: String,
    pub think_ms: u64,
    pub depth: u32,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct BestMoveResult {
    #[serde(rename = "move")]
    pub mv: Move,
}

fn board_from_json(json: &str) -> Result<Board, CliError> {
    let serialized = SerializedBoard::from_json(json).map_err(|e| CliError {
        error: e.to_string(),
    })?;
    let mut board = Board::from_serialized(&serialized);
    board.calculate_all_moves();
    Ok(board)
}

pub fn run(command: &str, stdin: &str) -> Result<String, CliError> {
    run_with_seed(command, stdin, None)
}

pub fn run_with_seed(command: &str, stdin: &str, seed: Option<u64>) -> Result<String, CliError> {
    match command {
        "legal-moves" => {
            let board = board_from_json(stdin)?;
            serde_json::to_string(&board.all_legal_moves()).map_err(|e| CliError {
                error: e.to_string(),
            })
        }
        "is-terminal" => {
            let board = board_from_json(stdin)?;
            serde_json::to_string(&TerminalResult {
                terminal: board.winning_team.is_some(),
                winner: board.winning_team,
            })
            .map_err(|e| CliError {
                error: e.to_string(),
            })
        }
        "apply-move" => {
            let input: ApplyMoveInput = serde_json::from_str(stdin).map_err(|e| CliError {
                error: e.to_string(),
            })?;
            let mut board = Board::from_serialized(&input.board);
            board.calculate_all_moves();
            let result = apply_move(&board, &input.mv);
            if !result.ok {
                return Err(CliError {
                    error: "illegal move".to_string(),
                });
            }
            serde_json::to_string(&result.board.to_serialized()).map_err(|e| CliError {
                error: e.to_string(),
            })
        }
        "play-random" => {
            let board = board_from_json(stdin)?;
            let seed = seed.unwrap_or(0);
            let result = play_random_game(board, seed).map_err(|e| CliError { error: e })?;
            serde_json::to_string(&PlayRandomResult {
                terminal: result.terminal,
                winner: result.winner,
                moves_played: result.moves_played,
            })
            .map_err(|e| CliError {
                error: e.to_string(),
            })
        }
        _ => Err(CliError {
            error: format!("unknown command: {command}"),
        }),
    }
}

pub fn run_best_move(stdin: &str, options: &BestMoveOptions) -> Result<String, CliError> {
    let board = board_from_json(stdin)?;
    let mut evaluator = OnnxEvaluator::from_file(Path::new(&options.model_path)).map_err(|e| {
        CliError {
            error: e.to_string(),
        }
    })?;
    let mv = search_best_move_timed(
        &board,
        &mut evaluator,
        &TimedSearchConfig {
            max_depth: options.depth,
            think_ms: options.think_ms,
        },
    )
    .map_err(|e| CliError {
        error: e.to_string(),
    })?;
    serde_json::to_string(&BestMoveResult { mv }).map_err(|e| CliError {
        error: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
    }

    #[test]
    fn best_move_returns_legal_move_within_budget() {
        use std::path::PathBuf;
        use std::time::Instant;

        let fixture: Value = serde_json::from_str(
            &fs::read_to_string(fixtures_dir().join("initial_board.json")).unwrap(),
        )
        .unwrap();
        let model = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/dummy.onnx");
        let options = BestMoveOptions {
            model_path: model.to_string_lossy().into_owned(),
            think_ms: 500,
            depth: 4,
        };
        let start = Instant::now();
        let out = run_best_move(
            &serde_json::to_string(&fixture["board"]).unwrap(),
            &options,
        )
        .unwrap();
        assert!(
            start.elapsed().as_millis() <= options.think_ms as u128 + 150,
            "best-move exceeded think-ms budget ({} ms)",
            start.elapsed().as_millis()
        );

        let parsed: Value = serde_json::from_str(&out).unwrap();
        let mv = &parsed["move"];
        assert!(mv["from"]["x"].is_number());
        assert!(mv["to"]["x"].is_number());

        let board = board_from_json(&serde_json::to_string(&fixture["board"]).unwrap()).unwrap();
        assert!(
            board.all_legal_moves().iter().any(|legal| {
                legal.from.x == mv["from"]["x"].as_u64().unwrap() as u8
                    && legal.from.y == mv["from"]["y"].as_u64().unwrap() as u8
                    && legal.to.x == mv["to"]["x"].as_u64().unwrap() as u8
                    && legal.to.y == mv["to"]["y"].as_u64().unwrap() as u8
            }),
            "returned move must be legal: {mv}"
        );
    }

    #[test]
    fn play_random_cli_reaches_terminal() {
        let fixture: Value = serde_json::from_str(
            &fs::read_to_string(fixtures_dir().join("initial_board.json")).unwrap(),
        )
        .unwrap();
        let out = run_with_seed(
            "play-random",
            &serde_json::to_string(&fixture["board"]).unwrap(),
            Some(42),
        )
        .unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["terminal"], json!(true));
        assert!(parsed["winner"].is_string());
        assert!(parsed["movesPlayed"].as_u64().unwrap() > 0);
    }

    #[test]
    fn is_terminal_on_initial_board() {
        let fixture: Value = serde_json::from_str(
            &fs::read_to_string(fixtures_dir().join("initial_board.json")).unwrap(),
        )
        .unwrap();
        let out = run("is-terminal", &serde_json::to_string(&fixture["board"]).unwrap())
            .unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["terminal"], json!(false));
        assert!(parsed["winner"].is_null());
    }

    #[test]
    fn is_terminal_when_white_wins() {
        let fixture: Value = serde_json::from_str(
            &fs::read_to_string(
                fixtures_dir().join("declares_white_winner_when_no_black_pieces.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let out = run("is-terminal", &serde_json::to_string(&fixture["board"]).unwrap())
            .unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["terminal"], json!(true));
        assert_eq!(parsed["winner"], json!("w"));
    }

    #[test]
    fn legal_moves_includes_wrapped_checkers_step() {
        let fixture: Value = serde_json::from_str(
            &fs::read_to_string(fixtures_dir().join("checkers_wrapped_step_left_edge.json"))
                .unwrap(),
        )
        .unwrap();
        let out = run("legal-moves", &serde_json::to_string(&fixture["board"]).unwrap())
            .unwrap();
        let moves: Vec<Value> = serde_json::from_str(&out).unwrap();
        assert!(moves.iter().any(|m| {
            m["from"]["x"] == 0
                && m["from"]["y"] == 3
                && m["to"]["x"] == 7
                && m["to"]["y"] == 3
        }));
    }

    #[test]
    fn apply_move_replays_fixtures() {
        for entry in fs::read_dir(fixtures_dir()).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let fixture: Value =
                serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            let Some(action) = fixture.get("action") else {
                continue;
            };

            let stdin = serde_json::to_string(&json!({
                "board": fixture["board"],
                "move": action["move"],
            }))
            .unwrap();

            let expect = &fixture["expect"];
            let result = run("apply-move", &stdin);
            if expect.get("applyOk") == Some(&json!(false)) {
                assert_eq!(
                    result,
                    Err(CliError {
                        error: "illegal move".to_string()
                    }),
                    "{}",
                    path.display()
                );
                continue;
            }

            let out = result.unwrap_or_else(|e| panic!("{}: {e:?}", path.display()));
            let parsed: Value = serde_json::from_str(&out).unwrap();
            assert_eq!(parsed["schemaVersion"], json!(1));

            if let Some(turns) = expect.get("totalTurns") {
                assert_eq!(parsed["totalTurns"], *turns, "{}", path.display());
            }
            if let Some(hop) = expect.get("checkersHopPosition") {
                assert_eq!(
                    parsed.get("checkersHopPosition"),
                    Some(hop),
                    "{}",
                    path.display()
                );
            }
            if let Some(winner) = expect.get("winningTeam") {
                assert_eq!(parsed.get("winningTeam"), Some(winner), "{}", path.display());
            }
        }
    }
}
