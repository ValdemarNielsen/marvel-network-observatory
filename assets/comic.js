(() => {
  "use strict";

  const pages = [...document.querySelectorAll(".comic-page")];
  if (!pages.length) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const currentLabel = document.querySelector("#page-current");
  const totalLabel = document.querySelector("#page-total");
  const titleLabel = document.querySelector("#page-label");
  const progress = document.querySelector("#page-progress");
  const previousButton = document.querySelector("[data-page-prev]");
  const nextButton = document.querySelector("[data-page-next]");
  const panelSelector = [
    ".hero-copy",
    ".hero-orbit",
    ".metric-strip",
    ".story-copy",
    ".duel",
    ".section-heading",
    ".explorer-toolbar",
    ".explorer-aside",
    ".chart-reading",
    ".component-grid",
    ".isolate-drawer",
    ".takeaway-section > .eyebrow",
    ".takeaway-section > blockquote",
    ".takeaway-copy",
    ".method-grid",
    ".reconcile-note",
    ".source-row",
    ".archive-section > .eyebrow",
    ".archive-section > h2",
    ".week-track",
  ].join(",");

  pages.forEach((page) => {
    [...page.querySelectorAll(panelSelector)].forEach((panel, index) => {
      panel.classList.add("comic-panel");
      panel.style.setProperty("--panel-delay", `${Math.min(index, 4) * 55}ms`);
    });
  });

  totalLabel.textContent = String(pages.length).padStart(2, "0");
  let currentIndex = -1;

  function setCurrent(index) {
    if (index < 0 || index >= pages.length || index === currentIndex) return;
    currentIndex = index;
    pages.forEach((page, pageIndex) => {
      page.classList.toggle("is-current", pageIndex === index);
      page.classList.toggle("is-before", pageIndex < index);
      page.classList.toggle("is-after", pageIndex > index);
      if (pageIndex === index) page.setAttribute("aria-current", "page");
      else page.removeAttribute("aria-current");
    });

    currentLabel.textContent = String(index + 1).padStart(2, "0");
    titleLabel.textContent = pages[index].dataset.pageLabel || `Page ${index + 1}`;
    progress.style.transform = `scaleX(${(index + 1) / pages.length})`;
    previousButton.disabled = index === 0;
    nextButton.disabled = index === pages.length - 1;
  }

  function nearestPage() {
    const marker = window.innerHeight * 0.46;
    let nearest = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    pages.forEach((page, index) => {
      const bounds = page.getBoundingClientRect();
      const distance = marker < bounds.top ? bounds.top - marker : marker > bounds.bottom ? marker - bounds.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = index;
      }
    });
    return nearest;
  }

  setCurrent(nearestPage());
  document.documentElement.classList.add("comic-ready");

  let pageFrame = 0;
  function queuePageCheck() {
    if (pageFrame) return;
    pageFrame = requestAnimationFrame(() => {
      pageFrame = 0;
      setCurrent(nearestPage());
    });
  }
  window.addEventListener("scroll", queuePageCheck, { passive: true });
  window.addEventListener("resize", queuePageCheck, { passive: true });

  function goTo(index) {
    if (index < 0 || index >= pages.length) return;
    pages[index].scrollIntoView({
      block: "start",
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });
  }

  previousButton.addEventListener("click", () => goTo(currentIndex - 1));
  nextButton.addEventListener("click", () => goTo(currentIndex + 1));
})();
