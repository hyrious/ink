//
// Strokes are made up of a series of points, each point may have a pressure and a timestamp.
// The algorithm's goal is to calculate a smooth outline of these points with known information.
// The basic idea is each stroke is affected by 2 factors:
//
// - "Thinning": The stroke will be thinner if the pressure is lower and
//               distance per interval between points become longer.
//               Without timestamp we can assume the interval is constant.
//
// - "Spreading": The last several points will spread (be bigger) even after you lift the pen.
//

import { clamp, IPoint, Vec } from "./base";
import { Spring } from "./spring";

/// The data structure for raw input point, should be easy to convert from pointer events.
export class RawPoint implements IPoint {
  /// @internal
  constructor(
    readonly x: number,
    readonly y: number,
    /// Pressure, range from 0 to 1. Use 0.5 for no-pressure cases.
    readonly p: number,
    /// Timestamp in milliseconds. Use 0 for no-timestamp cases.
    readonly t: number,
  ) { }

  /// Construct a RawPoint from x, y, pressure and timestamp.
  static of(x: number, y: number, pressure: number, timestamp: number) {
    return new RawPoint(x, y, pressure, timestamp);
  }

  /// Construct a RawPoint from a PointerEvent.
  /// The position is from clientX and clientY, which may not be the best choice
  /// for draw boards supporting pinch and zoom. Use {@link RawPoint.of} instead.
  static fromEvent(event: PointerEvent, pressure = clamp(event.pressure || 0.5, 0, 1)) {
    // Some stylus devices may report zero pressure, treat as no-pressure.
    return new RawPoint(event.clientX, event.clientY, pressure, performance.timeOrigin + event.timeStamp);
  }

  /// @internal
  static fromJSON(json: any) {
    return new RawPoint(json.x, json.y, json.p, json.t);
  }
}

/// The data structure for a point in a stroke, it has context information like
/// its direction, distance to the previous point, and running length.
export class Point {
  /// @internal
  constructor(
    readonly p: RawPoint,
    /// Inverted direction of this point, equals to `previous - current`.
    /// The first point's direction is the same as the second point.
    readonly v: Vec,
    /// Distance to the previous point, equals to `hypot(previous - current)`.
    readonly d: number,
    /// Running length from the first point to this point.
    readonly l: number,
  ) { }

  static of(point: RawPoint, vector: Vec, distance: number, length: number) {
    return new Point(point, vector, distance, length);
  }

  /// @internal
  static fromJSON(json: any) {
    return new Point(RawPoint.fromJSON(json.p), Vec.from(json.v), json.d, json.l);
  }
}

// Constants which should not be exported as options.
const enum C {
  // Skip points that are too close.
  SkipDistance = 4,
  // If the tail's length > `TailDistance * size`, draw a thinner tail,
  // otherwise draw an end cap.
  TailInterval = 100,
  TailDistance = 0.51,
  TailPressure = 0.72,
  // Math.PI + 0.0001 to prevent floating number issue when drawing the cap.
  PI = 3.1416926535897933,
  // Simulate pressure for mouse and trackpad.
  PressureChangeSpeed = 0.5,
  // Approximate ratio that multiplies `size` to draw a dot.
  DotSize = 0.36,
  // Minimal stroke width / 2.
  MinRadius = 0.75,
  // Spreading interval in milliseconds.
  SpreadInterval = 60,
  // Spreading amount per interval.
  SpreadAmount = 0.05,
}

/// @internal Increase each point's pressure in the next period with a small amount.
function pressureTillNow(p: Point, now: number) {
  if (now - p.p.t > C.SpreadInterval) return Math.min(p.p.p + C.SpreadAmount, 1);
  return Math.min(p.p.p + C.SpreadAmount * (now - p.p.t) / C.SpreadInterval, 1);
}

/// @internal Increase pressure for the next period with a small amount.
function pressureTillNow2(p: number, t: number, now: number) {
  if (now - t > C.SpreadInterval) return Math.min(p + C.SpreadAmount, 1);
  return Math.min(p + C.SpreadAmount * (now - t) / C.SpreadInterval, 1);
}

/// The data structure for a stroke.
export class Stroke {
  /// Indexes to split {@link Stroke.points} into curves. The first index is always `0`.
  readonly segments: number[] = [0]
  /// @internal See {@link Stroke.insert}.
  readonly pending: { [from: number]: RawPoint[] } = { __proto__: null } as any

  /// @internal
  constructor(
    /// The stroke's points. It grows on {@link Stroke.insert} and {@link Stroke.push}.
    readonly points: Point[],
    /// The stroke's length, equals to `points.at(-1).l`.
    /// {@link Stroke.insert} and {@link Stroke.push} will update this value.
    readonly length = points.length > 0 ? points[points.length - 1].l : 0,
  ) { }

  /// Create a stroke from raw points.
  static of(raw: RawPoint[] = []): Stroke {
    let stroke = new Stroke([], 0)
    for (let p of raw) stroke._push(p)
    stroke._updateSegments()
    return stroke
  }

  /// Revive a stroke from `JSON.parse(JSON.stringify(oldStroke))`.
  static fromJSON(json: any) {
    let stroke = new Stroke(json.points.map(Point.fromJSON), json.length);
    (stroke as { segments: number[] }).segments = json.segments;
    (stroke as { pending: { [from: number]: RawPoint[] } }).pending = json.pending;
    return stroke;
  }

  /// True when no points in the stroke.
  get empty() { return this.length == 0 }

  /// True when the stroke has only one point.
  get dot() { return this.points.length == 1 }

  /// Update the stroke with new points inserted from `from`.
  /// The `from` can exceed the stroke's length, where the points will be
  // pending until there be new points fill the gap.
  insert(from: number, raw: RawPoint[]): this {
    if (from == this.points.length) {
      for (let p of raw) this._push(p)
      from = this.points.length
      if (raw = this.pending[from]) {
        delete this.pending[from]
        this.insert(from, raw)
      }
      // Recursively call {@link Stroke.insert} to flush pending points.
      // Ensure a {@link Stroke._updateSegments} is called at the end of the recursion.
      else {
        this._updateSegments()
      }
    }
    else if (from > this.points.length) {
      this.pending[from] = raw
    }
    else {
      throw new RangeError(`Position ${from} conflicts with existing points`)
    }
    return this
  }

  /// Update the stroke by pushing new points to the end.
  push(raw: RawPoint): this {
    this._push(raw)
    this._updateSegments()
    return this
  }

  /// @internal This method does not call `_updateSegments`.
  _push(raw: RawPoint) {
    let points = this.points
    if (points.length > 0) {
      let prev = points[points.length - 1]
      let d = Math.hypot(raw.x - prev.p.x, raw.y - prev.p.y)
      this._updateLength(d)
      if (this.length - prev.l < C.SkipDistance) {
        // Skip this point, but preserve its pressure.
        (prev.p as { p: number }).p = Math.max(prev.p.p, raw.p)
        return
      }
      points.push(Point.of(raw, Vec.from(raw).subtract(prev.p).normalize(), d, this.length))
    } else {
      points.push(Point.of(raw, Vec.of(0, 0), 0, 0))
    }
  }

  /// Is the stroke still "spreading"?
  isSpreading(now = performance.timeOrigin + performance.now()): boolean {
    return this.points.length > 0 && now - this.points[this.points.length - 1].p.t < C.SpreadInterval
  }

  /// Compute the outline points of the segment starting at `from`.
  /// Returns an empty array if `from` is not in {@link Stroke.segments}.
  /// The `size` is the full width when pressure is 1.
  /// If the `tail` is true, it will simulate a thin tail when the last segment is long enough.
  outline(from: number, size: number, now = performance.timeOrigin + performance.now(), tail = true): IPoint[] {
    let end = this.segments.find(end => from < end)
    let points = this.points.slice(from > 0 ? from - 1 : from, end)
    if (points.length > 1) {
      let leftPoints: Vec[] = [], rightPoints: Vec[] = [], length = points.length,
          radius = size, prevPressure = points[0].p.p, lastPressure = points[length - 1].p.p,
          drawEndCap = true, tailIndex = -1, prevTimestamp = points[0].p.t,
          spring = new Spring(Math.max(prevPressure, C.DotSize / 5))
      // Draw a tail if the last segment is long enough.
      // The precisely comparing to 0.5 and 1.0 is probably a mouse event generated by chrome or firefox.
      if (tail && end == null && length >= 2 && (prevPressure == 0.5 || prevPressure == 1 || lastPressure < C.TailPressure)) {
        drawEndCap = false
        // The last point is maybe a predicted point (no sense), so use the one before it.
        let p2 = points[length - 2]
        // Get the distance of tail in some time, if it is long enough then draw a tail.
        let d = p2.d, p1 = p2, t = 0
        for (let i = length - 3; i >= 0; i--) {
          p1 = points[i]
          d += p1.d
          t = p2.p.t - p1.p.t
          if (t <= 0 || t > C.TailInterval) break
          tailIndex = i
        }
        if (d > C.TailDistance * size) {
          tailIndex += Math.ceil((length - tailIndex) / 3)
        } else {
          tailIndex = length - 3
        }
      }
      // Simulate pressure and push points.
      for (let i = 0; i < length; i++) {
        let { p, v, d } = points[i]
        // Fix first point's distance and direction (assume the same as the next point).
        if (i == 0) {
          d = 0
          v = points[1].v
        }
        let sp = Math.min(1, d / size), rp = Math.min(1, 1 - sp),
            pressure = Math.min(1, prevPressure + (rp - prevPressure) * (sp * C.PressureChangeSpeed)),
            nextVector = (i < length - 1 ? points[i + 1] : points[i]).v,
            nextDot = i < length - 1 ? v.dot(nextVector) : 1

        pressure = spring.set(pressure).update((p.t - prevTimestamp) / 800)
        // Tail case.
        if (!drawEndCap && i >= tailIndex) {
          let t = 1 - (length - i - 1) / (length - tailIndex)
          pressure = pressure * (1 - t * t)
        }

        radius = clamp(size * 0.5 * pressureTillNow2(pressure, p.t, now), C.MinRadius, size / 2)

        let offset = nextVector.lerp(v, nextDot).permutate().multiply(radius),
            pl = Vec.from(p).subtract(offset),
            pr = Vec.from(p).add(offset)

        leftPoints.push(pl)
        rightPoints.push(pr)

        prevTimestamp = p.t
        prevPressure = p.p
      }
      let startCap: Vec[] = [], firstPoint = rightPoints[0], endCap: Vec[] = []
      for (let step = 1 / 13, t = 0; t <= 1; t += step) {
        startCap.push(firstPoint.rotate(points[0].p, C.PI * t))
      }
      if (drawEndCap) {
        let lastPoint = points[length - 1],
            direction = lastPoint.v.negative().permutate(),
            start = Vec.from(lastPoint.p).project(direction, radius)
        for (let step = 1 / 13, t = 0; t < 1; t += step) {
          endCap.push(start.rotate(lastPoint.p, C.PI * t))
        }
      }
      return leftPoints.concat(endCap, rightPoints.reverse(), startCap)
    }
    // Dot case.
    else if (points.length == 1) {
      let p = points[0],
          start = Vec.from(p.p).project(Vec.of(1, 0), size * C.DotSize * pressureTillNow(p, now)),
          circle: Vec[] = []
      for (let step = 1 / 13, t = 0; t <= 2; t += step) {
        circle.push(start.rotate(p.p, C.PI * t))
      }
      return circle
    }
    else {
      return []
    }
  }

  /// Construct an SVG path string from raw points with basic smoothing.
  /// If `loop` is `true`, the path will be closed.
  stroke(points: IPoint[] = this.points.map(p => p.p), loop = false): string {
    let n = points.length
    if (n == 0) return ""
    let prev = points[0], path = '', curr: IPoint, middle: IPoint
    if (loop) {
      middle = Vec.from(prev).middle(points[n - 1])
      path += `M${middle.x.toFixed(2)},${middle.y.toFixed(2)}`
      for (let i = 1; i < n; i++) {
        curr = points[i], middle = Vec.from(prev).middle(curr)
        path += `Q${prev.x.toFixed(2)},${prev.y.toFixed(2)} ${middle.x.toFixed(2)},${middle.y.toFixed(2)}`
        prev = curr
      }
      if (n > 1) path += 'Z'
    } else {
      path += `M${prev.x.toFixed(2)},${prev.y.toFixed(2)}`
      for (let i = 1; i < n; i++) {
        curr = points[i], middle = Vec.from(prev).middle(curr)
        if (i == 1) path += `L${middle.x.toFixed(2)},${middle.y.toFixed(2)}`
        else path += `Q${prev.x.toFixed(2)},${prev.y.toFixed(2)} ${middle.x.toFixed(2)},${middle.y.toFixed(2)}`
        prev = curr
      }
      if (n > 1) path += `L${prev.x.toFixed(2)},${prev.y.toFixed(2)}`
    }
    return path
  }

  /// @internal Increase the running length.
  _updateLength(d: number) {
    (this as { length: number }).length += d
  }

  /// @internal Update {@link Stroke.segments} using current {@link Stroke.points}.
  _updateSegments() {
    let segments = this.segments, points = this.points, n = points.length
    for (let i = segments[segments.length - 1] + 1; i < n; i++) {
      if (points[i].v.dot(points[i - 1].v) < 0) {
        segments.push(i)
        i++
      }
    }
  }
}
