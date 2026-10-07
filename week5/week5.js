import autoAnimate from "./vendor/auto-animate.min.js";

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
const ns = "http://www.w3.org/2000/svg";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const number = new Intl.NumberFormat("en-US");
let data;
let selectedId = "Brian_Braddock";
let typed;
let dossierTyped;

function svg(tag, attributes = {}) { const element = document.createElementNS(ns, tag); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value)); return element; }
function logScale(value, min, max, start, end) { const t = (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min)); return start + t * (end - start); }
function byId(id) { return data.records.find((record) => record.id === id); }

function renderEvidence(record) {
  if (!record?.excerpt) return;
  selectedId = record.id;
  qs("#evidence-name").textContent = record.name;
  qs("#evidence-links").textContent = number.format(record.in_degree);
  qs("#evidence-words").textContent = number.format(record.words);
  qs("#evidence-predicted").textContent = number.format(record.predicted_words);
  qs("#evidence-link").href = record.url;
  qsa(".plot-dot").forEach((dot) => dot.classList.toggle("is-selected", dot.dataset.id === record.id));
  typed?.destroy();
  qs("#typed-evidence").textContent = reduced ? `“${record.excerpt}”` : "";
  if (!reduced && window.Typed) typed = new window.Typed("#typed-evidence", { strings: [`“${record.excerpt}”`], typeSpeed: 8, showCursor: true });
}

function setupScatter() {
  const chart = qs("#attention-scatter");
  const plot = { left: 72, right: 790, top: 34, bottom: 500 };
  [200,500,1000,2000,5000,10000].forEach((tick) => {
    const y = logScale(tick, 180, 16000, plot.bottom, plot.top);
    chart.append(svg("line", { x1:plot.left, x2:plot.right, y1:y, y2:y, class:"plot-grid" }));
    const label = svg("text", { x:plot.left - 10, y:y + 4, "text-anchor":"end", class:"plot-label" }); label.textContent = tick >= 1000 ? `${tick/1000}k` : tick; chart.append(label);
  });
  [0,1,3,10,30,100].forEach((tick) => {
    const x = logScale(tick + 1, 1, 120, plot.left, plot.right);
    chart.append(svg("line", { x1:x, x2:x, y1:plot.top, y2:plot.bottom, class:"plot-grid" }));
    const label = svg("text", { x, y:plot.bottom + 22, "text-anchor":"middle", class:"plot-label" }); label.textContent = tick; chart.append(label);
  });
  chart.append(svg("line",{x1:plot.left,x2:plot.right,y1:plot.bottom,y2:plot.bottom,class:"plot-axis"}));
  chart.append(svg("line",{x1:plot.left,x2:plot.left,y1:plot.top,y2:plot.bottom,class:"plot-axis"}));

  const regression = svg("path", { class:"plot-regression" });
  let d = "";
  for (let degree=0; degree<=106; degree+=2) {
    const predicted = Math.exp(data.model.intercept + data.model.slope * Math.log1p(degree));
    const x = logScale(degree + 1, 1, 120, plot.left, plot.right);
    const y = logScale(predicted, 180, 16000, plot.bottom, plot.top);
    d += `${degree ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  regression.setAttribute("d", d); chart.append(regression);

  const group = svg("g", { id:"scatter-points" }); chart.append(group);
  data.records.forEach((record) => {
    const x = logScale(record.in_degree + 1, 1, 120, plot.left, plot.right);
    const y = logScale(record.words, 180, 16000, plot.bottom, plot.top);
    record._x = x; record._y = y;
    const circle = svg("circle", { cx:x, cy:y, r:record.id === "Spider-Man" ? 7 : 4.4, fill:record.attention_z >= 0 ? "#ff4d00" : "#0b2ee9", class:"plot-dot", "data-id":record.id, opacity:.75 });
    circle.addEventListener("click", () => renderEvidence(record));
    circle.addEventListener("pointerenter", (event) => showTooltip(event, record));
    circle.addEventListener("pointermove", (event) => showTooltip(event, record));
    circle.addEventListener("pointerleave", hideTooltip);
    group.append(circle);
  });

  function animateDots() {
    const dots = qsa(".plot-dot");
    if (reduced || !window.Motion) return;
    dots.forEach((dot, index) => window.Motion.animate(dot, { opacity:[0,.75], r:[0,Number(dot.getAttribute("r"))] }, { delay:index*.002, duration:.5, easing:"ease-out" }));
    window.Motion.animate(regression, { pathLength:[0,1] }, { duration:1.2, delay:.25 });
  }
  qs("#replay-scatter").addEventListener("click", animateDots);
  qsa("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    qsa("[data-filter]").forEach((item) => { const active=item===button; item.classList.toggle("is-active",active); item.setAttribute("aria-pressed",String(active)); });
    qsa(".plot-dot").forEach((dot) => {
      const record = byId(dot.dataset.id);
      const visible = filter === "all" || (filter === "over" ? record.attention_z >= 1 : record.attention_z <= -1);
      if (window.Motion && !reduced) window.Motion.animate(dot, { opacity: visible ? .82 : .06, r: visible ? Number(dot.getAttribute("r")) : 2 }, { duration:.45 });
      else dot.style.opacity = visible ? .82 : .06;
    });
  }));
  animateDots();
}

function setupDossiers() {
  const list = qs("#dossier-list");
  autoAnimate(list, { duration: 420, easing: "cubic-bezier(.16,1,.3,1)" });
  let mode = "overwritten";
  let active = data[mode][0];

  function show(record) {
    active = record;
    qsa(".dossier-item", list).forEach((button) => button.classList.toggle("is-active", button.dataset.id === record.id));
    qs("#file-code").textContent = `FILE ${String(data[mode].indexOf(record) + 1).padStart(3,"0")} · ${mode === "overwritten" ? "ATTENTION SURPLUS" : "ATTENTION DEFICIT"}`;
    qs("#file-name").textContent = record.name;
    qs("#file-actual").textContent = `${number.format(record.words)} words`;
    qs("#file-expected").textContent = `${number.format(record.predicted_words)} expected`;
    const ratio = record.words / record.predicted_words;
    qs("#file-verdict").textContent = mode === "overwritten"
      ? `${ratio.toFixed(1)} times the model's expectation with ${number.format(record.in_degree)} incoming network link${record.in_degree === 1 ? "" : "s"}.`
      : `Only ${(ratio * 100).toFixed(0)}% of the model's expectation despite ${number.format(record.in_degree)} incoming network links.`;
    qs("#word-clippings").innerHTML = record.top_words.map((word) => `<span>${word}</span>`).join("");
    qs("#file-link").href = record.url;
    dossierTyped?.destroy();
    qs("#dossier-excerpt").textContent = reduced ? `“${record.excerpt}”` : "";
    if (!reduced && window.Typed) dossierTyped = new window.Typed("#dossier-excerpt", { strings:[`“${record.excerpt}”`], typeSpeed:7, showCursor:false });
  }

  function render() {
    list.innerHTML = data[mode].slice(0,8).map((record,index) => `<button type="button" class="dossier-item${record.id === active.id ? " is-active" : ""}" data-id="${record.id}"><span>${String(index+1).padStart(2,"0")}</span><strong>${record.name}</strong><small>${number.format(record.in_degree)} links · ${number.format(record.words)} words</small><b>${record.attention_z > 0 ? "+" : ""}${record.attention_z.toFixed(2)} z</b></button>`).join("");
    qsa(".dossier-item",list).forEach((button)=>button.addEventListener("click",()=>show(data[mode].find((record)=>record.id===button.dataset.id))));
    show(active);
  }
  qsa("[data-dossier]").forEach((button)=>button.addEventListener("click",()=>{
    mode=button.dataset.dossier; active=data[mode][0];
    qsa("[data-dossier]").forEach((item)=>{const on=item===button;item.classList.toggle("is-active",on);item.setAttribute("aria-pressed",String(on));});
    render();
  }));
  render();
}

function interpolateCurve(curve, pages) {
  if (pages <= curve[0].pages) return curve[0].vocabulary;
  for (let i=1;i<curve.length;i++) {
    if (pages <= curve[i].pages) {
      const previous=curve[i-1], next=curve[i], t=(pages-previous.pages)/(next.pages-previous.pages);
      return Math.round(previous.vocabulary+(next.vocabulary-previous.vocabulary)*t);
    }
  }
  return curve[curve.length-1].vocabulary;
}

function setupRace() {
  const chart=qs("#race-chart"), left=58,right=790,top=28,bottom=370,maxY=28000;
  [0,5000,10000,15000,20000,25000].forEach((tick)=>{const y=bottom-(tick/maxY)*(bottom-top);chart.append(svg("line",{x1:left,x2:right,y1:y,y2:y,stroke:"rgba(255,255,255,.16)"}));const label=svg("text",{x:left-8,y:y+4,"text-anchor":"end",fill:"#bbc2ff","font-size":"12"});label.textContent=tick?`${tick/1000}k`:"0";chart.append(label)});
  [1,50,100,150,200,250,303].forEach((tick)=>{const x=left+(tick-1)/302*(right-left);const label=svg("text",{x,y:bottom+22,"text-anchor":"middle",fill:"#bbc2ff","font-size":"12"});label.textContent=tick;chart.append(label)});
  const makePath=(curve,color,id)=>{const d=curve.map((point,index)=>`${index?"L":"M"}${(left+(point.pages-1)/302*(right-left)).toFixed(1)},${(bottom-(point.vocabulary/maxY)*(bottom-top)).toFixed(1)}`).join("");const path=svg("path",{d,id,fill:"none",stroke:color,"stroke-width":"5","stroke-linecap":"round","stroke-linejoin":"round"});chart.append(path);return path};
  const famousPath=makePath(data.growth.famous_first,"#eaff00","famous-path"),minorPath=makePath(data.growth.minor_first,"#ff4d9d","minor-path");
  const famousDot=svg("circle",{r:8,fill:"#eaff00",stroke:"#101010","stroke-width":"2"}),minorDot=svg("circle",{r:8,fill:"#ff4d9d",stroke:"#101010","stroke-width":"2"});chart.append(famousDot,minorDot);
  const range=qs("#race-range");
  let raceTimer;
  function update(pages){pages=Math.round(pages);range.value=pages;const famous=interpolateCurve(data.growth.famous_first,pages),minor=interpolateCurve(data.growth.minor_first,pages);qs("#race-pages").textContent=pages;qs("#race-famous").textContent=number.format(famous);qs("#race-minor").textContent=number.format(minor);qs("#race-output").textContent=`${pages} / 303`;qs("#race-gap").textContent=pages===303?"Both orders finish with exactly the same 26,959 types.":`The famous-first corpus has ${(famous/minor).toFixed(1)}× as many types at this point.`;const x=left+(pages-1)/302*(right-left);famousDot.setAttribute("cx",x);famousDot.setAttribute("cy",bottom-(famous/maxY)*(bottom-top));minorDot.setAttribute("cx",x);minorDot.setAttribute("cy",bottom-(minor/maxY)*(bottom-top));}
  range.addEventListener("input",()=>update(Number(range.value)));
  qs("#play-race").addEventListener("click",()=>{
    if(reduced){update(303);return}
    clearInterval(raceTimer);
    const started=performance.now();
    const advance=(now)=>{
      const progress=Math.min(1,(now-started)/4000);
      const eased=progress<.5?2*progress*progress:1-Math.pow(-2*progress+2,2)/2;
      update(1+302*eased);
      if(progress===1)clearInterval(raceTimer);
    };
    update(1);
    raceTimer=setInterval(()=>advance(performance.now()),40);
    window.Motion?.animate([famousPath,minorPath],{pathLength:[0,1]},{duration:4,ease:"ease-in-out"});
  });
  update(50);
}

function setupPageMotion(){
  if(!reduced)document.body.classList.add("motion-ready");
  const observer=new IntersectionObserver((entries)=>entries.forEach((entry)=>{if(entry.isIntersecting){entry.target.style.opacity="1";entry.target.style.transform="none";if(window.Motion&&!reduced)window.Motion.animate(entry.target,{opacity:[0,1],y:[28,0]},{duration:.75,ease:"ease-out"});observer.unobserve(entry.target)}}),{threshold:.12});qsa(".reveal").forEach((element)=>observer.observe(element));
  const links=qsa(".reader-nav a"),sections=links.map((link)=>qs(link.getAttribute("href")));function update(){const progress=Math.min(1,scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight));qs("#reader-progress").style.transform=`scaleX(${progress})`;let active=0;sections.forEach((section,index)=>{if(section.getBoundingClientRect().top<innerHeight*.4)active=index});links.forEach((link,index)=>link.setAttribute("aria-current",String(index===active)))}addEventListener("scroll",update,{passive:true});update();
}

function showTooltip(event, record) {
  const wrap = qs(".scatter-wrap"); const rect = wrap.getBoundingClientRect(); const tooltip = qs("#plot-tooltip"); const crosshair = qs("#plot-crosshair");
  tooltip.hidden=false; crosshair.hidden=false;
  tooltip.innerHTML=`<strong>${record.name}</strong><span>${number.format(record.in_degree)} incoming links · ${number.format(record.words)} words<br>${record.attention_z >= 0 ? "+" : ""}${record.attention_z.toFixed(2)} attention z-score</span>`;
  tooltip.style.left=`${Math.min(rect.width-220,Math.max(8,event.clientX-rect.left+12))}px`; tooltip.style.top=`${Math.min(rect.height-78,Math.max(8,event.clientY-rect.top+12))}px`;
  qs("i",crosshair).style.left=`${event.clientX-rect.left}px`; qs("b",crosshair).style.top=`${event.clientY-rect.top}px`;
}
function hideTooltip(){qs("#plot-tooltip").hidden=true;qs("#plot-crosshair").hidden=true;}

async function init(){
  const response=await fetch("data/attention_desk.json"); if(!response.ok)throw new Error(`Week 5 data failed: ${response.status}`); data=await response.json();
  setupScatter(); renderEvidence(data.overwritten[0]); setupDossiers(); setupRace(); setupPageMotion();
  if(window.Motion&&!reduced){window.Motion.animate(".issue-intro > *",{opacity:[0,1],y:[24,0]},{delay:window.Motion.stagger(.07),duration:.7});window.Motion.animate(".scatter-card",{opacity:[0,1],x:[35,0],rotate:[1.2,0]},{duration:.9});}
}
init().catch((error)=>{console.error(error);qs(".scatter-wrap").innerHTML="<p style='padding:2rem'>The evidence file could not be loaded.</p>";});
