export type Selection =
  | { kind: "browse" }
  | { kind: "context"; bin: string; heightRoofFt: number | null; groundElevationFt: number | null; plinth: boolean }
  | { kind: "building"; buildingId: string }
  | { kind: "floor"; buildingId: string; floor: number }
  | { kind: "view"; buildingId: string; floor: number };

export interface UiModel {
  selection: Selection;
  sunPreview: boolean;
  shadows: boolean;
  imageryNote: string | null;
}

export interface UiActions {
  selectBuilding: (id: string) => void;
  selectFloor: (floor: number) => void;
  flyToFloor: () => void;
  enterView: () => void;
  back: () => void;
  home: () => void;
  toggleSun: () => void;
  toggleShadows: () => void;
}
