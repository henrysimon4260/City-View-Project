export type VerificationStatus = "confirmed" | "estimated" | "unverified";

export interface DataPoint<T> {
  value: T;
  status: VerificationStatus;
  sources: string[];
  note?: string;
}

export interface Citation {
  id: string;
  title: string;
  publisher: string;
  url: string;
  retrieved: string;
  note?: string;
}

export interface AddressRecord {
  text: string;
  roles: string[];
  status: "confirmed";
  sources: string[];
}

/** A repeating unit line, for example line A on floors 5–30. Rings are optional and must be sourced. */
export interface UnitLine {
  lineId: string;
  floorStart: number;
  floorEnd: number;
  ring: [number, number][] | null;
  ringStatus: VerificationStatus;
  sources: string[];
  note?: string;
}

export interface ConflictRecord {
  field: string;
  modelValue: string;
  otherValue: string;
  status: "unverified";
  sources: string[];
  note: string;
}

export interface Corroboration {
  field: string;
  value: string;
  sources: string[];
  note: string;
}

/** One ordinal story. Elevations are feet above the city ground elevation, or null when they were not measured. */
export interface FloorRecord {
  number: number;
  label: string | null;
  baseFt: number | null;
  topFt: number | null;
  elevationStatus: VerificationStatus;
  sources: string[];
  note?: string;
}

export interface MassingSummary {
  kind: "citygml" | "footprint-envelope";
  status: VerificationStatus;
  sources: string[];
  note: string;
}

export interface BuildingRecord {
  id: string;
  name: string;
  bin: string;
  bbl: string;
  footprintRings: [number, number][][];
  centroid: [number, number];
  addresses: AddressRecord[];
  stories: DataPoint<number>;
  heightRoofFt: DataPoint<number>;
  groundElevationFt: DataPoint<number>;
  residentialUnits: DataPoint<number>;
  totalUnits: DataPoint<number>;
  dwellingUnitsOnCertificate: DataPoint<number | null>;
  yearBuilt: DataPoint<number>;
  constructionYear: DataPoint<number | null>;
  yearAltered: DataPoint<number | null>;
  buildingClass: DataPoint<string>;
  landUseCode: DataPoint<string>;
  zoning: DataPoint<string>;
  landmark: DataPoint<string | null>;
  historicDistrict: DataPoint<string | null>;
  featureCode: DataPoint<number>;
  buildingAreaSqft: DataPoint<number>;
  residentialAreaSqft: DataPoint<number>;
  commercialAreaSqft: DataPoint<number>;
  lotAreaSqft: DataPoint<number>;
  zipCode: DataPoint<string>;
  ownerName: DataPoint<string>;
  certificate: DataPoint<string | null>;
  unitLines: UnitLine[];
  floors: FloorRecord[];
  massing: MassingSummary;
  conflicts: ConflictRecord[];
  corroboration: Corroboration[];
  notes: string[];
}

export interface CityDataset {
  retrieved: string;
  plutoVersion: string;
  padVersion: string;
  citations: Citation[];
  datasetNotes: string[];
  buildings: BuildingRecord[];
}
