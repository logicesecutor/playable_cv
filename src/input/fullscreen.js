// Touch devices: go fullscreen and lock the screen to landscape when the player taps Play.
//
// Must run inside the tap's event handler (browsers only allow fullscreen from a user gesture).
// Android Chrome supports both; iPad Safari supports fullscreen (webkit prefix) but not the
// orientation lock; iPhone Safari supports neither, so there the "turn your phone" card
// (style.css #rotate) and the browser's own landscape mode have to do.

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/** best effort: never throws, resolves whether or not the browser agreed */
export async function enterLandscapeFullscreen() {
  const el = document.documentElement;
  try {
    if (!isFullscreen()) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } catch {
    // refused (iframe, browser setting): play in the page as it is
  }
  try {
    await screen.orientation?.lock?.("landscape");
  } catch {
    // not supported / not fullscreen: the portrait card covers it
  }
}

/** calls fn(isFullscreen) whenever fullscreen starts or ends; returns an unsubscribe function */
export function onFullscreenChange(fn) {
  const h = () => fn(isFullscreen());
  document.addEventListener("fullscreenchange", h);
  document.addEventListener("webkitfullscreenchange", h);
  return () => {
    document.removeEventListener("fullscreenchange", h);
    document.removeEventListener("webkitfullscreenchange", h);
  };
}
