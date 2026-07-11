"""Chesskers engine algorithms — Marimo slides for math majors.

Install & run::

    pip install -r presentation/requirements.txt -r training/requirements.txt
    python -m marimo edit presentation/engine_algorithms.py
    python -m marimo run presentation/engine_algorithms.py

In the editor: App preview → layout → Slides.
"""

import marimo

__generated_with = "0.23.13"
app = marimo.App(
    width="medium",
    layout_file="layouts/engine_algorithms.slides.json",
)


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell(hide_code=True)
def _():
    import json
    import math
    import sys
    from pathlib import Path

    _PRESENTATION = Path(__file__).resolve().parent
    _REPO = _PRESENTATION.parent
    sys.path.insert(0, str(_REPO / "training"))
    sys.path.insert(0, str(_PRESENTATION))

    from graph_widget import GraphWidget
    from chesskers.encoder import encode, tensor_fnv1a
    from chesskers.move_index import move_index
    from chesskers.rules import Board

    _COLOR_DEFAULT = "#4a90d9"
    _COLOR_ACTIVE = "#e67e22"
    _COLOR_LEAF = "#27ae60"
    _COLOR_PRUNED = "#bdc3c7"
    _COLOR_NEW = "#2ecc71"

    def graph_widget(
        trace: list[dict],
        *,
        height: int = 450,
        width: int | None = None,
        animation_interval_ms: int = 1500,
    ) -> GraphWidget:
        first = trace[0]
        return GraphWidget(
            nodes=first["nodes"],
            edges=first["edges"],
            frames=trace,
            animation_interval_ms=animation_interval_ms,
            height=height,
            width=width,
        )

    def build_alphabeta_trace() -> list[dict]:
        def node(nid, name, *, color=_COLOR_DEFAULT, size=18):
            return {"id": nid, "name": name, "color": color, "size": size}

        def edge(src, tgt, *, color="#555"):
            return {"id": f"{src}->{tgt}", "source": src, "target": tgt, "color": color}

        base_nodes = [
            node("root", "MAX\nα=−∞  β=+∞", size=22),
            node("L", "MIN"),
            node("M", "MIN"),
            node("R", "MIN"),
            node("L2", "leaf\nv=2", color=_COLOR_LEAF),
            node("L9", "leaf\nv=9", color=_COLOR_LEAF),
            node("M3", "leaf\nv=3", color=_COLOR_LEAF),
            node("M6", "leaf\nv=6", color=_COLOR_LEAF),
            node("R1", "leaf\nv=1", color=_COLOR_LEAF),
            node("R8", "leaf\nv=8", color=_COLOR_LEAF),
        ]
        base_edges = [
            edge("root", "L"),
            edge("root", "M"),
            edge("root", "R"),
            edge("L", "L2"),
            edge("L", "L9"),
            edge("M", "M3"),
            edge("M", "M6"),
            edge("R", "R1"),
            edge("R", "R8"),
        ]

        def step(
            caption: str,
            *,
            selected: list[str] | None = None,
            node_overrides: dict[str, dict] | None = None,
            pruned_edges: list[str] | None = None,
        ) -> dict:
            nodes = []
            for n in base_nodes:
                item = dict(n)
                if node_overrides and n["id"] in node_overrides:
                    item.update(node_overrides[n["id"]])
                nodes.append(item)
            pruned = set(pruned_edges or [])
            edges = []
            for e in base_edges:
                item = dict(e)
                if item["id"] in pruned:
                    item["color"] = _COLOR_PRUNED
                edges.append(item)
            return {
                "caption": caption,
                "nodes": nodes,
                "edges": edges,
                "selected": selected or [],
            }

        return [
            step("Start at the root. MAX wants the largest backed-up value.", selected=["root"]),
            step("Descend into the left MIN subtree.", selected=["L"]),
            step("Evaluate left leaf **2**.", selected=["L2"], node_overrides={"L2": {"color": _COLOR_ACTIVE, "size": 22}}),
            step("Evaluate left leaf **9**. MIN chooses min(2, 9) = **2**.", selected=["L9"], node_overrides={"L9": {"color": _COLOR_ACTIVE, "size": 22}, "L": {"name": "MIN\nvalue=2"}}),
            step("Root sets **α = 2** — the best value MAX has seen so far.", selected=["root"], node_overrides={"L": {"name": "MIN\nvalue=2"}, "root": {"name": "MAX\nα=2  β=+∞", "color": _COLOR_ACTIVE}}),
            step("Search the middle MIN subtree.", selected=["M"], node_overrides={"L": {"name": "MIN\nvalue=2"}, "root": {"name": "MAX\nα=2  β=+∞"}}),
            step("Evaluate middle leaf **3**.", selected=["M3"], node_overrides={"M3": {"color": _COLOR_ACTIVE, "size": 22}, "root": {"name": "MAX\nα=2  β=+∞"}}),
            step("Evaluate middle leaf **6**. MIN backs up **3**; root updates **α = 3**.", selected=["M6"], node_overrides={"M6": {"color": _COLOR_ACTIVE, "size": 22}, "M": {"name": "MIN\nvalue=3"}, "root": {"name": "MAX\nα=3  β=+∞", "color": _COLOR_ACTIVE}}),
            step("Search the right MIN subtree.", selected=["R"], node_overrides={"L": {"name": "MIN\nvalue=2"}, "M": {"name": "MIN\nvalue=3"}, "root": {"name": "MAX\nα=3  β=+∞"}}),
            step("Evaluate right leaf **1**. This branch cannot beat α = 3.", selected=["R1"], node_overrides={"R1": {"color": _COLOR_ACTIVE, "size": 22}, "R": {"name": "MIN\nvalue≤1"}, "root": {"name": "MAX\nα=3  β=+∞"}}),
            step("**Prune** leaf **8** — remaining work cannot change the answer.", selected=["R"], pruned_edges=["R->R8"], node_overrides={"R": {"name": "MIN\nvalue=1", "color": _COLOR_ACTIVE}, "R8": {"color": _COLOR_PRUNED}, "root": {"name": "MAX\nα=3  β=+∞"}}),
            step("Backup complete. Root value = max(2, 3, 1) = **3**.", selected=["root"], node_overrides={"root": {"name": "MAX\nvalue=3", "color": _COLOR_ACTIVE, "size": 24}, "L": {"name": "MIN\nvalue=2"}, "M": {"name": "MIN\nvalue=3"}, "R": {"name": "MIN\nvalue=1"}}, pruned_edges=["R->R8"]),
        ]

    def build_mcts_trace(n_sims: int = 6, c_puct: float = 1.5) -> list[dict]:
        moves = ["move_a", "move_b", "move_c", "move_d"]
        priors = {"move_a": 0.40, "move_b": 0.25, "move_c": 0.20, "move_d": 0.15}
        leaf_values = {"move_a": 0.30, "move_b": -0.10, "move_c": 0.15, "move_d": 0.05}

        class _MNode:
            __slots__ = ("visits", "value_sum", "children", "leaf_value")

            def __init__(self) -> None:
                self.visits = 0
                self.value_sum = 0.0
                self.children: dict[str, _MNode] = {}
                self.leaf_value: float | None = None

        root = _MNode()
        root.visits = 1
        steps: list[dict] = []

        def q_mean(node: _MNode) -> float:
            return node.value_sum / node.visits if node.visits else 0.0

        def puct_score(parent_visits: int, child: _MNode | None, p: float) -> float:
            child_visits = 0.0 if child is None else float(child.visits)
            q = 0.0 if child is None else q_mean(child)
            u = c_puct * p * math.sqrt(max(parent_visits, 1)) / (1.0 + child_visits)
            return q + u

        def graph_snapshot(
            caption: str,
            *,
            selected_path: list[str] | None = None,
            new_child: str | None = None,
        ) -> dict:
            selected_path = selected_path or []
            nodes = [
                {
                    "id": "root",
                    "name": f"root\nN={root.visits} Q={q_mean(root):.2f}",
                    "size": 16,
                    "color": _COLOR_ACTIVE if "root" in selected_path else _COLOR_DEFAULT,
                }
            ]
            edges = []
            for mv in moves:
                child = root.children.get(mv)
                cid = f"child_{mv}"
                p = priors[mv]
                if child is not None:
                    nodes.append(
                        {
                            "id": cid,
                            "name": f"{mv}\nN={child.visits} Q={q_mean(child):.2f}",
                            "size": 14,
                            "color": _COLOR_NEW
                            if mv == new_child
                            else (_COLOR_ACTIVE if cid in selected_path else _COLOR_LEAF),
                        }
                    )
                else:
                    nodes.append(
                        {
                            "id": cid,
                            "name": f"{mv}\n(unexpanded)",
                            "size": 14,
                            "color": _COLOR_PRUNED,
                        }
                    )
                score = puct_score(root.visits, child, p)
                edges.append(
                    {
                        "id": f"root->{cid}",
                        "source": "root",
                        "target": cid,
                        "name": f"P={p:.2f} U={score:.2f}",
                        "color": _COLOR_ACTIVE if cid in selected_path else "#555",
                    }
                )
            return {
                "caption": caption,
                "nodes": nodes,
                "edges": edges,
                "selected": selected_path,
            }

        steps.append(
            graph_snapshot(
                "Four root moves with non-uniform priors from the policy network."
            )
        )

        for sim in range(1, n_sims + 1):
            path = ["root"]
            best_mv = max(
                moves, key=lambda mv: puct_score(root.visits, root.children.get(mv), priors[mv])
            )
            cid = f"child_{best_mv}"
            path.append(cid)
            best_score = puct_score(root.visits, root.children.get(best_mv), priors[best_mv])
            steps.append(
                graph_snapshot(
                    f"Sim {sim} — **select** **{best_mv}** (highest PUCT score U ≈ {best_score:.2f}).",
                    selected_path=path,
                )
            )

            child = root.children.get(best_mv)
            expanded = child is None
            if expanded:
                child = _MNode()
                child.leaf_value = leaf_values[best_mv]
                root.children[best_mv] = child
                leaf_v = child.leaf_value
                steps.append(
                    graph_snapshot(
                        f"Sim {sim} — **expand** and **evaluate** **{best_mv}**; leaf value **{leaf_v:+.2f}**.",
                        selected_path=path,
                        new_child=best_mv,
                    )
                )
            else:
                leaf_v = child.leaf_value if child.leaf_value is not None else q_mean(child)
                steps.append(
                    graph_snapshot(
                        f"Sim {sim} — **evaluate** revisit to **{best_mv}**; value **{leaf_v:+.2f}**.",
                        selected_path=path,
                    )
                )

            for node in (child, root):
                node.visits += 1
                node.value_sum += leaf_v

            steps.append(
                graph_snapshot(
                    f"Sim {sim} — **backup** along the path. Root is now N={root.visits}, Q={q_mean(root):.2f}.",
                    selected_path=path,
                    new_child=best_mv if expanded else None,
                )
            )

        steps.append(
            graph_snapshot(
                "Done — visit counts at the root become the policy training target."
            )
        )
        return steps

    initial_fixture = json.loads(
        (_REPO / "fixtures" / "initial_board.json").read_text(encoding="utf-8")
    )
    return (
        Board,
        build_alphabeta_trace,
        build_mcts_trace,
        encode,
        graph_widget,
        initial_fixture,
        move_index,
        tensor_fnv1a,
    )


@app.cell
def _(mo):
    mo.md(r"""
    # Chesskers Engine Algorithms
    """)
    return


@app.cell
def _(mo):
    mo.vstack(
        [
            mo.md(
                "## Pipeline overview\n\n"
                "The board is encoded as a tensor, evaluated by a small CNN, "
                "then used for tree search — alpha-beta when you play, MCTS when the model trains itself."
            ),
            mo.mermaid("""
                flowchart LR
                  Board --> Net[Neural net]
                  Net --> AB[Alpha-beta at play time]
                  Net --> MCTS[MCTS in training]
                  MCTS --> Train[Train weights]
                  Train --> Net
            """),
        ]
    )
    return


@app.cell
def _(mo):
    mo.md(r"""
    ## Neural evaluation

    Too many positions to tabulate, so a **convolutional network** approximates two quantities from the encoded board:

    - **Value** — one number in \([-1, 1]\): how good the position is for the side to move.
    - **Policy** — a score for each legal move; softmax turns those into a probability distribution over moves.
    """)
    return


@app.cell(hide_code=True)
def _(build_alphabeta_trace, graph_widget, mo):
    ab_trace = build_alphabeta_trace()
    ab_graph = mo.ui.anywidget(graph_widget(ab_trace, height=380))
    return (ab_graph,)


@app.cell
def _(ab_graph, mo):
    mo.vstack(
        [
            mo.md(r"""
                ## Alpha-beta search (play time)

                **Minimax** backs up leaf scores: MAX takes the max of children, MIN takes the min.
                **α** and **β** are bounds that let us *prune* subtrees that cannot change the root choice.
            """),
            ab_graph,
        ]
    )
    return


@app.cell(hide_code=True)
def _(build_mcts_trace, graph_widget, mo):
    mcts_trace = build_mcts_trace()
    mcts_graph = mo.ui.anywidget(graph_widget(mcts_trace, height=260, width=520))
    return (mcts_graph,)


@app.cell
def _(mcts_graph, mo):
    mo.vstack(
        [
            mo.md(r"""
                ## MCTS / PUCT (training)

                Each simulation: **select** → **expand** → **evaluate** → **backup**.

                **PUCT** picks the next edge to explore. **Q** is the average leaf value
                seen so far (exploit moves that worked). **P** is the network's prior
                probability for that move. **N** counts how often a node or edge was visited.

                \[
                U(s,a) = \underbrace{Q(s,a)}_{\text{exploit}} + c_{\text{puct}}\, P(s,a)\, \underbrace{\frac{\sqrt{N(s)}}{1 + N(s,a)}}_{\text{explore}}
                \]

                Tune \(c_{\text{puct}}\) for exploration vs exploitation; here \(c_{\text{puct}} = 1.5\).
            """),
            mcts_graph,
        ]
    )
    return


@app.cell
def _(mo):
    mo.md(r"""
    ## Training loop

    1. **Self-play** — MCTS plays games and records positions with visit-count targets.
    2. **Train** — fit value (MSE) and policy (cross-entropy) against those targets.
    3. **Promote** — a new model must win ≥ 55% in a fixed MCTS-vs-MCTS suite to replace the old one.
    """)
    return


@app.cell
def _(mo):
    mo.md(r"""
    ## Summary

    | When | Algorithm | Purpose |
    |------|-----------|---------|
    | Every live move | Alpha-beta + neural leaf eval | Fast, strong play |
    | Training self-play | PUCT MCTS | Generate move distributions |
    | Model comparison | MCTS vs MCTS (55% gate) | Decide promote or reject |
    | Offline | Gradient descent | Fit network weights |
    """)
    return


@app.cell(hide_code=True)
def _(
    Board,
    build_alphabeta_trace,
    build_mcts_trace,
    encode,
    initial_fixture,
    move_index,
    tensor_fnv1a,
):
    board = Board.from_serialized(initial_fixture["board"])
    board.calculate_all_moves()
    assert tensor_fnv1a(encode(board)) == 0x52FE4DDD45287325
    assert move_index({"from": {"x": 3, "y": 1}, "to": {"x": 3, "y": 3}}) == 731
    assert len(build_alphabeta_trace()) == 12
    assert len(build_mcts_trace()) == 20
    return


if __name__ == "__main__":
    app.run()
