"""PUCT Monte-Carlo tree search for self-play policy targets (T1-6).

Mirrors ``engine/src/mcts.rs`` in shape (arena tree, sign-by-``to_move`` backup so
checkers multi-hops that keep the side to move are handled correctly). For the
Stage-B bootstrap this uses a **material leaf heuristic + uniform priors** — no
ONNX-in-Python dependency — and emits root visit counts as the policy target the
dual-head net is trained on.

ponytail: material-guided bootstrap (ceiling: no NN guidance). Upgrade path is to
guide MCTS with the trained net's value+policy once an in-process evaluator
exists (T1-7 iterative loop); the arena/backup code here stays the same.
"""

from __future__ import annotations

import math

from .rules import BLACK, WHITE, apply_move

_PROMOTIONS = ("queen", "rook", "bishop", "knight")
_PROMOTION_ROW = {WHITE: 7, BLACK: 0}
_PIECE_VALUE = {
    "king": 10.0,
    "queen": 9.0,
    "rook": 5.0,
    "bishop": 3.0,
    "knight": 3.0,
    "checkers": 3.0,
    "pawn": 1.0,
}


def expand_moves(board) -> list[dict]:
    """Legal moves for the side to move, promotions split into all 4 choices."""
    out: list[dict] = []
    for p in board.pieces:
        for tx, ty in p.possible_moves:
            base = {"from": {"x": p.x, "y": p.y}, "to": {"x": tx, "y": ty}}
            if p.type == "pawn" and ty == _PROMOTION_ROW[p.team]:
                for promo in _PROMOTIONS:
                    out.append({**base, "promotion": promo})
            else:
                out.append(base)
    return out


def material_value(board) -> float:
    """Leaf value in [-1, 1] from the side-to-move perspective (tanh material)."""
    stm = board.current_team()
    score = 0.0
    for p in board.pieces:
        v = _PIECE_VALUE[p.type]
        score += v if p.team == stm else -v
    return math.tanh(score / 20.0)


def _terminal_value(winner: str, to_move: str) -> float:
    return 1.0 if winner == to_move else -1.0


class _Node:
    __slots__ = ("board", "to_move", "winner", "visits", "value_sum", "expanded", "edges")

    def __init__(self, board) -> None:
        self.board = board
        self.to_move = board.current_team()
        self.winner = board.winning_team
        self.visits = 0
        self.value_sum = 0.0
        self.expanded = False
        # each edge: [move, prior, child_index_or_None]
        self.edges: list[list] = []


def _select_edge(arena: list[_Node], node_idx: int, c_puct: float) -> int | None:
    node = arena[node_idx]
    sqrt_parent = math.sqrt(max(node.visits, 1))
    best_i, best_score = None, -math.inf
    for i, (_, prior, child_idx) in enumerate(node.edges):
        if child_idx is None:
            child_visits, q = 0.0, 0.0
        else:
            child = arena[child_idx]
            mean = child.value_sum / child.visits if child.visits else 0.0
            q = mean if child.to_move == node.to_move else -mean
        child_visits = 0.0 if child_idx is None else float(arena[child_idx].visits)
        u = c_puct * prior * sqrt_parent / (1.0 + child_visits)
        score = q + u
        if score > best_score:
            best_score, best_i = score, i
    return best_i


def _backup(arena: list[_Node], path: list[int], leaf_value: float, leaf_team: str) -> None:
    for idx in path:
        node = arena[idx]
        node.visits += 1
        node.value_sum += leaf_value if node.to_move == leaf_team else -leaf_value


def _expand(node: _Node, dirichlet: list[float] | None, value_fn) -> float:
    node.expanded = True
    moves = expand_moves(node.board)
    if not moves:
        return value_fn(node.board)
    prior = 1.0 / len(moves)
    if dirichlet is not None and len(dirichlet) == len(moves):
        # Root exploration noise (AlphaZero): mix uniform prior with Dirichlet.
        node.edges = [[mv, 0.75 * prior + 0.25 * d, None] for mv, d in zip(moves, dirichlet)]
    else:
        node.edges = [[mv, prior, None] for mv in moves]
    return value_fn(node.board)


def _simulate(arena: list[_Node], root: int, c_puct: float, value_fn) -> None:
    path: list[int] = []
    idx = root
    while True:
        path.append(idx)
        node = arena[idx]

        if node.winner is not None:
            _backup(arena, path, _terminal_value(node.winner, node.to_move), node.to_move)
            return

        if not node.expanded:
            value = _expand(node, None, value_fn)
            _backup(arena, path, value, node.to_move)
            return

        if not node.edges:
            mean = node.value_sum / node.visits if node.visits else 0.0
            _backup(arena, path, mean, node.to_move)
            return

        edge_i = _select_edge(arena, idx, c_puct)
        edge = node.edges[edge_i]
        if edge[2] is None:
            result = apply_move(node.board, edge[0])
            if not result.ok:  # move generator and apply agree; guard anyway
                raise RuntimeError(f"MCTS expanded an illegal move: {edge[0]}")
            arena.append(_Node(result.board))
            edge[2] = len(arena) - 1
        idx = edge[2]


def run_mcts(board, simulations: int, c_puct: float, rng, root_noise: bool = True,
             value_fn=material_value):
    """Return ``(root_value, [(move, visit_count), ...])`` for ``board``.

    ``root_value`` is the root's mean value (side-to-move POV); the visit list is
    the policy target. ``rng`` is a ``random.Random`` for root Dirichlet noise.
    ``value_fn`` is the leaf evaluator (defaults to the material heuristic; pass a
    stronger net-backed value to produce higher-quality policy targets).
    """
    arena: list[_Node] = [_Node(board)]
    root = arena[0]

    # Expand root up front so we can inject Dirichlet exploration noise.
    root.visits = 1
    moves = expand_moves(board)
    if not moves:
        return value_fn(board), []
    dirichlet = _dirichlet(rng, len(moves)) if root_noise else None
    root.value_sum = _expand(root, dirichlet, value_fn)

    for _ in range(simulations):
        _simulate(arena, 0, c_puct, value_fn)

    visits = [
        (edge[0], arena[edge[2]].visits if edge[2] is not None else 0) for edge in root.edges
    ]
    root_value = root.value_sum / root.visits if root.visits else 0.0
    return root_value, visits


def _dirichlet(rng, n: int, alpha: float = 0.3) -> list[float]:
    """Symmetric Dirichlet sample via normalized Gammas (stdlib only)."""
    samples = [rng.gammavariate(alpha, 1.0) for _ in range(n)]
    total = sum(samples) or 1.0
    return [s / total for s in samples]
