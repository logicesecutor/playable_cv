// The original page as a minimap, with the player as an arrow + view cone.
export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLCanvasElement} raster  page as rendered by pdf.js
   * @param {{W:number, D:number}} size world size in metres
   */
  constructor(canvas, raster, size) {
    this.canvas = canvas;
    this.raster = raster;
    this.size = size;
    const w = 220;
    canvas.width = w * devicePixelRatio;
    canvas.height = Math.round((w * size.D) / size.W) * devicePixelRatio;
    canvas.style.aspectRatio = `${size.W} / ${size.D}`;
    this.ctx = canvas.getContext("2d");
  }

  /**
   * @param {number} x @param {number} z world position @param {number} yaw radians (0 = facing -Z)
   * @param {{x:number, z:number, yaw:number, color:string}[]} [others] other players you can see
   */
  draw(x, z, yaw, others = []) {
    const { ctx, canvas } = this;
    const sx = canvas.width / this.size.W;
    const sz = canvas.height / this.size.D;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.raster, 0, 0, canvas.width, canvas.height);

    // other players: a dot in their colour with a short facing tick
    const dpr = devicePixelRatio;
    for (const o of others) {
      const ox = o.x * sx, oz = o.z * sz;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(ox, oz);
      ctx.lineTo(ox - Math.sin(o.yaw) * 9 * dpr, oz - Math.cos(o.yaw) * 9 * dpr);
      ctx.stroke();
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(ox, oz, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }

    const px = x * sx, pz = z * sz;
    const r = 7 * devicePixelRatio;
    ctx.translate(px, pz);
    ctx.rotate(-yaw);
    // view cone
    const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 6);
    cone.addColorStop(0, "rgba(255,90,54,0.45)");
    cone.addColorStop(1, "rgba(255,90,54,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 6, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
    ctx.closePath();
    ctx.fill();
    // arrow
    ctx.fillStyle = "#ff5a36";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.75, r * 0.8);
    ctx.lineTo(0, r * 0.35);
    ctx.lineTo(-r * 0.75, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
