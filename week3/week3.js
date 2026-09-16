(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const state = { metric: "degree", brokerView: "brokers", strategy: "degree", removed: 25, selectedNode: null };
  const questions = {
    degree: "Who has the most direct connections?",
    closeness: "Who can reach everybody in the fewest steps?",
    betweenness: "Who controls the largest share of shortest paths?",
    eigenvector: "Who is connected to other important characters?",
  };
  const labels = { degree: "Degree", closeness: "Closeness", betweenness: "Betweenness", eigenvector: "Eigenvector" };
  const colors = { degree: "#d8ff3e", betweenness: "#ff4f9a", closeness: "#20d9e7", eigenvector: "#ff8a34", random: "#b7bddb" };
  const brokerStories = {
    "Turbo (comics)": "Turbo is a five-link hinge. Remove Turbo and Redneck becomes separated from the giant component.",
    "Nightmask": "Nightmask has five links, but one of them is Mark Hazzard's only route into the giant component.",
    "Rockman (character)": "Rockman has only two links and sits directly between The Witness and Black Widow's neighborhood.",
    "Hercules (Marvel Comics)": "Hercules combines a high degree with more brokerage than equally connected null-model characters.",
    "Black Widow (Natasha Romanova)": "Black Widow connects several small branches. Removing her strands Blue Eagle and the Rockman branch.",
    "Black Cat (Marvel Comics)": "Black Cat has 28 links, but many of her neighbors have alternative routes. Her popularity creates less control than expected.",
    "Storm (Marvel Comics)": "Storm is highly connected inside a dense X-Men neighborhood, where alternative routes reduce her betweenness.",
    "Betsy Braddock": "Betsy Braddock is part of all six maximum cliques. Dense local redundancy makes her less of a broker than her degree suggests.",
  };

  function svgEl(name, attrs = {}, text = "") {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function initials(name) {
    return name.replace(/\([^)]*\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function shortName(name) {
    return name.replace(/\s*\([^)]*\)/g, "");
  }

  function fmtMetric(metric, value) {
    if (metric === "degree") return Math.round(value).toString();
    return value.toFixed(3);
  }

  function setupReveal() {
    if (!("IntersectionObserver" in window)) return;
    document.documentElement.classList.add("reveal-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle("is-visible", entry.isIntersecting));
    }, { threshold: 0.08, rootMargin: "0px 0px -8%" });
    $$(".field-page").forEach((page) => observer.observe(page));
  }

  function setupReader() {
    const links = $$('[data-section-link]');
    const sections = links.map((link) => $(link.getAttribute("href"))).filter(Boolean);
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
      $("#reading-progress").style.transform = `scaleX(${progress})`;
      let active = 0;
      sections.forEach((section, index) => { if (section.getBoundingClientRect().top < innerHeight * .44) active = index; });
      links.forEach((link, index) => link.setAttribute("aria-current", index === active ? "true" : "false"));
    };
    addEventListener("scroll", update, { passive: true });
    update();
  }

  function setupRanking(data) {
    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
    const list = $("#rank-list");
    const profileName = $("#profile-name");

    function showProfile(node) {
      if (!node) return;
      state.selectedNode = node.id;
      $("#profile-monogram").textContent = initials(node.name);
      profileName.textContent = shortName(node.name);
      $("#profile-degree").textContent = `${Math.round(node.degree)} · #${node.degreeRank}`;
      $("#profile-closeness").textContent = `${node.closeness.toFixed(3)} · #${node.closenessRank}`;
      $("#profile-betweenness").textContent = `${node.betweenness.toFixed(3)} · #${node.betweennessRank}`;
    }

    function render() {
      const entries = data.leaderboards[state.metric].slice(0, 7);
      const max = entries[0].value || 1;
      $("#metric-question").textContent = questions[state.metric];
      list.replaceChildren(...entries.map((entry, index) => {
        const item = document.createElement("li");
        const rank = document.createElement("span");
        rank.textContent = String(index + 1).padStart(2, "0");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = shortName(entry.name);
        button.addEventListener("click", () => showProfile(nodeById.get(entry.id)));
        const bar = document.createElement("i");
        bar.style.width = `${Math.max(7, 100 * entry.value / max)}%`;
        const value = document.createElement("strong");
        value.textContent = fmtMetric(state.metric, entry.value);
        item.append(rank, button, bar, value);
        return item;
      }));
      const selected = nodeById.get(state.selectedNode) || nodeById.get(entries[0].id);
      showProfile(selected);
    }

    $$("[data-metric]").forEach((button) => button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      $$("[data-metric]").forEach((peer) => {
        const active = peer === button;
        peer.classList.toggle("is-active", active);
        peer.setAttribute("aria-pressed", String(active));
      });
      render();
    }));
    state.selectedNode = data.leaderboards.degree[0].id;
    render();
  }

  function setupBrokers(data) {
    const svg = $("#broker-chart");
    const tooltip = $("#broker-tooltip");
    const file = $("#broker-file");

    function showFile(item) {
      $("#broker-initials").textContent = initials(item.name);
      $("#broker-name").textContent = shortName(item.name);
      $("#broker-degree").textContent = item.degree;
      $("#broker-degree-rank").textContent = `#${item.degreeRank}`;
      $("#broker-between-rank").textContent = `#${item.betweennessRank}`;
      $("#broker-z").textContent = `${item.z >= 0 ? "+" : ""}${item.z.toFixed(2)}`;
      $("#broker-p").textContent = item.twoSidedEmpiricalP.toFixed(3);
      $("#broker-story").textContent = brokerStories[item.name] || `${shortName(item.name)} has ${item.degree} links and a betweenness z-score of ${item.z.toFixed(2)} against the degree-preserving null.`;
      file.animate?.([{ transform: "translateY(5px)", opacity: .65 }, { transform: "translateY(0)", opacity: 1 }], { duration: 260, easing: "ease-out" });
    }

    function render() {
      const width = Math.max(300, Math.round(svg.getBoundingClientRect().width));
      const height = 420;
      const margin = { top: 30, right: 18, bottom: 58, left: 54 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const items = data.surprises[state.brokerView];
      const maxRank = Math.max(...items.map((item) => item.degreeRank));
      const minZ = Math.min(-3, ...items.map((item) => item.z)) - .4;
      const maxZ = Math.max(9, ...items.map((item) => item.z)) + .4;
      const x = (rank) => margin.left + ((rank - 1) / Math.max(1, maxRank - 1)) * innerW;
      const y = (z) => margin.top + (maxZ - z) / (maxZ - minZ) * innerH;

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.replaceChildren();
      const zero = y(0);
      svg.append(svgEl("line", { x1: margin.left, y1: zero, x2: width - margin.right, y2: zero, stroke: "#b7bddb", "stroke-dasharray": "5 6" }));
      [-2, 0, 2, 4, 6, 8].filter((tick) => tick >= minZ && tick <= maxZ).forEach((tick) => {
        const ty = y(tick);
        svg.append(svgEl("line", { x1: margin.left, y1: ty, x2: width - margin.right, y2: ty, stroke: "rgba(255,255,255,.09)" }));
        svg.append(svgEl("text", { x: margin.left - 10, y: ty + 4, fill: "#b7bddb", "font-size": 12, "text-anchor": "end" }, String(tick)));
      });
      [1, Math.round(maxRank / 2), maxRank].forEach((tick) => {
        const tx = x(tick);
        svg.append(svgEl("text", { x: tx, y: height - 28, fill: "#b7bddb", "font-size": 12, "text-anchor": "middle" }, `#${tick}`));
      });
      svg.append(svgEl("text", { x: margin.left + innerW / 2, y: height - 7, fill: "#fff8df", "font-size": 13, "font-weight": 700, "text-anchor": "middle" }, "Degree rank, lower is more connected"));
      const ylabel = svgEl("text", { x: 14, y: margin.top + innerH / 2, fill: "#fff8df", "font-size": 13, "font-weight": 700, "text-anchor": "middle", transform: `rotate(-90 14 ${margin.top + innerH / 2})` }, "Betweenness z-score");
      svg.append(ylabel);

      items.forEach((item, index) => {
        const circle = svgEl("circle", { cx: x(item.degreeRank), cy: y(item.z), r: index === 0 ? 10 : 7, fill: state.brokerView === "brokers" ? "#20d9e7" : "#ff4f9a", stroke: "#fff8df", "stroke-width": 2, tabindex: 0, role: "button", "aria-label": `${item.name}, degree rank ${item.degreeRank}, z-score ${item.z.toFixed(2)}` });
        const showTip = (event) => {
          tooltip.hidden = false;
          tooltip.innerHTML = `<strong>${shortName(item.name)}</strong>Degree #${item.degreeRank}<br>Betweenness #${item.betweennessRank}<br>z = ${item.z.toFixed(2)}`;
          const rect = svg.parentElement.getBoundingClientRect();
          const clientX = event.clientX || rect.left + x(item.degreeRank);
          const clientY = event.clientY || rect.top + y(item.z);
          tooltip.style.left = `${Math.min(rect.width - 200, Math.max(4, clientX - rect.left + 10))}px`;
          tooltip.style.top = `${Math.max(4, clientY - rect.top - 78)}px`;
        };
        circle.addEventListener("pointerenter", showTip);
        circle.addEventListener("focus", showTip);
        circle.addEventListener("pointerleave", () => { tooltip.hidden = true; });
        circle.addEventListener("blur", () => { tooltip.hidden = true; });
        circle.addEventListener("click", () => showFile(item));
        circle.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") showFile(item); });
        svg.append(circle);
        if (index < 3) svg.append(svgEl("text", { x: x(item.degreeRank) + 10, y: y(item.z) - 10, fill: "#fff8df", "font-size": 11, "font-weight": 700 }, shortName(item.name)));
      });
      showFile(items[0]);
    }

    $$("[data-broker-view]").forEach((button) => button.addEventListener("click", () => {
      state.brokerView = button.dataset.brokerView;
      $$("[data-broker-view]").forEach((peer) => {
        const active = peer === button;
        peer.classList.toggle("is-active", active);
        peer.setAttribute("aria-pressed", String(active));
      });
      render();
    }));
    render();
    let resizeTimer;
    addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
  }

  function setupAttack(data) {
    const svg = $("#attack-chart");
    const slider = $("#removal-count");
    const tooltip = $("#attack-tooltip");

    function point(strategy, removed) {
      if (strategy === "random") {
        const item = data.attacks.random[removed];
        return { giantFraction: item.meanGiantFraction, components: item.meanComponents, giantSize: item.meanGiantFraction * data.graph.nodes };
      }
      return data.attacks[strategy][removed];
    }

    function updateReadout() {
      const selected = point(state.strategy, state.removed);
      const random = point("random", state.removed);
      const percent = Math.round(100 * selected.giantFraction);
      $("#removal-output").textContent = state.removed;
      $("#giant-percent").textContent = `${percent}%`;
      $("#giant-size").textContent = `${Math.round(selected.giantSize)} nodes`;
      $("#component-count").textContent = `${Number(selected.components).toFixed(state.strategy === "random" ? 1 : 0)} components`;
      $("#random-percent").textContent = `${Math.round(100 * random.giantFraction)}%`;
      const label = state.strategy === "random" ? "randomly chosen" : `highest-${labels[state.strategy].toLowerCase()}`;
      $("#attack-verdict").textContent = state.removed === 0
        ? "The intact giant component contains all 277 characters."
        : `Removing ${state.removed} ${label} characters leaves about ${Math.round(selected.giantSize)} together. Random removal leaves about ${Math.round(random.giantSize)}.`;
    }

    function render() {
      const width = Math.max(300, Math.round(svg.getBoundingClientRect().width));
      const height = 420;
      const margin = { top: 28, right: 18, bottom: 58, left: 56 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const x = (removed) => margin.left + removed / 50 * innerW;
      const y = (fraction) => margin.top + (1 - (fraction - .6) / .4) * innerH;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.replaceChildren();
      [0.6, 0.7, 0.8, 0.9, 1].forEach((tick) => {
        const ty = y(tick);
        svg.append(svgEl("line", { x1: margin.left, y1: ty, x2: width - margin.right, y2: ty, stroke: "rgba(255,255,255,.1)" }));
        svg.append(svgEl("text", { x: margin.left - 9, y: ty + 4, fill: "#b7bddb", "font-size": 12, "text-anchor": "end" }, `${Math.round(tick * 100)}%`));
      });
      [0, 10, 20, 30, 40, 50].forEach((tick) => svg.append(svgEl("text", { x: x(tick), y: height - 29, fill: "#b7bddb", "font-size": 12, "text-anchor": "middle" }, String(tick))));
      svg.append(svgEl("text", { x: margin.left + innerW / 2, y: height - 7, fill: "#fff8df", "font-size": 13, "font-weight": 700, "text-anchor": "middle" }, "Characters removed"));

      const random = data.attacks.random;
      const band = [
        ...random.map((item) => `${x(item.removed)},${y(item.q90GiantFraction)}`),
        ...[...random].reverse().map((item) => `${x(item.removed)},${y(item.q10GiantFraction)}`),
      ].join(" ");
      svg.append(svgEl("polygon", { points: band, fill: "rgba(183,189,219,.16)" }));

      ["random", "degree", "betweenness", "closeness", "eigenvector"].forEach((strategy) => {
        const samples = strategy === "random"
          ? data.attacks.random.map((item) => ({ removed: item.removed, giantFraction: item.meanGiantFraction }))
          : data.attacks[strategy];
        const d = samples.map((item, index) => `${index ? "L" : "M"}${x(item.removed)},${y(item.giantFraction)}`).join(" ");
        const active = strategy === state.strategy;
        svg.append(svgEl("path", { d, fill: "none", stroke: colors[strategy], "stroke-width": active ? 4 : 1.5, opacity: active ? 1 : .38, "stroke-dasharray": strategy === "random" ? "5 5" : "none" }));
      });
      const selected = point(state.strategy, state.removed);
      const guideX = x(state.removed);
      svg.append(svgEl("line", { x1: guideX, y1: margin.top, x2: guideX, y2: margin.top + innerH, stroke: "#fff8df", "stroke-dasharray": "4 5", opacity: .6 }));
      const dot = svgEl("circle", { cx: guideX, cy: y(selected.giantFraction), r: 8, fill: colors[state.strategy], stroke: "#fff8df", "stroke-width": 3, tabindex: 0, "aria-label": `${state.removed} removed, ${Math.round(100 * selected.giantFraction)} percent remains` });
      const showTip = () => {
        tooltip.hidden = false;
        tooltip.innerHTML = `<strong>${labels[state.strategy] || "Random"}</strong>${state.removed} removed<br>${Math.round(100 * selected.giantFraction)}% remains`;
        tooltip.style.left = `${Math.min(width - 170, Math.max(5, guideX + 10))}px`;
        tooltip.style.top = `${Math.max(5, y(selected.giantFraction) - 62)}px`;
      };
      dot.addEventListener("pointerenter", showTip); dot.addEventListener("focus", showTip);
      dot.addEventListener("pointerleave", () => { tooltip.hidden = true; }); dot.addEventListener("blur", () => { tooltip.hidden = true; });
      svg.append(dot);
      updateReadout();
    }

    $$("[data-strategy]").forEach((button) => button.addEventListener("click", () => {
      state.strategy = button.dataset.strategy;
      $$("[data-strategy]").forEach((peer) => {
        const active = peer === button;
        peer.classList.toggle("is-active", active);
        peer.setAttribute("aria-pressed", String(active));
      });
      render();
    }));
    slider.addEventListener("input", () => { state.removed = Number(slider.value); render(); });
    render();
    let resizeTimer;
    addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
  }

  function setupPathfinder(network, centrality) {
    const names = new Map(network.nodes.map((node) => [node.id, node.name]));
    const idsByName = new Map(network.nodes.map((node) => [node.name.toLocaleLowerCase(), node.id]));
    const allowed = new Set(centrality.nodes.map((node) => node.id));
    const adjacency = new Map([...allowed].map((id) => [id, []]));
    network.pairs.forEach(({ source, target }) => {
      if (allowed.has(source) && allowed.has(target)) {
        adjacency.get(source).push(target);
        adjacency.get(target).push(source);
      }
    });
    adjacency.forEach((neighbors) => neighbors.sort((a, b) => names.get(a).localeCompare(names.get(b))));
    const list = $("#character-list");
    [...allowed].sort((a, b) => names.get(a).localeCompare(names.get(b))).forEach((id) => {
      const option = document.createElement("option");
      option.value = names.get(id);
      list.append(option);
    });

    function bfs(start, target) {
      const queue = [start];
      const previous = new Map([[start, null]]);
      for (let head = 0; head < queue.length; head += 1) {
        const node = queue[head];
        if (node === target) break;
        adjacency.get(node).forEach((neighbor) => {
          if (!previous.has(neighbor)) { previous.set(neighbor, node); queue.push(neighbor); }
        });
      }
      if (!previous.has(target)) return [];
      const path = [];
      for (let node = target; node !== null; node = previous.get(node)) path.push(node);
      return path.reverse();
    }

    function renderPath(path) {
      const stage = $("#route-stage");
      stage.replaceChildren();
      path.forEach((id, index) => {
        const node = document.createElement("span");
        node.textContent = shortName(names.get(id));
        stage.append(node);
        if (index < path.length - 1) {
          const step = document.createElement("i");
          step.textContent = index + 1;
          stage.append(step);
        }
      });
      const distance = Math.max(0, path.length - 1);
      $("#route-distance").textContent = `${distance} ${distance === 1 ? "step" : "steps"}`;
      $("#route-copy").textContent = `One shortest path from ${shortName(names.get(path[0]))} to Spider-Man.`;
      stage.animate?.([{ opacity: .35, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 300, easing: "ease-out" });
    }

    $("#path-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = $("#character-search").value.trim();
      const start = idsByName.get(raw.toLocaleLowerCase());
      if (!start || !allowed.has(start)) {
        $("#route-stage").textContent = "Choose a character from the list.";
        $("#route-distance").textContent = "No route yet";
        $("#route-copy").textContent = "The tool searches the 277-character giant component.";
        return;
      }
      renderPath(bfs(start, centrality.spider.id));
    });
    const turbo = idsByName.get("turbo (comics)");
    if (turbo) renderPath(bfs(turbo, centrality.spider.id));
  }

  async function boot() {
    setupReveal();
    setupReader();
    try {
      const [centrality, network] = await Promise.all([
        fetch("data/centrality_lab.json").then((response) => { if (!response.ok) throw new Error("centrality data"); return response.json(); }),
        fetch("../assets/data/network.json").then((response) => { if (!response.ok) throw new Error("network data"); return response.json(); }),
      ]);
      setupRanking(centrality);
      setupBrokers(centrality);
      setupAttack(centrality);
      setupPathfinder(network, centrality);
    } catch (error) {
      console.error(error);
      $("#metric-question").textContent = "The interactive data could not be loaded. Refresh the page to try again.";
    }
  }

  boot();
})();
