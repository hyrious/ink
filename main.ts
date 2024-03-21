import { union, difference, setPrecision } from 'polyclip-ts'
import { Input, Stroke, type RawPoint, type Vec } from './src/ink'

setPrecision(1e-12)

let $root = document.getElementById('app')!
let $svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
let $g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
let $defs_eraser = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
let $settings = {
  size: document.getElementById('stroke-size') as HTMLInputElement,
  clear: document.getElementById('clear') as HTMLButtonElement,
  undo: document.getElementById('undo') as HTMLButtonElement,
  redo: document.getElementById('redo') as HTMLButtonElement,
  outline: document.getElementById('outline') as HTMLInputElement,
  pressure: document.getElementById('pressure') as HTMLInputElement,
  eraser: document.getElementById('eraser') as HTMLInputElement,
  data: document.getElementById('data') as HTMLElement,
}

let $log = document.getElementById('log')!
function log(...msg: any[]) {
  $log.append(msg.map(inspect).join(' ') + '\n')
  if ($log.childNodes.length > 20)
    $log.removeChild($log.firstChild!)
}
function inspect(obj: any): string {
  if (typeof obj === 'object') {
    if (typeof obj === 'function') return 'Fn()';
    if (Array.isArray(obj)) {
      let str = '[', content = false
      for (let x of obj) {
        str += ' ' + inspect(x) + ','
        content = true
      }
      str = content ? str.slice(0, -1) + ' ]' : str + ']'
      return str
    } else {
      let str = '{', content = false
      for (let key in obj) {
        str += ' ' + key + ': ' + inspect(obj[key]) + ','
        content = true
      }
      str = content ? str.slice(0, -1) + ' }' : str + '}'
      return str
    }
  } else if (typeof obj === 'number') {
    return obj.toFixed(1)
  } else {
    return '' + obj
  }
}

window.onerror = function debug(error: any) {
  log(error)
}

let __log = console.log
console.log = function() {
  log.apply(this, arguments)
  return __log.apply(this, arguments)
}

let renderingMs = 0
let bytes = 0, total = 0
function consumeStroke(stroke: Stroke) {
  try {
    bytes = JSON.stringify(stroke.toJSON()).length
    total += bytes
  } catch (error) {
    console.error(error)
  }
}
function updateData() {
  $settings.data.textContent = `${renderingMs.toFixed(1)}ms, ${prettyBytes(bytes)} (Total: ${prettyBytes(total)})`
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

function isErasing() { return $settings.eraser.checked }

let $mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask')
$settings.eraser.oninput = () => {
  if (isErasing()) {
    $defs_eraser.append($mask)
    $settings.pressure.disabled = true
  } else {
    $mask.remove()
    $settings.pressure.disabled = false
  }
}
$mask.setAttribute('id', 'eraser')

let $mask_background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
$mask_background.setAttribute('width', '100%')
$mask_background.setAttribute('height', '100%')
$mask_background.setAttribute('fill', 'white')
$mask.append($mask_background)
$g.setAttribute('mask', 'url(#eraser)')

$svg.append($defs_eraser)
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
$svg.style.cssText = `display: block; width: 100%; height: 100%;
font-size: 0; touch-action: none; position: relative; contain: content;
overflow: hidden; overscroll-behavior: none;`

let strokes = { __proto__: null } as { [id: number]: [s: Stroke, p: SVGPathElement] }
let dirty = { __proto__: null } as { [id: number]: true }
let input = Input.create({ dom: $svg, gesture: false })
let eraser: { stroke: Stroke, $path: SVGPathElement } | undefined

$settings.pressure.oninput = () => {
  input.pressure = $settings.pressure.checked
}

function applyTransform(raw: RawPoint) { return raw }

input.on('open', (id, raw) => {
  let stroke = Stroke.create([applyTransform(raw)])
  let $path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  $path.style.pointerEvents = 'none'
  if (isErasing()) {
    $path.setAttribute('fill', 'black')
    $mask.append($path)
    if (eraser) { eraser.$path.remove() }
    eraser = { stroke, $path }
  } else {
    strokes[id] = [stroke, $path]
    dirty[id] = true
    $g.append($path)
    render()
  }
})

input.on('update', (id, raw) => {
  if (isErasing() && eraser) {
    let size = $settings.size.valueAsNumber * 2
    let { stroke, $path } = eraser, d = '', outlines: Vec[][] = []
    stroke.push(applyTransform(raw))
    for (let index of stroke.sections) {
      let outline = stroke.outline(index, size)
      d += simple_bezier(outline)
      outlines.push(outline)
    }
    $path[OUTLINES] = outlines
    $path.setAttribute('d', d)
  } else if (strokes[id]) {
    let [stroke] = strokes[id]
    stroke.push(applyTransform(raw))
    dirty[id] = true
    render()
  }
})

input.on('cancel', (id) => {
  if (isErasing() && eraser) {
    eraser.$path.remove()
  } else if (strokes[id]) {
    strokes[id][1].remove()
    delete strokes[id]
  }
})

input.on('close', (id) => {
  if (isErasing() && eraser) {
    let t0 = performance.now()
    try { erase(eraser) }
    catch (error) {
      console.error(error)
      alert('Failed to erase: ' + error)
    }
    finally { eraser.$path.remove() }
    eraser = void 0
    renderingMs = performance.now() - t0
    updateData()
  } if (strokes[id]) {
    let [stroke, $path] = strokes[id]
    let commit = true
    if (stroke.empty) {
      $path.remove()
      commit = false
    }
    render()
    consumeStroke(stroke)
    updateData()
    console.info(stroke)
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

document.onkeydown = (ev) => {
  let ctrl = ev.ctrlKey, shift = ev.shiftKey, meta = ev.metaKey, alt = ev.altKey, code = ev.keyCode
  let primary = input._browser.mac ? meta : ctrl

  const click = (btn: HTMLInputElement | HTMLButtonElement) => {
    ev.preventDefault()
    btn.focus(); btn.click()
  }

  if (!ctrl && !shift && !meta && !alt) {
    if (code == 79) click($settings.outline);
    if (code == 80) {
      if ($settings.pressure.disabled) {
        click($settings.eraser)
      } else {
        click($settings.pressure)
      }
    }
    if (code == 69) click($settings.eraser);
  } else if (primary && !shift && code == 90) {
    click($settings.undo)
  } else if (primary && shift && code == 90) {
    click($settings.redo)
  }
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const M = ({ x, y }) => `M${x.toFixed(2)},${y.toFixed(2)}`;
const L = ({ x, y }) => `L${x.toFixed(2)},${y.toFixed(2)}`;
const Q = (c, { x, y }) => `Q${c.x.toFixed(2)},${c.y.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`;

type MultiPoly = [x: number, y: number][][][]
const OUTLINES = '_outlines'
const POLY = '_poly'

function render() {
  let size = $settings.size.valueAsNumber
  let t0 = performance.now(), working = false
  for (let id in dirty) {
    if (strokes[id]) {
      let [stroke, $path] = strokes[id], d = '', outlines: Vec[][] = []
      for (let index of stroke.sections) {
        let outline = stroke.outline(index, size)
        d += simple_bezier(outline)
        outlines.push(outline)
      }
      $path[OUTLINES] = outlines
      $path.setAttribute('d', d)
    }
    delete dirty[id]
    working = true
  }
  if (working) {
    renderingMs = performance.now() - t0
  }
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

function geom($path: SVGPathElement): MultiPoly {
  if ($path[POLY]) return $path[POLY]
  let outlines = $path[OUTLINES] || [] as Vec[][], poly: MultiPoly = []
  for (let outline of outlines) {
    poly = union(poly, [outline.map(v => [v.x, v.y] as const)])
  }
  return poly
}

function erase({ $path }: { $path: SVGPathElement }) {
  let t0 = performance.now()
  let backup = Array.from($g.children) as SVGPathElement[]
  let content: [x: number, y: number][][][] = []
  content = union(content, ...backup.map(geom))

  // PERF: Maybe '1) a - collect close outlines 2) union(a) - eraser 3) union(a + rest)' could be faster.
  let subtract = geom($path)
  let result = difference(content, subtract)
  let current = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  current.style.pointerEvents = 'none'

  let d = ''
  for (let poly of result) {
    for (let ring of poly) {
      let outline = ring.map(e => ({ x: e[0], y: e[1] }))
      d += simple_bezier(outline)
    }
  }
  current[POLY] = result
  current.setAttribute('d', d)

  $g.textContent = ''; $g.append(current)

  undoStack.commit(
    () => { $g.textContent = ''; $g.append(...backup) },
    () => { $g.textContent = ''; $g.append(current) },
  )
  renderingMs = performance.now() - t0
  updateData()
}

Object.assign(window, {
  debug: { undoStack, strokes, dirty, input, eraser: () => eraser }
})
