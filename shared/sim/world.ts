import type { Arena, EntityId } from "../protocol.ts";
import { ARENA, applyEdges } from "./arena.ts";
import { collisionPairs } from "./collision.ts";
import type { Entity } from "./entity.ts";
import type { FlightInput } from "./flight.ts";

type WorldOptions = {
  arena?: Arena;
  findPairs?: (world: World) => Iterable<[Entity, Entity]>;
  events?: EventTarget;
  onCollision?: (a: Entity, b: Entity, world: World) => void;
};

export class World {
  readonly arena: Arena;
  private findPairs: NonNullable<WorldOptions["findPairs"]>;
  readonly events: EventTarget;
  private onCollision: NonNullable<WorldOptions["onCollision"]>;
  #entities = new Map<EntityId, Entity>();
  #pendingSpawn = new Map<EntityId, Entity>();
  #dead = new Set<EntityId>();
  #stepping = false;

  constructor({
    arena = ARENA,
    findPairs = collisionPairs,
    events = new EventTarget(),
    onCollision = () => {},
  }: WorldOptions = {}) {
    this.arena = arena;
    this.findPairs = findPairs;
    this.events = events;
    this.onCollision = onCollision;
  }

  spawn<T extends Entity>(entity: T): T {
    const store = this.#stepping ? this.#pendingSpawn : this.#entities;
    store.set(entity.id, entity);
    return entity;
  }

  despawn(id: EntityId) {
    const entity = this.get(id) ?? this.#pendingSpawn.get(id);
    if (!entity) return false;
    entity.alive = false;
    this.#dead.add(id);
    return true;
  }

  emit(type: string, detail: unknown) {
    this.events.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get(id: EntityId) {
    return this.#entities.get(id);
  }

  *[Symbol.iterator]() {
    yield* this.#entities.values();
  }

  *ofKind(kind: string) {
    for (const entity of this) {
      if (entity.alive && entity.kind === kind) yield entity;
    }
  }

  step(dt: number, inputs: ReadonlyMap<EntityId, FlightInput> = new Map()) {
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
