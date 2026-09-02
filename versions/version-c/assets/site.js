(() => {
  "use strict";

  document.documentElement.classList.add("js");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const COLORS = {
    ink: "#17131c",
    muted: "#655f6d",
    cyan: "#3046e8",
    coral: "#ff5738",
    violet: "#8c72c6",
    yellow: "#c8e83b",
    bg: "#f8f3e8",
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
    selectionActive: false,
    view: { zoom: 1, panX: 0, panY: 0 },
    drag: null,
    pointer: null,
    canvasWidth: 0,
    canvasHeight: 0,
    pixelRatio: 1,
    geometry: null,
    geometryDirty: true,
    drawFrame: 0,
    hoverFrame: 0,
    pendingHover: null,
  };

  const canvas = document.querySelector("#network-canvas");
  const networkStage = document.querySelector("#network-stage");
  const networkTooltip = document.querySelector("#network-tooltip");
  const dataStatus = document.querySelector("#data-status");
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });

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

  const scrollBehavior = () => (reducedMotion.matches ? "auto" : "smooth");

  function replayAnimation(element, className) {
    if (!element || reducedMotion.matches) return;
    element.classList.remove(className);
    requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add(className)));
  }

  function canvasSize() {
    return { width: state.canvasWidth, height: state.canvasHeight };
  }

  function requestNetworkDraw(geometryDirty = false) {
    if (geometryDirty) state.geometryDirty = true;
    if (state.drawFrame) return;
    state.drawFrame = requestAnimationFrame(() => {
      state.drawFrame = 0;
      paintNetwork();
    });
  }

  function resizeCanvas() {
    const bounds = networkStage.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const pixelBudgetRatio = Math.sqrt(1_700_000 / Math.max(1, width * height));
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5, pixelBudgetRatio));
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    const changed = pixelWidth !== canvas.width || pixelHeight !== canvas.height;

    state.canvasWidth = width;
    state.canvasHeight = height;
    state.pixelRatio = ratio;
    if (changed) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    requestNetworkDraw(true);
  }

  function radiusFor(node) {
    const value = node[state.networkMetric];
    return (2.7 + Math.sqrt(value) * 0.72) * Math.min(1.2, Math.sqrt(state.view.zoom));
  }

  function nodeColor(node) {
    if (node.in > node.out * 1.25) return COLORS.cyan;
    if (node.out > node.in * 1.25) return COLORS.coral;
    return COLORS.violet;
  }

  function directedRelationship(pair, focusId) {
    if (pair.source === focusId) {
      if (pair._forward && pair._reverse) return "mutual";
      if (pair._forward) return "out";
      if (pair._reverse) return "in";
    }
    if (pair.target === focusId) {
      if (pair._forward && pair._reverse) return "mutual";
      if (pair._forward) return "in";
      if (pair._reverse) return "out";
    }
    return null;
  }

  function rebuildGeometry() {
    if (!state.data || !state.canvasWidth || !state.canvasHeight) return;
    const { width, height } = canvasSize();
    const padding = Math.max(26, Math.min(56, Math.min(width, height) * 0.07));
    const fit = Math.max(1, Math.min((width - padding * 2) / 2.2, (height - padding * 2) / 2.2));
    const points = new Map();
    const radii = new Map();
    state.data.nodes.forEach((node) => {
      points.set(node.id, {
        x: width / 2 + node.x * fit * state.view.zoom + state.view.panX,
        y: height / 2 - node.y * fit * state.view.zoom + state.view.panY,
      });
      radii.set(node.id, radiusFor(node));
    });

    const oneWayPath = new Path2D();
    const mutualPath = new Path2D();
    state.data.pairs.forEach((pair) => {
      const start = points.get(pair.source);
      const end = points.get(pair.target);
      const path = pair.mutual ? mutualPath : oneWayPath;
      path.moveTo(start.x, start.y);
      path.lineTo(end.x, end.y);
    });

    const orderedNodes = [...state.data.nodes].sort((a, b) => a[state.networkMetric] - b[state.networkMetric]);
    const rankedIds = new Set(orderedNodes.slice(-5).map((node) => node.id));
    state.geometry = { points, radii, oneWayPath, mutualPath, orderedNodes, rankedIds };
    state.geometryDirty = false;
  }

  function ensureGeometry() {
    if (state.geometryDirty || !state.geometry) rebuildGeometry();
    return state.geometry;
  }

  function strokePath(path, color, width) {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke(path);
  }

  function paintNetwork() {
    if (!state.data || !state.canvasWidth) return;
    const { width, height } = canvasSize();
    const geometry = ensureGeometry();
    if (!geometry) return;
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";

    const focus = state.hovered || (state.selectionActive ? state.selected : null);
    const focusId = focus?.id;
    strokePath(geometry.oneWayPath, focusId ? "rgba(52,45,59,.055)" : "rgba(52,45,59,.13)", 0.6);
    strokePath(geometry.mutualPath, focusId ? "rgba(140,114,198,.09)" : "rgba(140,114,198,.24)", 0.8);

    if (focusId) {
      for (const pair of state.incidentMap.get(focusId) || []) {
        const start = geometry.points.get(pair.source);
        const end = geometry.points.get(pair.target);
        const relation = directedRelationship(pair, focusId);
        context.strokeStyle = relation === "mutual" ? "rgba(140,114,198,.96)" : relation === "in" ? "rgba(48,70,232,.96)" : "rgba(255,87,56,.96)";
        context.lineWidth = relation === "mutual" ? 1.65 : 1.45;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      }
    }

    for (const node of geometry.orderedNodes) {
      const point = geometry.points.get(node.id);
      const radius = geometry.radii.get(node.id);
      const isFocus = node.id === focusId;
      const isSelected = node.id === state.selected?.id;
      const connectedToFocus = focusId && state.neighborMap.get(focusId)?.has(node.id);
      const alpha = focusId && !isFocus && !connectedToFocus ? 0.58 : node.componentSize === 1 ? 1 : 0.88;
      context.globalAlpha = alpha;
      context.fillStyle = node.componentSize === 1 ? COLORS.yellow : nodeColor(node);
      context.beginPath();
      context.arc(point.x, point.y, isFocus ? radius + 1.5 : radius, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;

      if (isSelected || isFocus) {
        context.strokeStyle = isFocus ? COLORS.ink : "rgba(23,19,28,.78)";
        context.lineWidth = isFocus ? 1.8 : 1.25;
        context.beginPath();
        context.arc(point.x, point.y, radius + (isFocus ? 5 : 3.5), 0, Math.PI * 2);
        context.stroke();
      }
    }

    const labels = state.canvasWidth < 620 ? new Set() : new Set([...geometry.rankedIds].slice(0, 3));
    if (state.selected) labels.add(state.selected.id);
    if (state.hovered) labels.add(state.hovered.id);
    context.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
    context.textBaseline = "middle";
    for (const id of labels) {
      const node = state.byId.get(id);
      const point = geometry.points.get(id);
      const radius = geometry.radii.get(id);
      if (!node || !point) continue;
      const label = node.name.length > 27 ? `${node.name.slice(0, 25)}…` : node.name;
      context.lineWidth = 4;
      context.strokeStyle = "rgba(248,243,232,.96)";
      context.strokeText(label, point.x + radius + 6, point.y);
      context.fillStyle = id === focusId ? COLORS.ink : "rgba(23,19,28,.82)";
      context.fillText(label, point.x + radius + 6, point.y);
    }
  }

  function drawNetwork(geometryDirty = false) {
    requestNetworkDraw(geometryDirty);
  }

  function findNodeAt(x, y) {
    const geometry = ensureGeometry();
    if (!geometry) return null;
    let match = null;
    let bestSquared = Infinity;
    for (const node of state.data.nodes) {
      const point = geometry.points.get(node.id);
      const dx = point.x - x;
      const dy = point.y - y;
      const distanceSquared = dx * dx + dy * dy;
      const threshold = Math.max(8, geometry.radii.get(node.id) + 4);
      if (distanceSquared <= threshold * threshold && distanceSquared < bestSquared) {
        bestSquared = distanceSquared;
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
    state.selectionActive = true;
    updateCharacterCard(node);
    replayAnimation(document.querySelector("#character-card"), "track-change");
    document.querySelector("#character-search").value = node.name;
    drawNetwork();
    if (scroll) document.querySelector("#network").scrollIntoView({ behavior: scrollBehavior(), block: "start" });
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

  function showNetworkTooltip(node, point) {
    if (!node) return hideTooltip(networkTooltip);
    if (networkTooltip.dataset.nodeId !== node.id) {
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      title.textContent = node.name;
      detail.textContent = `${node.in} in · ${node.out} out · ${node.degree} neighbors`;
      networkTooltip.replaceChildren(title, detail);
      networkTooltip.dataset.nodeId = node.id;
    }
    networkTooltip.hidden = false;
    const x = Math.max(8, Math.min(point.x + 13, state.canvasWidth - 215));
    const y = Math.max(8, point.y - 40);
    networkTooltip.style.left = "0";
    networkTooltip.style.top = "0";
    networkTooltip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
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
      networkStage.style.cursor = "grabbing";
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
        drawNetwork(true);
        return;
      }
      state.pendingHover = point;
      if (state.hoverFrame) return;
      state.hoverFrame = requestAnimationFrame(() => {
        state.hoverFrame = 0;
        const latestPoint = state.pendingHover;
        const hovered = latestPoint ? findNodeAt(latestPoint.x, latestPoint.y) : null;
        if (hovered?.id !== state.hovered?.id) {
          state.hovered = hovered;
          networkStage.style.cursor = hovered ? "pointer" : "grab";
          drawNetwork();
        }
        showNetworkTooltip(hovered, latestPoint);
      });
    });

    const endPointer = (event) => {
      if (!state.drag) return;
      const wasMoved = state.drag.moved;
      state.drag = null;
      networkStage.classList.remove("is-dragging");
      networkStage.style.cursor = state.hovered ? "pointer" : "grab";
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
        state.pendingHover = null;
        hideTooltip(networkTooltip);
        drawNetwork(true);
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
        drawNetwork(true);
      },
      { passive: false },
    );

    document.querySelector("#reset-network").addEventListener("click", () => {
      state.view = { zoom: 1, panX: 0, panY: 0 };
      state.selected = state.byId.get("Spider-Man") || state.selected;
      state.selectionActive = false;
      updateCharacterCard(state.selected);
      document.querySelector("#character-search").value = "";
      drawNetwork(true);
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
        "aria-label": `${node.name}: ${node.in} incoming links and ${node.out} outgoing links`,
      });
      const show = (event) => chartTooltip(tooltip, card, event, `<strong>${node.name}</strong><span>${node.in} in · ${node.out} out</span>`);
      circle.addEventListener("pointerenter", show);
      circle.addEventListener("pointermove", show);
      circle.addEventListener("pointerleave", () => hideTooltip(tooltip));
      circle.addEventListener("click", () => selectNode(node, true));
      circle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(node, true);
        }
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
    document.querySelectorAll(".segmented button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
    });

    document.querySelectorAll("[data-network-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        state.networkMetric = button.dataset.networkMetric;
        document.querySelectorAll("[data-network-metric]").forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("is-active", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        if (state.networkMetric === "in" || state.networkMetric === "out") {
          state.leaderboardMetric = state.networkMetric;
          renderLeaderboard();
        }
        drawNetwork(true);
      });
    });

    document.querySelector("#swap-leaderboard").addEventListener("click", () => {
      state.leaderboardMetric = state.leaderboardMetric === "in" ? "out" : "in";
      renderLeaderboard();
    });

    document.querySelectorAll("[data-scatter-scale]").forEach((button) => {
      button.addEventListener("click", () => {
        state.scatterScale = button.dataset.scatterScale;
        document.querySelectorAll("[data-scatter-scale]").forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("is-active", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        renderScatter();
        replayAnimation(document.querySelector(".scatter-card"), "chart-refresh");
      });
    });

    document.querySelectorAll("[data-dist-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        state.distributionMetric = button.dataset.distMetric;
        document.querySelectorAll("[data-dist-metric]").forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("is-active", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        renderDistribution();
        replayAnimation(document.querySelector(".distribution-card"), "chart-refresh");
      });
    });

    document.querySelectorAll("[data-dist-scale]").forEach((button) => {
      button.addEventListener("click", () => {
        state.distributionScale = button.dataset.distScale;
        document.querySelectorAll("[data-dist-scale]").forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("is-active", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        renderDistribution();
        replayAnimation(document.querySelector(".distribution-card"), "chart-refresh");
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
      reveal.innerHTML = expanded ? "Open index <span aria-hidden=\"true\">↓</span>" : "Close index <span aria-hidden=\"true\">↑</span>";
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
        document.querySelectorAll("[data-dist-metric]").forEach((button) => {
          const selected = button.dataset.distMetric === input.direction;
          button.classList.toggle("is-active", selected);
          button.setAttribute("aria-pressed", String(selected));
        });
        document.querySelectorAll("[data-dist-scale]").forEach((button) => {
          const selected = button.dataset.distScale === input.scale;
          button.classList.toggle("is-active", selected);
          button.setAttribute("aria-pressed", String(selected));
        });
        renderDistribution();
        replayAnimation(document.querySelector(".distribution-card"), "chart-refresh");
        document.querySelector("#distribution").scrollIntoView({ behavior: scrollBehavior(), block: "start" });
        return { direction: input.direction, scale: input.scale, updated: true };
      },
    });
  }

  function setupMotion() {
    if (reducedMotion.matches) return;
    document.documentElement.classList.add("motion-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll(".section-shell:not(.takeaway-section)").forEach((section) => {
      section.classList.add("reveal-ready");
      observer.observe(section);
    });
    const syncPlayback = () => document.body.classList.toggle("is-paused", document.hidden);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();
  }

  function initialize(data) {
    state.data = data;
    state.byId = new Map(data.nodes.map((node) => [node.id, node]));
    state.directedSet = new Set(data.directedEdges.map((edge) => `${edge.source}\u0000${edge.target}`));
    state.neighborMap = new Map(data.nodes.map((node) => [node.id, new Set()]));
    state.incidentMap = new Map(data.nodes.map((node) => [node.id, []]));
    data.pairs.forEach((pair) => {
      pair._forward = state.directedSet.has(`${pair.source}\u0000${pair.target}`);
      pair._reverse = state.directedSet.has(`${pair.target}\u0000${pair.source}`);
      state.neighborMap.get(pair.source).add(pair.target);
      state.neighborMap.get(pair.target).add(pair.source);
      state.incidentMap.get(pair.source).push(pair);
      state.incidentMap.get(pair.target).push(pair);
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

    let resizeFrame = 0;
    const queueResize = () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resizeCanvas();
      });
    };
    const resizeObserver = new ResizeObserver(queueResize);
    resizeObserver.observe(networkStage);
    window.addEventListener("resize", queueResize, { passive: true });
  }

  setupMotion();

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
