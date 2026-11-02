import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { clampToLowerManhattan } from "../model/bounds";
import { fromLocal, groundForward, groundRight, lookVector, toLocal } from "./geodesy";

export interface Rig {
  pivot: Vector3;
  heading: number;
  pitch: number;
  distance: number;
}

const PITCH_MIN = (-80 * Math.PI) / 180;
const PITCH_MAX = (-2 * Math.PI) / 180;
const DIST_MIN = 32;
const DIST_MAX = 5400;

export class MapControls {
  readonly current: Rig;
  home: Rig;
  mode: "home" | "focus" = "home";
  enabled = true;
  private desired: Rig;
  private animation: { from: Rig; to: Rig; elapsed: number; duration: number; mode: "home" | "focus" } | null = null;
  private dragging = false;
  private dragMode: "pan" | "orbit" = "pan";
  private lastX = 0;
  private lastY = 0;
  private panVx = 0;
  private panVy = 0;
  private orbitVx = 0;
  private orbitVy = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; angle: number; midX: number; midY: number } | null = null;
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();
  private readonly right = new Vector3();
  private readonly forward = new Vector3();
  private readonly look = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    const pivot = new Vector3();
    this.current = { pivot, heading: 0, pitch: -0.82, distance: 1800 };
    this.desired = cloneRig(this.current);
    this.home = cloneRig(this.current);
    this.bind();
  }

  setHome(rig: Rig): void {
    this.home = cloneRig(rig);
  }

  snap(rig: Rig, mode: "home" | "focus"): void {
    this.animation = null;
    this.mode = mode;
    copyRig(this.current, rig);
    copyRig(this.desired, rig);
    this.apply(1);
  }

  flyTo(rig: Rig, duration: number, mode: "home" | "focus"): void {
    if (duration <= 0) {
      this.snap(rig, mode);
      return;
    }
    this.animation = { from: cloneRig(this.current), to: cloneRig(rig), elapsed: 0, duration, mode };
  }

  faceNorth(duration: number): void {
    const next = cloneRig(this.desired);
    next.heading = 0;
    this.flyTo(next, duration, this.mode);
  }

  get introducing(): boolean {
    return this.animation != null;
  }

  update(dt: number): void {
    if (this.animation) {
      this.animation.elapsed += dt;
      const t = Math.min(1, this.animation.elapsed / this.animation.duration);
      const k = 1 - (1 - t) ** 4;
      const { from, to } = this.animation;
      this.current.pivot.lerpVectors(from.pivot, to.pivot, k);
      this.current.heading = lerpAngle(from.heading, to.heading, k);
      this.current.pitch = from.pitch + (to.pitch - from.pitch) * k;
      this.current.distance = from.distance + (to.distance - from.distance) * k;
      if (t >= 1) {
        this.mode = this.animation.mode;
        copyRig(this.desired, this.current);
        this.animation = null;
      }
      this.apply(dt);
      return;
    }
    if (!this.dragging) {
      const decay = Math.exp(-3.1 * dt);
      this.panVx *= decay;
      this.panVy *= decay;
      this.orbitVx *= decay;
      this.orbitVy *= decay;
      if (Math.hypot(this.panVx, this.panVy) > 0.4) this.panPixels(this.panVx * dt, this.panVy * dt);
      if (Math.hypot(this.orbitVx, this.orbitVy) > 0.01) this.orbitPixels(this.orbitVx * dt, this.orbitVy * dt);
    }
    const lambda = this.dragging ? 22 : 10;
    const blend = 1 - Math.exp(-lambda * dt);
    this.current.pivot.lerp(this.desired.pivot, blend);
    this.current.heading = lerpAngle(this.current.heading, this.desired.heading, blend);
    this.current.pitch += (this.desired.pitch - this.current.pitch) * blend;
    this.current.distance += (this.desired.distance - this.current.distance) * blend;
    this.apply(dt);
  }

  private apply(_dt: number): void {
    lookVector(this.current.heading, this.current.pitch, this.look);
    this.camera.position.copy(this.current.pivot).addScaledVector(this.look, -this.current.distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.current.pivot);
    this.camera.updateMatrixWorld();
  }

  private bind(): void {
    const dom = this.dom;
    dom.addEventListener("contextmenu", (event) => event.preventDefault());
    dom.addEventListener("pointerdown", (event) => this.onDown(event));
    dom.addEventListener("pointermove", (event) => this.onMove(event));
    dom.addEventListener("pointerup", (event) => this.onUp(event));
    dom.addEventListener("pointercancel", (event) => this.onUp(event));
    dom.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    dom.addEventListener("dblclick", (event) => this.onDouble(event));
  }

  private interrupt(): void {
    if (!this.animation) return;
    this.animation = null;
    copyRig(this.desired, this.current);
    this.mode = "focus";
  }

  private onDown(event: PointerEvent): void {
    if (!this.enabled || event.button > 2) return;
    this.interrupt();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.dom.setPointerCapture(event.pointerId);
    this.panVx = this.panVy = this.orbitVx = this.orbitVy = 0;
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.dragMode = event.button === 2 || event.ctrlKey || event.metaKey ? "orbit" : "pan";
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    }
    this.syncPinch();
  }

  private onMove(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    previous.x = event.clientX;
    previous.y = event.clientY;
    if (this.pointers.size >= 2) {
      this.movePinch();
      return;
    }
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    const dt = 1 / 60;
    if (this.dragMode === "orbit") {
      this.orbitPixels(dx, dy);
      this.orbitVx = dx / dt;
      this.orbitVy = dy / dt;
    } else {
      this.panPixels(dx, dy);
      this.panVx = dx / dt;
      this.panVy = dy / dt;
    }
  }

  private onUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.dragging = false;
    else this.syncPinch();
  }

  private onWheel(event: WheelEvent): void {
    if (!this.enabled) return;
    event.preventDefault();
    this.interrupt();
    const rect = this.dom.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.groundAt(ndcX, ndcY);
    const factor = Math.exp(event.deltaY * 0.00115);
    const next = clamp(this.desired.distance * factor, DIST_MIN, DIST_MAX);
    if (hit) {
      const t = Math.max(-0.65, Math.min(0.8, 1 - next / this.desired.distance));
      this.desired.pivot.lerp(hit, t);
    }
    this.desired.distance = next;
    this.clampDesired();
    this.mode = "focus";
  }

  private onDouble(event: MouseEvent): void {
    const rect = this.dom.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.groundAt(ndcX, ndcY);
    const next = cloneRig(this.desired);
    next.distance = clamp(next.distance * 0.55, DIST_MIN, DIST_MAX);
    if (hit) next.pivot.lerp(hit, 0.45);
    this.flyTo(next, 0.7, "focus");
  }

  private syncPinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) {
      this.pinch = null;
      return;
    }
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    this.pinch = {
      distance: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx),
      midX: (pts[0].x + pts[1].x) / 2,
      midY: (pts[0].y + pts[1].y) / 2,
    };
  }

  private movePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2 || !this.pinch) return;
    this.interrupt();
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    const distance = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    this.desired.distance = clamp(this.desired.distance * (this.pinch.distance / distance), DIST_MIN, DIST_MAX);
    this.desired.heading -= angle - this.pinch.angle;
    this.panPixels(midX - this.pinch.midX, midY - this.pinch.midY);
    this.pinch = { distance, angle, midX, midY };
    this.mode = "focus";
  }

  private panPixels(dx: number, dy: number): void {
    const height = Math.max(1, this.dom.clientHeight);
    const meters =
      (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.current.distance) /
      height /
      Math.max(0.42, Math.sin(-this.current.pitch));
    groundRight(this.desired.heading, this.right);
    groundForward(this.desired.heading, this.forward);
    this.desired.pivot.addScaledVector(this.right, -dx * meters);
    this.desired.pivot.addScaledVector(this.forward, dy * meters);
    this.clampDesired();
    this.mode = "focus";
  }

  private orbitPixels(dx: number, dy: number): void {
    this.desired.heading -= dx * 0.0052;
    this.desired.pitch = clamp(this.desired.pitch - dy * 0.0036, PITCH_MIN, PITCH_MAX);
    this.mode = "focus";
  }

  private groundAt(ndcX: number, ndcY: number): Vector3 | null {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.plane.constant = -this.current.pivot.y;
    return this.raycaster.ray.intersectPlane(this.plane, this.hit)?.clone() ?? null;
  }

  private clampDesired(): void {
    const y = this.desired.pivot.y;
    const cart = fromLocal(this.desired.pivot);
    const [lon, lat] = clampToLowerManhattan(cart.longitude, cart.latitude);
    const next = toLocal(lon, lat, cart.height, new Vector3());
    this.desired.pivot.copy(next);
    this.desired.pivot.y = y;
    this.desired.distance = clamp(this.desired.distance, DIST_MIN, DIST_MAX);
    this.desired.pitch = clamp(this.desired.pitch, PITCH_MIN, PITCH_MAX);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerpAngle(from: number, to: number, t: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

export function cloneRig(rig: Rig): Rig {
  return { pivot: rig.pivot.clone(), heading: rig.heading, pitch: rig.pitch, distance: rig.distance };
}

function copyRig(target: Rig, source: Rig): void {
  target.pivot.copy(source.pivot);
  target.heading = source.heading;
  target.pitch = source.pitch;
  target.distance = source.distance;
}

