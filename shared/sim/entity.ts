import { entityId } from "../protocol.ts";
import type { FlightInput } from "./flight.ts";
import { Vector2 } from "./vector.ts";
import type { World } from "./world.ts";

export type Edge = "none" | "wrap" | "bounce";
export type EntityOptions = {
  kind?: string;
  pos?: Vector2;
  vel?: Vector2;
  angle?: number;
  radius?: number;
  edge?: Edge;
  collidable?: boolean;
};

export class Entity {
  kind: string;
  pos: Vector2;
  prevPos: Vector2;
  vel: Vector2;
  angle: number;
  prevAngle: number;
  radius: number;
  edge: Edge;
  collidable: boolean;
  alive: boolean;
  static #nextId = 1;
  #id = entityId(Entity.#nextId++);

  constructor({
    kind = "entity",
    pos = new Vector2(),
    vel = new Vector2(),
    angle = 0,
    radius = 0,
    edge = "none",
    collidable = true,
  }: EntityOptions = {}) {
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

  update(dt: number, _world?: World, _input?: FlightInput) {
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
