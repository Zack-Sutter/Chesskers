"""Self-play shard writer (T1-4).

Plays random-vs-random games with the Python rules mirror, encodes every
non-terminal position (encoder_v1), and labels it with the eventual game
outcome from that position's side-to-move perspective (architecture §5.4 /
§9 "Value target semantics"). Positions are written to ``training/shards/``
as NPZ files (``states`` float32 ``[N, 16, 8, 8]``, ``outcomes`` float32
``[N]`` in {-1, 0, +1}). Policy targets are added at T1-6.

Usage:
    python self_play.py --positions 1000 --out shards/ --seed 42
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from chesskers import Board, apply_move, encode
from chesskers.rules import BLACK, WHITE

_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures"
_INITIAL_BOARD = _FIXTURE_DIR / "initial_board.json"
_SHARD_DIR = Path(__file__).resolve().parent / "shards"

_PROMOTION_ROW = {WHITE: 7, BLACK: 0}


def _initial_board() -> Board:
    fixture = json.loads(_INITIAL_BOARD.read_text(encoding="utf-8"))
    board = Board.from_serialized(fixture["board"])
    board.calculate_all_moves()
    return board


def _legal_moves(board: Board) -> list[dict]:
    """All legal moves for the side to move as apply_move payloads."""
    moves: list[dict] = []
    for p in board.pieces:
        for dx, dy in p.possible_moves:
            move: dict = {"from": {"x": p.x, "y": p.y}, "to": {"x": dx, "y": dy}}
            # ponytail: auto-queen for value-only self-play; per-piece promotion
            # variety lands with the policy head at T1-6.
            if p.type == "pawn" and dy == _PROMOTION_ROW[p.team]:
                move["promotion"] = "queen"
            moves.append(move)
    return moves


def _outcomes(teams: list[str], winner: str | None) -> list[float]:
    """Value target per position from its side-to-move perspective."""
    if winner is None:
        return [0.0] * len(teams)
    return [1.0 if team == winner else -1.0 for team in teams]


def play_game(rng, max_moves: int) -> tuple[list[np.ndarray], list[str], str | None]:
    """Play one random game; return (encoded states, side-to-move teams, winner)."""
    board = _initial_board()
    states: list[np.ndarray] = []
    teams: list[str] = []

    for _ in range(max_moves):
        if board.winning_team is not None:
            break
        moves = _legal_moves(board)
        if not moves:
            # No terminal win but nobody can move: treat as a draw and stop.
            return states, teams, None
        states.append(encode(board))
        teams.append(board.current_team())
        result = apply_move(board, rng.choice(moves))
        if not result.ok:  # generated only legal moves, so this is a bug guard
            raise RuntimeError(f"self-play produced an illegal move: {result}")
        board = result.board

    return states, teams, board.winning_team


def generate_positions(rng, num_positions: int, max_moves: int):
    """Play games until at least ``num_positions`` are collected."""
    states: list[np.ndarray] = []
    outcomes: list[float] = []
    games = 0
    while len(states) < num_positions:
        game_states, game_teams, winner = play_game(rng, max_moves)
        states.extend(game_states)
        outcomes.extend(_outcomes(game_teams, winner))
        games += 1
    return (
        np.asarray(states, dtype=np.float32),
        np.asarray(outcomes, dtype=np.float32),
        games,
    )


def write_shards(states: np.ndarray, outcomes: np.ndarray, out_dir: Path,
                 shard_size: int) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for i, start in enumerate(range(0, len(states), shard_size)):
        end = start + shard_size
        path = out_dir / f"shard_{i:04d}.npz"
        np.savez_compressed(path, states=states[start:end], outcomes=outcomes[start:end])
        paths.append(path)
    return paths


def main() -> None:
    import random

    parser = argparse.ArgumentParser(description="Chesskers self-play shard writer (T1-4)")
    parser.add_argument("--positions", type=int, default=1000,
                        help="minimum number of positions to generate")
    parser.add_argument("--max-moves", type=int, default=300,
                        help="move cap per game (uncapped random games can loop; §9 draw note)")
    parser.add_argument("--shard-size", type=int, default=512,
                        help="positions per NPZ shard")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=_SHARD_DIR,
                        help="output directory for NPZ shards")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    states, outcomes, games = generate_positions(rng, args.positions, args.max_moves)
    paths = write_shards(states, outcomes, args.out, args.shard_size)

    wins = int((outcomes == 1.0).sum())
    losses = int((outcomes == -1.0).sum())
    draws = int((outcomes == 0.0).sum())
    print(f"{len(states)} positions from {games} games -> {len(paths)} shard(s) in {args.out}")
    print(f"outcomes: +1={wins}  -1={losses}  0={draws}")


if __name__ == "__main__":
    main()
