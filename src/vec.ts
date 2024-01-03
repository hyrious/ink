/// 2D vector
export interface Vec {
  readonly x: number
  readonly y: number
}

export const norm = ({ x, y }: Vec, d = Math.hypot(x, y)): Vec => ({ x: x / d, y: y / d })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Vec, n: number): Vec => ({ x: a.x * n, y: a.y * n })
export const per = ({ x, y }: Vec): Vec => ({ x: y, y: -x })
export const neg = ({ x, y }: Vec): Vec => ({ x: -x, y: -y })
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/// Rotate point `(x, y)` around point `C` in raidus `r`.
export const rot = ({ x, y }: Vec, C: Vec, r: number) => {
  const s = Math.sin(r), c = Math.cos(r),
        px = x - C.x, py = y - C.y,
        nx = px * c - py * s,
        ny = px * s + py * c
  return { x: nx + C.x, y: ny + C.y }
}

export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
export const lerp = (a: Vec, b: Vec, t: number) => add(a, mul(sub(b, a), t))
export const proj = (a: Vec, b: Vec, c: number) => add(a, mul(b, c))

export const copy = (a: Vec, b: Vec) => {
  (a as { x: number }).x = b.x;
  (a as { y: number }).y = b.y
  return a
}
