"""Build the Week 5 Marvel text and network-attention investigation.

Question: does network fame buy a character more Wikipedia words?
The analysis deliberately uses Week 5 tools only: token counts, vocabulary,
rankings, simple concordance-style excerpts, and a document-level comparison.
"""

from __future__ import annotations

import csv
import json
import math
import re
import statistics
import urllib.parse
import zipfile
from collections import Counter
from pathlib import Path

import networkx as nx


ROOT = Path(__file__).resolve().parents[1]
NODE_PATH = ROOT / "source-data" / "week1_nodes.tsv"
EDGE_PATH = ROOT / "source-data" / "week1_edges.tsv"
TEXT_PATH = ROOT / "source-data" / "marvel_pages.zip"
OUTPUT_PATH = ROOT / "week5" / "data" / "attention_desk.json"

WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
STOPWORDS = {
    "a", "about", "after", "again", "against", "all", "also", "am", "an", "and", "any", "are", "as", "at",
    "be", "because", "been", "before", "being", "between", "both", "but", "by", "can", "could", "did", "do",
    "does", "during", "each", "for", "from", "further", "had", "has", "have", "he", "her", "here", "hers",
    "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "may", "more",
    "most", "no", "nor", "not", "of", "on", "once", "only", "or", "other", "our", "out", "over", "own",
    "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "them", "then", "there",
    "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we",
    "were", "what", "when", "where", "which", "while", "who", "will", "with", "would", "you", "your",
}


def read_nodes() -> dict[str, dict[str, str]]:
    with NODE_PATH.open(encoding="utf-8-sig", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return {row["node_id"]: row for row in csv.DictReader(rows, delimiter="\t", quoting=csv.QUOTE_NONE)}


def read_edges() -> list[tuple[str, str]]:
    edges = []
    with EDGE_PATH.open(encoding="utf-8-sig") as handle:
        for line in handle:
            if not line.startswith("#") and line.strip():
                source, target = line.rstrip("\n").split("\t")
                edges.append((source, target))
    return edges


def read_pages() -> dict[str, str]:
    with zipfile.ZipFile(TEXT_PATH) as archive:
        return {
            urllib.parse.unquote(name.split("/")[-1][:-4]): archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.endswith(".txt") and "README" not in name
        }


def tokens(text: str) -> list[str]:
    return [match.group(0).lower().replace("’", "'") for match in WORD_RE.finditer(text)]


def rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        mean_rank = (start + end - 1) / 2 + 1
        for cursor in range(start, end):
            ranks[order[cursor]] = mean_rank
        start = end
    return ranks


def pearson(left: list[float], right: list[float]) -> float:
    mean_left, mean_right = statistics.mean(left), statistics.mean(right)
    numerator = sum((a - mean_left) * (b - mean_right) for a, b in zip(left, right))
    denominator = math.sqrt(sum((a - mean_left) ** 2 for a in left) * sum((b - mean_right) ** 2 for b in right))
    return numerator / denominator if denominator else 0.0


def regression(x: list[float], y: list[float]) -> tuple[float, float, float]:
    mean_x, mean_y = statistics.mean(x), statistics.mean(y)
    variance = sum((value - mean_x) ** 2 for value in x)
    slope = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y)) / variance
    intercept = mean_y - slope * mean_x
    predictions = [intercept + slope * value for value in x]
    residual = sum((actual - predicted) ** 2 for actual, predicted in zip(y, predictions))
    total = sum((actual - mean_y) ** 2 for actual in y)
    return intercept, slope, 1 - residual / total


def excerpt(text: str, name: str) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    sentences = SENTENCE_RE.split(clean)
    candidates = [sentence.strip() for sentence in sentences if 90 <= len(sentence.strip()) <= 290]
    distinctive = [
        sentence for sentence in candidates
        if not any(phrase in sentence.lower() for phrase in ("appearing in american comic books", "published by marvel comics", "fictional character"))
    ]
    picked = (distinctive or candidates or sentences)[:1]
    value = picked[0] if picked else f"No excerpt available for {name}."
    return value if len(value) <= 280 else value[:277].rstrip() + "…"


def main() -> None:
    nodes = read_nodes()
    edges = read_edges()
    pages = read_pages()
    assert len(nodes) == 303
    assert len(edges) == 1784
    assert set(nodes) == set(pages)

    graph = nx.DiGraph()
    graph.add_nodes_from(nodes)
    graph.add_edges_from(edges)

    page_tokens = {node: tokens(text) for node, text in pages.items()}
    global_counts = Counter(token for values in page_tokens.values() for token in values)
    content_counts = Counter(token for token, count in global_counts.items() if token not in STOPWORDS and len(token) > 2 for _ in range(count))

    records = []
    for node_id, row in nodes.items():
        values = page_tokens[node_id]
        counts = Counter(values)
        records.append({
            "id": node_id,
            "name": row["name"],
            "url": row["url"],
            "description": row["description"],
            "characters": len(pages[node_id]),
            "words": len(values),
            "vocabulary": len(counts),
            "hapax": sum(1 for count in counts.values() if count == 1),
            "lexical_diversity": round(len(counts) / len(values), 4) if values else 0,
            "in_degree": graph.in_degree(node_id),
            "out_degree": graph.out_degree(node_id),
            "excerpt": excerpt(pages[node_id], row["name"]),
            "top_words": [word for word, _ in Counter(token for token in values if token not in STOPWORDS and len(token) > 3).most_common(6)],
        })

    x = [math.log1p(record["in_degree"]) for record in records]
    y = [math.log(record["words"]) for record in records]
    intercept, slope, r_squared = regression(x, y)
    residuals = []
    for record, x_value, y_value in zip(records, x, y):
        predicted = intercept + slope * x_value
        value = y_value - predicted
        record["predicted_words"] = round(math.exp(predicted))
        record["residual"] = round(value, 5)
        residuals.append(value)
    residual_sd = statistics.pstdev(residuals)
    for record in records:
        record["attention_z"] = round(record["residual"] / residual_sd, 3) if residual_sd else 0

    over = sorted(records, key=lambda record: (-record["attention_z"], -record["words"]))[:12]
    under = sorted(records, key=lambda record: (record["attention_z"], -record["in_degree"]))[:12]
    famous = sorted(records, key=lambda record: (-record["in_degree"], record["name"]))[:10]
    longest = sorted(records, key=lambda record: (-record["words"], record["name"]))[:10]

    milestones = [1, 5, 10, 25, 50, 100, 150, 200, 250, 303]
    growth = {}
    for label, ordering in {
        "famous_first": sorted(records, key=lambda record: (-record["in_degree"], record["name"])),
        "minor_first": sorted(records, key=lambda record: (record["in_degree"], record["name"])),
    }.items():
        vocabulary: set[str] = set()
        curve = []
        for index, record in enumerate(ordering, start=1):
            vocabulary.update(page_tokens[record["id"]])
            if index in milestones:
                curve.append({"pages": index, "vocabulary": len(vocabulary)})
        growth[label] = curve

    record_by_id = {record["id"]: record for record in records}
    evidence_ids = []
    for record in over[:6] + under[:6] + famous[:4] + longest[:4]:
        if record["id"] not in evidence_ids:
            evidence_ids.append(record["id"])

    compact_records = []
    for record in records:
        compact = {key: value for key, value in record.items() if key not in {"excerpt", "top_words", "description"}}
        if record["id"] in evidence_ids:
            compact.update({"excerpt": record["excerpt"], "top_words": record["top_words"], "description": record["description"]})
        compact_records.append(compact)

    output = {
        "meta": {
            "documents": len(records),
            "edges": graph.number_of_edges(),
            "total_words": sum(record["words"] for record in records),
            "vocabulary": len(global_counts),
            "median_words": round(statistics.median(record["words"] for record in records)),
            "min_words": min(record["words"] for record in records),
            "max_words": max(record["words"] for record in records),
        },
        "model": {
            "x": "log(1 + in-degree)",
            "y": "log(word count)",
            "intercept": round(intercept, 6),
            "slope": round(slope, 6),
            "r_squared": round(r_squared, 4),
            "spearman": round(pearson(rank([record["in_degree"] for record in records]), rank([record["words"] for record in records])), 4),
        },
        "global_top_words": content_counts.most_common(20),
        "growth": growth,
        "overwritten": [{key: record[key] for key in ("id", "name", "words", "in_degree", "predicted_words", "attention_z", "excerpt", "top_words", "url")} for record in over],
        "underwritten": [{key: record[key] for key in ("id", "name", "words", "in_degree", "predicted_words", "attention_z", "excerpt", "top_words", "url")} for record in under],
        "famous": [{key: record[key] for key in ("id", "name", "words", "in_degree", "attention_z")} for record in famous],
        "longest": [{key: record[key] for key in ("id", "name", "words", "in_degree", "attention_z")} for record in longest],
        "records": compact_records,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "meta": output["meta"],
        "model": output["model"],
        "overwritten": output["overwritten"][:8],
        "underwritten": output["underwritten"][:8],
        "famous": output["famous"][:5],
        "longest": output["longest"][:5],
        "growth": output["growth"],
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
