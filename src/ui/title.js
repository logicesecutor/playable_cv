// The game's title, "Destroy Your Career": "Destroy Your" types itself out in typewriter type,
// then a red rubber stamp CAREER slams down (the same stamp look as the in-game REJECTED /
// FIRED!). Any element with class "game-title" gets it:
//   data-animate   typed + stamped when its screen is shown (first page, join screen)
//   class "small"  static, small (loading screen, end-of-match card)
// Elements with data-version get "{version}" replaced by the package.json version (vite define).
export const GAME_TITLE = "Destroy Your Career";
// eslint-disable-next-line no-undef
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const TYPED = "Destroy Your";
const STAMP = "Career";
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** fill every title and version tag in the page (once, at start) */
export function initTitles(root = document) {
  for (const el of root.querySelectorAll(".game-title")) build(el);
  for (const el of root.querySelectorAll("[data-version]")) el.textContent = el.textContent.replace("{version}", `v${APP_VERSION}`);
  document.title = GAME_TITLE;
}

function build(el) {
  if (el.dataset.ready) return;
  el.dataset.ready = "1";
  el.setAttribute("aria-label", GAME_TITLE);
  el.innerHTML =
    '<span class="gt-line" aria-hidden="true"><span class="gt-typed"></span><span class="gt-cursor"></span></span>' +
    `<span class="gt-stamp" aria-hidden="true">${STAMP}</span>`;
  if (!el.hasAttribute("data-animate")) finish(el);
}

/** show the final state right away */
function finish(el) {
  el.querySelector(".gt-typed").textContent = TYPED;
  el.classList.add("typed", "stamped", "done");
}

/** play the animated titles inside a screen that was just shown (each one plays once) */
export function playTitles(container) {
  for (const el of container?.querySelectorAll(".game-title[data-animate]") || []) {
    if (el.dataset.played) continue;
    el.dataset.played = "1";
    if (reduceMotion()) {
      finish(el);
      continue;
    }
    typeIn(el);
  }
}

function typeIn(el) {
  const typed = el.querySelector(".gt-typed");
  typed.textContent = "";
  let i = 0;
  const next = () => {
    if (i < TYPED.length) {
      typed.textContent = TYPED.slice(0, ++i);
      // typists aren't metronomes: a little jitter, a longer pause on the space
      setTimeout(next, TYPED[i - 1] === " " ? 160 : 55 + Math.random() * 70);
      return;
    }
    el.classList.add("typed");
    setTimeout(() => {
      el.classList.add("stamped"); // CSS: the stamp drops in and lands with a thud
      el.closest(".upload-card")?.classList.add("thud");
      setTimeout(() => el.classList.add("done"), 900);
    }, 260);
  };
  setTimeout(next, 250);
}
