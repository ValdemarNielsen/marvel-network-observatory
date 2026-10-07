# Marvel Network Observatory

A weekly interactive data story for DTU course **02805 Social Graphs and Interactions**.

The site explores the frozen 26 August 2026 snapshot of 303 pages in Wikipedia's
`Category:Marvel Comics superheroes`. Issue 01 studies edge direction and preserves all 17
isolates. Issue 02 uses null models to test whether the degree sequence explains clustering.
Issue 03 compares centrality definitions, tests betweenness against degree-preserving nulls,
and stress-tests the giant component under targeted removal. Issue 04 switches to the frozen
philosophers network to compare weighted communities, Louvain stability, and disparity backbones.
Issue 05 joins the Marvel network to 303 Wikipedia articles and tests whether incoming links
predict article length, then follows the largest exceptions and a vocabulary-growth race.

## What is interactive

- Searchable, zoomable network map with incoming, outgoing, and mutual links
- In-degree versus out-degree scatterplot with linear and log–log views
- In- and out-degree distributions with raw and width-normalized binned values
- Clickable leaderboards, the separate nine-character island, and all 17 isolates
- Week 2 null-model distributions for clustering and transitivity
- A reproducible degree-preserving shuffle test and configuration-model damage report
- Week 3 centrality switchboard with live character profiles
- Betweenness surprise scores against 100 degree-preserving null networks
- Interactive targeted-removal stress test and shortest-path finder
- Animated weighted versus unweighted philosophy community atlas
- Twenty-seed Louvain stability lab and interactive disparity-filter backbone
- Week 5 network-fame versus article-length scatterplot with outlier filters
- Animated attention case files and a famous-first versus minor-first vocabulary race

## Rebuild the derived data

The frozen source files are in `source-data/`. From the repository root, run:

```powershell
python scripts/build_network_data.py
```

The script verifies 303 nodes, 1,784 directed edges, 1,434 undirected pairs, and 17 isolates
before writing `assets/data/network.json`.

Build the Week 2 null-model results with the `valde-network-science` Jupyter environment:

```powershell
python scripts/build_week2_data.py
```

Build the Week 3 centrality and robustness results with the same environment:

```powershell
python scripts/build_week3_data.py
```

Build the Week 4 philosophy community and backbone results with the same environment:

```powershell
python scripts/build_week4_data.py
```

Build the Week 5 text and network results with the same environment:

```powershell
python scripts/build_week5_data.py
```

## Credits

Built by Sebastian, Orestis and Valdemar using the course's frozen shared-playground release.
Week 4 motion uses the MIT-licensed [Anime.js](https://animejs.com/) and
[Rough Notation](https://roughnotation.com/) libraries, vendored with their license texts.
Week 5 motion uses MIT-licensed Motion, AutoAnimate, and Typed.js 2.1.0, also vendored with
their license texts.
