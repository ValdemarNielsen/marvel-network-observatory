import { annotate, annotationGroup } from "./vendor/rough-notation.esm.js";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const palette = ["#ed5a3d", "#286a65", "#d39a2c", "#6e5596", "#287aa1", "#bb5f87", "#678335", "#bf7031", "#4865a9", "#816946", "#9b4c48", "#447c79"];
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
const formatNumber = new Intl.NumberFormat("en-US");

let data;
let communityMap;

async function loadData() {
  const response = await fetch("data/philosophy_atlas.json");
  if (!response.ok) throw new Error(`Could not load Week 4 data: ${response.status}`);
  return response.json();
}

function communityLabel(id) {
  const community = data.communities.find((item) => item.id === id);
  if (!community) return "a neighboring tradition";
  return `${community.top[0]} · ${community.top[1]}`;
}

class NetworkCanvas {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.nodes = data.visual.nodes;
    this.edges = data.visual.edges;
    this.nodeById = new Map(this.nodes.map((node) => [node.id, node]));
    this.positions = new Map();
    this.mix = options.mix || 0;
    this.threshold = options.threshold ?? 1;
    this.mode = options.mode || "weighted";
    this.hovered = null;
    this.selected = null;
    this.isBackbone = Boolean(options.backbone);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.resize = this.resize.bind(this);
    this.draw = this.draw.bind(this);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(280, rect.width);
    this.height = Math.max(360, rect.height);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.draw();
  }

  point(node) {
    const [wx, wy] = node.weighted_position;
    const [ux, uy] = node.unweighted_position;
    const x = wx + (ux - wx) * this.mix;
    const y = wy + (uy - wy) * this.mix;
    const padX = this.width * .045;
    const padY = this.height * .06;
    return { x: padX + x * (this.width - padX * 2), y: padY + y * (this.height - padY * 2) };
  }

  radius(node) {
    return Math.max(1.6, Math.min(8.5, 1.35 + Math.sqrt(node.strength) * .34));
  }

  draw() {
    if (!this.width || !this.height) return;
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(this.width * .5, this.height * .43, 30, this.width * .5, this.height * .45, this.width * .7);
    gradient.addColorStop(0, this.isBackbone ? "#174b43" : "#194e45");
    gradient.addColorStop(1, "#071f1d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    this.positions.clear();
    for (const node of this.nodes) this.positions.set(node.id, this.point(node));

    const activeBackboneNodes = new Set();
    if (this.isBackbone) {
      for (const edge of this.edges) {
        if (edge.alpha < this.threshold) {
          activeBackboneNodes.add(edge.source);
          activeBackboneNodes.add(edge.target);
        }
      }
    }
    ctx.lineCap = "round";
    for (const edge of this.edges) {
      if (this.isBackbone && edge.alpha >= this.threshold) continue;
      const source = this.positions.get(edge.source);
      const target = this.positions.get(edge.target);
      if (!source || !target) continue;
      const sourceNode = this.nodeById.get(edge.source);
      const targetNode = this.nodeById.get(edge.target);
      const fadeForMovers = this.mode === "movers" && !(sourceNode.moved || targetNode.moved);
      const edgeAlpha = this.isBackbone ? .13 + Math.min(.42, edge.weight * .045) : (fadeForMovers ? .012 : .045 + Math.min(.13, edge.weight * .012));
      ctx.strokeStyle = `rgba(224,235,230,${edgeAlpha})`;
      ctx.lineWidth = this.isBackbone ? Math.min(2.8, .4 + edge.weight * .18) : Math.min(1.6, .35 + edge.weight * .055);
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }

    const order = [...this.nodes].sort((a, b) => a.strength - b.strength);
    for (const node of order) {
      const point = this.positions.get(node.id);
      const activeEdge = !this.isBackbone || activeBackboneNodes.has(node.id);
      const faded = (this.mode === "movers" && !node.moved) || (this.isBackbone && !activeEdge);
      const id = this.mix > .5 ? node.unweighted : node.weighted;
      ctx.beginPath();
      ctx.arc(point.x, point.y, this.radius(node), 0, Math.PI * 2);
      ctx.fillStyle = faded ? "rgba(203,218,211,.16)" : palette[id % palette.length];
      ctx.fill();
      if (node.moved && !faded && !this.isBackbone) {
        ctx.strokeStyle = "rgba(255,255,255,.82)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (node.id === this.hovered || node.id === this.selected) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, this.radius(node) + 5, 0, Math.PI * 2);
        ctx.strokeStyle = node.id === this.selected ? "#f4c76f" : "rgba(255,255,255,.9)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  nearest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestDistance = 18;
    for (const node of this.nodes) {
      const point = this.positions.get(node.id);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }
}

function animateObject(target, properties, options = {}) {
  if (prefersReducedMotion || !window.anime) {
    Object.assign(target, properties);
    options.update?.();
    options.complete?.();
    return;
  }
  window.anime.remove(target);
  window.anime({ targets: target, ...properties, duration: options.duration || 850, easing: options.easing || "easeInOutCubic", update: options.update, complete: options.complete });
}

function setupCommunityMap() {
  communityMap = new NetworkCanvas(qs("#community-canvas"));
  const tooltip = qs("#map-tooltip");
  const caption = qs("#map-caption");
  const status = qs("#map-status");
  const canvas = communityMap.canvas;

  qs("#map-legend").innerHTML = data.communities.map((community) => `<span><i style="background:${community.color}"></i>${community.top[0]}</span>`).join("");

  function setView(view) {
    qsa("[data-view]").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    communityMap.mode = view;
    const targetMix = view === "unweighted" ? 1 : 0;
    status.textContent = view === "movers" ? "260 border cases" : view === "unweighted" ? "Every link equals one" : "Repeated links count";
    caption.textContent = view === "movers"
      ? "The 260 bright, outlined nodes change their best-matched community when repeats count."
      : `${view === "weighted" ? "Weighted" : "Unweighted"} Louvain, seed 11. The fast preview draws 427 high-strength and boundary nodes; all statistics use the full giant component.`;
    animateObject(communityMap, { mix: targetMix }, { duration: 1100, easing: "easeInOutQuart", update: communityMap.draw });
    communityMap.draw();
  }
  qsa("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));

  canvas.addEventListener("pointermove", (event) => {
    const node = communityMap.nearest(event.clientX, event.clientY);
    communityMap.hovered = node?.id || null;
    communityMap.draw();
    if (!node) { tooltip.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${node.name}</strong><span>${node.degree} neighbors · strength ${node.strength}${node.moved ? " · changes community" : ""}</span>`;
    tooltip.style.left = `${Math.min(rect.width - 220, Math.max(8, event.clientX - rect.left + 12))}px`;
    tooltip.style.top = `${Math.min(rect.height - 70, Math.max(8, event.clientY - rect.top + 12))}px`;
  });
  canvas.addEventListener("pointerleave", () => { communityMap.hovered = null; tooltip.hidden = true; communityMap.draw(); });
  canvas.addEventListener("click", (event) => {
    const node = communityMap.nearest(event.clientX, event.clientY);
    communityMap.selected = node?.id || null;
    communityMap.draw();
  });

  return setView;
}

function setupMovers(setView) {
  const movers = data.comparison.top_movers.slice(0, 10);
  qs("#mover-list").innerHTML = movers.map((mover) => {
    const from = communityLabel(mover.weighted);
    const to = communityLabel(mover.unweighted_aligned);
    return `<button type="button" data-node="${mover.id}"><strong>${mover.name}</strong><small>${from} → ${to}</small><span>strength ${mover.strength}</span></button>`;
  }).join("");
  qsa("[data-node]", qs("#mover-list")).forEach((button) => button.addEventListener("click", () => {
    setView("movers");
    communityMap.selected = button.dataset.node;
    communityMap.draw();
    qs(".atlas-console").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
  }));
}

function setupSeedChart() {
  const chart = qs("#seed-chart");
  const min = .545;
  const max = .570;
  chart.innerHTML = data.stability.runs.map((run) => {
    const height = 8 + ((run.modularity - min) / (max - min)) * 82;
    return `<div class="seed-column" title="Seed ${run.seed}: Q ${run.modularity.toFixed(3)}, ${run.communities} communities"><i class="seed-stem" style="height:${height}%"></i><b class="seed-dot" style="bottom:${height}%"></b><span class="seed-count">${run.communities}</span></div>`;
  }).join("");

  function replay() {
    if (!window.anime || prefersReducedMotion) return;
    window.anime({ targets: ".seed-stem", scaleY: [0, 1], delay: window.anime.stagger(35), duration: 650, easing: "easeOutExpo" });
    window.anime({ targets: ".seed-dot", opacity: [0, 1], scale: [0, 1], delay: window.anime.stagger(35, { start: 180 }), duration: 650, easing: "easeOutElastic(1, .6)" });
  }
  qs("#replay-seeds").addEventListener("click", replay);
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) { replay(); observer.disconnect(); }
  }, { threshold: .35 });
  observer.observe(chart);
}

function setupBackbone() {
  const levels = data.backbone;
  const buttons = qs("#alpha-buttons");
  buttons.innerHTML = levels.map((row, index) => `<button type="button" data-alpha="${row.alpha}" class="${index === 0 ? "is-active" : ""}" aria-pressed="${index === 0}">${row.alpha.toFixed(2)}</button>`).join("");
  const canvas = new NetworkCanvas(qs("#backbone-canvas"), { backbone: true, threshold: levels[0].alpha });
  let currentIndex = 0;
  let playback = null;

  function updateText(row) {
    qs("#backbone-label").textContent = row.alpha <= .01 ? "Strictest filter" : row.alpha >= .2 ? "Most permissive view" : "Backbone expanding";
    qs("#backbone-giant").textContent = formatNumber.format(row.giant);
    qs("#backbone-edges").textContent = formatNumber.format(row.edges);
    qs("#backbone-active").textContent = formatNumber.format(row.active_nodes);
    qs("#backbone-percent").textContent = `${(row.giant / data.meta.giant_nodes * 100).toFixed(1)}%`;
    qs("#backbone-meter").style.width = `${row.edges / data.meta.giant_edges * 100}%`;
  }

  function select(index) {
    currentIndex = index;
    const row = levels[index];
    qsa("[data-alpha]", buttons).forEach((button, buttonIndex) => {
      const active = buttonIndex === index;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    animateObject(canvas, { threshold: row.alpha }, { duration: 700, update: canvas.draw });
    updateText(row);
    if (window.anime && !prefersReducedMotion) {
      window.anime({ targets: ["#backbone-giant", "#backbone-edges", "#backbone-active"], opacity: [0, 1], translateY: [8, 0], delay: window.anime.stagger(50), duration: 420, easing: "easeOutCubic" });
    }
  }

  qsa("[data-alpha]", buttons).forEach((button, index) => button.addEventListener("click", () => { clearInterval(playback); select(index); }));
  qs("#play-backbone").addEventListener("click", () => {
    clearInterval(playback);
    select(0);
    playback = setInterval(() => {
      if (currentIndex >= levels.length - 1) { clearInterval(playback); return; }
      select(currentIndex + 1);
    }, prefersReducedMotion ? 500 : 1250);
  });
  updateText(levels[0]);
}

function setupMotion() {
  if (!prefersReducedMotion) document.body.classList.add("motion-ready");
  const reveals = qsa(".reveal");
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add("is-visible"); });
  }, { threshold: .12, rootMargin: "0px 0px -5%" });
  reveals.forEach((element) => revealObserver.observe(element));

  const annotations = annotationGroup([
    annotate(qs("#idea-word"), { type: "underline", color: "#d39a2c", strokeWidth: 3, padding: 3, animationDuration: 900 }),
    annotate(qs("#different-borders"), { type: "circle", color: "#ed5a3d", strokeWidth: 2, padding: 7, iterations: 2, animationDuration: 1100 }),
    annotate(qs(".note-number"), { type: "box", color: "#d39a2c", strokeWidth: 2, padding: 7, animationDuration: 800 }),
  ]);
  if (prefersReducedMotion) annotations.show();
  else {
    const annotationObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { annotations.show(); annotationObserver.disconnect(); }
    }, { threshold: .3 });
    annotationObserver.observe(qs("#idea-word"));
  }

  if (window.anime && !prefersReducedMotion) {
    window.anime({ targets: ".brand-orbit", rotate: 360, duration: 18000, easing: "linear", loop: true });
    window.anime({ targets: "[data-count]", innerHTML: [0, 260], round: 1, duration: 1500, delay: 500, easing: "easeOutExpo" });
    window.anime({ targets: ".atlas-console", opacity: [0, 1], translateY: [24, 0], rotate: [1.2, 0], duration: 1100, delay: 180, easing: "easeOutExpo" });
  }
}

function setupReader() {
  const links = qsa(".reader-nav a");
  const sections = links.map((link) => qs(link.getAttribute("href")));
  function update() {
    const progress = Math.min(1, window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight));
    qs("#reader-progress").style.transform = `scaleX(${progress})`;
    let active = 0;
    sections.forEach((section, index) => { if (section.getBoundingClientRect().top < window.innerHeight * .42) active = index; });
    links.forEach((link, index) => link.setAttribute("aria-current", String(index === active)));
  }
  window.addEventListener("scroll", update, { passive: true });
  update();
}

async function init() {
  try {
    data = await loadData();
    const setView = setupCommunityMap();
    setupMovers(setView);
    setupSeedChart();
    setupBackbone();
    setupMotion();
    setupReader();
  } catch (error) {
    console.error(error);
    qs(".map-stage").innerHTML = `<p style="padding:2rem;color:white">The data could not be loaded. Please refresh the page.</p>`;
  }
}

init();
