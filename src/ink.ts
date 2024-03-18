import { add, dot, lerp, mul, neg, norm, per, proj, rot, sub, type Vec } from './vec'

export type { Vec }

// Internal constants, I don't plan to expose them as options.
const enum C {
  // SAI-like input smoothing strategy: keep a queue of points
  // and get middle of them. The queue size is `Smoothing + 1`.
  Smoothing = 1,
  // Skip points that are too close.
  SkipDistance = 4,
  // If |segment| < `MinDistance` and is sharp corner, split here
  // and skip next `CoolingDown` points for performance.
  // `CoolingDown` must > 0.
  MinDistance = 1000, CoolingDown = 1,
  // If the last |segment| > `TailDistance * size`, draw a thinner tail,
  // otherwise draw an end cap.
  TailDistance = 0.314,
  // Math.PI + 0.0001 to prevent floating number issue when drawing the cap.
  PI = 3.1416926535897933,
  // Simulate pressure for mouse and trackpad.
  PressureChangeSpeed = 0.3,
  // Approximate ratio that multiplies `size` to draw a dot.
  DotSize = 0.36,
  // Minimal stroke width / 2.
  MinRadius = 0.75,
  // Zoom speed by mouse wheel.
  Scale = 0.035,
  // Prevent zooming too fast.
  MinScale = -40, ScaleRate = 0.02,
}

export interface RawPoint extends Vec {
  readonly r: number
}

/// The data structure for a point with its context information.
class Point {
  /// @internal
  constructor(
    /// The point's position.
    readonly p: Vec,
    /// Radius or pressure.
    readonly r: number,
    /// The inverted direction of this point, equals to `previous - current`.
    /// The first point's `v` is a dummy value.
    readonly v: Vec,
    /// Distance to previous point, equals to `hypot(previous - current)`.
    readonly d: number,
    /// Running length, the last point's `l` is the stroke's approximate length.
    readonly l: number,
  ) {}

  /// @internal
  toJSON(): any {
    return [this.p.x, this.p.y, this.r]
  }

  /// @internal Returns a shallow copy of this point, with raidus changed.
  dup(r = this.r): Point {
    return new Point(this.p, r, this.v, this.d, this.l)
  }
}

/// The data structure for a single stroke, which contains many points.
export class Stroke {
  /// Indexes to split `points` into curves. The first index is always `0`.
  readonly sections: number[] = [0]
  /// @internal See `insert()`.
  readonly pending: { [from: number]: RawPoint[] } = { __proto__: null } as any
  /// @internal See `updateCurr()`.
  readonly queue: Vec[] = []

  /// @internal
  constructor(
    /// The stroke's points. It is guaranteed that this is a grow-only immutable array.
    readonly points: Point[],
    /// The stroke's length, equals to `points.at(-1).l`.
    /// `insert()` and `push()` will update this value.
    readonly length = points.length > 0 ? points[points.length - 1].l : 0,
  ) {
    this.updateSections()
  }

  /// True when `points` is empty.
  get empty(): boolean { return this.points.length == 0 }

  /// True when `points` contains exactly one element.
  get dot(): boolean { return this.points.length == 1 }

  /// Update the stroke with new points inserted from `from`.
  /// `from` can exceed `points.length`, where the points will be
  /// pending unless there are new points fill in the hole.
  insert(from: number, raw: RawPoint[]): void {
    if (from == this.points.length) {
      raw.forEach(p => this.push(p, true))
      from = this.points.length
      if ((raw = this.pending[from])) {
        delete this.pending[from]
        this.insert(from, raw)
      }
      // Recursively call `insert()` to flush pending points.
      // Ensure `updateSections()` is called at the end or recursion.
      else {
        this.updateSections()
      }
    }
    else if (from > this.points.length) {
      if (__DEV__ && this.pending[from])
        console.warn(`Override pending points from ${from}`)
      this.pending[from] = raw
    }
    else {
      throw new RangeError(`Position ${from} conflicts with existing points`)
    }
  }

  /// Update the stroke with new point appended to the end of `points`.
  /// If `skip_sections` is `true`, it will not update `sections`.
  push(p: RawPoint, skip_sections = false): void {
    let { points } = this
    if (points.length > 0) {
      let curr: RawPoint, prev_ = points[points.length-1]
      // @ts-ignore No smoothing, get the raw input.
      if (C.Smoothing == 0) curr = p
      // @ts-ignore Level-1 smoothing, get the center of each segment.
      else if (C.Smoothing == 1)
        curr = { x: (p.x + prev_.p.x) / 2, y: (p.y + prev_.p.y) / 2, r: p.r }
      // Level-N smoothing
      else {
        curr = this.updateCurr(p, C.Smoothing + 1)
      }
      let prev = prev_.p, d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      this.updateLength(d)
      if (this.length - prev_.l < C.SkipDistance) {
        // Skip this point, but preserve its pressure.
        (prev_ as { r: number }).r = Math.max(prev_.r, curr.r)
        return
      }
      points.push(new Point(curr, curr.r, norm(sub(prev, curr)), d, this.length))
      if (!skip_sections) this.updateSections()
    }
    else {
      points.push(new Point(p, p.r, { x: 1, y: 1 }, 0, 0))
    }
  }

  /// Compute the outline points of the section starting at `from`.
  /// Returns an empty array if `from` is not zero and not in `sections`.
  /// `size` is the full width when pressure is 1.
  outline(from: number, size: number): Vec[] {
    let end = this.sections.find(end => from < end)
    // Get one more point at head to connect curves.
    let points = this.points.slice(from > 0 ? from - 1 : from, end)
    if (points.length > 1) {
      let leftPoints: Vec[] = [], rightPoints: Vec[] = [], len = points.length,
          radius = size, prevPressure = points[0].r, drawEndCap = true
      // If `end` is `undefined`, this is the final section. Draw a thinner tail when possible.
      // The precisely comparing to `0.5` is probably a mouse event (i.e. no real pressure).
      if (end == null && points[len - 1].r == 0.5 && points[len - 1].d > C.TailDistance * size) {
        if (len - 1 >= 0) points[len - 1] = points[len - 1].dup(Math.max(0.1, points[len - 1].r - 0.4))
        if (len - 2 >= 0) points[len - 2] = points[len - 2].dup(Math.max(0.1, points[len - 2].r - 0.2))
        drawEndCap = false
      }
      // Simulate pressure and push left/right points.
      for (let i = 0; i < len; i++) {
        let { p, r, v, d } = points[i]
        // Fix first point's distance and direction (assume the same as the next point).
        if (i == 0) {
          d = 0
          if (i < len - 1) v = points[i + 1].v
        }
        let sp = Math.min(1, d / size), rp = Math.min(1, 1 - sp),
            pressure = Math.min(1, prevPressure + (rp - prevPressure) * (sp * C.PressureChangeSpeed)),
            nextVector = (i < len - 1 ?  points[i + 1] : points[i]).v,
            nextDot = i < len - 1 ? dot(v, nextVector) : 1

        radius = Math.max(size * (0.5 * pressure), C.MinRadius)

        let offset = mul(per(lerp(nextVector, v, nextDot)), radius)
        let pl = sub(p, offset); leftPoints.push(pl)
        let pr = add(p, offset); rightPoints.push(pr)

        prevPressure = r
      }
      let startCap: Vec[] = [], endCap: Vec[] = []
      for (let step = 1 / 13, t = step; t <= 1; t += step) {
        startCap.push(rot(rightPoints[0], points[0].p, C.PI * t))
      }
      if (drawEndCap) {
        let lastPoint = points[len - 1],
            direction = per(neg(lastPoint.v)),
            start = proj(lastPoint.p, direction, radius)
        for (let step = 1 / 13, t = step; t < 1; t += step) {
          endCap.push(rot(start, lastPoint.p, C.PI * t))
        }
      }
      return leftPoints.concat(endCap, rightPoints.reverse(), startCap)
    }
    // Dot case.
    else if (points.length == 1) {
      let lastPoint = points[0],
          direction = per(neg(lastPoint.v)),
          start = proj(lastPoint.p, direction, size * C.DotSize * lastPoint.r),
          circle: Vec[] = []
      for (let step = 1 / 13, t = 0; t <= 2; t += step) {
        circle.push(rot(start, lastPoint.p, C.PI * t))
      }
      return circle
    }
    else {
      return []
    }
  }

  /// @internal Increment `length`.
  updateLength(d: number) {
    (this as { length: number }).length += d
  }

  /// @internal Update `sections` incrementally using current `points`.
  updateSections() {
    let { sections } = this;
    // The first 2 points share the same vector, skip them.
    for (let i = sections.length > 1 ? (sections[sections.length-1] + C.CoolingDown) : 2,
             len = this.points.length; i < len; i++) {
      if (this.points[i].d < C.MinDistance &&
          dot(this.points[i].v, this.points[i-1].v) < 0) {
        sections.push(i)
        i += C.CoolingDown
      }
    }
  }

  /// @internal Perform smoothing.
  updateCurr(p: RawPoint, n: number): RawPoint {
    this.queue.push(p)
    while (this.queue.length > n)
      this.queue.shift()
    let x = 0, y = 0
    for (let q of this.queue) {
      x += q.x
      y += q.y
    }
    n = this.queue.length
    return { x: x / n, y: y / n, r: p.r }
  }

  /// Convert this stroke to a JSON-serializable object.
  toJSON(): any {
    return this.points.map(p => p.toJSON())
  }

  /// De-serialize a stroke from its JSON representation.
  static fromJSON(json: any): Stroke {
    if (!json || !Array.isArray(json))
      throw new RangeError("Invalid JSON representation for Stroke")
    return Stroke.create(json.map(a => ({ x: a[0], y: a[1], r: a[2] })))
  }

  /// Create a new stroke from raw input.
  static create(raw: RawPoint[] = []): Stroke {
    let points: Point[] = [], last_length = 0
    if (raw.length > 0) {
      let prev = raw[0], length = 0
      points.push(new Point(prev, prev.r, { x: 1, y: 1 }, 0, 0))
      for (let i = 1; i < raw.length; i++) {
        let curr = raw[i], d = Math.hypot(curr.x - prev.x, curr.y - prev.y)
        length += d
        if (length - last_length < C.SkipDistance) {
          // Skip this point and keep pressure.
          (points[points.length - 1] as { r: number }).r = curr.r
          continue;
        }
        points.push(new Point(curr, curr.r, norm(sub(prev, curr)), d, length))
        prev = curr
        last_length = length
      }
      // Even if the last points not get pushed, their distance is added.
      last_length = length
    }
    return new Stroke(points, last_length)
  }
}

type Params<Fn = any> = Fn extends (...args: any) => any ? Parameters<Fn> : never

/// Handles named events.
class Observable<EventMap = any> {
  /// @internal
  _observers = new Map<any, Set<any>>()

  on<E extends keyof EventMap>(event: E, fn: EventMap[E]): () => void {
    let set = this._observers.get(event)
    if (set === undefined) {
      this._observers.set(event, set = new Set())
    }
    set.add(fn)
    return this.off.bind(this, event, fn)
  }

  off<E extends keyof EventMap>(event: E, fn: EventMap[E]): void {
    let set = this._observers.get(event)
    if (set !== undefined) {
      set.delete(fn)
      if (set.size == 0) this._observers.delete(event)
    }
  }

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

  dispose() {
    this._observers.clear()
  }
}

interface Transform {
  readonly x: number
  readonly y: number
  readonly scale: number
}

export interface InputEventMap {
  'open': (pointerId: number, point: RawPoint) => void
  'update': (pointerId: number, point: RawPoint) => void
  'cancel': (pointerId: number) => void
  'close': (pointerId: number) => void
  'pinch': (transform: Transform) => void
}

export interface InputConfig {
  /// The element to bind events like `pointermove`.
  dom?: HTMLElement | SVGElement
  /// Whether to stop reporting events, default is `false`.
  paused?: boolean
  /// Whether to handle pinch zoom gestures (multi-touch), default is `true`.
  gesture?: boolean
  /// Whether to use `poinetrEvent.pressure`, default is `true`.
  /// If `false`, it will always use `0.5` as the pressure number.
  /// Or you can set it as a custom number ranges in (0, 1].
  pressure?: boolean | number
  /// Whether to treat mouse wheel events on Windows as scrolling, default is `true`.
  /// If `false`, it will perform zooming on mouse wheel events.
  windowsScroll?: boolean
}

interface PinchDesc { x: number, y: number, area: number }

class Pinch {
  readonly points = new Map<number, PointerEvent>()
  // This pinch runs from (x0, y0, 1) to (x1, y1, scale).
  x0 = 0; y0 = 0; x1 = 0; y1 = 0; scale = 1
  ox = 0; oy = 0; rate = 1

  _desc(): PinchDesc {
    let x = 0, y = 0, area = 0
    for (let ev of this.points.values()) {
      x += ev.clientX
      y += ev.clientY
    }
    x /= this.points.size
    y /= this.points.size
    for (let ev of this.points.values()) {
      area += Math.hypot(ev.clientX - x, ev.clientY - y)
    }
    if (area == 0) area = 1
    return { x, y, area }
  }

  _init(desc: PinchDesc) {
    this.ox = this.oy = 0
    this.rate = 1 / desc.area
    this.x1 = this.x0 = desc.x
    this.y1 = this.y0 = desc.y
    this.scale = 1
  }

  _sync(desc: PinchDesc) {
    this.ox = this.x1 - desc.x
    this.oy = this.y1 - desc.y
    this.rate = this.scale / desc.area
  }

  _update(desc: PinchDesc) {
    this.x1 = desc.x + this.ox
    this.y1 = desc.y + this.oy
    this.scale = desc.area * this.rate
  }

  constructor(readonly input: Input) {}

  get empty(): boolean { return this.points.size == 0 }

  has(id: number): boolean { return this.points.has(id) }

  add(ev: PointerEvent) {
    this.points.set(ev.pointerId, ev)
    let desc = this._desc()
    if (this.points.size == 1) {
      this._init(desc)
    } else {
      this._sync(desc)
      this._update(desc)
    }
  }

  move(ev: PointerEvent) {
    this.points.set(ev.pointerId, ev)
    this._update(this._desc())
    this.input.emit('pinch', { x: this.x0 - this.x1, y: this.y0 - this.y1, scale: this.scale })
  }

  delete(id: number) {
    this.points.delete(id)
    if (this.points.size > 0) {
      let desc = this._desc()
      this._sync(desc)
      this._update(desc)
    }
  }
}

const nav = typeof navigator != 'undefined' ? navigator : { platform: "" }
const browser = {
  mac: /Mac/.test(nav.platform),
  windows: /Win/.test(nav.platform),
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
    /// Whether to treat wheel event as scrolling on Windows, default is `true`.
    /// If `false`, wheel events will be treated as zooming.
    public windowsScroll: boolean = true,
  ) {
    super()
  }

  /// The element to bind events like `pointermove`.
  get dom(): HTMLElement | SVGElement | undefined { return this._dom }
  set dom(v: HTMLElement | SVGElement | undefined) {
    if (this._dom == v) return;
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

  /// @internal The '<=' is intended for (0, 1] check.
  _clamp(val: number, min: number, max: number): number {
    return val <= min ? min : val > max ? max : val
  }

  /// @internal
  _mapPressure(real: number): number {
    return this.pressure === true ? real : this._clamp(this.pressure || 0.5, 0, 1)
  }

  /// @internal
  _mapGesture(ev: PointerEvent): boolean {
    return this.gesture === true || (this.gesture && ev.pointerType == 'touch')
  }

  /// @internal
  _pinch = new Pinch(this)

  /// @internal
  _onpointerdown = (ev: PointerEvent) => {
    if (this.paused) return;
    let id = ev.pointerId
    if (this._map.has(id)) this.emit('cancel', id);
    this._map.set(id, ev)
    ev.preventDefault()
    ev.stopPropagation()
    this._dom!.setPointerCapture(id)
    if (this._mapGesture(ev) && this._map.size > 1) {
      // Emit 'cancel' to all other strokes.
      this._map.forEach((ev2, id2) => {
        if (!this._pinch.has(id2)) {
          if (id != id2) this.emit('cancel', id2)
          this._pinch.add(ev2)
        }
      })
    } else {
      let rect = this._rect = this._dom!.getBoundingClientRect()
      this.emit('open', id, { x: ev.clientX - rect.left, y: ev.clientY - rect.top, r: this._mapPressure(ev.pressure) })
    }
  }

  /// @internal
  _onpointermove = (ev: PointerEvent) => {
    if (this.paused) return;
    let id = ev.pointerId
    ev.preventDefault()
    ev.stopPropagation()
    if (this._map.has(id)) {
      let ev0 = this._map.get(id)!
      // Apple pencil's bug, it fires 2 identical events.
      if (ev0.clientX == ev.clientX && ev0.clientY == ev.clientY) return;
      this._map.set(id, ev)
      // Stroke mode.
      if (this._pinch.empty) {
        // Firefox's bug, it gives 0 to pointer events generated by mouse.
        let pressure: number | undefined
        if (ev.pointerType == 'mouse' && ev.pressure == 0) pressure = this._mapPressure(0.5);
        let { left, top } = this._rect
        // @ts-ignore Get the most precise pointer events.
        if (ev.getCoalescedEvents) for (let ev1 of ev.getCoalescedEvents()) {
          this.emit('update', id, { x: ev1.clientX - left, y: ev1.clientY - top, r: pressure ?? this._mapPressure(ev.pressure) })
        } else {
          this.emit('update', id, { x: ev.clientX - left, y: ev.clientY - top, r: pressure ?? this._mapPressure(ev.pressure) })
        }
      }
      // Pinch mode.
      else {
        this._pinch.move(ev)
      }
    }
  }

  /// @internal
  _onpointerup = (ev: PointerEvent) => {
    if (this.paused) return;
    let id = ev.pointerId
    ev.preventDefault()
    ev.stopPropagation()
    if (this._map.has(id)) {
      // Stroke mode.
      if (this._pinch.empty) {
        // @ts-ignore Safari does not have this method.
        if (ev.getPredictedEvents) {
          let pred = this._map.get(id)?.getPredictedEvents()[0]
          let rect = this._rect
          if (pred) this.emit('update', id, {
            x: Math.round(pred.clientX - rect.left),
            y: Math.round(pred.clientY - rect.top),
            r: this._mapPressure(pred.pressure),
          })
        }
        this.emit('close', id)
      }
      // Pinch mode.
      else {
        this._pinch.delete(id)
      }
      this._map.delete(id)
    }
  }

  /// @internal
  _onpointercancel = (ev: PointerEvent) => {
    if (this.paused) return;
    let id = ev.pointerId
    ev.preventDefault()
    ev.stopPropagation()
    this._map.delete(id)
    // Stroke mode.
    if (this._pinch.empty) {
      this.emit('cancel', id)
    }
    // Pinch mode.
    else {
      this._pinch.delete(ev.pointerId)
    }
  }

  /// @internal
  _onwheel = (ev: WheelEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    let { deltaX, deltaY } = ev
    let scale = Math.hypot(deltaX, deltaY)
    let x = 0, y = 0
    if (browser.windows) scale = -scale;
    if (deltaX + deltaY < 0) scale = -scale;
    // macOS zoom by trackpad
    if (browser.mac && ev.ctrlKey) scale = -scale * 0.5;
    // macOS scroll by trackpad
    else if (browser.mac && ((ev as any).wheelDelta % 120 != 0 || ev.movementX != 0 || ev.deltaX != 0)
          // Windows updown scroll by mouse
          || this.windowsScroll && browser.windows && !ev.ctrlKey) {
      x = -deltaX
      y = -deltaY
      scale = 0
    }
    // Normal zoom by scroll.
    else scale *= C.Scale
    scale = 1 + Math.max(scale, C.MinScale) * C.ScaleRate
    this.emit('pinch', { x, y, scale })
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
    let input = new Input(config.paused, config.gesture, config.pressure, config.windowsScroll)
    input.dom = config.dom
    return input
  }
}
