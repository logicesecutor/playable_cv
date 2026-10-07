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

  /** @param {number} x @param {number} z world position @param {number} yaw radians (0 = facing -Z) */
  draw(x, z, yaw) {
    const { ctx, canvas } = this;
    const sx = canvas.width / this.size.W;
    const sz = canvas.height / this.size.D;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.raster, 0, 0, canvas.width, canvas.height);

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
