export const clamp = (value: number, min: number, max: number) => value < min ? min : value > max ? max : value;

export interface IPoint {
  readonly x: number;
  readonly y: number;
}

export interface IRectangle extends IPoint {
  readonly width: number;
  readonly height: number;
}

export class Vec {
  /// @internal
  constructor(
    readonly x: number,
    readonly y: number,
  ) { }

  static of(x: number, y: number) {
    return new Vec(x, y);
  }

  static from(vec: IPoint) {
    return new Vec(vec.x, vec.y);
  }

  add(other: IPoint) {
    return new Vec(this.x + other.x, this.y + other.y);
  }

  subtract(other: IPoint) {
    return new Vec(this.x - other.x, this.y - other.y);
  }

  multiply(scalar: number) {
    return new Vec(this.x * scalar, this.y * scalar);
  }

  normalize(d = Math.hypot(this.x, this.y)) {
    return new Vec(this.x / d, this.y / d);
  }

  /// Rotate the vector by 90 degrees. → becomes ↑
  permutate() {
    return new Vec(-this.y, this.x);
  }

  negative() {
    return new Vec(-this.x, -this.y);
  }

  middle(other: IPoint) {
    return new Vec((this.x + other.x) / 2, (this.y + other.y) / 2);
  }

  /// Rotate the vector around a center point.
  rotate(center: IPoint, radius: number) {
    const s = Math.sin(radius), c = Math.cos(radius),
          px = this.x - center.x, py = this.y - center.y,
          nx = px * c - py * s, ny = px * s + py * c;
    return new Vec(nx + center.x, ny + center.y);
  }

  dot(other: IPoint) {
    return this.x * other.x + this.y * other.y;
  }

  lerp(other: IPoint, t: number) {
    return new Vec(this.x + (other.x - this.x) * t, this.y + (other.y - this.y) * t);
  }

  project(other: IPoint, c: number) {
    return new Vec(this.x + other.x * c, this.y + other.y * c);
  }
}
