import { ARENA, applyEdges } from "./arena.js";
import { collisionPairs } from "./collision.js";

export class World {
  #entities = new Map();
  #pendingSpawn = new Map();
  #dead = new Set();
  #stepping = false;

  constructor({
    arena = ARENA,
    findPairs = collisionPairs,
    events = new EventTarget(),
    onCollision = () => {},
  } = {}) {
    this.arena = arena;
    this.findPairs = findPairs;
    this.events = events;
    this.onCollision = onCollision;
  }

  spawn(entity) {
    const store = this.#stepping ? this.#pendingSpawn : this.#entities;
    store.set(entity.id, entity);
    return entity;
  }

  despawn(id) {
    const entity = this.get(id) ?? this.#pendingSpawn.get(id);
    if (!entity) return false;
    entity.alive = false;
    this.#dead.add(id);
    return true;
  }

  emit(type, detail) {
    this.events.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get(id) {
    return this.#entities.get(id);
  }

  *[Symbol.iterator]() {
    yield* this.#entities.values();
  }

  *ofKind(kind) {
    for (const entity of this) {
      if (entity.alive && entity.kind === kind) yield entity;
    }
  }

  step(dt, inputs = new Map()) {
    this.#stepping = true;
    try {
      for (const entity of this) {
        if (!entity.alive) continue;
        entity.snapshot();
        entity.update(dt, this, inputs.get(entity.id));
        if (entity.alive) applyEdges(entity, this.arena);
      }

      for (const [a, b] of this.findPairs(this)) {
        if (a.alive && b.alive) this.onCollision(a, b, this);
      }
    } finally {
      for (const id of this.#dead) {
        this.#entities.delete(id);
        this.#pendingSpawn.delete(id);
      }
      this.#dead.clear();
      for (const entity of this.#pendingSpawn.values()) {
        this.#entities.set(entity.id, entity);
      }
      this.#pendingSpawn.clear();
      this.#stepping = false;
    }
  }
}
