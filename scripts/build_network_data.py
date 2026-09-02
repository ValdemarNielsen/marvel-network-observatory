"""Build the compact, deterministic data file used by the Week 1 story."""

from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

import networkx as nx


ROOT = Path(__file__).resolve().parents[1]
NODE_PATH = ROOT / "source-data" / "week1_nodes.tsv"
EDGE_PATH = ROOT / "source-data" / "week1_edges.tsv"
OUTPUT_PATH = ROOT / "assets" / "data" / "network.json"


def rows_without_comments(path: Path):
    with path.open(encoding="utf-8", newline="") as handle:
        yield from (line for line in handle if not line.startswith("#"))


def read_snapshot():
    nodes = list(csv.DictReader(rows_without_comments(NODE_PATH), delimiter="\t"))
    edge_rows = list(csv.reader(rows_without_comments(EDGE_PATH), delimiter="\t"))
    edges = [(source, target) for source, target in edge_rows if source and target]
    return nodes, edges


def normalize_layout(layout: dict[str, tuple[float, float]], scale: float, center):
    if not layout:
        return {}
    xs = [float(point[0]) for point in layout.values()]
    ys = [float(point[1]) for point in layout.values()]
    span = max(max(xs) - min(xs), max(ys) - min(ys), 1e-9)
    midpoint_x = (max(xs) + min(xs)) / 2
    midpoint_y = (max(ys) + min(ys)) / 2
    return {
        node: (
            center[0] + (float(point[0]) - midpoint_x) * (2 * scale / span),
            center[1] + (float(point[1]) - midpoint_y) * (2 * scale / span),
        )
        for node, point in layout.items()
    }


def build_layout(graph: nx.Graph, components: list[set[str]]):
    positions: dict[str, tuple[float, float]] = {}
    giant = graph.subgraph(components[0])
    giant_layout = nx.spring_layout(
        giant,
        seed=2805,
        k=0.13,
        iterations=450,
        weight=None,
    )
    positions.update(normalize_layout(giant_layout, 0.78, (-0.08, 0.02)))

    nontrivial = [component for component in components[1:] if len(component) > 1]
    for index, component in enumerate(nontrivial):
        subgraph = graph.subgraph(component)
        local = nx.circular_layout(subgraph)
        center = (0.72 - index * 0.25, 0.69)
        scale = 0.13 if len(component) > 3 else 0.05
        positions.update(normalize_layout(local, scale, center))

    isolates = sorted(nx.isolates(graph))
    for index, node in enumerate(isolates):
        angle = math.pi * (0.08 + 0.84 * index / max(len(isolates) - 1, 1))
        positions[node] = (0.02 + 0.98 * math.cos(angle), -0.03 - 0.9 * math.sin(angle))

    return positions


def distribution(values):
    counts = Counter(values)
    total = len(values)
    return [
        {"degree": degree, "x": degree + 1, "count": counts[degree], "p": counts[degree] / total}
        for degree in range(max(values) + 1)
        if counts[degree]
    ]


def binned_distribution(values):
    shifted = [value + 1 for value in values]
    total = len(shifted)
    bins = [(x, x) for x in range(1, 8)]
    start = 8
    width = 2
    maximum = max(shifted)
    while start <= maximum:
        bins.append((start, min(start + width - 1, maximum)))
        start += width
        width *= 2

    points = []
    for lower, upper in bins:
        count = sum(lower <= value <= upper for value in shifted)
        if not count:
            continue
        width = upper - lower + 1
        points.append(
            {
                "x": math.sqrt(lower * upper),
                "lower": lower,
                "upper": upper,
                "width": width,
                "count": count,
                "density": count / (total * width),
            }
        )
    return points


def main():
    node_rows, edges = read_snapshot()
    graph = nx.DiGraph()
    graph.add_nodes_from(row["node_id"] for row in node_rows)
    graph.add_edges_from(edges)
    undirected = graph.to_undirected()

    assert graph.number_of_nodes() == 303
    assert graph.number_of_edges() == 1784
    assert undirected.number_of_edges() == 1434
    assert len(list(nx.isolates(undirected))) == 17

    components = sorted(nx.connected_components(undirected), key=len, reverse=True)
    component_index = {
        node: index for index, component in enumerate(components) for node in component
    }
    positions = build_layout(undirected, components)
    in_degree = dict(graph.in_degree())
    out_degree = dict(graph.out_degree())
    degree = dict(undirected.degree())
    roster_index = {row["node_id"]: index for index, row in enumerate(node_rows)}

    reciprocal_pairs = sum(1 for source, target in undirected.edges() if graph.has_edge(source, target) and graph.has_edge(target, source))

    nodes = []
    for row in node_rows:
        node_id = row["node_id"]
        x, y = positions[node_id]
        nodes.append(
            {
                "id": node_id,
                "name": row["name"],
                "url": row["url"],
                "description": row["description"],
                "in": in_degree[node_id],
                "out": out_degree[node_id],
                "degree": degree[node_id],
                "component": component_index[node_id],
                "componentSize": len(components[component_index[node_id]]),
                "x": round(x, 6),
                "y": round(y, 6),
            }
        )

    pairs = []
    for source, target in undirected.edges():
        forward = graph.has_edge(source, target)
        reverse = graph.has_edge(target, source)
        pairs.append(
            {
                "source": source,
                "target": target,
                "mutual": forward and reverse,
            }
        )

    def ranked(metric):
        return [
            {"id": node, "name": node_rows[roster_index[node]]["name"], "value": value}
            for node, value in sorted(
                ((node, getattr(graph, metric)(node)) for node in graph.nodes()),
                key=lambda item: (-item[1], roster_index[item[0]]),
            )[:10]
        ]

    in_values = [in_degree[row["node_id"]] for row in node_rows]
    out_values = [out_degree[row["node_id"]] for row in node_rows]
    island = components[1]
    island_edges = graph.subgraph(island).number_of_edges()
    island_reciprocity = nx.reciprocity(graph.subgraph(island))

    payload = {
        "generatedFrom": "02805 shared playground: week 1 release (2026-08-26)",
        "stats": {
            "nodes": graph.number_of_nodes(),
            "directedEdges": graph.number_of_edges(),
            "undirectedPairs": undirected.number_of_edges(),
            "meanUndirectedDegree": 2 * undirected.number_of_edges() / graph.number_of_nodes(),
            "meanDirectedDegree": graph.number_of_edges() / graph.number_of_nodes(),
            "isolates": len(list(nx.isolates(undirected))),
            "weakComponents": len(components),
            "giantComponent": len(components[0]),
            "islandSize": len(island),
            "islandDirectedEdges": island_edges,
            "islandReciprocity": island_reciprocity,
            "reciprocalPairs": reciprocal_pairs,
            "oneWayPairs": undirected.number_of_edges() - reciprocal_pairs,
            "edgeReciprocity": nx.reciprocity(graph),
        },
        "top": {"in": ranked("in_degree"), "out": ranked("out_degree")},
        "distribution": {
            "in": distribution(in_values),
            "out": distribution(out_values),
            "inBinned": binned_distribution(in_values),
            "outBinned": binned_distribution(out_values),
        },
        "island": sorted(
            ({"id": node, "name": node_rows[roster_index[node]]["name"]} for node in island),
            key=lambda item: item["name"],
        ),
        "isolates": sorted(
            (
                {"id": node, "name": node_rows[roster_index[node]]["name"]}
                for node in nx.isolates(undirected)
            ),
            key=lambda item: item["name"],
        ),
        "nodes": nodes,
        "pairs": pairs,
        "directedEdges": [{"source": source, "target": target} for source, target in edges],
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUTPUT_PATH.name}: {payload['stats']['nodes']} nodes, "
        f"{payload['stats']['directedEdges']} directed edges, "
        f"{payload['stats']['isolates']} isolates"
    )


if __name__ == "__main__":
    main()
