"""MCTS self-play shard writer (T1-6, Stage B).

Plays games where both sides move by PUCT Monte-Carlo tree search (material leaf
heuristic + uniform priors, ``chesskers/mcts.py``), encodes every non-terminal
position (encoder_v1), and labels it with:

* ``outcomes`` — the eventual game result from the position's side-to-move
  perspective (architecture §5.4 / §9 "Value target semantics").
* ``policy`` — the root MCTS visit-count distribution over legal moves, stored
  sparsely as ``(policy_idx, policy_val)`` using the §5.3 move index.

Shards are NPZ files with keys ``states`` (``float32 [N,16,8,8]``), ``outcomes``
(``float32 [N]``), ``policy_idx`` (``int32 [N,K]``, ``-1`` padded) and
``policy_val`` (``float32 [N,K]``, ``0`` padded). See docs/architecture.md §9.

Usage:
    python self_play.py --positions 3000 --sims 64 --out shards/ --seed 42
    python self_play.py --positions 3000 --side w --seed 42   # -> shards/white/
    python self_play.py --positions 3000 --side b --seed 42   # -> shards/black/
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np

from chesskers import Board, apply_move, encode, move_index
from chesskers.mcts import material_value, run_mcts
from chesskers.repetition import init_position_tracking, is_terminal_board

_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures"
_INITIAL_BOARD = _FIXTURE_DIR / "initial_board.json"
_SHARD_DIR = Path(__file__).resolve().parent / "shards"
_SIDE_DIRS = {"w": _SHARD_DIR / "white", "b": _SHARD_DIR / "black"}

# Max sparse policy entries per position. Chesskers rarely exceeds ~40 legal
# moves (white's full army); 128 leaves generous headroom, overflow is truncated
# to the most-visited moves.
MAX_POLICY_ENTRIES = 128

# Plies to sample move ∝ visits (exploration) before switching to greedy play.
_TEMPERATURE_PLIES = 16


def _initial_board() -> Board:
    fixture = json.loads(_INITIAL_BOARD.read_text(encoding="utf-8"))
    board = Board.from_serialized(fixture["board"])
    board.calculate_all_moves()
    return init_position_tracking(board)


def _outcomes(teams: list[str], winner: str | None) -> list[float]:
    """Value target per position from its side-to-move perspective."""
    if winner is None:
        return [0.0] * len(teams)
    return [1.0 if team == winner else -1.0 for team in teams]


def _policy_target(visits: list[tuple[dict, int]]) -> list[tuple[int, float]]:
    """Normalize visit counts into a sparse (move_index, prob) policy target."""
    total = sum(c for _, c in visits)
    if total == 0:
        return []
    target = [(move_index(m), c / total) for m, c in visits if c > 0]
    if len(target) > MAX_POLICY_ENTRIES:
        target.sort(key=lambda t: t[1], reverse=True)
        target = target[:MAX_POLICY_ENTRIES]
    return target


def _choose_move(visits: list[tuple[dict, int]], rng: random.Random, greedy: bool) -> dict:
    counts = [c for _, c in visits]
    total = sum(counts)
    if total == 0:  # no simulations recorded (degenerate) — pick uniformly
        return rng.choice([m for m, _ in visits])
    if greedy:
        return max(visits, key=lambda mc: mc[1])[0]
    threshold = rng.random() * total
    acc = 0
    for move, count in visits:
        acc += count
        if threshold < acc:
            return move
    return visits[-1][0]


def play_game(rng: random.Random, max_moves: int, sims: int, c_puct: float,
              value_fn=material_value):
    """Play one MCTS self-play game.

    Returns ``(states, teams, policies, winner)`` where ``policies`` is a list of
    sparse ``[(move_index, prob), ...]`` targets aligned with ``states``.
    ``value_fn`` is the MCTS leaf evaluator (material heuristic by default, or the
    v001 net for higher-quality visit-count policy targets).
    """
    board = _initial_board()
    states: list[np.ndarray] = []
    teams: list[str] = []
    policies: list[list[tuple[int, float]]] = []

    for ply in range(max_moves):
        if is_terminal_board(board):
            break
        _root_value, visits = run_mcts(board, sims, c_puct, rng, True, value_fn)
        if not visits:
            return states, teams, policies, None  # no legal moves: treat as draw

        states.append(encode(board))
        teams.append(board.current_team())
        policies.append(_policy_target(visits))

        move = _choose_move(visits, rng, greedy=ply >= _TEMPERATURE_PLIES)
        result = apply_move(board, move)
        if not result.ok:
            raise RuntimeError(f"self-play produced an illegal move: {result}")
        board = result.board

    return states, teams, policies, board.winning_team if not board.is_draw else None


def _shard_out_dir(side: str | None, out: Path | None) -> Path:
    if out is not None:
        return out
    return _SIDE_DIRS[side] if side is not None else _SHARD_DIR


def generate_positions(rng: random.Random, num_positions: int, max_moves: int,
                       sims: int = 64, c_puct: float = 1.5, v001=None,
                       side: str | None = None):
    """Play games until at least ``num_positions`` are collected.

    With no ``v001`` model, MCTS uses the material leaf heuristic and value targets
    are the eventual game outcome (§5.4). When ``v001`` (an ``_V001`` wrapper) is
    supplied, MCTS is guided by v001's value (higher-quality visit-count policy
    targets) and value targets are distilled from v001 — anchoring v002's value to
    v001's so the policy head is the net improvement measured by the T1-6 suite.

    When ``side`` is ``"w"`` or ``"b"``, only positions with that side to move are
    kept (v2 side-specific training — arch §14.3).
    """
    value_fn = v001.value if v001 is not None else material_value
    states: list[np.ndarray] = []
    outcomes: list[float] = []
    policies: list[list[tuple[int, float]]] = []
    games = 0
    while len(states) < num_positions:
        game_states, game_teams, game_policies, winner = play_game(
            rng, max_moves, sims, c_puct, value_fn
        )
        for state, team, policy in zip(game_states, game_teams, game_policies):
            if side is not None and team != side:
                continue
            states.append(state)
            outcomes.append(_outcomes([team], winner)[0])
            policies.append(policy)
        games += 1

    states_arr = np.asarray(states, dtype=np.float32)
    if v001 is not None:
        values = v001.values(states_arr).astype(np.float32)
    else:
        values = np.asarray(outcomes, dtype=np.float32)
    policy_idx, policy_val = _pack_policies(policies)
    return (
        states_arr,
        values,
        policy_idx,
        policy_val,
        games,
    )


class _V001:
    """v001 value net (onnxruntime) used as the MCTS leaf and value-target source.

    v001 was exported with a fixed batch of 1, so states are evaluated one at a
    time. Raises on construction if onnxruntime or the model is unavailable.
    """

    def __init__(self, model_path: Path) -> None:
        import onnxruntime as ort  # noqa: PLC0415 — optional, only for --distill

        self._session = ort.InferenceSession(str(model_path))
        self._input = self._session.get_inputs()[0].name

    def _eval(self, tensor: np.ndarray) -> float:
        out = self._session.run(None, {self._input: tensor[None].astype(np.float32)})[0]
        return float(np.asarray(out).reshape(-1)[0])

    def value(self, board) -> float:
        return self._eval(encode(board))

    def values(self, states: np.ndarray) -> np.ndarray:
        return np.array([self._eval(s) for s in states], dtype=np.float32)


def _pack_policies(policies: list[list[tuple[int, float]]]) -> tuple[np.ndarray, np.ndarray]:
    """Pad ragged sparse policies into fixed-width ``[N, MAX_POLICY_ENTRIES]`` arrays."""
    n = len(policies)
    idx = np.full((n, MAX_POLICY_ENTRIES), -1, dtype=np.int32)
    val = np.zeros((n, MAX_POLICY_ENTRIES), dtype=np.float32)
    for i, entries in enumerate(policies):
        for j, (mi, prob) in enumerate(entries):
            idx[i, j] = mi
            val[i, j] = prob
    return idx, val


def write_shards(states: np.ndarray, outcomes: np.ndarray, policy_idx: np.ndarray,
                 policy_val: np.ndarray, out_dir: Path, shard_size: int) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for i, start in enumerate(range(0, len(states), shard_size)):
        end = start + shard_size
        path = out_dir / f"shard_{i:04d}.npz"
        np.savez_compressed(
            path,
            states=states[start:end],
            outcomes=outcomes[start:end],
            policy_idx=policy_idx[start:end],
            policy_val=policy_val[start:end],
        )
        paths.append(path)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Chesskers MCTS self-play shard writer (T1-6)")
    parser.add_argument("--positions", type=int, default=3000,
                        help="minimum number of positions to generate")
    parser.add_argument("--max-moves", type=int, default=160,
                        help="move cap per game (no draw rules; §9/§11)")
    parser.add_argument("--sims", type=int, default=64, help="MCTS simulations per move")
    parser.add_argument("--c-puct", type=float, default=1.5, help="PUCT exploration constant")
    parser.add_argument("--shard-size", type=int, default=512, help="positions per NPZ shard")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory for NPZ shards (default: shards/, or "
                             "shards/white|black/ when --side is set)")
    parser.add_argument("--side", choices=["w", "b"], default=None,
                        help="only keep positions where this side is to move")
    parser.add_argument("--distill", type=Path, default=None, metavar="V001_ONNX",
                        help="path to v001.onnx; guide MCTS with its value and distill it as the "
                             "value target (anchors v002 value to v001; requires onnxruntime)")
    args = parser.parse_args()

    v001 = _V001(args.distill) if args.distill else None

    out_dir = _shard_out_dir(args.side, args.out)
    rng = random.Random(args.seed)
    states, values, policy_idx, policy_val, games = generate_positions(
        rng, args.positions, args.max_moves, args.sims, args.c_puct, v001, args.side
    )
    paths = write_shards(states, values, policy_idx, policy_val, out_dir, args.shard_size)

    side_note = f" ({args.side} to move)" if args.side else ""
    print(f"{len(states)} positions{side_note} from {games} games -> "
          f"{len(paths)} shard(s) in {out_dir}")
    if v001 is not None:
        print(f"value targets: distilled from {args.distill} "
              f"(mean {values.mean():.3f}, range [{values.min():.3f}, {values.max():.3f}])")
    else:
        wins = int((values == 1.0).sum())
        losses = int((values == -1.0).sum())
        draws = int((values == 0.0).sum())
        print(f"outcomes: +1={wins}  -1={losses}  0={draws}")


if __name__ == "__main__":
    main()
