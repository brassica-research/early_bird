// ---------------------------------------------------------------------------
// Where in the home the issue is.
//
// The technician needs two things the address can't tell them: which room to
// walk to, and which floor it's on (stairs, ladder access, and how far tools
// have to be carried all change the job). Both are captured on intake.
//
// Rooms are a starting palette, not an enum — the customer can type their own
// (a workshop, a nursery, "the addition out back"), so the stored value is a
// free-text string that the chips simply pre-fill. Floors ARE a closed set:
// they drive routing/equipment decisions, so they need to be comparable.
// ---------------------------------------------------------------------------

/** Common rooms offered as one-tap chips. Free text is always allowed. */
export const ROOM_SUGGESTIONS: string[] = [
  "Kitchen",
  "Primary bathroom",
  "Hall bathroom",
  "Living room",
  "Primary bedroom",
  "Bedroom",
  "Laundry room",
  "Dining room",
  "Basement",
  "Garage",
  "Hallway",
  "Home office",
  "Attic",
  "Outside / exterior",
  "Whole home",
];

export const FLOOR_IDS = [
  "basement",
  "ground",
  "second",
  "third_plus",
  "attic",
  "outside",
] as const;

export type FloorId = (typeof FLOOR_IDS)[number];

export interface FloorOption {
  id: FloorId;
  label: string;
  /** Short qualifier shown under the label on the picker. */
  hint: string;
}

export const FLOORS: FloorOption[] = [
  { id: "basement", label: "Basement", hint: "Below ground" },
  { id: "ground", label: "1st floor", hint: "Ground level" },
  { id: "second", label: "2nd floor", hint: "One flight up" },
  { id: "third_plus", label: "3rd floor or higher", hint: "Two-plus flights" },
  { id: "attic", label: "Attic / crawl space", hint: "Limited access" },
  { id: "outside", label: "Outside", hint: "Yard, exterior, roofline" },
];

export function floorLabel(id: string | undefined | null): string {
  if (!id) return "Not specified";
  return FLOORS.find((f) => f.id === id)?.label ?? id;
}

export function isFloorId(value: string): value is FloorId {
  return (FLOOR_IDS as readonly string[]).includes(value);
}

// --- Photo limits ----------------------------------------------------------
// Shared by the browser (which downsizes before upload) and the API (which
// enforces them again — the client is never trusted).

/** Max photos a customer can attach to one intake. */
export const MAX_PHOTOS = 6;
/** Max bytes for a single stored photo after client-side downscaling. */
export const MAX_PHOTO_BYTES = 1_500_000;
/** Max total bytes across all photos on one intake. */
export const MAX_PHOTOS_TOTAL_BYTES = 6_000_000;
/** Longest edge (px) the browser downscales to before upload. */
export const PHOTO_MAX_EDGE_PX = 1400;
/** Image types accepted for upload. */
export const ACCEPTED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
