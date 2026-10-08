// MP4 HUD: health bar, damage flash + direction, killcam text, spawn protection, scoreboard (Tab),
// kill feed entries.
const $ = (id) => document.getElementById(id);

export class CombatHud {
  constructor() {
    this.el = {
      health: $("health"),
      fill: $("hp-fill"),
      value: $("hp-value"),
      prot: $("hp-prot"),
      damage: $("damage"),
      dir: $("dmg-dir"),
      killcam: $("killcam"),
      killer: $("kc-killer"),
      head: $("kc-head"),
      count: $("kc-count"),
      board: $("scoreboard"),
      body: $("sb-body"),
      feed: $("feed"),
    };
    this.flash = 0;
    this.dirT = 0;
    this.hp = -1;
  }

  show(on) {
    this.el.health.hidden = !on;
  }

  setHp(hp, max = 100) {
    const v = Math.max(0, Math.round(hp));
    if (v === this.hp) return;
    this.hp = v;
    this.el.value.textContent = String(v);
    this.el.fill.style.width = `${(v / max) * 100}%`;
    this.el.health.classList.toggle("low", v <= 30);
  }

  /**
   * @param {number} amount HP lost
   * @param {number|null} angle direction of the shooter relative to where we look (rad, 0 = ahead, + = left)
   */
  damage(amount, angle) {
    this.flash = Math.min(1, this.flash + 0.35 + amount / 60);
    if (angle !== null) {
      this.el.dir.style.transform = `translate(-50%, -50%) rotate(${(-angle * 180) / Math.PI}deg)`;
      this.dirT = 1.2;
    }
  }

  protection(on) {
    this.el.prot.hidden = !on;
  }

  /** dead: "Killed by X", countdown; null to hide */
  killcam(info) {
    this.el.killcam.hidden = !info;
    if (!info) return;
    this.el.killer.textContent = info.name;
    this.el.killer.style.color = info.color;
    this.el.head.textContent = info.head ? " · headshot" : "";
    this.el.count.textContent = String(Math.max(0, Math.ceil(info.left)));
  }

  /** a line in the kill feed: killer ▸ victim */
  killFeed(k, v, head, selfId) {
    const li = document.createElement("li");
    li.className = "kill";
    if (k.id === selfId || v.id === selfId) li.classList.add("me");
    const a = document.createElement("b");
    a.textContent = k.name;
    a.style.color = k.color;
    const mid = document.createElement("span");
    mid.className = "kf-icon";
    mid.textContent = head ? " ◎ " : " ▸ ";
    const b = document.createElement("b");
    b.textContent = v.name;
    b.style.color = v.color;
    li.append(a, mid, b);
    const feed = this.el.feed;
    feed.append(li);
    while (feed.children.length > 6) feed.firstElementChild.remove();
    setTimeout(() => li.classList.add("fade"), 6000);
    setTimeout(() => li.remove(), 6450);
  }

  /** @param {{id:number, name:string, color:string, kills:number, deaths:number, letters:number, ping:string, alive:boolean}[]} rows */
  scoreboard(rows, selfId) {
    if (!rows) {
      this.el.board.hidden = true;
      return;
    }
    this.el.board.hidden = false;
    this.el.body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement("tr");
        if (r.id === selfId) tr.className = "me";
        if (!r.alive) tr.classList.add("dead");
        const cells = [
          ["dot", ""],
          ["name", r.name],
          ["num", String(r.kills)],
          ["num", String(r.deaths)],
          ["num", String(r.letters)],
          ["num ping", r.ping],
        ];
        for (const [cls, text] of cells) {
          const td = document.createElement("td");
          td.className = cls;
          td.textContent = text;
          if (cls === "dot") td.style.background = r.color;
          tr.append(td);
        }
        return tr;
      }),
    );
  }

  update(dt) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 1.6);
      this.el.damage.style.opacity = String(this.flash);
    }
    if (this.dirT > 0) {
      this.dirT -= dt;
      this.el.dir.style.opacity = String(Math.max(0, Math.min(1, this.dirT)));
    }
  }

  reset() {
    this.flash = 0;
    this.dirT = 0;
    this.el.damage.style.opacity = "0";
    this.el.dir.style.opacity = "0";
    this.killcam(null);
    this.scoreboard(null);
    this.protection(false);
    this.show(false);
    this.hp = -1;
  }
}
