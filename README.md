# Marvel Network Observatory

An interactive Week 1 data story for DTU course **02805 Social Graphs and Interactions**.

The site explores the frozen 26 August 2026 snapshot of 303 pages in Wikipedia's
`Category:Marvel Comics superheroes`. It keeps the network directed and adds the full node
roster before its edges, preserving all 17 isolates.

## What is interactive

- Searchable, zoomable network map with incoming, outgoing, and mutual links
- In-degree versus out-degree scatterplot with linear and log–log views
- In- and out-degree distributions with raw and width-normalized binned values
- Clickable leaderboards, the separate nine-character island, and all 17 isolates

## Rebuild the derived data

The frozen source files are in `source-data/`. From the repository root, run:

```powershell
python scripts/build_network_data.py
```

The script verifies 303 nodes, 1,784 directed edges, 1,434 undirected pairs, and 17 isolates
before writing `assets/data/network.json`.

## Credits

Built by Sebastian, Orestis and Valdemar using the course's frozen shared-playground release.
