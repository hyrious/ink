import { Stroke, Input, type Vec } from './src/ink'

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

let renderingMs = 0
let total = 0
function updateData(stroke: Stroke) {
  try {
    let bytes = JSON.stringify(stroke.toJSON()).length
    total += bytes
    $settings.data.textContent = `${renderingMs.toFixed(1)}ms, ${prettyBytes(bytes)} (Total: ${prettyBytes(total)})`
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
let strokes = { __proto__: null } as { [id: number]: [s: Stroke, p: SVGPathElement] }
let dirty = { __proto__: null } as { [id: number]: true }
let input = Input.create({ dom: $svg })

// const clamp = (val: number, min: number, max: number) => {
//   return val < min ? min : val > max ? max : val
// }
// let transform = { x: 0, y: 0, scale: 1 }
// input.on('pinch', ({ x, y, scale }) => {
//   console.log('pinch', x, y, scale)
//   transform.x += x
//   transform.y += y
//   transform.scale *= scale
//   // Limit viewport.
//   transform.x = clamp(transform.x, -400, 400)
//   transform.y = clamp(transform.y, -300, 300)
//   transform.scale = clamp(transform.scale, 0.125, 4)
//   // Update.
//   $g.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
// })

input.on('open', (id, raw) => {
  let stroke = Stroke.create([raw])
  let $path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  $path.style.pointerEvents = 'none'
  strokes[id] = [stroke, $path]
  dirty[id] = true
  $g.append($path)
  if (scheduled) return;
  scheduled = true
  queueMicrotask(render)
})

input.on('update', (id, raw) => {
  if (strokes[id]) {
    let [stroke] = strokes[id]
    stroke.push(raw)
    dirty[id] = true
    if (scheduled) return;
    scheduled = true
    queueMicrotask(render)
  }
})

input.on('cancel', (id) => {
  if (strokes[id]) {
    strokes[id][1].remove()
    delete strokes[id]
  }
})

input.on('close', (id) => {
  if (strokes[id]) {
    let [stroke, $path] = strokes[id]
    let commit = true
    if (stroke.empty) {
      $path.remove()
      commit = false
    }
    updateData(stroke)
    console.log(stroke)
    scheduled = true
    render()
    delete strokes[id]
    if (commit) undoStack.commit(
      () => $path.remove(),
      // The z-index is not correct, but this demo does not care about it.
      () => $g.append($path),
    )
  }
})

$svg.ontouchstart = $svg.ontouchmove = $svg.ontouchend = $svg.ontouchcancel = (ev) => {
  ev.preventDefault()
  ev.stopPropagation()
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const M = ({ x, y }) => `M${x.toFixed(2)},${y.toFixed(2)}`;
const L = ({ x, y }) => `L${x.toFixed(2)},${y.toFixed(2)}`;
const Q = (c, { x, y }) => `Q${c.x.toFixed(2)},${c.y.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`;

function render() {
  if (!scheduled) return;
  scheduled = false
  let size = $settings.size.valueAsNumber
  let t0 = performance.now()
  for (let id in dirty) {
    if (strokes[id]) {
      let [stroke, $path] = strokes[id], d = ''
      for (let index of stroke.sections) {
        d += simple_bezier(stroke.outline(index, size))
      }
      $path.setAttribute('d', d)
    }
    delete dirty[id]
  }
  renderingMs = performance.now() - t0
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

Object.assign(window, {
  debug: { undoStack, strokes, dirty, input }
})
