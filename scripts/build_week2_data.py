"""Build the reproducible null-model dataset used by the Week 2 post."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import networkx as nx
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
NODE_PATH = ROOT / "source-data" / "week1_nodes.tsv"
EDGE_PATH = ROOT / "source-data" / "week1_edges.tsv"
OUTPUT_PATH = ROOT / "week2" / "data" / "null_models.json"

BASE_SEED = 20260909
SAMPLES = 100
SWAPS_PER_EDGE = 10


def non_comment_lines(path: Path) -> list[str]:
    return [
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]


def load_graph() -> tuple[nx.Graph, dict[str, dict[str, str]]]:
    node_lines = non_comment_lines(NODE_PATH)
    node_rows = list(csv.DictReader(node_lines, delimiter="\t"))
    node_lookup = {row["node_id"]: row for row in node_rows}

    graph = nx.Graph()
    graph.add_nodes_from(node_lookup)
    for line in non_comment_lines(EDGE_PATH):
        source, target = line.split("\t")
        if source != target:
            graph.add_edge(source, target)

    if graph.number_of_nodes() != 303 or graph.number_of_edges() != 1434:
        raise RuntimeError("The frozen Marvel snapshot did not match 303 nodes and 1,434 pairs.")
    return graph, node_lookup


def metrics(graph: nx.Graph) -> dict[str, float | int]:
    return {
        "averageClustering": nx.average_clustering(graph),
        "transitivity": nx.transitivity(graph),
        "edges": graph.number_of_edges(),
        "components": nx.number_connected_components(graph),
        "giantSize": len(max(nx.connected_components(graph), key=len)),
    }


def summarize(values: list[float], real_value: float) -> dict[str, float | int]:
    array = np.asarray(values, dtype=float)
    mean = float(array.mean())
    sample_sd = float(array.std(ddof=1))
    extreme = int(np.count_nonzero(array >= real_value))
    return {
        "mean": mean,
        "sd": sample_sd,
        "min": float(array.min()),
        "q025": float(np.quantile(array, 0.025)),
        "median": float(np.quantile(array, 0.5)),
        "q975": float(np.quantile(array, 0.975)),
        "max": float(array.max()),
        "zScore": (real_value - mean) / sample_sd if sample_sd else math.inf,
        "extremeCount": extreme,
        "empiricalP": (1 + extreme) / (1 + len(array)),
    }


def main() -> None:
    full_graph, node_lookup = load_graph()
    giant_nodes = max(nx.connected_components(full_graph), key=len)
    real_graph = full_graph.subgraph(giant_nodes).copy()
    n = real_graph.number_of_nodes()
    m = real_graph.number_of_edges()
    if n != 277:
        raise RuntimeError(f"Expected a 277-node giant component, found {n}.")

    real_metrics = metrics(real_graph)
    node_order = sorted(real_graph)
    degree_sequence = [real_graph.degree(node) for node in node_order]
    sorted_degree_sequence = sorted(degree_sequence)

    models: dict[str, dict[str, list[float] | list[int]]] = {
        "swaps": {
            "averageClustering": [],
            "transitivity": [],
            "edges": [],
            "components": [],
            "giantSize": [],
        },
        "configuration": {
            "averageClustering": [],
            "transitivity": [],
            "edges": [],
            "components": [],
            "giantSize": [],
            "lostEdges": [],
        },
        "gnm": {
            "averageClustering": [],
            "transitivity": [],
            "edges": [],
            "components": [],
            "giantSize": [],
        },
    }

    top_nodes = sorted(node_order, key=lambda node: (-real_graph.degree(node), node))[:8]
    hub_simple_degrees = {node: [] for node in top_nodes}

    for sample_index in range(SAMPLES):
        seed = BASE_SEED + sample_index

        swapped = real_graph.copy()
        swap_count = SWAPS_PER_EDGE * m
        nx.double_edge_swap(
            swapped,
            nswap=swap_count,
            max_tries=swap_count * 20,
            seed=seed,
        )
        if sorted(degree for _, degree in swapped.degree()) != sorted_degree_sequence:
            raise RuntimeError("A degree-preserving swap changed the degree sequence.")
        swapped_metrics = metrics(swapped)
        for key in models["swaps"]:
            models["swaps"][key].append(swapped_metrics[key])

        multi = nx.configuration_model(degree_sequence, seed=seed)
        simple = nx.Graph(multi)
        simple.remove_edges_from(nx.selfloop_edges(simple))
        simple_metrics = metrics(simple)
        for key in ("averageClustering", "transitivity", "edges", "components", "giantSize"):
            models["configuration"][key].append(simple_metrics[key])
        models["configuration"]["lostEdges"].append(m - simple.number_of_edges())
        for node in top_nodes:
            hub_simple_degrees[node].append(simple.degree(node_order.index(node)))

        random_graph = nx.gnm_random_graph(n, m, seed=seed)
        random_metrics = metrics(random_graph)
        for key in models["gnm"]:
            models["gnm"][key].append(random_metrics[key])

    summaries: dict[str, dict[str, dict[str, float | int]]] = {}
    for model_name, samples in models.items():
        summaries[model_name] = {
            "averageClustering": summarize(
                samples["averageClustering"], real_metrics["averageClustering"]
            ),
            "transitivity": summarize(samples["transitivity"], real_metrics["transitivity"]),
        }

    lost_edges = np.asarray(models["configuration"]["lostEdges"], dtype=float)
    summaries["configuration"]["lostEdges"] = {
        "mean": float(lost_edges.mean()),
        "sd": float(lost_edges.std(ddof=1)),
        "min": int(lost_edges.min()),
        "median": float(np.median(lost_edges)),
        "max": int(lost_edges.max()),
    }

    hub_damage = []
    for node in top_nodes:
        simplified = np.asarray(hub_simple_degrees[node], dtype=float)
        original = real_graph.degree(node)
        hub_damage.append(
            {
                "id": node,
                "name": node_lookup[node]["name"],
                "originalDegree": original,
                "configurationMeanDegree": float(simplified.mean()),
                "meanDegreeLost": float(original - simplified.mean()),
            }
        )

    payload = {
        "generatedFrom": "02805 shared Marvel playground, Week 1 frozen release",
        "generatedAt": "2026-09-09",
        "method": {
            "baseSeed": BASE_SEED,
            "samplesPerNull": SAMPLES,
            "swapsPerEdge": SWAPS_PER_EDGE,
            "empiricalP": "(1 + null values at least as large as real) / (1 + samples)",
            "tail": "one-sided, higher than the null",
        },
        "graph": {
            "scope": "undirected giant component",
            "nodes": n,
            "edges": m,
            "meanDegree": 2 * m / n,
        },
        "real": real_metrics,
        "models": models,
        "summaries": summaries,
        "hubDamage": hub_damage,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}")
    print(f"Real C: {real_metrics['averageClustering']:.6f}")
    for model_name in ("swaps", "configuration", "gnm"):
        summary = summaries[model_name]["averageClustering"]
        print(
            f"{model_name:13s} mean={summary['mean']:.6f} "
            f"sd={summary['sd']:.6f} z={summary['zScore']:.2f} "
            f"p={summary['empiricalP']:.4f}"
        )


if __name__ == "__main__":
    main()
