(() => {
  "use strict";

  document.documentElement.classList.add("js");

  const COLORS = {
    ink: "#f5f0e8",
    muted: "#747c91",
    cyan: "#5ce1e6",
    coral: "#ff6b57",
    violet: "#a58cff",
    yellow: "#f4d35e",
    bg: "#080b14",
  };

  const state = {
    data: null,
    byId: new Map(),
    networkMetric: "in",
    leaderboardMetric: "in",
    scatterScale: "log",
    distributionMetric: "in",
    distributionScale: "log",
    selected: null,
    hovered: null,
    view: { zoom: 1, panX: 0, panY: 0 },
    drag: null,
    pointer: null,
  };

  const canvas = document.querySelector("#network-canvas");
  const networkStage = document.querySelector("#network-stage");
  const networkTooltip = document.querySelector("#network-tooltip");
  const dataStatus = document.querySelector("#data-status");
  const context = canvas.getContext("2d");

  const svgElement = (tag, attributes = {}, text = "") => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
    if (text) element.textContent = text;
    return element;
  };

  const formatNumber = (value, digits = 0) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  const makeScale = (domainMin, domainMax, rangeMin, rangeMax, type = "linear") => {
    const transform = type === "log" ? (value) => Math.log10(Math.max(value, Number.MIN_VALUE)) : (value) => value;
    const start = transform(domainMin);
    const span = transform(domainMax) - start || 1;
    return (value) => rangeMin + ((transform(value) - start) / span) * (rangeMax - rangeMin);
  };

  const chartTooltip = (tooltip, parent, event, html) => {
    const box = parent.getBoundingClientRect();
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const x = Math.min(event.clientX - box.left + 12, box.width - 220);
    const y = Math.max(8, event.clientY - box.top - 18);
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${y}px`;
  };

  const hideTooltip = (tooltip) => {
    tooltip.hidden = true;
  };

  function canvasSize() {
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  function resizeCanvas() {
    const { width, height } = canvasSize();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawNetwork();
  }

  function screenPoint(node) {
    const { width, height } = canvasSize();
    const padding = Math.min(54, width * 0.06);
    const baseX = padding + ((node.x + 1.1) / 2.2) * (width - 2 * padding);
    const baseY = padding + (1 - (node.y + 1.1) / 2.2) * (height - 2 * padding);
    return {
      x: width / 2 + (baseX - width / 2) * state.view.zoom + state.view.panX,
      y: height / 2 + (baseY - height / 2) * state.view.zoom + state.view.panY,
    };
  }

  function nodeRadius(node) {
    const value = node[state.networkMetric];
    return (2.1 + Math.sqrt(value) * 0.82) * Math.min(1.25, Math.sqrt(state.view.zoom));
  }

  function nodeColor(node) {
    if (node.in > node.out * 1.25) return COLORS.cyan;
    if (node.out > node.in * 1.25) return COLORS.coral;
    return COLORS.violet;
  }

  function directedRelationship(pair, focusId) {
    const sourceToTarget = state.directedSet.has(`${pair.source}\u0000${pair.target}`);
    const targetToSource = state.directedSet.has(`${pair.target}\u0000${pair.source}`);
    if (pair.source === focusId) {
      if (sourceToTarget && targetToSource) return "mutual";
      if (sourceToTarget) return "out";
      if (targetToSource) return "in";
    }
    if (pair.target === focusId) {
      if (sourceToTarget && targetToSource) return "mutual";
      if (sourceToTarget) return "in";
      if (targetToSource) return "out";
    }
    return null;
  }

  function drawNetwork() {
    if (!state.data || !canvas.clientWidth) return;
    const { width, height } = canvasSize();
    context.clearRect(0, 0, width, height);

    const focus = state.hovered || state.selected;
    const focusId = focus?.id;
    const points = new Map(state.data.nodes.map((node) => [node.id, screenPoint(node)]));

    context.lineCap = "round";
    for (const pair of state.data.pairs) {
      const start = points.get(pair.source);
      const end = points.get(pair.target);
      if (!start || !end) continue;
      const relation = focusId ? directedRelationship(pair, focusId) : null;
      const incident = pair.source === focusId || pair.target === focusId;

      if (focusId && !incident) {
        context.strokeStyle = "rgba(125, 137, 160, 0.018)";
        context.lineWidth = 0.45;
      } else if (relation === "mutual") {
        context.strokeStyle = "rgba(165, 140, 255, 0.8)";
        context.lineWidth = 1.4;
      } else if (relation === "in") {
        context.strokeStyle = "rgba(92, 225, 230, 0.82)";
        context.lineWidth = 1.35;
      } else if (relation === "out") {
        context.strokeStyle = "rgba(255, 107, 87, 0.82)";
        context.lineWidth = 1.35;
      } else {
        context.strokeStyle = pair.mutual ? "rgba(165, 140, 255, 0.095)" : "rgba(159, 169, 190, 0.045)";
        context.lineWidth = pair.mutual ? 0.7 : 0.5;
      }

      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }

    const rankedIds = new Set(
      [...state.data.nodes]
        .sort((a, b) => b[state.networkMetric] - a[state.networkMetric])
        .slice(0, 5)
        .map((node) => node.id),
    );

    const orderedNodes = [...state.data.nodes].sort((a, b) => a[state.networkMetric] - b[state.networkMetric]);
    for (const node of orderedNodes) {
      const point = points.get(node.id);
      const radius = nodeRadius(node);
      const isFocus = node.id === focusId;
      const isSelected = node.id === state.selected?.id;
      const connectedToFocus = focusId && state.neighborMap.get(focusId)?.has(node.id);
      const alpha = focusId && !isFocus && !connectedToFocus ? 0.18 : node.componentSize === 1 ? 0.9 : 0.78;

      context.globalAlpha = alpha;
      context.fillStyle = node.componentSize === 1 ? COLORS.yellow : nodeColor(node);
      if (isFocus || isSelected) {
        context.shadowColor = nodeColor(node);
        context.shadowBlur = 18;
      }
      context.beginPath();
      context.arc(point.x, point.y, isFocus ? radius + 2 : radius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;

      if (isSelected) {
        context.strokeStyle = COLORS.ink;
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    const labels = new Set(rankedIds);
    if (state.selected) labels.add(state.selected.id);
    if (state.hovered) labels.add(state.hovered.id);
    context.font = "10px Inter, system-ui, sans-serif";
    context.textBaseline = "middle";
    for (const id of labels) {
      const node = state.byId.get(id);
      const point = points.get(id);
      if (!node || !point) continue;
      const radius = nodeRadius(node);
      const label = node.name.length > 27 ? `${node.name.slice(0, 25)}…` : node.name;
      context.lineWidth = 4;
      context.strokeStyle = "rgba(8, 11, 20, 0.92)";
      context.strokeText(label, point.x + radius + 6, point.y);
      context.fillStyle = id === focusId ? COLORS.ink : "rgba(245, 240, 232, 0.72)";
      context.fillText(label, point.x + radius + 6, point.y);
    }
  }

  function findNodeAt(x, y) {
    if (!state.data) return null;
    let match = null;
    let best = Infinity;
    for (const node of state.data.nodes) {
      const point = screenPoint(node);
      const distance = Math.hypot(point.x - x, point.y - y);
      const threshold = Math.max(7, nodeRadius(node) + 4);
      if (distance <= threshold && distance < best) {
        best = distance;
        match = node;
      }
    }
    return match;
  }

  function updateCharacterCard(node) {
    document.querySelector("#selected-name").textContent = node.name;
    document.querySelector("#selected-description").textContent = node.description || "No short description is available.";
    document.querySelector("#selected-in").textContent = formatNumber(node.in);
    document.querySelector("#selected-out").textContent = formatNumber(node.out);
    document.querySelector("#selected-degree").textContent = formatNumber(node.degree);
    document.querySelector("#selected-link").href = node.url;
  }

  function selectNode(node, scroll = false) {
    if (!node) return;
    state.selected = node;
    updateCharacterCard(node);
    document.querySelector("#character-search").value = node.name;
    drawNetwork();
    if (scroll) document.querySelector("#network").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function focusByName(name, scroll = true) {
    const normalized = name.trim().toLocaleLowerCase();
    if (!normalized) return null;
    const exact = state.data.nodes.find((node) => node.name.toLocaleLowerCase() === normalized);
    const partial = state.data.nodes.find((node) => node.name.toLocaleLowerCase().includes(normalized));
    const node = exact || partial;
    if (node) selectNode(node, scroll);
    return node;
  }

  function showNetworkTooltip(node, event) {
    if (!node) return hideTooltip(networkTooltip);
    const box = networkStage.getBoundingClientRect();
    networkTooltip.innerHTML = `<strong>${node.name}</strong><span>${node.in} in · ${node.out} out · ${node.degree} neighbors</span>`;
    networkTooltip.hidden = false;
    networkTooltip.style.left = `${Math.min(event.clientX - box.left + 13, box.width - 215)}px`;
    networkTooltip.style.top = `${Math.max(8, event.clientY - box.top - 40)}px`;
  }

  function pointerCoordinates(event) {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function setupNetworkInteractions() {
    canvas.addEventListener("pointerdown", (event) => {
      const point = pointerCoordinates(event);
      state.drag = { startX: point.x, startY: point.y, panX: state.view.panX, panY: state.view.panY, moved: false };
      canvas.setPointerCapture(event.pointerId);
      networkStage.classList.add("is-dragging");
    });

    canvas.addEventListener("pointermove", (event) => {
      const point = pointerCoordinates(event);
      state.pointer = point;
      if (state.drag) {
        const dx = point.x - state.drag.startX;
        const dy = point.y - state.drag.startY;
        if (Math.hypot(dx, dy) > 3) state.drag.moved = true;
        state.view.panX = state.drag.panX + dx;
        state.view.panY = state.drag.panY + dy;
        state.hovered = null;
        hideTooltip(networkTooltip);
        drawNetwork();
        return;
      }
      const hovered = findNodeAt(point.x, point.y);
      if (hovered?.id !== state.hovered?.id) {
        state.hovered = hovered;
        drawNetwork();
      }
      canvas.style.cursor = hovered ? "pointer" : "grab";
      showNetworkTooltip(hovered, event);
    });

    const endPointer = (event) => {
      if (!state.drag) return;
      const wasMoved = state.drag.moved;
      state.drag = null;
      networkStage.classList.remove("is-dragging");
      if (!wasMoved) {
        const point = pointerCoordinates(event);
        selectNode(findNodeAt(point.x, point.y));
      }
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", () => {
      if (!state.drag) {
        state.hovered = null;
        hideTooltip(networkTooltip);
        drawNetwork();
      }
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const point = pointerCoordinates(event);
        const oldZoom = state.view.zoom;
        const nextZoom = Math.min(4.5, Math.max(0.65, oldZoom * Math.exp(-event.deltaY * 0.0012)));
        const { width, height } = canvasSize();
        state.view.panX = point.x - width / 2 - ((point.x - width / 2 - state.view.panX) * nextZoom) / oldZoom;
        state.view.panY = point.y - height / 2 - ((point.y - height / 2 - state.view.panY) * nextZoom) / oldZoom;
        state.view.zoom = nextZoom;
        drawNetwork();
      },
      { passive: false },
    );

    document.querySelector("#reset-network").addEventListener("click", () => {
      state.view = { zoom: 1, panX: 0, panY: 0 };
      state.selected = state.byId.get("Spider-Man") || state.selected;
      updateCharacterCard(state.selected);
      drawNetwork();
    });
  }

  function renderLeaderboard() {
    const metric = state.leaderboardMetric;
    const list = document.querySelector("#leaderboard");
    document.querySelector("#leaderboard-title").textContent = metric === "in" ? "Most linked to" : "Links out most";
    document.querySelector("#swap-leaderboard").setAttribute("aria-label", metric === "in" ? "Switch leaderboard to links out" : "Switch leaderboard to links in");
    list.replaceChildren();
    state.data.top[metric].slice(0, 5).forEach((entry) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.name;
      button.title = `Show ${entry.name} in the network`;
      button.addEventListener("click", () => selectNode(state.byId.get(entry.id), true));
      const value = document.createElement("strong");
      value.textContent = entry.value;
      item.append(button, value);
      list.append(item);
    });
  }

  function renderScatter() {
    const svg = document.querySelector("#scatter-chart");
    const card = svg.closest(".chart-card");
    const tooltip = document.querySelector("#scatter-tooltip");
    svg.replaceChildren();
    const width = 940;
    const height = 570;
    const margin = { top: 30, right: 50, bottom: 68, left: 76 };
    const xMax = Math.max(...state.data.nodes.map((node) => node.out + 1));
    const yMax = Math.max(...state.data.nodes.map((node) => node.in + 1));
    const x = makeScale(1, xMax, margin.left, width - margin.right, state.scatterScale);
    const y = makeScale(1, yMax, height - margin.bottom, margin.top, state.scatterScale);
    const logTicks = [1, 2, 5, 10, 20, 50, 100, 200];
    const xTicks = state.scatterScale === "log" ? logTicks.filter((tick) => tick <= xMax) : [1, 6, 11, 16, 21, 26];
    const yTicks = state.scatterScale === "log" ? logTicks.filter((tick) => tick <= yMax) : [1, 21, 41, 61, 81, 101];

    xTicks.forEach((tick) => {
      svg.append(svgElement("line", { x1: x(tick), x2: x(tick), y1: margin.top, y2: height - margin.bottom, class: "grid-line" }));
      svg.append(svgElement("text", { x: x(tick), y: height - margin.bottom + 22, "text-anchor": "middle", class: "tick-label" }, tick));
    });
    yTicks.forEach((tick) => {
      svg.append(svgElement("line", { x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick), class: "grid-line" }));
      svg.append(svgElement("text", { x: margin.left - 13, y: y(tick) + 3, "text-anchor": "end", class: "tick-label" }, tick));
    });
    svg.append(svgElement("line", { x1: margin.left, x2: width - margin.right, y1: height - margin.bottom, y2: height - margin.bottom, class: "axis-line" }));
    svg.append(svgElement("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: height - margin.bottom, class: "axis-line" }));
    const equalityMax = Math.min(xMax, yMax);
    svg.append(svgElement("line", { x1: x(1), y1: y(1), x2: x(equalityMax), y2: y(equalityMax), class: "equality-line" }));
    svg.append(svgElement("text", { x: width / 2, y: height - 18, "text-anchor": "middle", class: "axis-label" }, "Out-degree + 1 (links sent)"));
    const yLabel = svgElement("text", { x: 20, y: height / 2, "text-anchor": "middle", class: "axis-label", transform: `rotate(-90 20 ${height / 2})` }, "In-degree + 1 (links received)");
    svg.append(yLabel);

    const labelNames = new Set(["Spider-Man", "Betsy Braddock", "Hulk", "Wolverine (character)", "Doctor Strange", "Cloak and Dagger (characters)"]);
    const plot = svgElement("g");
    state.data.nodes.forEach((node) => {
      const color = node.in > node.out ? COLORS.cyan : node.out > node.in ? COLORS.coral : COLORS.violet;
      const circle = svgElement("circle", {
        cx: x(node.out + 1),
        cy: y(node.in + 1),
        r: labelNames.has(node.name) ? 5.2 : 3.2,
        fill: color,
        opacity: labelNames.has(node.name) ? 1 : 0.55,
        class: "scatter-point",
        tabindex: labelNames.has(node.name) ? 0 : -1,
      });
      const show = (event) => chartTooltip(tooltip, card, event, `<strong>${node.name}</strong><span>${node.in} in · ${node.out} out</span>`);
      circle.addEventListener("pointerenter", show);
      circle.addEventListener("pointermove", show);
      circle.addEventListener("pointerleave", () => hideTooltip(tooltip));
      circle.addEventListener("click", () => selectNode(node, true));
      circle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") selectNode(node, true);
      });
      plot.append(circle);
    });
    svg.append(plot);

    state.data.nodes.filter((node) => labelNames.has(node.name)).forEach((node) => {
      const placeLeft = node.name === "Spider-Man" || node.name === "Doctor Strange";
      svg.append(svgElement("text", {
        x: x(node.out + 1) + (placeLeft ? -8 : 8),
        y: y(node.in + 1) - 9,
        "text-anchor": placeLeft ? "end" : "start",
        class: "point-label",
      }, node.name.replace(" (character)", "").replace(" (characters)", "")));
    });
  }

  function renderDistribution() {
    const svg = document.querySelector("#distribution-chart");
    const card = svg.closest(".chart-card");
    const tooltip = document.querySelector("#distribution-tooltip");
    svg.replaceChildren();
    const width = 940;
    const height = 520;
    const margin = { top: 28, right: 42, bottom: 66, left: 82 };
    const metric = state.distributionMetric;
    const raw = state.data.distribution[metric];
    const binned = state.data.distribution[`${metric}Binned`];
    const xMax = Math.max(...raw.map((point) => point.x));
    const yMax = Math.max(...raw.map((point) => point.p)) * 1.15;
    const positives = [...raw.map((point) => point.p), ...binned.map((point) => point.density)].filter(Boolean);
    const yMin = state.distributionScale === "log" ? Math.min(...positives) * 0.65 : 0;
    const x = makeScale(1, xMax, margin.left, width - margin.right, state.distributionScale);
    const y = makeScale(yMin, yMax, height - margin.bottom, margin.top, state.distributionScale);
    const logXTicks = [1, 2, 5, 10, 20, 50, 100, 200].filter((tick) => tick <= xMax);
    const linearXTicks = Array.from({ length: 6 }, (_, index) => 1 + ((xMax - 1) * index) / 5);
    const xTicks = state.distributionScale === "log" ? logXTicks : linearXTicks;
    const logYTicks = [1, .5, .2, .1, .05, .02, .01, .005, .002, .001].filter((tick) => tick >= yMin && tick <= yMax);
    const linearYTicks = Array.from({ length: 6 }, (_, index) => (yMax * index) / 5);
    const yTicks = state.distributionScale === "log" ? logYTicks : linearYTicks;

    xTicks.forEach((tick) => {
      svg.append(svgElement("line", { x1: x(tick), x2: x(tick), y1: margin.top, y2: height - margin.bottom, class: "grid-line" }));
      svg.append(svgElement("text", { x: x(tick), y: height - margin.bottom + 21, "text-anchor": "middle", class: "tick-label" }, state.distributionScale === "log" ? tick : Math.round(tick)));
    });
    yTicks.forEach((tick) => {
      svg.append(svgElement("line", { x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick), class: "grid-line" }));
      const label = tick === 0 ? "0" : tick >= .01 ? tick.toFixed(tick < .1 ? 2 : 1) : tick.toExponential(0);
      svg.append(svgElement("text", { x: margin.left - 13, y: y(tick) + 3, "text-anchor": "end", class: "tick-label" }, label));
    });
    svg.append(svgElement("line", { x1: margin.left, x2: width - margin.right, y1: height - margin.bottom, y2: height - margin.bottom, class: "axis-line" }));
    svg.append(svgElement("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: height - margin.bottom, class: "axis-line" }));
    svg.append(svgElement("text", { x: width / 2, y: height - 17, "text-anchor": "middle", class: "axis-label" }, "Degree + 1 (isolates stay visible)"));
    svg.append(svgElement("text", { x: 20, y: height / 2, "text-anchor": "middle", class: "axis-label", transform: `rotate(-90 20 ${height / 2})` }, "Probability / density"));

    raw.forEach((point) => {
      const circle = svgElement("circle", { cx: x(point.x), cy: y(point.p), r: 4, class: "raw-point" });
      const show = (event) => chartTooltip(tooltip, card, event, `<strong>Degree ${point.degree}</strong><span>${point.count} character${point.count === 1 ? "" : "s"} · P(k) = ${point.p.toFixed(4)}</span>`);
      circle.addEventListener("pointerenter", show); circle.addEventListener("pointermove", show); circle.addEventListener("pointerleave", () => hideTooltip(tooltip));
      svg.append(circle);
    });

    const pathData = binned.map((point, index) => `${index ? "L" : "M"}${x(point.x).toFixed(2)},${y(point.density).toFixed(2)}`).join(" ");
    svg.append(svgElement("path", { d: pathData, class: "binned-line" }));
    binned.forEach((point) => {
      const circle = svgElement("circle", { cx: x(point.x), cy: y(point.density), r: 5, class: "binned-point" });
      const range = point.lower === point.upper ? `k + 1 = ${point.lower}` : `k + 1 from ${point.lower} to ${point.upper}`;
      const show = (event) => chartTooltip(tooltip, card, event, `<strong>${range}</strong><span>${point.count} characters · width ${point.width} · density ${point.density.toFixed(4)}</span>`);
      circle.addEventListener("pointerenter", show); circle.addEventListener("pointermove", show); circle.addEventListener("pointerleave", () => hideTooltip(tooltip));
      svg.append(circle);
    });
  }

  function renderComponentLists() {
    const island = document.querySelector("#island-list");
    const isolates = document.querySelector("#isolate-list");
    state.data.island.forEach((entry) => {
      const button = document.createElement("button");
      button.className = "name-chip";
      button.type = "button";
      button.textContent = entry.name;
      button.addEventListener("click", () => selectNode(state.byId.get(entry.id), true));
      island.append(button);
    });
    state.data.isolates.forEach((entry) => {
      const button = document.createElement("button");
      button.className = "isolate-chip";
      button.type = "button";
      button.textContent = entry.name;
      button.addEventListener("click", () => selectNode(state.byId.get(entry.id), true));
      isolates.append(button);
    });
  }

  function setupControls() {
    document.querySelectorAll("[data-network-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        state.networkMetric = button.dataset.networkMetric;
        document.querySelectorAll("[data-network-metric]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        if (state.networkMetric === "in" || state.networkMetric === "out") {
          state.leaderboardMetric = state.networkMetric;
          renderLeaderboard();
        }
        drawNetwork();
      });
    });

    document.querySelector("#swap-leaderboard").addEventListener("click", () => {
      state.leaderboardMetric = state.leaderboardMetric === "in" ? "out" : "in";
      renderLeaderboard();
    });

    document.querySelectorAll("[data-scatter-scale]").forEach((button) => {
      button.addEventListener("click", () => {
        state.scatterScale = button.dataset.scatterScale;
        document.querySelectorAll("[data-scatter-scale]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        renderScatter();
      });
    });

    document.querySelectorAll("[data-dist-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        state.distributionMetric = button.dataset.distMetric;
        document.querySelectorAll("[data-dist-metric]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        renderDistribution();
      });
    });

    document.querySelectorAll("[data-dist-scale]").forEach((button) => {
      button.addEventListener("click", () => {
        state.distributionScale = button.dataset.distScale;
        document.querySelectorAll("[data-dist-scale]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        renderDistribution();
      });
    });

    const search = document.querySelector("#character-search");
    search.addEventListener("change", () => focusByName(search.value, false));
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        focusByName(search.value, false);
      }
    });

    const reveal = document.querySelector("#reveal-isolates");
    const isolateList = document.querySelector("#isolate-list");
    reveal.addEventListener("click", () => {
      const expanded = reveal.getAttribute("aria-expanded") === "true";
      reveal.setAttribute("aria-expanded", String(!expanded));
      isolateList.hidden = expanded;
      reveal.innerHTML = expanded ? "Reveal all 17 <span aria-hidden=\"true\">↓</span>" : "Hide isolates <span aria-hidden=\"true\">↑</span>";
    });
  }

  function registerWebMcpTools() {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool) => {
      try {
        void Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
      } catch (_) {}
    };

    register({
      name: "focus_character",
      title: "Focus Marvel character",
      description: "Find a character by name, select them in the network, and return their degree counts.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, description: "Character name, such as Spider-Man" } },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input.name !== "string" || !input.name.trim()) throw new Error("Provide a non-empty character name.");
        const node = focusByName(input.name, true);
        if (!node) throw new Error(`No character matched “${input.name}”.`);
        return { name: node.name, inDegree: node.in, outDegree: node.out, uniqueNeighbors: node.degree };
      },
    });

    register({
      name: "set_degree_distribution_view",
      title: "Set degree distribution view",
      description: "Change the visible degree distribution between in/out degree and linear/log-log axes.",
      inputSchema: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["in", "out"] },
          scale: { type: "string", enum: ["linear", "log"] },
        },
        required: ["direction", "scale"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["in", "out"].includes(input.direction) || !["linear", "log"].includes(input.scale)) throw new Error("Use direction in/out and scale linear/log.");
        state.distributionMetric = input.direction;
        state.distributionScale = input.scale;
        document.querySelectorAll("[data-dist-metric]").forEach((button) => button.classList.toggle("is-active", button.dataset.distMetric === input.direction));
        document.querySelectorAll("[data-dist-scale]").forEach((button) => button.classList.toggle("is-active", button.dataset.distScale === input.scale));
        renderDistribution();
        document.querySelector("#distribution").scrollIntoView({ behavior: "smooth", block: "start" });
        return { direction: input.direction, scale: input.scale, updated: true };
      },
    });
  }

  function initialize(data) {
    state.data = data;
    state.byId = new Map(data.nodes.map((node) => [node.id, node]));
    state.directedSet = new Set(data.directedEdges.map((edge) => `${edge.source}\u0000${edge.target}`));
    state.neighborMap = new Map(data.nodes.map((node) => [node.id, new Set()]));
    data.pairs.forEach((pair) => {
      state.neighborMap.get(pair.source).add(pair.target);
      state.neighborMap.get(pair.target).add(pair.source);
    });

    document.querySelectorAll("[data-stat]").forEach((element) => {
      element.textContent = formatNumber(data.stats[element.dataset.stat]);
    });
    const options = document.querySelector("#character-options");
    data.nodes.forEach((node) => {
      const option = document.createElement("option");
      option.value = node.name;
      options.append(option);
    });

    state.selected = state.byId.get("Spider-Man") || data.nodes[0];
    updateCharacterCard(state.selected);
    dataStatus.hidden = true;
    renderLeaderboard();
    renderScatter();
    renderDistribution();
    renderComponentLists();
    setupControls();
    setupNetworkInteractions();
    resizeCanvas();
    registerWebMcpTools();

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(networkStage);
  }

  fetch("assets/data/network.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
      return response.json();
    })
    .then(initialize)
    .catch((error) => {
      dataStatus.textContent = "The network data could not be loaded. Please refresh the page.";
      dataStatus.classList.add("is-error");
      console.error(error);
    });
})();
