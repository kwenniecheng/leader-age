/* =========================================================
   cover.js - parallax for the header layers.
   Independent of the chart: works even if the data fails to load.
   Each .cover__layer has data-speed: the layer is pushed down by
   scrollY * speed, so it lags behind the page (appears further away).
   ========================================================= */
(function () {
  "use strict";
  const cover = document.getElementById("cover");
  if (!cover) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layers = Array.from(cover.querySelectorAll(".cover__layer"))
    .map(el => ({ el, speed: parseFloat(el.dataset.speed) || 0 }))
    .filter(l => l.speed !== 0);
  if (!layers.length) return;

  let ticking = false, lastY = -1;

  function update() {
    ticking = false;
    // Stop moving once the cover has scrolled out of view
    const y = Math.min(window.scrollY || window.pageYOffset, cover.offsetHeight);
    if (y === lastY) return;
    lastY = y;
    layers.forEach(l => {
      l.el.style.transform = "translate3d(0," + (y * l.speed).toFixed(1) + "px,0)";
    });
  }

  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
})();
