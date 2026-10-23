// Rwanda administrative districts and locations
// Data is loaded dynamically per district to minimize bundle size

import provincesData from "@/data/rwanda/provinces.json";

export type Province = "KIGALI" | "EAST" | "WEST" | "NORTH" | "SOUTH";

// Province names mapped to user-friendly display names
export const PROVINCE_DISPLAY_NAMES: Record<Province, string> = {
  KIGALI: "Kigali City",
  EAST: "Eastern Province",
  WEST: "Western Province",
  NORTH: "Northern Province",
  SOUTH: "Southern Province",
};

// All provinces
export const RWANDA_PROVINCES = provincesData.provinces as Province[];

// All districts grouped by province
export const RWANDA_DISTRICTS: Record<string, string[]> = provincesData.districts;

// District data cache to avoid reloading
const districtDataCache: Record<string, DistrictData> = {};

export interface DistrictData {
  province: string;
  district: string;
  sectors: Record<string, Record<string, string[]>>;
}

/**
 * Load district data dynamically (sectors, cells, villages)
 * Only loads when needed to keep bundle size small
 */
export async function loadDistrictData(district: string): Promise<DistrictData | null> {
  // Check cache first
  if (districtDataCache[district]) {
    return districtDataCache[district];
  }

  try {
    // Convert district name to safe filename
    const safeDistrictName = district.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

    // Dynamic import of district data
    const data = await import(`@/data/rwanda/${safeDistrictName}.json`);

    // Cache the data
    districtDataCache[district] = data.default;

    return data.default;
  } catch (error) {
    console.error(`Failed to load data for district: ${district}`, error);
    return null;
  }
}

/**
 * Get all sectors for a district
 */
export async function getSectors(district: string): Promise<string[]> {
  const data = await loadDistrictData(district);
  return data ? Object.keys(data.sectors).sort() : [];
}

/**
 * Get all cells for a sector
 */
export async function getCells(district: string, sector: string): Promise<string[]> {
  const data = await loadDistrictData(district);
  if (!data || !data.sectors[sector]) return [];
  return Object.keys(data.sectors[sector]).sort();
}

/**
 * Get all villages for a cell
 */
export async function getVillages(district: string, sector: string, cell: string): Promise<string[]> {
  const data = await loadDistrictData(district);
  if (!data || !data.sectors[sector] || !data.sectors[sector][cell]) return [];
  return data.sectors[sector][cell];
}

// Legacy constants for backward compatibility (secondary school levels/streams)
export const CLASS_LEVELS = ["S1", "S2", "S3", "S4", "S5", "S6"] as const;
export const STREAMS = ["A", "B", "C", "D", "E", "F"] as const;

// Common dropdowns for student management
export const GENDER_OPTIONS = ["Male", "Female"] as const;
export const STUDENT_STATUS_OPTIONS = ["active", "inactive", "graduated", "transferred", "repeating"] as const;
export const GUARDIAN_RELATIONSHIPS = [
  "Father",
  "Mother",
  "Guardian",
  "Uncle",
  "Aunt",
  "Grandparent",
  "Sibling",
  "Other Relative",
  "Foster Parent",
  "Legal Guardian"
] as const;

// School levels (Rwanda education system)
export const SCHOOL_LEVELS = {
  nursery: ["Baby Class", "Middle Class", "Top Class"],
  primary: ["Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6"],
  secondary: ["S1", "S2", "S3", "S4", "S5", "S6"],
} as const;
