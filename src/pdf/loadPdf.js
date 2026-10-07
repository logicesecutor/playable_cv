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

/** @param {File} file */
export async function loadPdfFile(file, opts) {
  const data = new Uint8Array(await file.arrayBuffer());
  return extractPdf(data, { pdfjs, createCanvas, Path2DBase: NativePath2D }, opts);
}
