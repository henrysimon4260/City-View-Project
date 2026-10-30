export interface UnitActivation {
  buildingId: string;
  floor: number;
  /** Null when the click is the grey unverified floor plate rather than a sourced unit. */
  unitId: string | null;
  ringStatus: "estimated" | "confirmed" | "unverified";
}

type GalleryHandler = (event: UnitActivation) => void;

const handlers = new Set<GalleryHandler>();

/**
 * Photo crossfade is intentionally not implemented.
 * Call `onUnitActivated` from a later module to receive unit clicks.
 */
export function onUnitActivated(handler: GalleryHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function activateUnit(event: UnitActivation): void {
  for (const handler of handlers) handler(event);
}

export function galleryListenerCount(): number {
  return handlers.size;
}
