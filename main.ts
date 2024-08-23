import { clamp, RawPoint, Stroke } from './src/ink'

let $root = document.getElementById('app')!
let $svg = $root.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
let $settings = {
  color: document.getElementById('stroke-color') as HTMLInputElement,
  size: document.getElementById('stroke-size') as HTMLInputElement,
  clear: document.getElementById('clear') as HTMLButtonElement,
  undo: document.getElementById('undo') as HTMLButtonElement,
  redo: document.getElementById('redo') as HTMLButtonElement,
  pressure: document.getElementById('pressure') as HTMLInputElement,
}

$svg.setAttribute('fill-rule', 'nonzero')
$svg.setAttribute('fill', 'currentColor')
$svg.style.cssText = `display: block; width: 100%; height: 100%;
font-size: 0; touch-action: none; position: relative; contain: content;
overflow: hidden; overscroll-behavior: none;`

$settings.color.value = matchMedia('(prefers-color-scheme: dark)').matches ? '#ffffff' : '#000000'

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
}

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

let undoStack = {
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

let strokes: { [id: number]: [Stroke, SVGPathElement] } = {}
let dirty: { [id: number]: true } = {}

let onOpen = (id: number, p: RawPoint) => {
  let stroke = Stroke.of([p])
  let $path = $svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
  $path.style.pointerEvents = 'none'
  $path.style.fill = $settings.color.value
  strokes[id] = [stroke, $path]
  dirty[id] = true
  render()
}

let onUpdate = (id: number, p: RawPoint) => {
  if (strokes[id]) {
    strokes[id][0].push(p)
    dirty[id] = true
    render()
    requestAnimation()
  }
}

let onCancel = (id: number) => {
  if (strokes[id]) {
    strokes[id][1].remove()
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
    delete dirty[id]
    requestAnimation()
    if (commit) undoStack.commit(
      () => $path.remove(),
      // The z-index is not correct, but this demo does not care about it.
      () => $svg.append($path),
    )
  }
}

// This happens synchronously, without even a microtask.
let render = () => {
  let size = $settings.size.valueAsNumber
  for (let id in dirty) {
    if (strokes[id]) {
      let [stroke, $path] = strokes[id], d = ''
      for (let index of stroke.segments) {
        let outline = stroke.outline(index, size)
        d += stroke.stroke(outline)
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
    if (code == 80) click($settings.pressure)
    if (code == 219 || code == 221) {
      let size = $settings.size.valueAsNumber, inc = code == 221 ? 5 : -5
      $settings.size.value = '' + clamp(size + inc, +$settings.size.min, +$settings.size.max)
    }
  } else if (primary && !shift && code == 90) {
    click($settings.undo)
  } else if (primary && shift && code == 90) {
    click($settings.redo)
  }
}

Object.assign(globalThis, {
  $settings, $svg, strokes, dirty, undoStack,
})
