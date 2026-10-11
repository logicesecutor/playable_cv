// The front page (#upload-screen.landing in index.html, styles in landing.css):
// - theme switch: <html data-theme="paper|dark">; the first visit follows the device, the nav
//   button overrides it and is remembered in localStorage ("dyc-theme"). index.html sets the
//   attribute before first paint so there is no flash.
// - the stage: a sample CV extruded in CSS 3D (no WebGL, paints instantly). Click / tap a word: a
//   word slip flies in, the word shatters, a scorch and a REJECTED stamp stay on the paper.
// - the word-shot ticker, scroll reveals, the nav border, the example invite "Copy" button.
// main.js keeps the real upload flow (#dropzone, #file-input); this file only calls onSample().
import { WORDS, RARE_WORDS } from "../fx/wordShots.js";

const THEME_KEY = "dyc-theme";
const DEPTH = 7; // stacked layers per word on the stage
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** a random slip word, 1 in 8 rare (the game picks deterministically per shot, see pickWord) */
const pick = () => {
  const list = Math.random() < 1 / 8 ? RARE_WORDS : WORDS;
  return list[(Math.random() * list.length) | 0];
};

/**
 * @param {{ onSample?: () => void }} [o] onSample: "No CV handy? Use the sample" was clicked
 * @returns {{ setActive(on: boolean): void }} pause the stage demo while another screen shows
 */
export function initLanding({ onSample } = {}) {
  const page = document.getElementById("upload-screen");
  const $ = (id) => document.getElementById(id);
  const reduce = reduceMotion();
  let active = !page.hidden;

  initTheme($("lp-theme"), reduce);

  // nav: a hairline once the page scrolls; "Drop your CV" goes back to the hero and flashes the zone
  const nav = $("lp-nav");
  page.addEventListener("scroll", () => nav.classList.toggle("stuck", page.scrollTop > 8), { passive: true });
  $("lp-cta").addEventListener("click", () => {
    setTimeout(() => {
      const dz = $("dropzone");
      dz.classList.add("dragging");
      setTimeout(() => dz.classList.remove("dragging"), 700);
    }, 450);
  });
  $("lp-sample").addEventListener("click", () => onSample?.());
  $("lp-copy").addEventListener("click", (e) => {
    const b = e.currentTarget;
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy"), 1400);
  });

  // ticker: the in-game vocabulary, rare words reversed
  const seq = [];
  for (let k = 0; k < 14; k++) seq.push(k % 4 === 3 ? { w: RARE_WORDS[k % RARE_WORDS.length], rare: true } : { w: WORDS[k % WORDS.length] });
  $("lp-ticker").innerHTML = seq
    .concat(seq)
    .map((x) => `<li${x.rare ? ' class="rare"' : ""}><span class="lp-slip">${x.w}</span></li>`)
    .join("");

  // reveals
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
      { threshold: 0.15 },
    );
    page.querySelectorAll(".reveal").forEach((n) => io.observe(n));
  } else page.querySelectorAll(".reveal").forEach((n) => n.classList.add("in"));

  const stage = createStage($, reduce, () => active);
  // the demo shots start once the animated title has landed
  setTimeout(() => stage.startDemo(), 2600);

  return {
    setActive(on) {
      active = on;
    },
  };
}

function initTheme(button, reduce) {
  const root = document.documentElement;
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* private mode: follow the device */
  }
  const apply = (theme, animate) => {
    if (animate && !reduce) {
      root.classList.add("theming");
      setTimeout(() => root.classList.remove("theming"), 400);
    }
    root.dataset.theme = theme;
    // the browser chrome (mobile address bar) matches the page ground
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#09090b" : "#f3efe6");
    button.setAttribute("aria-label", theme === "dark" ? "Switch to bright theme" : "Switch to dark theme");
  };
  apply(saved || (mq?.matches ? "dark" : "paper"), false);
  mq?.addEventListener?.("change", (e) => !saved && apply(e.matches ? "dark" : "paper", true));
  button.addEventListener("click", () => {
    saved = root.dataset.theme === "dark" ? "paper" : "dark";
    try {
      localStorage.setItem(THEME_KEY, saved);
    } catch {
      /* not remembered, still switched */
    }
    apply(saved, true);
  });
}

// ------------------------------------------------------------------ the shootable CV
function createStage($, reduce, isActive) {
  const stage = $("lp-stage"), paper = $("lp-paper"), xhair = $("lp-xhair");
  // every word becomes DEPTH stacked copies (the extrusion) + a top face that takes the clicks
  for (const row of paper.querySelectorAll(".row")) {
    const words = row.textContent.trim().split(/\s+/);
    row.textContent = "";
    for (const w of words) {
      const s = document.createElement("span");
      s.className = "w";
      s.dataset.word = w;
      let html = `<span class="top" style="transform:translateZ(${DEPTH * 1.4 + 1}px)">${w}</span>`;
      for (let d = DEPTH; d >= 1; d--) {
        html += `<span class="lay" style="transform:translateZ(${d * 1.4}px);color:${d === DEPTH ? "#2b2b31" : "#0a0a0c"}">${w}</span>`;
      }
      s.innerHTML = html;
      row.appendChild(s);
    }
  }
  const words = [...paper.querySelectorAll(".w")];
  const total = words.length;
  let alive = total, ammo = 30, reloading = false, aiming = false, lastStamp = null, demo = null, demoShots = 0;

  const tilt = (px, py) => {
    paper.style.setProperty("--rx", `${(50 - py * 8).toFixed(2)}deg`);
    paper.style.setProperty("--rz", `${(-24 + px * 10).toFixed(2)}deg`);
  };
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    xhair.style.transform = `translate(${x}px, ${y}px)`;
    if (e.pointerType === "mouse") stage.classList.add("aim");
    aiming = true;
    if (!reduce) tilt(x / r.width - 0.5, y / r.height - 0.5);
  });
  stage.addEventListener("pointerleave", () => {
    stage.classList.remove("aim");
    aiming = false;
    tilt(0, 0);
  });
  stage.addEventListener("click", (e) => {
    if (e.target.closest("#lp-reset")) return;
    stopDemo();
    shoot(e.target.closest(".w"), e.clientX, e.clientY);
  });
  $("lp-reset").addEventListener("click", () => {
    for (const w of words) w.classList.remove("dead");
    paper.querySelectorAll(".lp-scorch, .lp-pstamp, .lp-shard").forEach((n) => n.remove());
    alive = total;
    lastStamp = null;
    $("lp-integ-v").textContent = "100.0%";
    setAmmo(30);
    $("lp-reset").hidden = true;
  });

  function setAmmo(n) {
    ammo = n;
    $("lp-ammo-v").textContent = n;
    $("lp-ammo").classList.toggle("low", n <= 5);
  }

  function shoot(target, cx, cy) {
    if (reloading) return;
    setAmmo(ammo - 1);
    if (ammo <= 0) {
      reloading = true;
      $("lp-ammo-v").textContent = "··";
      setTimeout(() => ((reloading = false), setAmmo(30)), 1100);
    }
    const r = stage.getBoundingClientRect();
    flySlip(cx - r.left, cy - r.top);
    xhair.classList.add("hit");
    setTimeout(() => xhair.classList.remove("hit"), 120);
    if (target) setTimeout(() => destroy(target), reduce ? 0 : 140);
  }

  function flySlip(tx, ty) {
    const s = document.createElement("span");
    s.className = "lp-slip lp-fly";
    s.textContent = pick();
    stage.appendChild(s);
    if (reduce || !s.animate) {
      s.style.transform = `translate(${tx}px, ${ty}px)`;
      setTimeout(() => s.remove(), 600);
      return;
    }
    const sx = stage.clientWidth * 0.82, sy = stage.clientHeight + 10, at = `translate(${tx - 20}px, ${ty - 14}px)`;
    s.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(.6) rotate(8deg)`, opacity: 1 },
        { transform: `${at} scale(1) rotate(-3deg)`, opacity: 1, offset: 0.25 },
        { transform: `${at} scale(1) rotate(-3deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${tx - 10}px, ${ty + 60}px) scale(.9) rotate(24deg)`, opacity: 0 },
      ],
      { duration: 1500, easing: "cubic-bezier(.2,.7,.3,1)" },
    ).onfinish = () => s.remove();
  }

  function destroy(w) {
    if (w.classList.contains("dead")) return;
    w.classList.add("dead");
    alive--;
    const ox = w.offsetLeft + w.parentNode.offsetLeft, oy = w.offsetTop + w.parentNode.offsetTop;
    const ww = w.offsetWidth, hh = w.offsetHeight, font = getComputedStyle(w).font;
    if (!reduce) {
      const letters = w.dataset.word.split("");
      letters.forEach((ch, i) => {
        const sh = document.createElement("span");
        sh.className = "lp-shard";
        sh.textContent = ch;
        sh.style.font = font;
        sh.style.left = `${ox + (ww / letters.length) * i}px`;
        sh.style.top = `${oy}px`;
        paper.appendChild(sh);
        const dx = (Math.random() - 0.5) * 120, dy = (Math.random() - 0.5) * 120, rz = (Math.random() - 0.5) * 720;
        sh.animate(
          [
            { transform: "translateZ(10px)", opacity: 1 },
            { transform: `translate3d(${dx}px, ${dy}px, ${90 + Math.random() * 120}px) rotateX(${rz}deg) rotateZ(${rz}deg)`, opacity: 0 },
          ],
          { duration: 900 + Math.random() * 400, easing: "cubic-bezier(.1,.6,.3,1)" },
        ).onfinish = () => sh.remove();
      });
    }
    const sc = document.createElement("span");
    sc.className = "lp-scorch";
    const pad = Math.max(ww, hh) * 0.35;
    Object.assign(sc.style, { left: `${ox - pad}px`, top: `${oy - pad / 2}px`, width: `${ww + pad * 2}px`, height: `${hh + pad}px` });
    paper.appendChild(sc);
    // REJECTED printed on the paper, at most one per area (like STAMP_GAP in the game)
    if (!lastStamp || Math.hypot(lastStamp[0] - ox, lastStamp[1] - oy) > 120) {
      lastStamp = [ox, oy];
      const st = document.createElement("span");
      st.className = "lp-stamp lp-pstamp slam";
      st.textContent = "Rejected";
      st.style.left = `${Math.min(ox - 10, 300)}px`;
      st.style.top = `${oy - 6}px`;
      paper.appendChild(st);
    }
    $("lp-integ-v").textContent = `${((alive / total) * 100).toFixed(1)}%`;
    const chip = $("lp-integ");
    chip.classList.add("bump");
    setTimeout(() => chip.classList.remove("bump"), 250);
    $("lp-hint").style.opacity = 0;
    $("lp-reset").hidden = false;
  }

  function startDemo() {
    if (reduce || demo) return;
    demo = setInterval(() => {
      if (aiming || demoShots >= 4 || document.hidden || !isActive()) return;
      const live = words.filter((w) => !w.classList.contains("dead") && !w.closest(".cv-name"));
      const w = live[(Math.random() * live.length) | 0];
      if (!w) return;
      const b = w.getBoundingClientRect(), r = stage.getBoundingClientRect();
      if (b.top < r.top || b.bottom > r.bottom) return;
      demoShots++;
      shoot(w, b.left + b.width / 2, b.top + b.height / 2);
    }, 1800);
  }
  function stopDemo() {
    clearInterval(demo);
    demo = -1; // never restart once the visitor has taken over
  }
  return { startDemo: () => demo === null && startDemo() };
}
