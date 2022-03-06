import { input } from "./input.mjs";
import { mid } from "./common.mjs";

const $ = document.getElementById(
  new URL(import.meta.url).searchParams.get("id")
);

$.width = $.scrollWidth;
$.height = $.scrollHeight;

function h(tag) {
  return document.createElement(tag);
}

const temp = h("canvas");
temp.width = $.width;
temp.height = $.height;
const temp_ctx = temp.getContext("2d");

class Path {
  constructor(ctx) {
    this.ctx = ctx;
    // save current canvas to temp, but hey you could do this at any time
    temp_ctx.clearRect(0, 0, temp.width, temp.height);
    temp_ctx.drawImage(ctx.canvas, 0, 0);
    this.points = [];
  }
  remove() {
    this.ctx = null;
    this.points = null;
  }
  update(point) {
    this.points.push(point);
    if (this.points.length >= 2) {
      const points = this.points;
      ctx.clearRect(0, 0, temp.width, temp.height);
      ctx.drawImage(temp, 0, 0);
      // NOTE: can also use Path2D(), which turns out the same code as svg
      //       then, we can have ctx.isPointInPath(path2d, x, y) to be able
      //       to click on it
      ctx.beginPath();
      const last = points.length - 1;
      ctx.moveTo(points[0].x, points[0].y);
      let mid_point = mid(points[0], points[1]);
      ctx.lineTo(mid_point.x, mid_point.y);
      for (let i = 1; i < last; ++i) {
        let mid_point = mid(points[i], points[i + 1]);
        ctx.quadraticCurveTo(
          points[i].x,
          points[i].y,
          mid_point.x,
          mid_point.y
        );
      }
      ctx.lineTo(points[last].x, points[last].y);
      ctx.stroke();
    }
  }
}

let path = null;
let ctx = $.getContext("2d");
ctx.strokeStyle = matchMedia("(prefers-color-scheme: dark)").matches
  ? "#fff"
  : "#000";
ctx.lineWidth = 2;

input($, {
  start() {
    path = new Path(ctx);
  },
  /** @param { PointerEvent } ev */
  update(ev) {
    const { offsetX: x, offsetY: y } = ev;
    path.update({ x, y });
  },
  finish() {
    path.remove();
    path = null;
  },
});

// Advantages:
// generally less cpu usage (no need to do math work)
// can create lots of weird brushes through custom drawing code

// Disadvantanges:
// do the math work by yourself, which may be slower than native svg
// can be very hard to optimize performance,
// we need some assumptions to reduce our works, like:
// - strokes doesn't have to be separated to move one of it up/down
