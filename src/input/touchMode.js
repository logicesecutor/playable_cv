// Decides once, at page load, whether this is a touch device (phone / tablet) that gets the
// on-screen controls instead of mouse + keyboard.
//
// A device is "touch" when its *primary* pointer is a finger: `(pointer: coarse)`, or it can't
// hover and has a touch screen. A laptop with a touch screen keeps the desktop controls (its
// primary pointer is the touchpad).
//
// Developer override: `?touch=1` forces touch mode (handy with the browser's device emulation),
// `?touch=0` forces the desktop controls on a phone.

/** @returns {boolean} */
export function detectTouch() {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced === "1") return true;
  if (forced === "0") return false;
  const mq = (q) => typeof matchMedia === "function" && matchMedia(q).matches;
  return mq("(pointer: coarse)") || (navigator.maxTouchPoints > 0 && mq("(hover: none)"));
}

export const touchMode = detectTouch();

// CSS hook: `html.touch …` styles the touch layout (style.css)
document.documentElement.classList.toggle("touch", touchMode);
