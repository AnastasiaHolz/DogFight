export type Point = Readonly<{ x: number; y: number }>;

export class Vector2 {
  readonly x: number;
  readonly y: number;
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    Object.freeze(this);
  }

  add(other: Point) {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  sub(other: Point) {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  scale(factor: number) {
    return new Vector2(this.x * factor, this.y * factor);
  }

  length() {
    return Math.hypot(this.x, this.y);
  }

  normalize() {
    const length = this.length();
    return length > 0 ? this.scale(1 / length) : new Vector2();
  }

  rotate(angle: number) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vector2(
      this.x * cos - this.y * sin,
      this.x * sin + this.y * cos,
    );
  }

  dot(other: Point) {
    return this.x * other.x + this.y * other.y;
  }

  static fromAngle(angle: number) {
    return new Vector2(Math.cos(angle), Math.sin(angle));
  }
}
