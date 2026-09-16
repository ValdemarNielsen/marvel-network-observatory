"""Build the reproducible Week 3 centrality and robustness dataset."""

from __future__ import annotations

import csv
import json
import math
import random
from collections import Counter
from pathlib import Path

import networkx as nx
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
NODE_PATH = ROOT / "source-data" / "week1_nodes.tsv"
EDGE_PATH = ROOT / "source-data" / "week1_edges.tsv"
OUTPUT_PATH = ROOT / "week3" / "data" / "centrality_lab.json"

BASE_SEED = 20260916
NULL_SAMPLES = 100
SWAPS_PER_EDGE = 10
ATTACK_STEPS = 50
RANDOM_ATTACK_SAMPLES = 100


def non_comment_lines(path: Path) -> list[str]:
    return [
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]


def load_graphs() -> tuple[nx.DiGraph, nx.Graph, dict[str, dict[str, str]]]:
    rows = list(csv.DictReader(non_comment_lines(NODE_PATH), delimiter="\t"))
    lookup = {row["node_id"]: row for row in rows}

    directed = nx.DiGraph()
    directed.add_nodes_from(lookup)
    for line in non_comment_lines(EDGE_PATH):
        source, target = line.split("\t")
        if source != target:
            directed.add_edge(source, target)

    undirected = directed.to_undirected()
    if directed.number_of_nodes() != 303 or directed.number_of_edges() != 1784:
        raise RuntimeError("The frozen Marvel snapshot no longer matches Week 1.")
    if undirected.number_of_edges() != 1434:
        raise RuntimeError("Expected 1,434 undirected pairs.")
    return directed, undirected, lookup


def stable_ranking(values: dict[str, float], names: dict[str, str]) -> list[str]:
    return sorted(values, key=lambda node: (-values[node], names[node].casefold(), node))


def ranks(order: list[str]) -> dict[str, int]:
    return {node: index + 1 for index, node in enumerate(order)}


def attack_curve(graph: nx.Graph, order: list[str], steps: int) -> list[dict[str, float | int]]:
    work = graph.copy()
    records: list[dict[str, float | int]] = []
    original_n = graph.number_of_nodes()

    for removed in range(steps + 1):
        component_sizes = sorted((len(c) for c in nx.connected_components(work)), reverse=True)
        giant = component_sizes[0] if component_sizes else 0
        records.append(
            {
                "removed": removed,
                "giantSize": giant,
                "giantFraction": giant / original_n,
                "components": len(component_sizes),
            }
        )
        if removed < steps:
            work.remove_node(order[removed])
    return records


def random_attack_summary(graph: nx.Graph, steps: int) -> list[dict[str, float | int]]:
    rng = random.Random(BASE_SEED + 7000)
    values = [[] for _ in range(steps + 1)]
    component_values = [[] for _ in range(steps + 1)]
    nodes = sorted(graph)

    for _ in range(RANDOM_ATTACK_SAMPLES):
        order = nodes.copy()
        rng.shuffle(order)
        curve = attack_curve(graph, order, steps)
        for index, point in enumerate(curve):
            values[index].append(point["giantFraction"])
            component_values[index].append(point["components"])

    summary = []
    for removed in range(steps + 1):
        fractions = np.asarray(values[removed], dtype=float)
        components = np.asarray(component_values[removed], dtype=float)
        summary.append(
            {
                "removed": removed,
                "meanGiantFraction": float(fractions.mean()),
                "q10GiantFraction": float(np.quantile(fractions, 0.10)),
                "q90GiantFraction": float(np.quantile(fractions, 0.90)),
                "meanComponents": float(components.mean()),
            }
        )
    return summary


def z_score(real: float, samples: list[float]) -> dict[str, float | int]:
    array = np.asarray(samples, dtype=float)
    mean = float(array.mean())
    sd = float(array.std(ddof=1))
    higher = int(np.count_nonzero(array >= real))
    lower = int(np.count_nonzero(array <= real))
    return {
        "mean": mean,
        "sd": sd,
        "z": (real - mean) / sd if sd else 0.0,
        "higherOrEqual": higher,
        "lowerOrEqual": lower,
        "twoSidedEmpiricalP": min(1.0, 2 * (1 + min(higher, lower)) / (1 + len(array))),
    }


def main() -> None:
    directed, full_undirected, lookup = load_graphs()
    giant_nodes = max(nx.connected_components(full_undirected), key=len)
    graph = full_undirected.subgraph(giant_nodes).copy()
    names = {node: lookup[node]["name"] for node in graph}
    n = graph.number_of_nodes()
    m = graph.number_of_edges()
    if (n, m) != (277, 1421):
        raise RuntimeError(f"Expected giant component 277/1421, found {n}/{m}.")

    degree = {node: float(value) for node, value in graph.degree()}
    closeness = nx.closeness_centrality(graph)
    harmonic_raw = nx.harmonic_centrality(graph)
    harmonic = {node: value / (n - 1) for node, value in harmonic_raw.items()}
    betweenness = nx.betweenness_centrality(graph, normalized=True)
    eigenvector = nx.eigenvector_centrality(graph, max_iter=2000, tol=1e-12)

    metrics = {
        "degree": degree,
        "closeness": closeness,
        "harmonic": harmonic,
        "betweenness": betweenness,
        "eigenvector": eigenvector,
    }
    orders = {key: stable_ranking(values, names) for key, values in metrics.items()}
    rank_maps = {key: ranks(order) for key, order in orders.items()}

    sorted_degrees = sorted(value for _, value in graph.degree())
    null_betweenness = {node: [] for node in graph}
    for sample_index in range(NULL_SAMPLES):
        shuffled = graph.copy()
        swap_count = SWAPS_PER_EDGE * m
        nx.double_edge_swap(
            shuffled,
            nswap=swap_count,
            max_tries=swap_count * 30,
            seed=BASE_SEED + sample_index,
        )
        if sorted(value for _, value in shuffled.degree()) != sorted_degrees:
            raise RuntimeError("Degree-preserving shuffle changed the degree sequence.")
        sample_values = nx.betweenness_centrality(shuffled, normalized=True)
        for node, value in sample_values.items():
            null_betweenness[node].append(value)

    betweenness_null = {
        node: z_score(betweenness[node], null_betweenness[node]) for node in graph
    }
    surprise_order = sorted(
        graph,
        key=lambda node: (-betweenness_null[node]["z"], names[node].casefold(), node),
    )
    sheltered_order = sorted(
        graph,
        key=lambda node: (betweenness_null[node]["z"], names[node].casefold(), node),
    )

    attacks = {
        metric: attack_curve(graph, orders[metric], ATTACK_STEPS)
        for metric in ("degree", "betweenness", "closeness", "eigenvector")
    }
    attacks["random"] = random_attack_summary(graph, ATTACK_STEPS)

    single_removals = []
    for node in graph:
        reduced = graph.copy()
        reduced.remove_node(node)
        components = sorted((len(c) for c in nx.connected_components(reduced)), reverse=True)
        single_removals.append(
            {
                "id": node,
                "name": names[node],
                "degree": int(degree[node]),
                "betweenness": betweenness[node],
                "giantAfter": components[0],
                "nodesOutsideGiant": n - 1 - components[0],
                "componentsAfter": len(components),
            }
        )
    single_removals.sort(
        key=lambda item: (
            -item["nodesOutsideGiant"],
            -item["componentsAfter"],
            -item["betweenness"],
            item["name"].casefold(),
        )
    )

    maximal_cliques = list(nx.find_cliques(graph))
    clique_number = max(map(len, maximal_cliques))
    largest_cliques = [clique for clique in maximal_cliques if len(clique) == clique_number]
    clique_size_counts = Counter(map(len, maximal_cliques))

    center = sorted(nx.center(graph), key=lambda node: names[node].casefold())
    spider_id = next(node for node in graph if names[node] == "Spider-Man")
    spider_lengths = nx.single_source_shortest_path_length(graph, spider_id)
    farthest_distance = max(spider_lengths.values())
    farthest = sorted(
        (node for node, distance in spider_lengths.items() if distance == farthest_distance),
        key=lambda node: names[node].casefold(),
    )

    node_records = []
    for node in sorted(graph, key=lambda value: names[value].casefold()):
        record = {
            "id": node,
            "name": names[node],
            "description": lookup[node]["description"],
            "url": lookup[node]["url"],
        }
        for metric, values in metrics.items():
            record[metric] = values[node]
            record[f"{metric}Rank"] = rank_maps[metric][node]
        record["betweennessNull"] = betweenness_null[node]
        node_records.append(record)

    def leaderboard(metric: str, limit: int = 12) -> list[dict[str, float | int | str]]:
        return [
            {
                "id": node,
                "name": names[node],
                "value": metrics[metric][node],
                "rank": index + 1,
            }
            for index, node in enumerate(orders[metric][:limit])
        ]

    payload = {
        "generatedFrom": "02805 shared Marvel playground, Week 1 frozen release",
        "generatedAt": "2026-09-16",
        "method": {
            "baseSeed": BASE_SEED,
            "betweennessNullSamples": NULL_SAMPLES,
            "swapsPerEdge": SWAPS_PER_EDGE,
            "randomAttackSamples": RANDOM_ATTACK_SAMPLES,
            "attackRanking": "static rankings computed before any removals",
            "betweennessNull": "degree-preserving double-edge swaps",
        },
        "graph": {
            "scope": "undirected giant component",
            "nodes": n,
            "edges": m,
            "meanDistance": nx.average_shortest_path_length(graph),
            "diameter": nx.diameter(graph),
            "radius": nx.radius(graph),
            "center": [{"id": node, "name": names[node]} for node in center],
            "degreeAssortativity": nx.degree_assortativity_coefficient(graph),
            "cliqueNumber": clique_number,
            "maximalCliques": len(maximal_cliques),
            "articulationPoints": len(list(nx.articulation_points(graph))),
        },
        "leaderboards": {
            metric: leaderboard(metric)
            for metric in ("degree", "closeness", "harmonic", "betweenness", "eigenvector")
        },
        "nodes": node_records,
        "surprises": {
            "brokers": [
                {
                    "id": node,
                    "name": names[node],
                    "degree": int(degree[node]),
                    "degreeRank": rank_maps["degree"][node],
                    "betweenness": betweenness[node],
                    "betweennessRank": rank_maps["betweenness"][node],
                    **betweenness_null[node],
                }
                for node in surprise_order[:12]
            ],
            "sheltered": [
                {
                    "id": node,
                    "name": names[node],
                    "degree": int(degree[node]),
                    "degreeRank": rank_maps["degree"][node],
                    "betweenness": betweenness[node],
                    "betweennessRank": rank_maps["betweenness"][node],
                    **betweenness_null[node],
                }
                for node in sheltered_order[:12]
            ],
        },
        "attacks": attacks,
        "singleRemovals": single_removals[:15],
        "cliques": {
            "number": clique_number,
            "maximalCount": len(maximal_cliques),
            "sizeCounts": [
                {"size": size, "count": count}
                for size, count in sorted(clique_size_counts.items())
            ],
            "largest": [
                [
                    {"id": node, "name": names[node]}
                    for node in sorted(clique, key=lambda value: names[value].casefold())
                ]
                for clique in largest_cliques
            ],
        },
        "spider": {
            "id": spider_id,
            "farthestDistance": farthest_distance,
            "farthest": [{"id": node, "name": names[node]} for node in farthest],
        },
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    top_broker = payload["surprises"]["brokers"][0]
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}")
    print(
        f"Giant component: n={n}, m={m}, mean distance={payload['graph']['meanDistance']:.3f}, "
        f"diameter={payload['graph']['diameter']}, radius={payload['graph']['radius']}"
    )
    print(
        f"Top unexpected broker: {top_broker['name']} "
        f"(degree rank {top_broker['degreeRank']}, betweenness rank {top_broker['betweennessRank']}, "
        f"z={top_broker['z']:.2f})"
    )
    print(
        f"Clique number={clique_number}, largest cliques={len(largest_cliques)}, "
        f"articulation points={payload['graph']['articulationPoints']}"
    )


if __name__ == "__main__":
    main()
