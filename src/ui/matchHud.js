// MP5 HUD: the match bar ("first to 10", leader, your kills) and the end-of-match card
// (winner, final scores, awards, Rematch for the host).
import { AWARDS } from "../net/match.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export class MatchHud {
  constructor() {
    this.el = {
      bar: $("match-bar"),
      card: $("endcard"),
      title: $("ec-title"),
      sub: $("ec-sub"),
      body: $("ec-body"),
      awards: $("ec-awards"),
      rematch: $("ec-rematch"),
      wait: $("ec-wait"),
    };
    /** host clicked Rematch */
    this.onRematch = null;
    this._click = (e) => {
      e.stopPropagation();
      this.onRematch?.();
    };
    this.el.rematch.addEventListener("click", this._click);
    this._stop = (e) => e.stopPropagation(); // clicks on the card must not grab the mouse
    this.el.card.addEventListener("click", this._stop);
    this._last = "";
  }

  /**
   * @param {{target:number, leader:{name:string,color:string,kills:number}|null, you:number, round:number}} s
   */
  bar(s) {
    const key = JSON.stringify(s);
    if (key === this._last) return;
    this._last = key;
    this.el.bar.hidden = false;
    const lead = s.leader
      ? `<span class="mb-lead"><b style="color:${esc(s.leader.color)}">${esc(s.leader.name)}</b> ${s.leader.kills}</span>`
      : `<span class="mb-lead">no kills yet</span>`;
    this.el.bar.innerHTML = `<span class="mb-target">First to ${s.target}</span>${lead}<span class="mb-you">you ${s.you}</span>`;
  }

  /**
   * @param {object} r
   * @param {{id:number,name:string,color:string}} r.winner
   * @param {{id:number,name:string,color:string,kills:number,deaths:number,letters:number}[]} r.rows  in final order
   * @param {[string, number, number][]} r.awards
   * @param {(id:number) => {name:string,color:string}} r.info
   * @param {number} r.round
   * @param {number} r.target
   * @param {boolean} r.isHost
   * @param {string} r.hostName
   * @param {number} r.selfId
   */
  showEnd(r) {
    const e = this.el;
    e.card.hidden = false;
    const you = r.winner.id === r.selfId;
    e.title.innerHTML = you ? "You win!" : `<b style="color:${esc(r.winner.color)}">${esc(r.winner.name)}</b> wins`;
    e.sub.textContent = `Match ${r.round} · first to ${r.target} kills`;
    e.body.innerHTML = r.rows
      .map(
        (x, i) =>
          `<tr class="${x.id === r.selfId ? "me" : ""}"><td class="rank">${i + 1}</td><td class="dot" style="background:${esc(x.color)}"></td>` +
          `<td class="name">${esc(x.name)}</td><td class="num">${x.kills}</td><td class="num">${x.deaths}</td><td class="num">${x.letters}</td></tr>`,
      )
      .join("");
    e.awards.innerHTML = r.awards
      .map(([key, id, value]) => {
        const a = AWARDS.find((x) => x.key === key);
        if (!a) return "";
        const p = r.info(id);
        return `<div class="award"><span class="aw-title">${esc(a.title)}</span><b style="color:${esc(p.color)}">${esc(p.name)}</b><span class="aw-value">${value} ${esc(a.unit)}</span></div>`;
      })
      .join("");
    e.rematch.hidden = !r.isHost;
    e.rematch.disabled = false;
    e.wait.hidden = r.isHost;
    e.wait.textContent = `Waiting for ${r.hostName} to start a rematch…`;
  }

  hideEnd() {
    this.el.card.hidden = true;
  }

  dispose() {
    this.el.rematch.removeEventListener("click", this._click);
    this.el.card.removeEventListener("click", this._stop);
    this.hideEnd();
    this.el.bar.hidden = true;
    this._last = "";
  }
}
