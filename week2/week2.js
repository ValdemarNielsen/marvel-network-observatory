(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const modelMeta = {
    swaps: { label: "Degree swaps", color: "#ff4fad" },
    configuration: { label: "Configuration", color: "#53e7ff" },
    gnm: { label: "Random G(n,m)", color: "#ff8458" },
  };
  const statisticMeta = {
    averageClustering: { label: "average clustering", short: "Average C" },
    transitivity: { label: "transitivity", short: "Transitivity" },
  };
  const state = {
    data: null,
    statistic: "averageClustering",
    visibleModels: new Set(Object.keys(modelMeta)),
  };

  const chart = document.querySelector("#null-chart");
  const tooltip = document.querySelector("#chart-tooltip");
  const caption = document.querySelector("#chart-caption");
  const chartShell = document.querySelector(".chart-shell");

  const svgElement = (tag, attributes = {}, text = "") => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
    if (text) element.textContent = text;
    return element;
  };

  const format = (value, digits = 3) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  const histogram = (values, min, max, bins) => {
    const width = (max - min) / bins;
    const counts = Array(bins).fill(0);
    values.forEach((value) => {
      const index = Math.min(bins - 1, Math.max(0, Math.floor((value - min) / width)));
      counts[index] += 1;
    });
    return { width, counts: counts.map((count) => count / values.length) };
  };

  function renderChart() {
    if (!state.data) return;
    chart.replaceChildren();

    const statistic = state.statistic;
    const realValue = state.data.real[statistic];
    const visible = [...state.visibleModels];
    const allValues = visible.flatMap((model) => state.data.models[model][statistic]);
    if (!allValues.length) {
      caption.textContent = "Choose at least one null model to inspect.";
      return;
    }

    const measuredWidth = Math.round(chart.getBoundingClientRect().width || 920);
    const width = Math.max(340, measuredWidth);
    const compact = width < 560;
    const height = compact ? 470 : 440;
    const margin = compact
      ? { top: 75, right: 16, bottom: 66, left: 58 }
      : { top: 70, right: 30, bottom: 62, left: 70 };
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const domainMin = Math.max(0, Math.min(...allValues) * 0.78);
    const domainMax = Math.max(realValue * 1.055, Math.max(...allValues) * 1.1);
    const bins = compact ? 24 : 34;
    const distributions = Object.fromEntries(
      visible.map((model) => [model, histogram(state.data.models[model][statistic], domainMin, domainMax, bins)]),
    );
    const maxShare = Math.max(...visible.flatMap((model) => distributions[model].counts)) * 1.18;
    const x = (value) => margin.left + ((value - domainMin) / (domainMax - domainMin)) * plotWidth;
    const y = (share) => margin.top + plotHeight - (share / maxShare) * plotHeight;

    for (let index = 0; index <= 4; index += 1) {
      const share = (maxShare / 4) * index;
      const yPos = y(share);
      chart.append(svgElement("line", { x1: margin.left, y1: yPos, x2: width - margin.right, y2: yPos, class: "chart-grid" }));
      chart.append(svgElement("text", { x: margin.left - 12, y: yPos + 5, "text-anchor": "end", class: "chart-tick" }, `${Math.round(share * 100)}%`));
    }

    const xTickCount = compact ? 4 : 5;
    for (let index = 0; index <= xTickCount; index += 1) {
      const value = domainMin + ((domainMax - domainMin) / xTickCount) * index;
      const xPos = x(value);
      chart.append(svgElement("line", { x1: xPos, y1: margin.top, x2: xPos, y2: height - margin.bottom, class: "chart-grid" }));
      chart.append(svgElement("text", { x: xPos, y: height - margin.bottom + 28, "text-anchor": "middle", class: "chart-tick" }, format(value, 2)));
    }

    chart.append(svgElement("line", { x1: margin.left, y1: height - margin.bottom, x2: width - margin.right, y2: height - margin.bottom, class: "chart-axis" }));
    chart.append(svgElement("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: height - margin.bottom, class: "chart-axis" }));
    chart.append(svgElement("text", { x: margin.left + plotWidth / 2, y: height - 16, "text-anchor": "middle", class: "chart-label" }, statisticMeta[statistic].short));
    chart.append(svgElement("text", { x: 20, y: margin.top + plotHeight / 2, transform: `rotate(-90 20 ${margin.top + plotHeight / 2})`, "text-anchor": "middle", class: "chart-label" }, "Share of simulations"));

    visible.forEach((model) => {
      const distribution = distributions[model];
      const points = distribution.counts.map((share, index) => ({
        x: x(domainMin + (index + .5) * distribution.width),
        y: y(share),
      }));
      const path = [
        `M ${points[0].x} ${y(0)}`,
        ...points.map((point) => `L ${point.x} ${point.y}`),
        `L ${points.at(-1).x} ${y(0)}`,
        "Z",
      ].join(" ");
      chart.append(svgElement("path", {
        d: path,
        class: "null-area",
        fill: modelMeta[model].color,
        "fill-opacity": ".12",
        stroke: modelMeta[model].color,
      }));

      const mean = state.data.summaries[model][statistic].mean;
      chart.append(svgElement("line", {
        x1: x(mean), y1: margin.top + 3, x2: x(mean), y2: height - margin.bottom,
        class: "null-mean", stroke: modelMeta[model].color,
      }));
    });

    const realX = x(realValue);
    chart.append(svgElement("line", { x1: realX, y1: margin.top - 10, x2: realX, y2: height - margin.bottom, class: "real-line" }));
    const badgeWidth = compact ? 118 : 132;
    const badgeX = Math.min(width - margin.right - badgeWidth, Math.max(margin.left, realX - badgeWidth / 2));
    chart.append(svgElement("rect", { x: badgeX, y: margin.top - 48, width: badgeWidth, height: 34, class: "real-badge" }));
    chart.append(svgElement("text", { x: badgeX + badgeWidth / 2, y: margin.top - 25, "text-anchor": "middle", class: "real-badge-text" }, `REAL ${format(realValue)}`));

    chart.onpointermove = (event) => {
      const bounds = chart.getBoundingClientRect();
      const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
      if (pointerX < margin.left || pointerX > width - margin.right) {
        tooltip.hidden = true;
        return;
      }
      const value = domainMin + ((pointerX - margin.left) / plotWidth) * (domainMax - domainMin);
      const rows = visible.map((model) => {
        const distribution = distributions[model];
        const index = Math.min(bins - 1, Math.max(0, Math.floor((value - domainMin) / distribution.width)));
        return `<span style="color:${modelMeta[model].color}">${modelMeta[model].label}</span>: <strong>${Math.round(distribution.counts[index] * 100)}</strong> of 100`;
      });
      tooltip.innerHTML = `<strong>${statisticMeta[statistic].short} ≈ ${format(value)}</strong><br>${rows.join("<br>")}`;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(bounds.width - 240, Math.max(8, event.clientX - bounds.left + 12))}px`;
      tooltip.style.top = `${Math.max(44, event.clientY - bounds.top - 48)}px`;
    };
    chart.onpointerleave = () => { tooltip.hidden = true; };

    const swapSummary = state.data.summaries.swaps[statistic];
    caption.innerHTML = `Reality sits <strong>${format(swapSummary.zScore, 1)} standard deviations</strong> above the degree-preserving null. None of the 100 swapped networks reached it, so the corrected one-sided p-value is <strong>${format(swapSummary.empiricalP, 4)}</strong>, not zero.`;
  }

  function bindControls() {
    document.querySelectorAll("[data-statistic]").forEach((button) => {
      button.addEventListener("click", () => {
        state.statistic = button.dataset.statistic;
        document.querySelectorAll("[data-statistic]").forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle("is-active", active);
          candidate.setAttribute("aria-pressed", String(active));
        });
        renderChart();
      });
    });

    document.querySelectorAll("[data-model]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) state.visibleModels.add(input.dataset.model);
        else state.visibleModels.delete(input.dataset.model);
        renderChart();
      });
    });
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function renderDamageChart() {
    const damageChart = document.querySelector("#damage-chart");
    if (!damageChart || !state.data) return;
    damageChart.replaceChildren(
      svgElement("title", { id: "damage-chart-title" }, "Average degree retained by top hubs after simplifying the configuration model"),
      svgElement("desc", { id: "damage-chart-desc" }, "Bars compare each hub's real degree with its average degree across 100 simplified configuration networks."),
    );

    const measuredWidth = Math.round(damageChart.getBoundingClientRect().width || 900);
    const width = Math.max(340, measuredWidth);
    const compact = width < 600;
    const height = 500;
    const margin = compact
      ? { left: 132, right: 48, top: 42, bottom: 48 }
      : { left: 220, right: 76, top: 42, bottom: 48 };
    damageChart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const plotWidth = width - margin.left - margin.right;
    const maxDegree = Math.ceil(Math.max(...state.data.hubDamage.map((row) => row.originalDegree)) / 20) * 20;
    const x = (value) => margin.left + (value / maxDegree) * plotWidth;
    const rowHeight = 49;

    for (let tick = 0; tick <= maxDegree; tick += 20) {
      const xPos = x(tick);
      damageChart.append(svgElement("line", {
        x1: xPos, y1: margin.top - 12, x2: xPos, y2: 446,
        stroke: "rgba(9,13,29,.13)", "stroke-width": 1,
      }));
      damageChart.append(svgElement("text", {
        x: xPos, y: 478, "text-anchor": "middle",
        fill: "#665f69", "font-family": "Trebuchet MS, sans-serif", "font-size": 16,
      }, String(tick)));
    }

    state.data.hubDamage.forEach((row, index) => {
      const y = margin.top + index * rowHeight;
      damageChart.append(svgElement("text", {
        x: margin.left - 14, y: y + 19, "text-anchor": "end",
        fill: "#090d1d", "font-family": "Trebuchet MS, sans-serif", "font-size": 16, "font-weight": 800,
      }, row.name.split(" (")[0]));
      damageChart.append(svgElement("rect", {
        x: margin.left, y, width: Math.max(1, x(row.originalDegree) - margin.left), height: 25,
        fill: "#141a35", stroke: "#090d1d", "stroke-width": 1,
      }));
      damageChart.append(svgElement("rect", {
        x: margin.left, y: y + 6, width: Math.max(1, x(row.configurationMeanDegree) - margin.left), height: 13,
        fill: "#53e7ff",
      }));
      damageChart.append(svgElement("text", {
        x: Math.min(width - 8, x(row.originalDegree) + 8), y: y + 19,
        fill: "#b02272", "font-family": "Trebuchet MS, sans-serif", "font-size": compact ? 16 : 14, "font-weight": 900,
      }, `−${format(row.meanDegreeLost, 1)}`));
    });

    const tableBody = document.querySelector("#hub-table-body");
    if (tableBody) {
      tableBody.replaceChildren();
      state.data.hubDamage.forEach((row) => {
        const tr = document.createElement("tr");
        [row.name, row.originalDegree, format(row.configurationMeanDegree, 1), format(row.meanDegreeLost, 1)].forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(td);
        });
        tableBody.append(tr);
      });
    }
  }

  function populateResults() {
    const real = state.data.real.averageClustering;
    const swaps = state.data.summaries.swaps.averageClustering;
    const configuration = state.data.summaries.configuration.averageClustering;
    const gnm = state.data.summaries.gnm.averageClustering;
    const lost = state.data.summaries.configuration.lostEdges;
    const spider = state.data.hubDamage[0];

    setText("#hero-real", format(real));
    setText("#metric-real", format(real));
    setText("#metric-swaps", format(swaps.mean));
    setText("#metric-z", format(swaps.zScore, 1));
    setText("#swaps-mean", format(swaps.mean));
    setText("#swaps-result", `z = ${format(swaps.zScore, 1)} · p = ${format(swaps.empiricalP, 4)}`);
    setText("#configuration-mean", format(configuration.mean));
    setText("#configuration-cost", `${format(lost.mean, 1)} links on average`);
    setText("#gnm-mean", format(gnm.mean));
    setText("#gnm-result", `z = ${format(gnm.zScore, 1)} · p = ${format(gnm.empiricalP, 4)}`);
    setText("#lost-links-title", format(lost.mean, 0));
    setText("#lost-links-mean", format(lost.mean, 1));
    setText("#lost-links-range", `${lost.min} to ${lost.max}`);
    setText("#spider-loss", format(spider.meanDegreeLost, 1));
    setText("#spider-retained", format(spider.configurationMeanDegree, 1));
    renderDamageChart();
  }

  function bindReadingProgress() {
    const pages = [...document.querySelectorAll(".case-page")];
    const links = [...document.querySelectorAll("[data-case-link]")];
    const progress = document.querySelector("#reading-progress");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    pages[0]?.classList.add("is-visible");
    document.documentElement.classList.add("reveal-ready");

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("is-visible");
      });
      const marker = window.innerHeight * .42;
      let nearest = 0;
      let distance = Number.POSITIVE_INFINITY;
      pages.forEach((page, index) => {
        const bounds = page.getBoundingClientRect();
        const nextDistance = marker < bounds.top ? bounds.top - marker : marker > bounds.bottom ? marker - bounds.bottom : 0;
        if (nextDistance < distance) {
          distance = nextDistance;
          nearest = index;
        }
      });
      links.forEach((link, index) => {
        if (index === nearest) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }, { threshold: [.12, .35], rootMargin: "-8% 0px -18%" });
    pages.forEach((page) => observer.observe(page));

    let frame = 0;
    const updateProgress = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 1;
      progress.style.transform = `scaleX(${ratio})`;
    };
    window.addEventListener("scroll", () => {
      if (!frame) frame = requestAnimationFrame(updateProgress);
    }, { passive: true });
    window.addEventListener("resize", updateProgress, { passive: true });
    updateProgress();

    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        if (reducedMotion.matches) return;
        const target = document.querySelector(link.getAttribute("href"));
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function bindResponsiveCharts() {
    let frame = 0;
    window.addEventListener("resize", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderChart();
        renderDamageChart();
      });
    }, { passive: true });
  }

  async function init() {
    bindControls();
    bindReadingProgress();
    bindResponsiveCharts();
    try {
      const response = await fetch("data/null_models.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      populateResults();
      renderChart();
    } catch (error) {
      caption.textContent = "The evidence file could not be loaded. Refresh the page to try again.";
      console.error(error);
    }
  }

  init();
})();
