import { getStroke } from "https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.0/dist/esm/index.js";
import pc from "https://esm.sh/polygon-clipping@0.15.3";
import { input } from "./input.mjs";
import { mid } from "./common.mjs";

const { union } = pc;

const $ = document.getElementById(
  new URL(import.meta.url).searchParams.get("id"),
);

function svg(tag = "svg") {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

const average = (a, b) => (a + b) / 2;

function getSvgPathFromStroke(points, closed = true) {
  const len = points.length;

  if (len < 4) {
    return "";
  }

  let a = points[0];
  let b = points[1];
  let c = points[2];

  let d =
    `M${a[0].toFixed(2)},${a[1].toFixed(2)} ` +
    `Q${b[0].toFixed(2)},${b[1].toFixed(2)} ` +
    `${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} ` +
    `T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }

  if (closed) {
    d += "Z";
  }

  return d;
}

const surface = svg("path");
$.append(surface);
const all_strokes = [];

class Path {
  constructor(path) {
    this.path = path;
    this.points = [];
    this.defn = "";

    path.setAttribute("stroke-width", "0");
    path.setAttribute("fill", "currentColor");
  }
  remove() {
    this.path.remove();
  }
  update(x, y, p) {
    var a = new Array(3);
    a[0] = x;
    a[1] = y;
    a[2] = p;
    this.points.push(a);

    var stroke = getStroke(this.points, {
      size: 8,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
    });

    this.defn = getSvgPathFromStroke(stroke);
    this.path.setAttribute("d", this.defn);
  }
  finish() {
    var stroke = getStroke(this.points, {
      size: 8,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
    });
    all_strokes.push([stroke]);

    var d = [];
    union(...all_strokes).forEach((face) =>
      face.forEach((points) => {
        d.push(getSvgPathFromStroke(points));
      }),
    );

    surface.setAttribute("d", d.join(" "));

    this.remove();
  }
}

let path = null;

input($, {
  start() {
    path = new Path(svg("path"));
    $.append(path.path);
  },
  /** @param { PointerEvent } ev */
  update(ev) {
    const { offsetX: x, offsetY: y, pressure: p } = ev;
    path.update(x, y, p);
  },
  finish() {
    if (path && path.tail === 0) {
      path.remove();
    }
    path && path.finish();
    path = null;
  },
});
