"""Python mirror of the Chesskers rules (T1-2).

Faithful port of the TypeScript game-engine / Rust engine so self-play can run
in-process without subprocessing Node. The single source of truth for behavior
is ``fixtures/*.json``; this module must pass every fixture assertion.

Coordinates are ``(x, y)`` tuples. Teams are ``"w"`` / ``"b"``. Piece types use
the SerializedBoard strings (``"pawn"``, ``"rook"``, ..., ``"checkers"``).
See docs/architecture.md §2 (rules) and §5.1 (SerializedBoard).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

BOARD_DIM = 8

WHITE = "w"
BLACK = "b"

Coord = tuple[int, int]

# 8 king-like directions used by checkers steps and jumps.
_DIRECTIONS: list[Coord] = [
    (0, 1), (0, -1), (1, 0), (-1, 0),
    (1, 1), (1, -1), (-1, 1), (-1, -1),
]

_PROMOTION_TYPES = {"queen", "rook", "bishop", "knight"}


def wrap_coord(n: int) -> int:
    return ((n % BOARD_DIM) + BOARD_DIM) % BOARD_DIM


def in_bounds(x: int, y: int) -> bool:
    return 0 <= x < BOARD_DIM and 0 <= y < BOARD_DIM


def _pawn_direction(team: str) -> int:
    return 1 if team == WHITE else -1


@dataclass
class Piece:
    x: int
    y: int
    type: str
    team: str
    has_moved: bool = False
    en_passant: bool = False
    possible_moves: list[Coord] = field(default_factory=list)

    @property
    def coord(self) -> Coord:
        return (self.x, self.y)


# --- tile predicates -------------------------------------------------------

def _tile_is_occupied(pos: Coord, pieces: list[Piece]) -> bool:
    return any(p.coord == pos for p in pieces)


def _tile_is_occupied_by_opponent(pos: Coord, pieces: list[Piece], team: str) -> bool:
    return any(p.coord == pos and p.team != team for p in pieces)


def _tile_is_empty_or_opponent(pos: Coord, pieces: list[Piece], team: str) -> bool:
    return not _tile_is_occupied(pos, pieces) or _tile_is_occupied_by_opponent(pos, pieces, team)


# --- chess move generation -------------------------------------------------

def _ray_moves(
    piece: Piece, pieces: list[Piece], deltas: list[Coord], *, max_steps: int = 7
) -> list[Coord]:
    moves: list[Coord] = []
    for dx, dy in deltas:
        for i in range(1, max_steps + 1):
            x, y = piece.x + dx * i, piece.y + dy * i
            if not in_bounds(x, y):
                break
            dest = (x, y)
            if not _tile_is_occupied(dest, pieces):
                moves.append(dest)
            elif _tile_is_occupied_by_opponent(dest, pieces, piece.team):
                moves.append(dest)
                break
            else:
                break
    return moves


_ROOK_DIRS = [(0, 1), (0, -1), (-1, 0), (1, 0)]
_BISHOP_DIRS = [(1, 1), (1, -1), (-1, -1), (-1, 1)]
_QUEEN_DIRS = _ROOK_DIRS + _BISHOP_DIRS


def possible_rook_moves(rook: Piece, pieces: list[Piece]) -> list[Coord]:
    return _ray_moves(rook, pieces, _ROOK_DIRS)


def possible_bishop_moves(bishop: Piece, pieces: list[Piece]) -> list[Coord]:
    return _ray_moves(bishop, pieces, _BISHOP_DIRS)


def possible_queen_moves(queen: Piece, pieces: list[Piece]) -> list[Coord]:
    return _ray_moves(queen, pieces, _QUEEN_DIRS)


def possible_king_moves(king: Piece, pieces: list[Piece]) -> list[Coord]:
    return _ray_moves(king, pieces, _QUEEN_DIRS, max_steps=1)


def possible_knight_moves(knight: Piece, pieces: list[Piece]) -> list[Coord]:
    moves: list[Coord] = []
    for i in (-1, 1):
        for j in (-1, 1):
            candidates = [
                (knight.x + j, knight.y + i * 2),
                (knight.x + i * 2, knight.y + j),
            ]
            for x, y in candidates:
                if in_bounds(x, y) and _tile_is_empty_or_opponent((x, y), pieces, knight.team):
                    moves.append((x, y))
    return moves


def possible_pawn_moves(pawn: Piece, pieces: list[Piece]) -> list[Coord]:
    special_row = 1 if pawn.team == WHITE else 6
    direction = _pawn_direction(pawn.team)
    px, py = pawn.x, pawn.y
    moves: list[Coord] = []

    ny = py + direction
    if in_bounds(px, ny) and not _tile_is_occupied((px, ny), pieces):
        moves.append((px, ny))
        sy = py + 2 * direction
        if py == special_row and in_bounds(px, sy) and not _tile_is_occupied((px, sy), pieces):
            moves.append((px, sy))

    for dx in (-1, 1):
        ax, ay = px + dx, py + direction
        if not in_bounds(ax, ay):
            continue
        attack = (ax, ay)
        if _tile_is_occupied_by_opponent(attack, pieces, pawn.team):
            moves.append(attack)
        elif not _tile_is_occupied(attack, pieces) and in_bounds(px + dx, py):
            side = next((p for p in pieces if p.coord == (px + dx, py)), None)
            if side is not None and side.en_passant:
                moves.append(attack)

    return moves


def castling_moves(king: Piece, pieces: list[Piece]) -> list[Coord]:
    if king.has_moved:
        return []
    moves: list[Coord] = []
    for rook in pieces:
        if rook.type != "rook" or rook.team != king.team or rook.has_moved:
            continue
        direction = 1 if rook.x > king.x else -1
        adjacent = (king.x + direction, king.y)
        if adjacent in rook.possible_moves:
            moves.append(rook.coord)
    return moves


# --- checkers move generation ---------------------------------------------

def _torus_delta(a: int, b: int) -> int:
    d = b - a
    if d > BOARD_DIM // 2:
        d -= BOARD_DIM
    if d < -BOARD_DIM // 2:
        d += BOARD_DIM
    return d


def _king_step_moves(piece: Piece, pieces: list[Piece]) -> list[Coord]:
    moves: list[Coord] = []
    for dx, dy in _DIRECTIONS:
        dest = (wrap_coord(piece.x + dx), wrap_coord(piece.y + dy))
        if not _tile_is_occupied(dest, pieces):
            moves.append(dest)
    return moves


def _single_jump_moves(piece: Piece, pieces: list[Piece]) -> list[Coord]:
    moves: list[Coord] = []
    for dx, dy in _DIRECTIONS:
        adjacent = (wrap_coord(piece.x + dx), wrap_coord(piece.y + dy))
        landing = (wrap_coord(piece.x + 2 * dx), wrap_coord(piece.y + 2 * dy))
        if _tile_is_occupied_by_opponent(adjacent, pieces, piece.team) and not _tile_is_occupied(landing, pieces):
            moves.append(landing)
    return moves


def possible_checkers_moves(piece: Piece, pieces: list[Piece], hop_continuation: bool) -> list[Coord]:
    jumps = _single_jump_moves(piece, pieces)
    if hop_continuation:
        return jumps

    moves: list[Coord] = []
    seen: set[Coord] = set()
    for mv in _king_step_moves(piece, pieces) + jumps:
        if mv not in seen:
            seen.add(mv)
            moves.append(mv)
    return moves


def jumped_piece(from_: Coord, to: Coord, pieces: list[Piece]) -> Optional[Piece]:
    dx = _torus_delta(from_[0], to[0])
    dy = _torus_delta(from_[1], to[1])
    adx, ady = abs(dx), abs(dy)
    is_valid = (adx == 2 and ady == 0) or (adx == 0 and ady == 2) or (adx == 2 and ady == 2)
    if not is_valid:
        return None
    middle = (wrap_coord(from_[0] + dx // 2), wrap_coord(from_[1] + dy // 2))
    return next((p for p in pieces if p.coord == middle), None)


def is_checkers_jump(from_: Coord, to: Coord, pieces: list[Piece], team: str) -> bool:
    jumped = jumped_piece(from_, to, pieces)
    return jumped is not None and jumped.team != team


# --- board -----------------------------------------------------------------

@dataclass
class PendingPromotion:
    x: int
    y: int
    team: str


@dataclass
class Board:
    pieces: list[Piece] = field(default_factory=list)
    total_turns: int = 1
    winning_team: Optional[str] = None
    checkers_hop_position: Optional[Coord] = None
    is_draw: bool = False
    position_counts: dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_serialized(cls, board: dict) -> "Board":
        if board.get("schemaVersion") != 1:
            raise ValueError(f"unsupported schemaVersion: {board.get('schemaVersion')}")
        pieces = [
            Piece(
                x=p["x"],
                y=p["y"],
                type=p["type"],
                team=p["team"],
                has_moved=p.get("hasMoved", False),
                en_passant=bool(p.get("enPassant", False)),
            )
            for p in board["pieces"]
        ]
        hop = board.get("checkersHopPosition")
        return cls(
            pieces=pieces,
            total_turns=board["totalTurns"],
            winning_team=board.get("winningTeam"),
            checkers_hop_position=(hop["x"], hop["y"]) if hop else None,
            is_draw=bool(board.get("isDraw", False)),
        )

    def clone(self) -> "Board":
        return Board(
            pieces=[
                Piece(p.x, p.y, p.type, p.team, p.has_moved, p.en_passant, list(p.possible_moves))
                for p in self.pieces
            ],
            total_turns=self.total_turns,
            winning_team=self.winning_team,
            checkers_hop_position=self.checkers_hop_position,
            is_draw=self.is_draw,
            position_counts=dict(self.position_counts),
        )

    def current_team(self) -> str:
        return BLACK if self.total_turns % 2 == 0 else WHITE

    def piece_at(self, pos: Coord) -> Optional[Piece]:
        return next((p for p in self.pieces if p.coord == pos), None)

    def calculate_all_moves(self) -> None:
        self.winning_team = None

        if not any(p.team == BLACK for p in self.pieces):
            self.winning_team = WHITE
            return
        if not any(p.type == "king" and p.team == WHITE for p in self.pieces):
            self.winning_team = BLACK
            return

        hop = self.checkers_hop_position
        snapshot = list(self.pieces)
        for piece in self.pieces:
            piece.possible_moves = _piece_valid_moves(piece, snapshot, hop)

        if hop is not None:
            current = self.current_team()
            for piece in self.pieces:
                if piece.team == current and piece.coord != hop:
                    piece.possible_moves = []

        for king in [p for p in self.pieces if p.type == "king"]:
            king.possible_moves.extend(castling_moves(king, self.pieces))

        current = self.current_team()
        for piece in self.pieces:
            if piece.team != current:
                piece.possible_moves = []

    def legal_moves_from(self, from_: Coord) -> list[Coord]:
        piece = self.piece_at(from_)
        return list(piece.possible_moves) if piece else []

    def to_serialized(self) -> dict:
        out: dict = {
            "schemaVersion": 1,
            "pieces": [],
            "totalTurns": self.total_turns,
        }
        for p in self.pieces:
            sp = {"x": p.x, "y": p.y, "type": p.type, "team": p.team, "hasMoved": p.has_moved}
            if p.type == "pawn" and p.en_passant:
                sp["enPassant"] = True
            out["pieces"].append(sp)
        if self.checkers_hop_position is not None:
            out["checkersHopPosition"] = {
                "x": self.checkers_hop_position[0],
                "y": self.checkers_hop_position[1],
            }
        if self.winning_team is not None:
            out["winningTeam"] = self.winning_team
        if self.is_draw:
            out["isDraw"] = True
        return out


def initial_board() -> Board:
    """Starting position — mirrors ``packages/game-engine/src/boardConstants.ts``."""
    board = Board(
        pieces=[
            Piece(2, 6, "checkers", BLACK),
            Piece(3, 6, "checkers", BLACK),
            Piece(4, 6, "checkers", BLACK),
            Piece(5, 6, "checkers", BLACK),
            Piece(0, 0, "rook", WHITE),
            Piece(1, 0, "knight", WHITE),
            Piece(2, 0, "bishop", WHITE),
            Piece(3, 0, "queen", WHITE),
            Piece(4, 0, "king", WHITE),
            Piece(5, 0, "bishop", WHITE),
            Piece(6, 0, "knight", WHITE),
            Piece(7, 0, "rook", WHITE),
            Piece(0, 1, "pawn", WHITE),
            Piece(1, 1, "pawn", WHITE),
            Piece(2, 1, "pawn", WHITE),
            Piece(3, 1, "pawn", WHITE),
            Piece(4, 1, "pawn", WHITE),
            Piece(5, 1, "pawn", WHITE),
            Piece(6, 1, "pawn", WHITE),
            Piece(7, 1, "pawn", WHITE),
        ],
        total_turns=1,
    )
    board.calculate_all_moves()
    return board


def _piece_valid_moves(piece: Piece, pieces: list[Piece], hop: Optional[Coord]) -> list[Coord]:
    if piece.type == "pawn":
        return possible_pawn_moves(piece, pieces)
    if piece.type == "knight":
        return possible_knight_moves(piece, pieces)
    if piece.type == "bishop":
        return possible_bishop_moves(piece, pieces)
    if piece.type == "rook":
        return possible_rook_moves(piece, pieces)
    if piece.type == "queen":
        return possible_queen_moves(piece, pieces)
    if piece.type == "king":
        return possible_king_moves(piece, pieces)
    if piece.type == "checkers":
        return possible_checkers_moves(piece, pieces, hop is not None and hop == piece.coord)
    raise ValueError(f"unknown piece type: {piece.type}")


# --- apply_move ------------------------------------------------------------

@dataclass
class ApplyMoveResult:
    ok: bool
    board: Board
    pending_promotion: Optional[PendingPromotion] = None
    is_capture: bool = False


def _is_en_passant_move(board: Board, from_: Coord, to: Coord, piece_type: str, team: str) -> bool:
    if piece_type != "pawn":
        return False
    direction = _pawn_direction(team)
    dx = to[0] - from_[0]
    dy = to[1] - from_[1]
    if dx in (-1, 1) and dy == direction:
        victim_y = to[1] - direction
        return any(
            p.type == "pawn" and p.x == to[0] and p.y == victim_y and p.en_passant
            for p in board.pieces
        )
    return False


def _play_move(board: Board, en_passant: bool, played_from: Coord, played_type: str,
               played_team: str, destination: Coord) -> None:
    direction = _pawn_direction(played_team)

    if played_type == "king":
        dest_piece = board.piece_at(destination)
        if dest_piece is not None and dest_piece.type == "rook" and dest_piece.team == played_team:
            king_x, rook_x = played_from[0], destination[0]
            step = 1 if rook_x - king_x > 0 else -1
            new_king_x = king_x + step * 2
            new_rook_x = new_king_x - step
            for piece in board.pieces:
                if piece.coord == played_from:
                    piece.x = new_king_x
                elif piece.coord == destination:
                    piece.x = new_rook_x
            board.calculate_all_moves()
            return

    if en_passant:
        victim_y = destination[1] - direction
        next_pieces: list[Piece] = []
        for piece in board.pieces:
            if piece.coord == played_from:
                piece.x, piece.y = destination
                piece.has_moved = True
                if piece.type == "pawn":
                    piece.en_passant = False
                next_pieces.append(piece)
            elif piece.x == destination[0] and piece.y == victim_y:
                continue  # captured pawn removed
            else:
                if piece.type == "pawn":
                    piece.en_passant = False
                next_pieces.append(piece)
        board.pieces = next_pieces
        board.calculate_all_moves()
        return

    checkers_jump = played_type == "checkers" and is_checkers_jump(
        played_from, destination, board.pieces, played_team
    )
    jumped = None
    if checkers_jump:
        jp = jumped_piece(played_from, destination, board.pieces)
        jumped = jp.coord if jp else None

    from_y = played_from[1]
    next_pieces = []
    for piece in board.pieces:
        if piece.coord == played_from:
            if piece.type == "pawn":
                piece.en_passant = abs(from_y - destination[1]) == 2
            piece.x, piece.y = destination
            piece.has_moved = True
            next_pieces.append(piece)
        elif jumped is not None and piece.coord == jumped:
            continue  # jumped piece removed by checkers hop
        elif piece.coord != destination:
            if piece.type == "pawn":
                piece.en_passant = False
            next_pieces.append(piece)
    board.pieces = next_pieces
    board.calculate_all_moves()


def apply_move(board: Board, move: dict) -> ApplyMoveResult:
    """Apply ``move`` to a copy of ``board``. ``move`` = {from, to, promotion?}."""
    next_board = board.clone()
    played_from = (move["from"]["x"], move["from"]["y"])
    destination = (move["to"]["x"], move["to"]["y"])
    promotion = move.get("promotion")

    played = next_board.piece_at(played_from)
    if played is None:
        return ApplyMoveResult(ok=False, board=next_board)

    played_type = played.type
    played_team = played.team

    hop = next_board.checkers_hop_position
    if hop is not None:
        if played_from != hop:
            return ApplyMoveResult(ok=False, board=next_board)
    elif played_team == WHITE and next_board.total_turns % 2 != 1:
        return ApplyMoveResult(ok=False, board=next_board)
    elif played_team == BLACK and next_board.total_turns % 2 != 0:
        return ApplyMoveResult(ok=False, board=next_board)

    if destination not in played.possible_moves:
        return ApplyMoveResult(ok=False, board=next_board)

    en_passant = _is_en_passant_move(next_board, played_from, destination, played_type, played_team)
    checkers_jump = played_type == "checkers" and is_checkers_jump(
        played_from, destination, next_board.pieces, played_team
    )
    is_capture = (
        en_passant
        or checkers_jump
        or any(p.coord == destination and p.team != played_team for p in next_board.pieces)
    )

    _play_move(next_board, en_passant, played_from, played_type, played_team, destination)

    if next_board.winning_team is None:
        if played_type == "checkers" and checkers_jump:
            landed = next_board.piece_at(destination)
            more_jumps = (
                landed is not None
                and landed.type == "checkers"
                and landed.team == played_team
                and len(possible_checkers_moves(landed, next_board.pieces, True)) > 0
            )
            if more_jumps:
                next_board.checkers_hop_position = destination
            else:
                next_board.checkers_hop_position = None
                next_board.total_turns += 1
        else:
            next_board.checkers_hop_position = None
            next_board.total_turns += 1

    next_board.calculate_all_moves()

    promotion_row = 7 if played_team == WHITE else 0
    pending_promotion: Optional[PendingPromotion] = None

    if destination[1] == promotion_row and played_type == "pawn":
        if promotion is None:
            pending_promotion = PendingPromotion(x=destination[0], y=destination[1], team=played_team)
        else:
            if promotion not in _PROMOTION_TYPES:
                raise ValueError(f"invalid promotion choice: {promotion}")
            for piece in next_board.pieces:
                if piece.coord == destination:
                    piece.type = promotion
                    piece.has_moved = True
                    piece.en_passant = False
            next_board.calculate_all_moves()

    from .repetition import record_position

    record_position(next_board)

    return ApplyMoveResult(
        ok=True,
        board=next_board,
        pending_promotion=pending_promotion,
        is_capture=is_capture,
    )
