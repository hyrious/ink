import type { RawPoint } from './ink'
import { clamp } from './vec'

const enum C {
  // Zoom speed by mouse wheel.
  Scale = 0.035,
  // Prevent zooming too fast.
  MinScale = -40, ScaleRate = 0.02,
}

// Extract function params or `never`.
type Params<Fn = any> = Fn extends (...args: any) => any ? Parameters<Fn> : never

/// Handles named events.
class Observable<EventMap = any> {
  /// @internal
  _observers = new Map<any, Set<any>>()

  /// Listen to an event.
  on<E extends keyof EventMap>(event: E, fn: EventMap[E]): () => void {
    let set = this._observers.get(event)
    if (set === undefined) {
      this._observers.set(event, set = new Set())
    }
    set.add(fn)
    return this.off.bind(this, event, fn)
  }

  /// Stop listening to an event.
  off<E extends keyof EventMap>(event: E, fn: EventMap[E]): void {
    let set = this._observers.get(event)
    if (set !== undefined) {
      set.delete(fn)
      if (set.size == 0) this._observers.delete(event)
    }
  }

  /// Emit an event.
  emit<E extends keyof EventMap>(event: E, ...args: Params<EventMap[E]>): void {
    let set = this._observers.get(event)
    if (set) set.forEach(f => this._invoke(f, args))
  }

  /// @internal
  _invoke(f: any, args: any) {
    try {
      f(...args)
    } catch (error) {
      console.error(error)
    }
  }

  /// Remove all subscribers.
  dispose() {
    this._observers.clear()
  }
}

interface InputWheelEvent {
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaScale: number
}

interface InputPinchEvent extends InputWheelEvent {
  /// - `0`: start pinch & zoom
  /// - `1`: update pinch & zoom (user touch not end)
  /// - `2`: pinch & zoom done
  readonly phase: 0 | 1 | 2
}

export interface InputEventMap {
  'open': (pointerId: number, point: RawPoint) => void
  'update': (pointerId: number, point: RawPoint) => void
  'cancel': (pointerId: number) => void
  'close': (pointerId: number) => void
  'wheel': (event: InputWheelEvent) => void
  'pinch': (event: InputPinchEvent) => void
}

export interface InputConfig {
  /// The element to bind events like `pointermove`.
  dom?: HTMLElement | SVGElement
  /// Whether to stop reporting events, default is `false`.
  paused?: boolean
  /// Whether to handle pinch zoom gestures (multi-touch), default is `true`.
  /// If `false`, multi-touch inputs will be treated as separate strokes.
  gesture?: boolean
  /// Whether to use `pointerEvent.pressure`, default is `true`.
  /// If `false`, it will always use `0.5` as the pressure number.
  /// Or you can set it as a custom number ranges in (0, 1].
  pressure?: boolean | number
}

/// Helper class to handle pointer events.
/// To disable intrinsic user agent touch behaviors (such as panning or zooming),
/// add style `touch-action: none` to the target element.
export class Input extends Observable<InputEventMap> {
  /// @internal pointerId => pointerEvent
  readonly _map = new Map<number, PointerEvent>()
  /// @internal
  _dom?: HTMLElement | SVGElement
  /// @internal
  _unlistenDOM?: () => void
  /// @internal It will be set in pointerdown, so never be undefined.
  _rect: DOMRect
  /// @internal
  _browser: { windows: boolean, mac: boolean }

  /// @internal
  constructor(
    /// Whether to stop reporting events, default is `false`.
    public paused = false,
    /// Whether to handle pinch zoom gestures (multi-touch), default is `true`.
    /// - `true`: Multi-touch events will fire a `cancel` stroke event and `pinch` events follows.
    /// - `false`: Treat each `pointerId` as a single stroke.
    /// - `"strict"`: Same as `true`, but only when `pointerType` is `"touch"`.
    public gesture: boolean | "strict" = true,
    /// Whether to use the `pressure` property from pointer events, default is `true`.
    /// - `true`: Use pressure from pointer events.
    /// - `false`: Same as `0.5`.
    /// - number range from 0 (exclusive) to 1 (inclusive): Use this value as pressure.
    public pressure: boolean | number = true,
  ) {
    super()
    const nav = typeof navigator != 'undefined' ? navigator : { platform: "" }
    this._browser = {
      mac: /Mac/.test(nav.platform),
      windows: /Win/.test(nav.platform),
    }
  }

  /// The element to bind events like `pointermove`.
  get dom(): HTMLElement | SVGElement | undefined { return this._dom }
  set dom(v: HTMLElement | SVGElement | undefined) {
    if (this._dom == v) return
    this._dom = v
    this._listen(this._dom, {
      pointerdown: this._onpointerdown,
      pointermove: this._onpointermove,
      pointerup: this._onpointerup,
      pointerout: this._onpointerup,
      pointercancel: this._onpointercancel,
      wheel: this._onwheel,
    })
    if (this._dom) this._rect = this._dom.getBoundingClientRect()
  }

  pause(): void { this.paused = true }
  resume(): void { this.paused = false }

  /// @internal
  _listen(element: HTMLElement | SVGElement | undefined, eventMap: { [name: string]: (...args: any) => any }) {
    if (this._unlistenDOM) {
      this._unlistenDOM()
      this._unlistenDOM = void 0
    }
    if (element) {
      for (let name in eventMap) element.addEventListener(name, eventMap[name])
      this._unlistenDOM = () => { for (let name in eventMap) element.removeEventListener(name, eventMap[name]) }
    }
  }

  /// @internal
  _mapPressure(real: number): number {
    return this.pressure === true ? real : clamp(this.pressure || 0.5, 0, 1)
  }

  /// @internal
  _mapGesture(ev: PointerEvent): boolean {
    return this.gesture === true || (this.gesture && ev.pointerType == 'touch')
  }

  /// @internal
  _pinch: Pinch | null

  /// @internal
  _onpointerdown = (ev: PointerEvent) => {
    if (this.paused) return
    let id = ev.pointerId
    if (this._map.has(id)) this.emit('cancel', id)
    this._map.set(id, ev)
    ev.preventDefault()
    ev.stopPropagation()
    this._dom!.setPointerCapture(id)
    let rect = this._rect = this._dom!.getBoundingClientRect()
    if (this._mapGesture(ev) && this._map.size > 1) {
      let pinch = this._pinch = new Pinch(this)
      // Emit 'cancel' to all other strokes.
      this._map.forEach((ev2, id2) => {
        if (!pinch.has(id2)) {
          if (id != id2) this.emit('cancel', id2)
          pinch.add(ev2)
        }
      })
    } else {
      this.emit('open', id, { x: ev.clientX - rect.left, y: ev.clientY - rect.top, r: this._mapPressure(ev.pressure) })
    }
  }

  /// @internal
  _onpointermove = (ev: PointerEvent) => {
    if (this.paused) return
    let id = ev.pointerId
    ev.preventDefault()
    ev.stopPropagation()
    if (this._map.has(id)) {
      let ev0 = this._map.get(id)!
      // Apple pencil's bug, it fires 2 identical events.
      if (ev0.clientX == ev.clientX && ev0.clientY == ev.clientY) return
      this._map.set(id, ev)
      if (this._pinch) {
        this._pinch.move(ev)
      } else {
        // Firefox's bug, it gives 0 to pointer events generated by mouse.
        let pressure: number | undefined
        if (ev.pointerType == 'mouse' && ev.pressure == 0) pressure = this._mapPressure(0.5)
        let { left, top } = this._rect
        // @ts-ignore Get the most precise pointer events.
        if (ev.getCoalescedEvents) for (let ev1 of ev.getCoalescedEvents()) {
          this.emit('update', id, { x: ev1.clientX - left, y: ev1.clientY - top, r: pressure ?? this._mapPressure(ev.pressure) })
        } else {
          this.emit('update', id, { x: ev.clientX - left, y: ev.clientY - top, r: pressure ?? this._mapPressure(ev.pressure) })
        }
      }
    }
  }

  /// @internal
  _onpointerup = (ev: PointerEvent) => {
    if (this.paused) return
    let id = ev.pointerId
    ev.preventDefault()
    ev.stopPropagation()
    if (this._map.has(id)) {
      if (this._pinch) {
        this._pinch.delete(id)
        if (this._pinch.empty) this._pinch = null
      } else {
        let { left, top } = this._rect
        // @ts-ignore Safari does not have this method.
        if (ev.getPredictedEvents) {
          let pred = this._map.get(id)?.getPredictedEvents()[0]
          if (pred) this.emit('update', id, {
            x: pred.clientX - left,
            y: pred.clientY - top,
            r: this._mapPressure(pred.pressure),
          })
        }
        this.emit('close', id)
      }
      this._map.delete(id)
    }
  }

  /// @internal
  _onpointercancel = (ev: PointerEvent) => {
    if (this.paused) return
    let id = ev.pointerId
    ev.preventDefault()
    ev.stopPropagation()
    this._map.delete(id)
    if (this._pinch) {
      this._pinch.delete(id)
      if (this._pinch.empty) this._pinch = null
    } else {
      this.emit('cancel', id)
    }
  }

  /// @internal
  _onwheel = (ev: WheelEvent) => {
    if (this.paused) return
    ev.preventDefault()
    ev.stopPropagation()
    let { deltaX, deltaY } = ev
    let scale = Math.hypot(deltaX, deltaY)
    let x = 0, y = 0
    if (this._browser.windows) { scale = -scale }
    if (deltaX + deltaY < 0) { scale = -scale }
    // macOS zoom by trackpad
    if (this._browser.mac && ev.ctrlKey) { scale = -scale * 0.5 }
    // macOS scroll by trackpad
    else if (this._browser.mac && ((ev as any).wheelDelta % 120 != 0 || ev.movementX != 0 || ev.deltaX != 0)
      // Windows scroll by mouse wheel
      || this._browser.windows && !ev.ctrlKey) {
      x = -deltaX
      y = -deltaY
      scale = 0
    }
    // Normal zoom by scroll.
    else { scale *= C.Scale }
    scale = Math.max(scale, C.MinScale) * C.ScaleRate
    let { left, top } = this._rect
    this.emit('wheel', { x: ev.clientX - left, y: ev.clientY - top, deltaX: x, deltaY: y, deltaScale: scale })
  }

  /// Remove all subscribers and DOM listeners.
  override dispose(): void {
    if (this._unlistenDOM) {
      this._unlistenDOM()
      this._unlistenDOM = void 0
    }
    super.dispose()
  }

  /// Create a new input handler.
  static create(config: InputConfig = {}) {
    let input = new Input(config.paused, config.gesture, config.pressure)
    input.dom = config.dom
    return input
  }
}

interface PinchDesc {
  readonly x: number
  readonly y: number
  readonly d: number
}

class Pinch {
  readonly points = new Map<number, PointerEvent>()
  // This pinch runs from (x0, y0, 1) to (x1, y1, scale).
  x0 = 0; y0 = 0; x1 = 0; y1 = 0; scale = 1
  ox = 0; oy = 0; rate = 1; initialized = false; size = 0

  constructor(readonly input: Input) {}

  get empty(): boolean { return this.points.size == 0 }

  has(id: number): boolean { return this.points.has(id) }

  add(ev: PointerEvent) {
    this.points.set(ev.pointerId, ev)
    this.update()
  }

  move(ev: PointerEvent) {
    this.points.set(ev.pointerId, ev)
    this.update()
  }

  delete(id: number) {
    this.points.delete(id)
    this.update()
  }

  update() {
    let desc = this.desc(), phase: InputPinchEvent["phase"] = 1
    if (this.size == 0 && this.points.size == 1) { phase = 0 }
    else if (this.size > 0 && this.points.size == 0) { phase = 2 }
    if (this.initialized) {
      if (this.size !== this.points.size) {
        this.ox = this.x1 - desc.x
        this.oy = this.y1 - desc.y
        this.rate = this.scale / desc.d
        this.size = this.points.size
      }
      this.x1 = desc.x + this.ox
      this.y1 = desc.y + this.oy
      this.scale = desc.d * this.rate
    } else {
      this.ox = this.oy = 0
      this.rate = 1 / desc.d
      this.x1 = this.x0 = desc.x
      this.y1 = this.y0 = desc.y
      this.scale = 1
      this.size = this.points.size
      this.initialized = true
    }
    this.input.emit('pinch', {
      phase,
      x: this.x0,
      y: this.y0,
      deltaX: this.x0 - this.x1 / this.scale,
      deltaY: this.y0 - this.y1 / this.scale,
      deltaScale: this.scale,
    })
  }

  desc(): PinchDesc {
    let x = 0, y = 0, d = 0
    for (let ev of this.points.values()) {
      x += ev.clientX
      y += ev.clientY
    }
    if (this.points.size > 0) {
      x /= this.points.size
      y /= this.points.size
    }
    for (let ev of this.points.values()) {
      d += Math.hypot(ev.clientX - x, ev.clientY - y)
    }
    return { x, y, d: d || 1 }
  }
}
