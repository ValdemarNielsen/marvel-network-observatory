# Marvel Network Observatory

An interactive Week 1 data story for DTU course **02805 Social Graphs and Interactions**.

The site explores the frozen 26 August 2026 snapshot of 303 pages in Wikipedia's
`Category:Marvel Comics superheroes`. Issue 01 studies edge direction and preserves all 17
isolates. Issue 02 uses null models to test whether the degree sequence explains clustering.

## What is interactive

- Searchable, zoomable network map with incoming, outgoing, and mutual links
- In-degree versus out-degree scatterplot with linear and log–log views
- In- and out-degree distributions with raw and width-normalized binned values
- Clickable leaderboards, the separate nine-character island, and all 17 isolates
- Week 2 null-model distributions for clustering and transitivity
- A reproducible degree-preserving shuffle test and configuration-model damage report

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

## Credits

Built by Sebastian, Orestis and Valdemar using the course's frozen shared-playground release.
