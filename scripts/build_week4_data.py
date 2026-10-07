"""Build the Week 4 philosophy community atlas from the frozen course release.

The script deliberately adds every philosopher before loading links, sums directed
weights into undirected pairs, compares weighted and unweighted Louvain partitions,
tests stability across seeds, and computes a disparity-filter backbone.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx


ROOT = Path(__file__).resolve().parents[1]
NODE_PATH = ROOT / "source-data" / "week4_philosophers_nodes.tsv"
EDGE_PATH = ROOT / "source-data" / "week4_philosophers_edges.tsv"
OUTPUT_PATH = ROOT / "week4" / "data" / "philosophy_atlas.json"
SEEDS = list(range(20))
MAIN_SEED = 11
BACKBONE_LEVELS = (0.01, 0.03, 0.05, 0.10, 0.20)
COLORS = ("#ed5a3d", "#286a65", "#d39a2c", "#6e5596", "#287aa1", "#bb5f87", "#678335", "#bf7031", "#4865a9", "#816946", "#9b4c48", "#447c79")


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return list(csv.DictReader(rows, delimiter="\t"))


def normalized_mutual_information(a: dict[str, int], b: dict[str, int]) -> float:
    nodes = list(a)
    n = len(nodes)
    count_a = Counter(a[node] for node in nodes)
    count_b = Counter(b[node] for node in nodes)
    joint = Counter((a[node], b[node]) for node in nodes)

    def entropy(counts: Counter[int]) -> float:
        return -sum((value / n) * math.log(value / n) for value in counts.values())

    mutual = 0.0
    for (left, right), value in joint.items():
        p_xy = value / n
        mutual += p_xy * math.log((value * n) / (count_a[left] * count_b[right]))
    h_a, h_b = entropy(count_a), entropy(count_b)
    return (2 * mutual / (h_a + h_b)) if h_a + h_b else 1.0


def partition_map(communities: list[set[str]]) -> dict[str, int]:
    return {node: index for index, community in enumerate(communities) for node in community}


def optimal_alignment(reference: dict[str, int], candidate: dict[str, int]) -> tuple[dict[int, int], int]:
    """Maximum-overlap label alignment using a small bitmask assignment problem."""
    reference_labels = sorted(set(reference.values()))
    candidate_labels = sorted(set(candidate.values()))
    size = max(len(reference_labels), len(candidate_labels))
    overlaps = [[0] * size for _ in range(size)]
    ref_index = {label: index for index, label in enumerate(reference_labels)}
    cand_index = {label: index for index, label in enumerate(candidate_labels)}
    for node in reference:
        overlaps[cand_index[candidate[node]]][ref_index[reference[node]]] += 1

    states: dict[int, tuple[int, tuple[int, ...]]] = {0: (0, ())}
    for row in range(size):
        next_states: dict[int, tuple[int, tuple[int, ...]]] = {}
        for mask, (score, assignment) in states.items():
            for column in range(size):
                if mask & (1 << column):
                    continue
                next_mask = mask | (1 << column)
                value = (score + overlaps[row][column], assignment + (column,))
                if next_mask not in next_states or value[0] > next_states[next_mask][0]:
                    next_states[next_mask] = value
        states = next_states
    score, assignment = states[(1 << size) - 1]
    mapping = {
        candidate_labels[row]: reference_labels[column]
        for row, column in enumerate(assignment[: len(candidate_labels)])
        if column < len(reference_labels)
    }
    return mapping, score


def stable_unit(value: str, salt: str) -> float:
    digest = hashlib.blake2b(f"{salt}:{value}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big") / ((1 << 64) - 1)


def layout_for_partition(graph: nx.Graph, communities: list[set[str]], salt: str) -> dict[str, list[float]]:
    ordered = sorted(enumerate(communities), key=lambda item: (-len(item[1]), item[0]))
    positions: dict[str, list[float]] = {}
    count = len(ordered)
    for order, (community_id, members) in enumerate(ordered):
        angle = -math.pi / 2 + order * 2 * math.pi / count
        ring = 0.31 if count <= 8 else (0.27 if order < 6 else 0.43)
        center_x = 0.5 + math.cos(angle) * ring
        center_y = 0.5 + math.sin(angle) * ring * 0.78
        ranked = sorted(members, key=lambda node: (-graph.degree(node), node))
        radius = 0.046 + 0.0085 * math.sqrt(len(members))
        for rank, node in enumerate(ranked):
            theta = 2 * math.pi * stable_unit(node, f"{salt}-theta")
            fraction = math.sqrt((rank + 0.6) / max(1, len(ranked)))
            jitter = 0.75 + stable_unit(node, f"{salt}-radius") * 0.35
            x = center_x + math.cos(theta) * radius * fraction * jitter
            y = center_y + math.sin(theta) * radius * fraction * jitter * 0.72
            positions[node] = [round(max(0.03, min(0.97, x)), 5), round(max(0.04, min(0.96, y)), 5)]
    return positions


def community_summaries(graph: nx.Graph, communities: list[set[str]], attributes: dict[str, dict[str, str]]) -> list[dict]:
    summaries = []
    for index, community in enumerate(communities):
        top = sorted(community, key=lambda node: (-graph.degree(node, weight="weight"), node))[:7]
        eras = Counter(attributes[node]["era"] for node in community)
        fields = Counter(
            field.strip()
            for node in community
            for field in attributes[node]["subfields"].split(";")
            if field.strip()
        )
        summaries.append({
            "id": index,
            "size": len(community),
            "color": COLORS[index % len(COLORS)],
            "top": [attributes[node]["name"] for node in top],
            "era": eras.most_common(1)[0][0] if eras else "Unknown",
            "field": fields.most_common(1)[0][0] if fields else "general philosophy",
        })
    return summaries


def disparity_alpha(graph: nx.Graph, source: str, target: str, weight: float) -> float:
    values = []
    for node in (source, target):
        degree = graph.degree(node)
        strength = graph.degree(node, weight="weight")
        if degree <= 1 or strength <= 0:
            values.append(0.0)
        else:
            values.append((1.0 - weight / strength) ** (degree - 1))
    return min(values)


def backbone_stats(graph: nx.Graph, edge_alpha: dict[tuple[str, str], float]) -> list[dict]:
    rows = []
    for level in BACKBONE_LEVELS:
        backbone = nx.Graph()
        backbone.add_nodes_from(graph.nodes)
        backbone.add_edges_from(edge for edge, alpha in edge_alpha.items() if alpha < level)
        components = sorted(nx.connected_components(backbone), key=len, reverse=True)
        active = sum(1 for node in backbone if backbone.degree(node) > 0)
        rows.append({
            "alpha": level,
            "edges": backbone.number_of_edges(),
            "active_nodes": active,
            "giant": len(components[0]) if components else 0,
            "components": len(components),
        })
    return rows


def main() -> None:
    node_rows = read_tsv(NODE_PATH)
    edge_rows = read_tsv(EDGE_PATH)
    attributes = {row["node_id"]: row for row in node_rows}

    directed = nx.DiGraph()
    directed.add_nodes_from(attributes)
    for row in edge_rows:
        directed.add_edge(row["source"], row["target"], weight=int(row["weight"]))
    assert directed.number_of_nodes() == 1444
    assert directed.number_of_edges() == 11135

    graph = nx.Graph()
    graph.add_nodes_from(attributes)
    for source, target, data in directed.edges(data=True):
        weight = data["weight"]
        if graph.has_edge(source, target):
            graph[source][target]["weight"] += weight
        else:
            graph.add_edge(source, target, weight=weight)
    assert graph.number_of_edges() == 9140

    components = sorted(nx.connected_components(graph), key=len, reverse=True)
    giant = graph.subgraph(components[0]).copy()
    assert giant.number_of_nodes() == 1374
    assert giant.number_of_edges() == 9139

    weighted_communities = nx.community.louvain_communities(giant, weight="weight", seed=MAIN_SEED)
    unweighted_communities = nx.community.louvain_communities(giant, weight=None, seed=MAIN_SEED)
    weighted_map = partition_map(weighted_communities)
    unweighted_map = partition_map(unweighted_communities)
    alignment, matched = optimal_alignment(weighted_map, unweighted_map)
    aligned_unweighted = {node: alignment.get(label, label + 100) for node, label in unweighted_map.items()}
    nmi = normalized_mutual_information(weighted_map, unweighted_map)

    weighted_modularity = nx.community.modularity(giant, weighted_communities, weight="weight")
    unweighted_modularity = nx.community.modularity(giant, unweighted_communities, weight=None)

    stability_partitions = []
    stability_rows = []
    for seed in SEEDS:
        communities = nx.community.louvain_communities(giant, weight="weight", seed=seed)
        mapping = partition_map(communities)
        stability_partitions.append(mapping)
        stability_rows.append({
            "seed": seed,
            "communities": len(communities),
            "modularity": round(nx.community.modularity(giant, communities, weight="weight"), 6),
        })
    pairwise_nmi = [
        normalized_mutual_information(stability_partitions[left], stability_partitions[right])
        for left in range(len(stability_partitions))
        for right in range(left + 1, len(stability_partitions))
    ]

    weighted_positions = layout_for_partition(giant, weighted_communities, "weighted")
    unweighted_positions = layout_for_partition(giant, unweighted_communities, "unweighted")
    edge_alpha = {
        tuple(sorted((source, target))): disparity_alpha(giant, source, target, data["weight"])
        for source, target, data in giant.edges(data=True)
    }

    strength = dict(giant.degree(weight="weight"))
    degree = dict(giant.degree())
    movers = [node for node in giant if weighted_map[node] != aligned_unweighted[node]]
    movers.sort(key=lambda node: (-strength[node], node))
    visual_nodes = set(sorted(giant, key=lambda node: (-strength[node], node))[:420])
    visual_nodes.update(movers[:80])
    if "Aristotle" in giant:
        visual_nodes.add("Aristotle")

    visual_edges = []
    for source, target, data in giant.edges(data=True):
        if source not in visual_nodes or target not in visual_nodes:
            continue
        alpha = edge_alpha[tuple(sorted((source, target)))]
        visual_edges.append({
            "source": source,
            "target": target,
            "weight": data["weight"],
            "alpha": round(alpha, 6),
        })

    summaries = community_summaries(giant, weighted_communities, attributes)
    top_movers = []
    for node in movers[:16]:
        top_movers.append({
            "id": node,
            "name": attributes[node]["name"],
            "strength": strength[node],
            "degree": degree[node],
            "weighted": weighted_map[node],
            "unweighted_raw": unweighted_map[node],
            "unweighted_aligned": aligned_unweighted[node],
            "from_label": summaries[weighted_map[node]]["top"][:2],
        })

    aristotle = None
    if "Aristotle" in giant:
        community = weighted_communities[weighted_map["Aristotle"]]
        peers = sorted(
            (node for node in community if node != "Aristotle"),
            key=lambda node: (-giant["Aristotle"].get(node, {}).get("weight", 0), -strength[node], node),
        )[:10]
        aristotle = {
            "weighted_community": weighted_map["Aristotle"],
            "unweighted_community_aligned": aligned_unweighted["Aristotle"],
            "degree": degree["Aristotle"],
            "strength": strength["Aristotle"],
            "peers": [attributes[node]["name"] for node in peers],
            "subfields": attributes["Aristotle"]["subfields"],
            "era": attributes["Aristotle"]["era"],
        }

    output = {
        "meta": {
            "directed_nodes": directed.number_of_nodes(),
            "directed_edges": directed.number_of_edges(),
            "undirected_edges": graph.number_of_edges(),
            "giant_nodes": giant.number_of_nodes(),
            "giant_edges": giant.number_of_edges(),
            "isolated_or_small_nodes": graph.number_of_nodes() - giant.number_of_nodes(),
            "seed": MAIN_SEED,
        },
        "comparison": {
            "weighted_communities": len(weighted_communities),
            "unweighted_communities": len(unweighted_communities),
            "weighted_modularity": round(weighted_modularity, 4),
            "unweighted_modularity": round(unweighted_modularity, 4),
            "nmi": round(nmi, 4),
            "matched_nodes": matched,
            "moved_nodes": len(giant) - matched,
            "top_movers": top_movers,
        },
        "stability": {
            "runs": stability_rows,
            "pairwise_nmi": [round(value, 5) for value in pairwise_nmi],
            "mean_nmi": round(sum(pairwise_nmi) / len(pairwise_nmi), 4),
            "min_nmi": round(min(pairwise_nmi), 4),
            "max_nmi": round(max(pairwise_nmi), 4),
        },
        "backbone": backbone_stats(giant, edge_alpha),
        "communities": summaries,
        "aristotle": aristotle,
        "visual": {
            "nodes": [
                {
                    "id": node,
                    "name": attributes[node]["name"],
                    "degree": degree[node],
                    "strength": strength[node],
                    "weighted": weighted_map[node],
                    "unweighted": aligned_unweighted[node],
                    "moved": weighted_map[node] != aligned_unweighted[node],
                    "weighted_position": weighted_positions[node],
                    "unweighted_position": unweighted_positions[node],
                }
                for node in sorted(visual_nodes)
            ],
            "edges": visual_edges,
        },
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "output": str(OUTPUT_PATH),
        "weighted_communities": len(weighted_communities),
        "unweighted_communities": len(unweighted_communities),
        "nmi": round(nmi, 4),
        "moved_nodes": len(giant) - matched,
        "stability_mean_nmi": output["stability"]["mean_nmi"],
        "backbone": output["backbone"],
        "aristotle": aristotle,
        "visual_nodes": len(visual_nodes),
        "visual_edges": len(visual_edges),
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
