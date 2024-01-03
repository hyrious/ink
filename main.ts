import { Stroke } from './src/ink'
import { type Vec } from './src/vec'

let $root = document.getElementById('app')!
let $svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
let $g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
let $settings = {
  size: document.getElementById('stroke-size') as HTMLInputElement,
}

$svg.append($g)
$root.append($svg)

let rect: DOMRect

$g.setAttribute('fill', 'currentColor')
// $g.setAttribute('fill', 'none')
// $g.setAttribute('stroke', 'currentColor')
// $g.setAttribute('stroke-width', '1')

$svg.setAttribute('fill-rule', 'nonzero')
$svg.style.cssText = 'display: block; width: 100%; height: 100%; font-size: 0; touch-action: none; position: relative'

let scheduled = false
let strokes = { __proto__: null } as { [id: number]: [s: Stroke, p: SVGPathElement, x: number, y: number, pred?: PointerEvent | null] }
let dirty = { __proto__: null } as { [id: number]: true }

$svg.onpointerdown = (ev) => {
  ev.preventDefault()
  ev.stopPropagation()
  $svg.setPointerCapture(ev.pointerId)
  rect = $svg.getBoundingClientRect()
  let stroke = Stroke.create([{ x: ev.clientX - rect.left, y: ev.clientY - rect.top, r: ev.pressure }])
  let $path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  $path.style.pointerEvents = 'none'
  strokes[ev.pointerId] = [stroke, $path, ev.clientX, ev.clientY]
  dirty[ev.pointerId] = true
  $g.append($path)
  if (scheduled) return;
  scheduled = true
  queueMicrotask(render)
}

$svg.onpointermove = (ev) => {
  ev.preventDefault()
  ev.stopPropagation()
  if (strokes[ev.pointerId]) {
    let [stroke, _path, x_, y_] = strokes[ev.pointerId]

    // Apple pencil's bug, it fires 2 identical events
    if (x_ == ev.clientX && y_ == ev.clientY) return;
    strokes[ev.pointerId][2] = ev.clientX
    strokes[ev.pointerId][3] = ev.clientY

    // @ts-ignore
    if (ev.getCoalescedEvents) ev.getCoalescedEvents().forEach(e => {
      stroke.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, r: e.pressure })
    })
    else {
      stroke.push({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, r: ev.pressure })
    }
    dirty[ev.pointerId] = true

    // @ts-ignore
    if (ev.getPredictedEvents) {
      strokes[ev.pointerId][4] = ev.getPredictedEvents()[0]
    }

    if (scheduled) return;
    scheduled = true
    queueMicrotask(render)
  }
}

$svg.onpointercancel = (ev) => {
  ev.preventDefault()
  ev.stopPropagation()
  if (strokes[ev.pointerId]) {
    strokes[ev.pointerId][1].remove()
    delete strokes[ev.pointerId]
  }
}

$svg.onpointerup = $svg.onpointerout = (ev) => {
  ev.preventDefault()
  ev.stopPropagation()
  if (strokes[ev.pointerId]) {
    let [stroke, $path, x_, y_, e] = strokes[ev.pointerId]
    if (e && (e.clientX != x_ || e.clientY != y_)) {
      stroke.push({
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top),
        r: e.pressure,
      })
      dirty[e.pointerId] = true
      render()
    }
    else if (stroke.dot || stroke.empty) {
      $path.remove()
    }
    console.log(stroke)
    delete strokes[ev.pointerId]
  }
}

$svg.ontouchstart = $svg.ontouchmove = $svg.ontouchend = $svg.ontouchcancel = (ev) => {
  ev.preventDefault()
  ev.stopPropagation()
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const M = ({ x, y }) => `M${x.toFixed(2)},${y.toFixed(2)}`;
const L = ({ x, y }) => `L${x.toFixed(2)},${y.toFixed(2)}`;
const Q = (c, { x, y }) => `Q${c.x.toFixed(2)},${c.y.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`;

function render() {
  scheduled = false
  let size = $settings.size.valueAsNumber
  for (let id in dirty) if (strokes[id]) {
    let [stroke, $path] = strokes[id], d = ''
    for (let index of stroke.sections) {
      d += simple_bezier(stroke.outline(index, size))
    }
    $path.setAttribute('d', d)
  }
  dirty = { __proto__: null } as typeof dirty
}

function simple_bezier(points: Vec[]) {
  if (points.length == 0) return '';
  let prev = points.shift()!, d = M(prev), i = 1;
  for (let curr of points) {
    if (i) d += L(mid(prev, curr))
    d += Q(prev, mid(prev, curr))
    i = 0
    prev = curr
  }
  return d + L(points[points.length - 1])
}
