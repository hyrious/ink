import { clamp, RawPoint, Stroke } from './src/ink'

let $root = document.getElementById('app')!
let $svg = $root.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
let $mask = $root.appendChild(document.createElement('div'))
let $settings = {
  color: document.getElementById('stroke-color') as HTMLInputElement,
  size: document.getElementById('stroke-size') as HTMLInputElement,
  clear: document.getElementById('clear') as HTMLButtonElement,
  undo: document.getElementById('undo') as HTMLButtonElement,
  redo: document.getElementById('redo') as HTMLButtonElement,
  pressure: document.getElementById('pressure') as HTMLInputElement,
  tail: document.getElementById('tail') as HTMLInputElement,
  eraser: document.getElementById('eraser') as HTMLInputElement,
  smooth: document.getElementById('smooth') as HTMLSelectElement,
}

let defaultPressure = $settings.pressure.checked
let defaultTail = $settings.tail.checked
let defaultSmooth = $settings.smooth.value
let defaultSize = $settings.size.valueAsNumber

$svg.setAttribute('fill-rule', 'nonzero')
$svg.setAttribute('fill', 'currentColor')
$svg.style.cssText = `display: block; width: 100%; height: 100%;
font-size: 0; touch-action: none; position: relative; contain: content;
overflow: hidden; overscroll-behavior: none;`

$mask.style.cssText = `display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%;
touch-action: none; contain: content; z-index: 1;`

let matchDark = matchMedia('(prefers-color-scheme: dark)')
let defaultColor = () => matchDark.matches ? '#ffffff' : '#000000'
$settings.color.value = defaultColor()

$settings.color.onchange = $settings.color.oninput = () => {
  refreshUrl()
}

$settings.size.onchange = $settings.size.oninput = () => {
  refreshUrl()
}

$settings.clear.onclick = () => {
  let current = Array.from($svg.children)
  $svg.textContent = ''
  undoStack.commit(
    () => $svg.append(...current),
    () => $svg.textContent = '',
  )
}

$settings.undo.onclick = () => undoStack.undo()
$settings.redo.onclick = () => undoStack.redo()

let pressure: 0.5 | undefined

$settings.pressure.oninput = () => {
  pressure = $settings.pressure.checked ? void 0 : 0.5
  refreshUrl()
}

$settings.tail.oninput = () => {
  refreshUrl()
}

$settings.smooth.onchange = $settings.smooth.oninput = () => {
  refreshUrl()
}

$settings.eraser.oninput = () => {
  let erasing = $settings.eraser.checked
  $mask.style.cursor = erasing ? `url(https://api.iconify.design/mdi:eraser.svg?color=${encodeURIComponent($settings.color.value)}) 12 32, auto` : 'default'
  $mask.style.display = erasing ? 'block' : 'none'
}

for (let i = 1; i <= 15; i++) {
  let $option = document.createElement('option')
  $option.value = $option.textContent = String(i)
  $settings.smooth.appendChild($option)
}

let refreshUrl = () => {
  let replacement = ''
  if ($settings.color.value !== defaultColor()) {
    replacement += `&color=${$settings.color.value.slice(1)}`
  }
  if ($settings.size.valueAsNumber !== defaultSize) {
    replacement += `&size=${$settings.size.valueAsNumber}`
  }
  if ($settings.pressure.checked !== defaultPressure) {
    replacement += `&pressure=${$settings.pressure.checked ? 1 : 0}`
  }
  if ($settings.tail.checked !== defaultTail) {
    replacement += `&tail=${$settings.tail.checked ? 1 : 0}`
  }
  if ($settings.smooth.value !== defaultSmooth) {
    replacement += `&smooth=${$settings.smooth.value}`
  }
   history.replaceState({}, "", replacement ? replacement.replace('&', '?') : location.pathname)
}

let search = new URL(location.href).searchParams
if (search.has('color')) {
  $settings.color.value = '#' + search.get('color')!
}
if (search.has('size')) {
  $settings.size.value = search.get('size')!
}
if (search.has('pressure')) {
  $settings.pressure.checked = search.get('pressure') !== '0'
  $settings.pressure.dispatchEvent(new InputEvent('input'))
}
if (search.has('tail')) {
  $settings.tail.checked = search.get('tail') !== '0'
  $settings.tail.dispatchEvent(new InputEvent('input'))
}
if (search.has('smooth')) {
  $settings.smooth.value = search.get('smooth')!
}
refreshUrl()

let running = new Map<number, PointerEvent>()

$svg.onpointerdown = (e) => {
  let id = e.pointerId
  if (running.has(id)) onCancel(id)
  running.set(id, e)
  e.preventDefault()
  e.stopPropagation()
  $svg.setPointerCapture(id)
  // Ideally it should save $svg.getBoundingClientRect() for calculating the offset.
  // In our demo case the offset is always 0.
  onOpen(id, RawPoint.fromEvent(e, pressure))
}

$svg.onpointermove = (e) => {
  let id = e.pointerId
  e.preventDefault()
  e.stopPropagation()
  if (running.has(id)) {
    let e0 = running.get(id)!
    // Apple pencil's bug, it fires 2 identical events.
    if (e0.clientX === e.clientX && e0.clientY === e.clientY) return
    running.set(id, e)
    if (!!e.getCoalescedEvents) for (let ev of e.getCoalescedEvents()) {
      onUpdate(id, RawPoint.fromEvent(ev, pressure))
    } else {
      onUpdate(id, RawPoint.fromEvent(e, pressure))
    }
  }
}

$svg.onpointerup = $svg.onpointerout = (e) => {
  let id = e.pointerId
  e.preventDefault()
  e.stopPropagation()
  if (running.has(id)) {
    if (!!e.getPredictedEvents) {
      // Use last point's predict result instead of this pointerup event.
      let ev = running.get(id)!.getPredictedEvents()[0]
      if (ev) onUpdate(id, RawPoint.fromEvent(ev, pressure))
    }
    onClose(id)
    running.delete(id)
  }
}

$svg.onpointercancel = (e) => {
  let id = e.pointerId
  e.preventDefault()
  e.stopPropagation()
  if (running.has(id)) {
    onCancel(id)
    running.delete(id)
  }
}

$svg.ontouchstart = $svg.ontouchmove = $svg.ontouchend = $svg.ontouchcancel = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

let eraserLastPoint: RawPoint | undefined

$mask.onpointerdown = (e) => {
  e.preventDefault()
  e.stopPropagation()
  $mask.setPointerCapture(e.pointerId)
  onErase(eraserLastPoint = RawPoint.fromEvent(e))
}

$mask.onpointermove = (e) => {
  if (eraserLastPoint) {
    e.preventDefault()
    e.stopPropagation()
    let current = RawPoint.fromEvent(e)
    onErase(current)
    eraserLastPoint = current
  }
}

$mask.onpointerup = $mask.onpointerout = (e) => {
  eraserLastPoint = void 0
}

$mask.ontouchstart = $mask.ontouchmove = $mask.ontouchend = $mask.ontouchcancel = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

interface IUndoStack {
  index: number
  stack: { undo: () => void, redo: () => void }[]
  readonly undoable: boolean
  readonly redoable: boolean
  commit(undo: () => void, redo: () => void): void
  undo(): void
  redo(): void
  update(): void
}

let undoStack: IUndoStack = {
  index: 0,
  stack: [],
  get undoable() { return this.index > 0 },
  get redoable() { return this.index < this.stack.length },
  commit(undo: () => void, redo: () => void) {
    this.stack[this.index] = { undo, redo }
    this.index++
    // Max 20 steps.
    while (this.stack.length > 20) {
      this.stack.shift()
      this.index--
    }
    // Delete all redos.
    this.stack.length = this.index
    this.update()
  },
  undo() {
    if (this.undoable) {
      this.index--
      this.stack[this.index].undo()
      this.update()
    }
  },
  redo() {
    if (this.redoable) {
      this.stack[this.index].redo()
      this.index++
      this.update()
    }
  },
  update() {
    $settings.undo.disabled = !this.undoable
    $settings.redo.disabled = !this.redoable
  }
}

interface IQueue<T> {
  push(item: T): this
  /// Push the last element again, return undefined if no such element.
  dup(): this | undefined
  /// Get computed item.
  get(): T
}

class Queue1<T> implements IQueue<T> {
  item: T | undefined

  push(item: T) {
    this.item = item
    return this
  }

  dup() {
    if (this.item) return this
  }

  get() {
    return this.item!
  }
}

class Queue<T> implements IQueue<T> {
  items: T[] = []
  size = 0

  constructor(
    readonly compute: (items: T[]) => T,
    readonly capacity = 2,
  ) { }

  push(item: T): this {
    this.items.push(item)
    this.size++
    while (this.size > this.capacity) {
      this.items.shift()
      this.size--
    }
    return this
  }

  dup(): this | undefined {
    if (this.size > 0) {
      return this.push(this.items[this.items.length - 1])
    }
  }

  get(): T {
    return this.compute(this.items)
  }
}

let averagePoint = (ps: RawPoint[]): RawPoint => {
  // Use average x, y and latest p, t.
  let sum_x = 0, sum_y = 0, pressure = 0.5, timestamp = 0
  for (let p of ps) {
    sum_x += p.x
    sum_y += p.y
    pressure = p.p
    timestamp = p.t
  }
  return RawPoint.of(sum_x / ps.length, sum_y / ps.length, pressure, timestamp)
}

let createQueue = (p: RawPoint): IQueue<RawPoint> => {
  if ($settings.smooth.value == '0') {
    return new Queue1<RawPoint>().push(p)
  } else {
    let size = Number.parseInt($settings.smooth.value) + 1
    return new Queue<RawPoint>(averagePoint, size).push(p)
  }
}

let strokes: { [id: number]: [Stroke, SVGPathElement] } = {}
let queue: { [id: number]: IQueue<RawPoint> } = {}
let dirty: { [id: number]: true } = {}

let onOpen = (id: number, p: RawPoint) => {
  let stroke = Stroke.of([p])
  let $path = $svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
  $path.style.pointerEvents = 'none'
  $path.style.fill = $settings.color.value
  strokes[id] = [stroke, $path]
  queue[id] = createQueue(p)
  dirty[id] = true
  render()
}

let onUpdate = (id: number, p: RawPoint) => {
  if (strokes[id]) {
    strokes[id][0].push(queue[id].push(p).get())
    dirty[id] = true
    render()
    requestAnimation()
  }
}

let onCancel = (id: number) => {
  if (strokes[id]) {
    strokes[id][1].remove()
    delete queue[id]
    delete strokes[id]
    delete dirty[id]
  }
}

let onClose = (id: number) => {
  if (strokes[id]) {
    let [stroke, $path] = strokes[id]
    let commit = true
    if (stroke.empty && !stroke.dot) {
      $path.remove()
      commit = false
    }
    render()
    delete queue[id]
    delete dirty[id]
    requestAnimation()
    if (commit) undoStack.commit(
      () => $path.remove(),
      // The z-index is not correct, but this demo does not care about it.
      () => $svg.append($path),
    )
  }
}

let onErase = (p: RawPoint) => {
  let point = $svg.createSVGPoint()
  point.x = p.x
  point.y = p.y
  for (let $path of $svg.children as unknown as SVGPathElement[]) {
    $path.isPointInFill(point) && $path.remove()
  }
  if (eraserLastPoint) {
    let dx = p.x - eraserLastPoint.x, dy = p.y - eraserLastPoint.y
    for (let x = 0; x < 1; x += 0.1) {
      let point = $svg.createSVGPoint()
      point.x = p.x - x * dx
      point.y = p.y - x * dy
      for (let $path of $svg.children as unknown as SVGPathElement[]) {
        $path.isPointInFill(point) && $path.remove()
      }
    }
  }
}

// This happens synchronously, without even a microtask.
let render = () => {
  let now = performance.now()
  let size = $settings.size.valueAsNumber
  let tail = $settings.tail.checked
  for (let id in dirty) {
    if (strokes[id]) {
      let [stroke, $path] = strokes[id], d = ''
      for (let index of stroke.segments) {
        let outline = stroke.outline(index, size, now, tail)
        d += stroke.stroke(outline, true)
      }
      $path.setAttribute('d', d)
    }
    delete dirty[id]
  }
}

let animateId = 0

let requestAnimation = () => {
  cancelAnimationFrame(animateId)
  animateId = requestAnimationFrame(updateAnimation)
}

let updateAnimation = () => {
  render()
  let schedule = false
  for (let id in strokes) {
    let q = queue[id]?.dup()
    if (q) strokes[id][0].push(q.get())
    if (strokes[id][0].isSpreading()) {
      dirty[id] = true
      schedule = true
    }
  }
  if (schedule) requestAnimation()
}

let isMac = /Mac/.test(navigator.platform)

document.onkeydown = (ev) => {
  let ctrl = ev.ctrlKey, shift = ev.shiftKey, meta = ev.metaKey, alt = ev.altKey, code = ev.keyCode
  let primary = isMac ? meta : ctrl

  const click = (btn: HTMLInputElement | HTMLButtonElement) => {
    ev.preventDefault()
    btn.focus(); btn.click()
  }

  if (!ctrl && !shift && !meta && !alt) {
    if (code == 80)
      if ($settings.eraser.checked)
        click($settings.eraser)
      else
        click($settings.pressure)
    if (code == 69) click($settings.eraser) 
    if (code == 219 || code == 221) {
      let size = $settings.size.valueAsNumber, inc = code == 221 ? 5 : -5
      $settings.size.value = '' + clamp(size + inc, +$settings.size.min, +$settings.size.max)
      $settings.size.dispatchEvent(new InputEvent('input'))
    }
    if (code === 84) click($settings.tail)
  } else if (primary && !shift && code == 90) {
    click($settings.undo)
  } else if (primary && shift && code == 90) {
    click($settings.redo)
  }
}

Object.assign(globalThis, {
  $settings, $svg, strokes, dirty, undoStack,
})
