// Browser entry for the extractor: wires pdf.js + its worker + DOM canvases.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { extractPdf } from "./extract.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// grab the native class before the extractor temporarily swaps the global
const NativePath2D = globalThis.Path2D;

function createCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Read a picked / dropped file. The raw bytes are kept on the result (`bytes`) for multiplayer. */
export async function loadPdfFile(file, opts) {
  return loadPdfBytes(new Uint8Array(await file.arrayBuffer()), opts);
}

/**
 * @param {Uint8Array} bytes PDF file contents (not modified)
 */
export async function loadPdfBytes(bytes, opts) {
  // pdf.js hands its input buffer over to the worker (it becomes unusable here), so give it a copy
  const pdf = await extractPdf(bytes.slice(), { pdfjs, createCanvas, Path2DBase: NativePath2D }, opts);
  pdf.bytes = bytes;
  return pdf;
}
