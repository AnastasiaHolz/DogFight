import { Vector2 } from "./vector.js";

export class Entity {
  static #nextId = 1;
  #id = Entity.#nextId++;

  constructor({
    kind = "entity",
    pos = new Vector2(),
    vel = new Vector2(),
    angle = 0,
    radius = 0,
    edge = "none",
    collidable = true,
  } = {}) {
    this.kind = kind;
    this.pos = pos;
    this.prevPos = pos;
    this.vel = vel;
    this.angle = angle;
    this.prevAngle = angle;
    this.radius = radius;
    this.edge = edge;
    this.collidable = collidable;
    this.alive = true;
  }

  get id() {
    return this.#id;
  }

  snapshot() {
    this.prevPos = this.pos;
    this.prevAngle = this.angle;
  }

  update(dt) {
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
