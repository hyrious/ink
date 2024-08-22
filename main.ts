import { RawPoint, Stroke } from './src/ink'

let $root = document.getElementById('app')!
let $svg = $root.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))

$svg.setAttribute('fill-rule', 'nonzero')
$svg.setAttribute('fill', 'currentColor')
$svg.style.cssText = `display: block; width: 100%; height: 100%;
font-size: 0; touch-action: none; position: relative; contain: content;
overflow: hidden; overscroll-behavior: none;`

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
  onOpen(id, RawPoint.fromEvent(e))
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
      onUpdate(id, RawPoint.fromEvent(ev))
    } else {
      onUpdate(id, RawPoint.fromEvent(e))
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
      if (ev) onUpdate(id, RawPoint.fromEvent(ev))
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

let strokes: { [id: number]: [Stroke, SVGPathElement] } = {}
let dirty: { [id: number]: true } = {}

let onOpen = (id: number, p: RawPoint) => {
  let stroke = Stroke.of([p])
  let $path = $svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
  $path.style.pointerEvents = 'none'
  strokes[id] = [stroke, $path]
  dirty[id] = true
  render()
}

let onUpdate = (id: number, p: RawPoint) => {
  if (strokes[id]) {
    strokes[id][0].push(p)
    dirty[id] = true
    render()
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
    if (stroke.empty) {
      $path.remove()
    }
    render()
    delete dirty[id]
    requestAnimation()
  }
}

// Full width of the stroke if pressure is 1.
let size = 12

// This happens synchronously, without even a microtask.
let render = () => {
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
    } else {
      delete strokes[id]
    }
  }
  if (schedule) requestAnimation()
}
