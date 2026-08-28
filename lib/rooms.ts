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

// ---------------------------------------------------------------------------
// Room palette + issue-aware filtering.
//
// Each room carries a set of "fixtures" — the things that plausibly exist in
// it (a toilet, a kitchen sink, the breaker panel, an HVAC air handler). Each
// issue the customer can pick maps to the fixture(s) it concerns. Given the
// selected issues, we offer only the rooms that could actually contain them —
// so "Toilet" stops suggesting the Kitchen or the Attic. Free text is always
// allowed, and anything we don't have a mapping for stays unconstrained.
// ---------------------------------------------------------------------------

export interface RoomOption {
  name: string;
  /** Fixtures/systems that plausibly exist in this room. */
  fixtures: string[];
}

/**
 * Common rooms offered as one-tap chips, each tagged with the fixtures it can
 * hold. "Whole home" is a wildcard and is always offered.
 */
export const ROOM_CATALOG: RoomOption[] = [
  {
    name: "Kitchen",
    fixtures: ["sink", "kitchen_sink", "water", "dishwasher", "oven", "microwave", "fridge", "ice_maker", "wet", "power", "vent", "network"],
  },
  {
    name: "Master bathroom",
    fixtures: ["toilet", "shower", "sink", "water", "wet", "power", "vent", "exhaust_fan"],
  },
  {
    name: "Hall bathroom",
    fixtures: ["toilet", "shower", "sink", "water", "wet", "power", "vent", "exhaust_fan"],
  },
  {
    name: "Living room",
    fixtures: ["living", "power", "vent", "thermostat", "tv", "network"],
  },
  {
    name: "Master bedroom",
    fixtures: ["bedroom", "power", "vent", "tv", "network"],
  },
  {
    name: "Bedroom",
    fixtures: ["bedroom", "power", "vent", "tv", "network"],
  },
  {
    name: "Laundry room",
    fixtures: ["laundry", "sink", "water", "wet", "appliance", "power", "vent"],
  },
  {
    name: "Dining room",
    fixtures: ["living", "power", "vent"],
  },
  {
    name: "Basement",
    fixtures: ["utility", "water", "water_heater", "toilet", "sink", "laundry", "fridge", "ice_maker", "appliance", "breaker", "hvac_system", "power", "network", "vent"],
  },
  {
    name: "Garage",
    fixtures: ["utility", "power", "appliance", "fridge", "water_heater", "breaker", "hvac_system", "water"],
  },
  {
    name: "Hallway",
    fixtures: ["common", "power", "thermostat", "vent", "network"],
  },
  {
    name: "Home office",
    fixtures: ["living", "power", "network", "data", "vent"],
  },
  {
    name: "Attic",
    fixtures: ["hvac_system", "vent", "power", "exhaust_fan", "insulation"],
  },
  {
    name: "Outside / exterior",
    fixtures: ["exterior", "water", "power", "doorbell", "hvac_condenser", "weather"],
  },
];

/** Room always offered regardless of the selected issue. */
export const WHOLE_HOME = "Whole home";

/** Flat list of one-tap room chips (all rooms; free text always allowed). */
export const ROOM_SUGGESTIONS: string[] = [
  ...ROOM_CATALOG.map((r) => r.name),
  WHOLE_HOME,
];

/**
 * Which fixture(s) an issue concerns, keyed by the fully-qualified item id
 * ("category:item"). Only issues that meaningfully constrain the room appear
 * here — anything omitted is treated as "could be anywhere" and never hides a
 * room. A room is offered when it shares at least one fixture with the issue.
 */
export const ISSUE_ROOM_FIXTURES: Record<string, string[]> = {
  // Plumbing
  "plumbing:faucet": ["sink", "kitchen_sink"],
  "plumbing:toilet": ["toilet"],
  "plumbing:drain": ["sink", "shower"],
  "plumbing:disposal": ["kitchen_sink"],
  "plumbing:water-heater": ["water_heater"],
  // Electrical
  "electrical:breaker": ["breaker"],
  "electrical:doorbell": ["doorbell"],
  // Appliances live in specific rooms
  "appliance:refrigerator": ["fridge"],
  "appliance:dishwasher": ["dishwasher"],
  "appliance:laundry": ["laundry"],
  "appliance:oven": ["oven"],
  "appliance:microwave": ["microwave"],
  "appliance:ice-maker": ["ice_maker"],
  // HVAC equipment (vents/thermostats are handled as "anywhere")
  "hvac:heat": ["hvac_system"],
  "hvac:cooling": ["hvac_system", "hvac_condenser"],
  "hvac:thermostat": ["thermostat"],
  // Repair — wet-area sealing
  "appliance:caulk-grout": ["wet"],
  "repair:caulk-grout": ["wet"],
};

/**
 * Given the selected issue keys ("category:item"), return the room chips worth
 * offering. Rules:
 *  - No selection, or any unconstrained issue → offer every room.
 *  - Otherwise offer the union of rooms whose fixtures match a selected issue.
 *  - "Whole home" is always appended.
 * Order follows ROOM_CATALOG so the list stays stable.
 */
export function suggestRooms(selectedItemKeys: string[]): string[] {
  const constrained = selectedItemKeys.filter((k) => ISSUE_ROOM_FIXTURES[k]);
  const hasUnconstrained = selectedItemKeys.some(
    (k) => !ISSUE_ROOM_FIXTURES[k],
  );
  // Nothing to narrow by, or at least one "could-be-anywhere" issue picked.
  if (constrained.length === 0 || hasUnconstrained) {
    return [...ROOM_SUGGESTIONS];
  }
  const wanted = new Set<string>();
  for (const key of constrained) {
    for (const fx of ISSUE_ROOM_FIXTURES[key]) wanted.add(fx);
  }
  const rooms = ROOM_CATALOG.filter((r) =>
    r.fixtures.some((fx) => wanted.has(fx)),
  ).map((r) => r.name);
  rooms.push(WHOLE_HOME);
  return rooms;
}

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
