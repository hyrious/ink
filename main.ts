import { Stroke, type Vec } from './src/ink'

let $root = document.getElementById('app')!
let $svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
let $g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
let $settings = {
  size: document.getElementById('stroke-size') as HTMLInputElement,
  clear: document.getElementById('clear') as HTMLButtonElement,
  undo: document.getElementById('undo') as HTMLButtonElement,
  redo: document.getElementById('redo') as HTMLButtonElement,
  outline: document.getElementById('outline') as HTMLInputElement,
  data: document.getElementById('data') as HTMLElement,
}

let total = 0
function updateData(stroke: Stroke) {
  try {
    let bytes = JSON.stringify(stroke.toJSON()).length
    total += bytes
    $settings.data.textContent = `${prettyBytes(bytes)} (Total: ${prettyBytes(total)})`
  } catch (err) {
    console.error(err)
  }
}

function prettyBytes(n: number) {
  return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' kB'
}

let undoStack = {
  index: 0,
  // Suppose we have committed 2 strokes:
  //
  //   stack = [delete_stroke_1, delete_stroke_2]
  //                                            ^ index = 2
  // Now call `undo()`, what happens is index--:
  //
  //   stack = [delete_stroke_1, restore_stroke_2]
  //                           ^ index = 1
  //                             ^^^^^^^^^^^^^^^^ replace the undo() with redo()
  stack: [],
  get undoable(): boolean { return this.index > 0 },
  get redoable(): boolean { return this.index < this.stack.length },
  commit(undo: () => void, redo: () => void) {
    this.stack[this.index] = { undo, redo }
    this.index += 1
    // Max 20 steps.
    while (this.stack.length > 20) {
      this.stack.shift()
      this.index -= 1
    }
    // Clear all redos.
    this.stack.length = this.index
    this.update()
  },
  undo() {
    if (this.undoable) {
      this.index -= 1
      this.stack[this.index].undo()
      this.update()
    }
  },
  redo() {
    if (this.redoable) {
      this.stack[this.index].redo()
      this.index += 1
      this.update()
    }
  },
  update() {
    $settings.undo.disabled = !this.undoable
    $settings.redo.disabled = !this.redoable
  },
}

$svg.append($g)
$root.append($svg)

$settings.clear.onclick = () => {
  let current = Array.from($g.children)
  $g.textContent = ''
  undoStack.commit(
    () => $g.append(...current),
    () => $g.textContent = '',
  )
}

$settings.undo.onclick = () => undoStack.undo()
$settings.redo.onclick = () => undoStack.redo()

let rect: DOMRect

$g.setAttribute('fill', 'currentColor')
$settings.outline.oninput = () => {
  let outline = $settings.outline.checked
  if (outline) {
    $g.setAttribute('fill', 'none')
    $g.setAttribute('stroke', 'currentColor')
    $g.setAttribute('stroke-width', '1')
  } else {
    $g.setAttribute('fill', 'currentColor')
  }
}

$svg.setAttribute('fill-rule', 'nonzero')
$svg.style.cssText = 'display: block; width: 100%; height: 100%; font-size: 0; touch-action: none; position: relative; contain: content'

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

    // Apple pencil's bug, it fires 2 identical events.
    // For pressure-change-only events, it seems chrome will emit a point that slightly changes position (x+1).
    // So this workaround does not cause other issues.
    if (x_ == ev.clientX && y_ == ev.clientY) return;
    strokes[ev.pointerId][2] = ev.clientX
    strokes[ev.pointerId][3] = ev.clientY

    // Firefox sometimes give 0 to mousemove events, fix them to 0.5.
    let pressure: number | undefined
    if (ev.pointerType === 'mouse' && pressure == 0) pressure = 0.5

    // @ts-ignore
    if (ev.getCoalescedEvents) ev.getCoalescedEvents().forEach(e => {
      stroke.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, r: pressure ?? e.pressure })
    })
    else {
      stroke.push({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, r: pressure ?? ev.pressure })
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
    let commit = true
    if (e && (e.clientX != x_ || e.clientY != y_)) {
      stroke.push({
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top),
        r: Math.max(e.pressure, 0.1),
      })
      dirty[e.pointerId] = true
      render()
    }
    // If this stroke is too small to be seen, remove it
    else if (stroke.empty) {
      $path.remove()
      commit = false
    }
    console.log(stroke)
    updateData(stroke)
    delete strokes[ev.pointerId]
    if (commit) {
      undoStack.commit(
        () => $path.remove(),
        // The z-index is not correct, but this demo does not care about it.
        () => $g.append($path),
      )
    }
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
