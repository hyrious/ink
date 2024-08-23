const enum C {
  initial = 0.36,
  timespan = 0.016667,
  stiffness = 0.75,
  damping = 0.25,
  precision = 0.01,
}

export class Spring {
  value = C.initial
  last = C.initial
  target = C.initial
  set(target: number): this {
    this.target = target
    return this
  }
  update(dt?: number): number {
    if (!dt) dt = C.timespan
    if (this.value >= 0 && this.target >= 0 && this.last >= 0) {
      let v = this.target
      let delta = v - this.value
      let velocity = (this.value - this.last) / dt
      let spring = C.stiffness * delta
      let damper = C.damping * velocity
      let acceleration = spring - damper
      let d = (velocity + acceleration) * dt
      this.last = this.value
      if (Math.abs(d) < C.precision && Math.abs(delta) < C.precision) {
        this.value = this.target
      } else {
        this.value += d
      }
    }
    return this.value
  }
}
