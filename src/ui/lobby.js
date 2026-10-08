// Multiplayer UI: the join screen (guest), the invite box on the pause card (host),
// the player list and the notice feed in the HUD.
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ nickname, remembered per browser
const NAME_KEY = "playable-cv:name";
export function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}
export function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode: fine, just not remembered */
  }
}

/** room id from an invite link (`#join=pcv-…`), or null */
export function joinIdFromUrl(loc = location) {
  const m = /(?:^#|&)join=([a-z0-9-]+)/i.exec(loc.hash);
  return m ? m[1].toLowerCase() : null;
}

/** forget the invite in the address bar (keeps ?broker=… and friends) */
export function clearJoinFromUrl() {
  history.replaceState(null, "", location.pathname + location.search);
}

// ------------------------------------------------------------------ guest: join screen
export class JoinScreen {
  constructor() {
    this.form = $("join-form");
    this.name = $("join-name");
    this.button = $("join-button");
    this.status = $("join-status");
    this.statusText = $("join-status-text");
    this.bar = this.status.querySelector(".bar");
    this.progress = $("join-progress");
    this.error = $("join-error");
    /** @type {(name:string) => void} */
    this.onJoin = null;
    this.name.value = savedName();
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = this.name.value.trim() || "Player";
      saveName(name);
      this.onJoin?.(name);
    });
  }

  focus() {
    this.name.focus();
    this.name.select();
  }

  busy(on) {
    this.button.disabled = on;
    this.name.disabled = on;
    this.status.hidden = !on;
    if (on) this.error.hidden = true;
  }

  /** @param {number} [progress] 0..1, or undefined for an indeterminate bar */
  setStatus(text, progress) {
    this.statusText.textContent = text;
    const det = typeof progress === "number";
    this.bar.classList.toggle("indeterminate", !det);
    this.progress.style.width = det ? `${Math.round(progress * 100)}%` : "";
  }

  fail(message) {
    this.busy(false);
    this.error.textContent = message;
    this.error.hidden = false;
  }
}

// ------------------------------------------------------------------ host: invite box on the pause card
export class InvitePanel {
  constructor() {
    this.root = $("invite");
    this.start = $("invite-start");
    this.name = $("invite-name");
    this.button = $("invite-button");
    this.status = $("invite-status");
    this.ready = $("invite-ready");
    this.link = $("invite-link");
    this.copy = $("invite-copy");
    this.help = $("invite-help");
    /** @type {(name:string) => void} */
    this.onInvite = null;

    // the pause card captures the mouse on click: keep clicks in here for the controls
    this._stop = (e) => e.stopPropagation();
    this.root.addEventListener("click", this._stop);
    this._onInviteClick = () => {
      const name = this.name.value.trim() || "Host";
      saveName(name);
      this.onInvite?.(name);
    };
    this._onCopy = () => this.copyLink();
    this._onKey = (e) => {
      if (e.key === "Enter") this._onInviteClick();
    };
    this.button.addEventListener("click", this._onInviteClick);
    this.copy.addEventListener("click", this._onCopy);
    this.name.addEventListener("keydown", this._onKey);
    this.link.addEventListener("focus", () => this.link.select());
    this.reset();
  }

  reset() {
    this.name.value = savedName();
    this.start.hidden = false;
    this.button.disabled = false;
    this.name.disabled = false;
    this.ready.hidden = true;
    this.help.hidden = true;
    this.setStatus("");
  }

  setStatus(text, isError = false) {
    this.status.textContent = text;
    this.status.hidden = !text;
    this.status.classList.toggle("error", isError);
  }

  opening() {
    this.button.disabled = true;
    this.name.disabled = true;
    this.setStatus("Opening a room…");
  }

  failed(message) {
    this.button.disabled = false;
    this.name.disabled = false;
    this.setStatus(message, true);
  }

  /** room is open: show the link */
  showLink(url, { host, maxPlayers = 8 }) {
    this.start.hidden = true;
    this.ready.hidden = false;
    this.link.value = url;
    this.setStatus("");
    this.help.hidden = false;
    this.help.textContent = host
      ? isLocalUrl(url)
        ? "This link uses localhost, so it only works on this computer (handy for testing with a second tab). For friends, use the deployed site, or run `npm run dev -- --host` and share your LAN address."
        : `Send this link to up to ${maxPlayers - 1} friends. Keep this tab open: your browser is the server.`
      : "Anyone with this link can join the same game.";
  }

  async copyLink() {
    const url = this.link.value;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // http on a LAN address has no clipboard API: select it so Ctrl+C works
      this.link.focus();
      this.link.select();
      document.execCommand?.("copy");
    }
    this.copy.textContent = "Copied";
    clearTimeout(this._copyT);
    this._copyT = setTimeout(() => (this.copy.textContent = "Copy"), 1500);
  }

  dispose() {
    this.root.removeEventListener("click", this._stop);
    this.button.removeEventListener("click", this._onInviteClick);
    this.copy.removeEventListener("click", this._onCopy);
    this.name.removeEventListener("keydown", this._onKey);
    this.reset();
  }
}

function isLocalUrl(url) {
  const h = new URL(url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

// ------------------------------------------------------------------ HUD: players + notices
export class PlayersPanel {
  constructor() {
    this.el = $("players");
    this.visible = false;
  }

  /**
   * @param {import("../net/room.js").PlayerInfo[]} players
   * @param {number} selfId
   * @param {Map<number, number>} [kills] letters destroyed per player id
   */
  render(players, selfId, kills) {
    this.el.replaceChildren(
      ...players.map((p) => {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = p.color;
        const name = document.createElement("span");
        name.textContent = p.name;
        if (p.id === selfId) name.className = "you";
        const tag = document.createElement("span");
        tag.className = "tagline";
        if (p.state === "loading") tag.textContent = "joining…";
        else if (p.host) tag.textContent = "host";
        else if (typeof p.ping === "number" && p.ping > 0) {
          // round trip to the host
          tag.textContent = `${Math.round(p.ping)} ms`;
          tag.classList.add("ping");
          if (p.ping > 250) tag.classList.add("bad");
          else if (p.ping > 140) tag.classList.add("warn");
        }
        const n = kills?.get(p.id) || 0;
        const score = document.createElement("span");
        score.className = "score";
        score.title = "letters destroyed";
        score.textContent = n ? `${n} ${n === 1 ? "letter" : "letters"}` : "";
        li.append(dot, name, score, tag);
        return li;
      }),
    );
  }

  show(on) {
    this.visible = on;
    this.el.hidden = !on;
  }
}

export class Feed {
  constructor() {
    this.el = $("feed");
  }

  push(text, seconds = 5) {
    const li = document.createElement("li");
    li.textContent = text;
    this.el.append(li);
    while (this.el.children.length > 5) this.el.firstElementChild.remove();
    setTimeout(() => li.classList.add("fade"), seconds * 1000);
    setTimeout(() => li.remove(), seconds * 1000 + 450);
  }

  clear() {
    this.el.replaceChildren();
  }
}
