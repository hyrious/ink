const $svg = document.querySelector<SVGSVGElement>('#app')!

const running = new Map<number, PointerEvent>()

$svg.onpointerdown = (e) => {
  let id = e.pointerId
  if (running.has(id)) onCancel(id)
  running.set(id, e)
  e.preventDefault()
  e.stopPropagation()
  $svg.setPointerCapture(id)
  onOpen(id, e)
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
      onUpdate(id, ev)
    } else {
      onUpdate(id, e)
    }
  }
}

$svg.onpointerup = $svg.onpointerout = (e) => {
  let id = e.pointerId
  e.preventDefault()
  e.stopPropagation()
  if (running.has(id)) {
    // The up event doesn't have meaningful predicted events.
    if (!!e.getPredictedEvents) for (let ev of running.get(id)!.getPredictedEvents()) {
      onUpdate(id, ev, 'green')
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

let strokes = new Map<number, SVGGElement>()

let addCircle = ($g: SVGGElement, x: number, y: number, r: number, stroke = 'currentColor') => {
  let $circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  $circle.setAttribute('cx', x.toFixed(2))
  $circle.setAttribute('cy', y.toFixed(2))
  $circle.setAttribute('r', r.toFixed(2))
  $circle.setAttribute('stroke', stroke)
  $g.appendChild($circle)
}

let onOpen = (id: number, e: PointerEvent) => {
  let $g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  addCircle($g, e.clientX, e.clientY, e.pressure * size, 'red')
  $svg.appendChild($g)
  strokes.set(id, $g)
}

let size = 16

let onUpdate = (id: number, e: PointerEvent, stroke?: string) => {
  if (strokes.has(id)) {
    addCircle(strokes.get(id)!, e.clientX, e.clientY, e.pressure * size, stroke)
  }
}

let onCancel = (id: number) => {
  if (strokes.has(id)) {
    strokes.get(id)!.remove()
    strokes.delete(id)
  }
}

let onClose = (id: number) => {
  strokes.delete(id)
}
