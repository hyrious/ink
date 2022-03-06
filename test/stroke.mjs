import { mid } from "./common.mjs";

const W_BASE = 2;
const [start, control, end] = window.StrokeData;

const $ = document.getElementById(
  new URL(import.meta.url).searchParams.get("id")
);

function svg(tag = "svg") {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

const M = ({ x, y }) => `M${x},${y}`;
const L = ({ x, y }) => `L${x},${y}`;
const Q = (c, { x, y }) => `Q${c.x},${c.y} ${x},${y}`;
const C = (c1, c2, { x, y }) => `C${c1.x},${c1.y} ${c2.x},${c2.y} ${x} ${y}`;
const A = (r, f, { x, y }) => `A${r},${r} 0 ${f},0 ${x},${y}`;

function circle(p, a) {
  const e = svg("circle");
  e.setAttribute("cx", p.x);
  e.setAttribute("cy", p.y);
  e.setAttribute("r", p.w / W_BASE);
  for (const k in a) {
    e.setAttribute(k, a[k]);
  }
  $.append(e);
}

let a = { stroke: "red", fill: "none", "stroke-width": 1 };
circle(start, a);
circle({ ...control, w: 5 }, { ...a, stroke: "green" });
circle(end, a);

// B(t)  = (1-t)^2 p0 + 2(1-t)t p1 + t^2 p2
//       = p1 + (1-t)^2 (p0-p1) + t^2 (p2-p1)
// B'(t) = 2(1-t) (p1-p0) + 2t (p2-p1)
// B'(0) = 2 (p1-p0)
// B'(1) = 2 (p2-p1)

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function rot90(a) {
  return { x: -a.y, y: a.x };
}

function rot270(a) {
  return { x: a.y, y: -a.x };
}

function norm(a, m = 1) {
  let s = Math.hypot(a.x, a.y);
  return { x: (a.x * m) / s, y: (a.y * m) / s };
}

let d0 = sub(control, start);
let d1 = sub(end, control);
// B'(t)   = 2(1-t)(p1-p0) + 2t(p2-p1)
// B'(0.5) = p2-p0
let dc = sub(end, start);

let r0 = norm(rot90(d0), start.w / W_BASE);
let e00 = add(start, r0);
let e01 = sub(start, r0);

let r1 = norm(rot90(d1), end.w / W_BASE);
let e10 = add(end, r1); // same edge: e00
let e11 = sub(end, r1); // same edge: e01

let wavg = start.w + end.w / 2;
let rc = norm(rot90(dc), wavg / W_BASE);
let ec0 = add(control, rc); // same edge: e00
let ec1 = sub(control, rc); // same edge: e01

let all = [e00, e01, e10, e11, ec0, ec1];
let side = [e00, e10, ec0]; // which side is "inner"?

function square_length(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
let inner = true;
if (square_length(e00, e10) < square_length(e01, e11)) {
  console.log("inner");
  // make it more "inner"
  // ec0 = add(ec0, rc);
  // ec1 = control;
} else {
  console.log("outer");
  inner = false;
  // ec1 = sub(ec1, rc);
  // ec0 = control;
}

for (const p of side) {
  circle({ ...p, w: 3 }, { ...a, stroke: "orange" });
}

function path(d, a) {
  let e = svg("path");
  e.setAttribute("d", d.join(""));
  e.setAttribute("stroke-width", "1");
  e.setAttribute("stroke", "currentColor");
  e.setAttribute("fill", "none");
  for (const k in a) {
    e.setAttribute(k, a[k]);
  }
  return $.append(e);
}

path([M(e00), Q(ec0, e10)], { stroke: "orange" });
// path([M(e01), Q(ec1, e11)]);

circle({ ...e10, w: 3 }, { ...a, stroke: "currentColor" });
circle({ ...e11, w: 3 }, { ...a, stroke: "#0f0" });

let radius0 = Math.hypot(r0.x, r0.y);
let radius1 = Math.hypot(r1.x, r1.y);
// prettier-ignore
let result = path([
  // first curve, from e00 to e10
  M(e00), Q(ec0, e10),

  // line from e10 to e11
  // L(e11),

  // half circle from e10 to e11
  A(radius1, inner ? 0 : 1, e11),

  // second curve, from e11 to e01
  Q(ec1, e01),

  // half circle from e01 to e00
  A(radius0, inner ? 0 : 1, e00),
], {
  stroke: "none",
  fill: "rgba(127,127,127,0.5)",
});
