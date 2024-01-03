import { add, dot, lerp, mul, neg, norm, per, proj, rot, sub, type Vec } from './vec'

// Internal constants, I don't plan to expose them as options.
const enum C {
  // SAI-like input smoothing strategy: keep a queue of points
  // and get middle of them. The queue size is `Smoothing + 1`.
  Smoothing = 1,
  // Skip points that are too close.
  SkipDistance = 5,
  // If |segment| < `MinDistance` and is sharp corner, split here
  // and skip next `CoolingDown` points for performance.
  // `CoolingDown` must > 0.
  MinDistance = 1000, CoolingDown = 1,
  // If the last |segment| > `TailDistance * size`, draw a thinner tail,
  // otherwise draw an end cap.
  TailDistance = 0.4,
  // Math.PI + 0.0001 to prevent floating number issue when drawing the cap.
  PI = 3.1416926535897933,
  // Simulate pressure for mouse and trackpad.
  PressureChangeSpeed = 0.3,
  // Approximate ratio that multiplies `size` to draw a dot.
  DotSize = 0.4125,
  // Minimal stroke width / 2.
  MinRadius = 0.75,
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
      if (this.length - prev_.l < C.SkipDistance) return
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
      // If `end` is `undefined`, this is the final section.
      // In that case draw a thinner tail when possible.
      if (end == null && points[len - 1].d > C.TailDistance * size) {
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
  private updateLength(d: number) {
    (this as { length: number }).length += d
  }

  /// @internal Update `sections` incrementally using current `points`.
  private updateSections() {
    let { sections } = this;
    for (let i = sections.length > 1 ? (sections[sections.length-1] + C.CoolingDown) : 1,
             len = this.points.length; i < len; i++) {
      if (this.points[i].d < C.MinDistance &&
          dot(this.points[i].v, this.points[i-1].v) < 0) {
        sections.push(i)
        i += C.CoolingDown
      }
    }
  }

  /// @internal
  private updateCurr(p: RawPoint, n: number): RawPoint {
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
    let points: Point[] = [], ll = 0
    if (raw.length > 0) {
      let prev = raw[0], l = 0, fake = { queue: [] }
      points.push(new Point(prev, prev.r, { x: 1, y: 1 }, 0, 0))
      for (let i = 1; i < raw.length; i++) {
        let p = raw[i], curr: RawPoint
        // @ts-ignore No smoothing, get the raw input.
        if (C.Smoothing == 0) curr = p
        // @ts-ignore Level-1 smoothing, get the center of each segment.
        else if (C.Smoothing == 1)
          curr = { x: (p.x + prev.x) / 2, y: (p.y + prev.y) / 2, r: p.r }
        // Level-N smoothing
        else {
          curr = Stroke.prototype.updateCurr.call(fake, p, C.Smoothing + 1)
        }
        let d = Math.hypot(curr.x - prev.x, curr.y - prev.y)
        l += d
        if (l - ll < C.SkipDistance) continue;
        points.push(new Point(curr, curr.r, norm(sub(prev, curr)), d, l))
        prev = curr
        ll = l
      }
    }
    return new Stroke(points, ll)
  }
}
