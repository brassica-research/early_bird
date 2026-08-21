// Service catalog shown on the landing page and offered as chips on the intake
// form. Category ids match the heuristic config so selections feed triage.
//
// The catalog is three levels deep so the customer narrows down instead of
// typing everything into the description box:
//
//   category (Plumbing) → item (Faucet) → symptom (Drips when off)
//
// Each level is optional after the first: picking just a category, or a
// category + item, still submits a usable signal to triage. The symptom level
// is what gives the heuristic/LLM the specific vocabulary it scores against.

export interface ServiceItem {
  /** Stable id, unique within its category. */
  id: string;
  label: string;
  /** Third-level drill-down: concrete symptoms for this item. */
  symptoms: string[];
}

export interface ServiceDef {
  id: string;
  icon: string;
  title: string;
  blurb: string;
  /** Specific items/appliances the customer can tap, each with symptoms. */
  items: ServiceItem[];
}

export const SERVICES: ServiceDef[] = [
  {
    id: "plumbing",
    icon: "🚰",
    title: "Plumbing",
    blurb:
      "Leaky faucets, running toilets, slow or clogged drains, garbage disposals, water-heater checks.",
    items: [
      {
        id: "faucet",
        label: "Faucet",
        symptoms: [
          "Drips when shut off",
          "Leaks at the base",
          "Weak or no flow",
          "Handle is loose or stuck",
        ],
      },
      {
        id: "toilet",
        label: "Toilet",
        symptoms: [
          "Runs constantly",
          "Won't flush or is clogged",
          "Leaks at the base",
          "Fills very slowly",
        ],
      },
      {
        id: "drain",
        label: "Sink / shower drain",
        symptoms: [
          "Drains slowly",
          "Fully clogged",
          "Backs up into another fixture",
          "Smells bad",
        ],
      },
      {
        id: "disposal",
        label: "Garbage disposal",
        symptoms: [
          "Hums but won't spin",
          "Completely dead",
          "Leaks underneath",
          "Very loud / rattling",
        ],
      },
      {
        id: "pressure",
        label: "Water pressure",
        symptoms: [
          "Low at one fixture",
          "Low throughout the house",
          "Hammering or banging pipes",
        ],
      },
      {
        id: "water-heater",
        label: "Water heater",
        symptoms: [
          "No hot water",
          "Runs out quickly",
          "Leaking or dripping tank",
          "Popping or rumbling noises",
        ],
      },
    ],
  },
  {
    id: "electrical",
    icon: "💡",
    title: "Electrical",
    blurb:
      "Dead outlets, switches, light fixtures, ceiling fans, GFCI resets, dimmers, doorbells.",
    items: [
      {
        id: "outlet",
        label: "Outlet",
        symptoms: [
          "Completely dead",
          "Works intermittently",
          "Warm, scorched or sparking",
          "Loose — plugs fall out",
        ],
      },
      {
        id: "light",
        label: "Light fixture",
        symptoms: [
          "Won't turn on",
          "Flickers or dims",
          "Bulbs burn out fast",
          "Needs replacing / upgrading",
        ],
      },
      {
        id: "fan",
        label: "Ceiling fan",
        symptoms: [
          "Won't turn on",
          "Wobbles or shakes",
          "Noisy",
          "Needs installing or replacing",
        ],
      },
      {
        id: "breaker",
        label: "Breaker / GFCI",
        symptoms: [
          "Breaker keeps tripping",
          "GFCI won't reset",
          "Half the room has no power",
        ],
      },
      {
        id: "switch",
        label: "Switch / dimmer",
        symptoms: [
          "Does nothing",
          "Buzzes or gets warm",
          "Dimmer flickers",
          "Needs replacing / smart upgrade",
        ],
      },
      {
        id: "doorbell",
        label: "Doorbell / smart doorbell",
        symptoms: [
          "No sound",
          "Chime is faint or buzzing",
          "Needs installing",
        ],
      },
    ],
  },
  {
    id: "appliance",
    icon: "🧺",
    title: "Appliances",
    blurb:
      "Refrigerators, dishwashers, washers & dryers, ovens, microwaves, ice makers — diagnostics & repair.",
    items: [
      {
        id: "refrigerator",
        label: "Refrigerator",
        symptoms: [
          "Not cooling / warm inside",
          "Freezing food",
          "Leaking water",
          "Loud or constant running",
        ],
      },
      {
        id: "dishwasher",
        label: "Dishwasher",
        symptoms: [
          "Won't drain",
          "Leaves dishes dirty",
          "Leaks onto the floor",
          "Won't start",
        ],
      },
      {
        id: "laundry",
        label: "Washer / dryer",
        symptoms: [
          "Washer won't drain or spin",
          "Dryer won't heat",
          "Takes several cycles to dry",
          "Shakes, bangs or squeals",
        ],
      },
      {
        id: "oven",
        label: "Oven / stove",
        symptoms: [
          "Won't heat",
          "Bakes unevenly",
          "Burner won't light",
          "Door or seal is bad",
        ],
      },
      {
        id: "microwave",
        label: "Microwave",
        symptoms: [
          "Runs but doesn't heat",
          "Completely dead",
          "Sparks or arcs inside",
          "Turntable won't spin",
        ],
      },
      {
        id: "ice-maker",
        label: "Ice maker",
        symptoms: [
          "Makes no ice",
          "Ice tastes bad",
          "Leaks or freezes up",
          "Jams / won't dispense",
        ],
      },
    ],
  },
  {
    id: "hvac",
    icon: "🌡️",
    title: "HVAC & Air Quality",
    blurb:
      "Thermostats, filter changes, airflow issues, humidifiers/dehumidifiers, basic heating & cooling checks.",
    items: [
      {
        id: "thermostat",
        label: "Thermostat",
        symptoms: [
          "Blank or unresponsive",
          "Reads the wrong temperature",
          "Won't hold a schedule",
          "Needs installing / upgrading",
        ],
      },
      {
        id: "heat",
        label: "Heating",
        symptoms: [
          "No heat at all",
          "Blows cool air",
          "Short-cycles on and off",
          "Some rooms stay cold",
        ],
      },
      {
        id: "cooling",
        label: "Cooling / AC",
        symptoms: [
          "Not cooling",
          "Runs constantly",
          "Water pooling near the unit",
          "Some rooms stay hot",
        ],
      },
      {
        id: "filter",
        label: "Air filter",
        symptoms: [
          "Due for a change",
          "Not sure of the size",
          "Dusty air / allergies",
        ],
      },
      {
        id: "humidity",
        label: "Humidifier / dehumidifier",
        symptoms: [
          "Air is too dry",
          "Air is damp or musty",
          "Unit won't run",
        ],
      },
      {
        id: "airflow",
        label: "Airflow / vents",
        symptoms: [
          "Weak airflow at a vent",
          "Whistling or rattling ducts",
          "Vent won't open or close",
        ],
      },
    ],
  },
  {
    id: "repair",
    icon: "🛠️",
    title: "Basic Home Repair",
    blurb:
      "Patching & drywall, caulking, grout, squeaks, lubricating hinges, mounting, weatherstripping, touch-ups.",
    items: [
      {
        id: "drywall",
        label: "Drywall / wall",
        symptoms: [
          "Hole or dent",
          "Crack along a seam",
          "Anchor pulled out",
          "Needs touch-up paint",
        ],
      },
      {
        id: "caulk-grout",
        label: "Caulk / grout",
        symptoms: [
          "Cracked or moldy caulk",
          "Crumbling grout",
          "Gap around the tub or sink",
        ],
      },
      {
        id: "door",
        label: "Door",
        symptoms: [
          "Squeaks",
          "Sticks or won't latch",
          "Handle or lock is loose",
          "Drags on the floor",
        ],
      },
      {
        id: "mounting",
        label: "Mounting / hanging",
        symptoms: [
          "TV or shelf to mount",
          "Curtain rod or blinds",
          "Mirror or artwork",
          "Childproofing / anti-tip",
        ],
      },
      {
        id: "window",
        label: "Window",
        symptoms: [
          "Drafty",
          "Won't open or close",
          "Screen is torn",
          "Fogged between panes",
        ],
      },
      {
        id: "weatherstripping",
        label: "Weatherstripping",
        symptoms: [
          "Draft under a door",
          "Worn or missing seal",
          "Door sweep needs replacing",
        ],
      },
    ],
  },
  {
    id: "connectivity",
    icon: "📶",
    title: "Internet & Connectivity",
    blurb:
      "Wi-Fi dead zones, router/modem setup, mesh networks, ethernet runs, smart-home connectivity.",
    items: [
      {
        id: "wifi",
        label: "Wi-Fi coverage",
        symptoms: [
          "Dead zone in one room",
          "Drops constantly",
          "Slow only on Wi-Fi",
          "Weak upstairs or in the basement",
        ],
      },
      {
        id: "router",
        label: "Router / modem",
        symptoms: [
          "No internet at all",
          "Needs setup or replacing",
          "Keeps rebooting",
          "Can't get into the settings",
        ],
      },
      {
        id: "mesh",
        label: "Mesh network",
        symptoms: [
          "Nodes won't connect",
          "Needs installing",
          "Devices pick the wrong node",
        ],
      },
      {
        id: "ethernet",
        label: "Ethernet / wiring",
        symptoms: [
          "Port is dead",
          "Need a new run",
          "Wall jack is loose",
        ],
      },
      {
        id: "smart-home",
        label: "Smart home devices",
        symptoms: [
          "Device won't pair",
          "Keeps going offline",
          "Needs installing / configuring",
        ],
      },
      {
        id: "tv-stream",
        label: "TV / streaming",
        symptoms: [
          "Buffering or pixelated",
          "Device won't connect",
          "Needs setup",
        ],
      },
    ],
  },
];

/** Look up a category by id. */
export function findCategory(id: string): ServiceDef | undefined {
  return SERVICES.find((c) => c.id === id);
}

/** Look up an item by its category id + item id. */
export function findItem(
  categoryId: string,
  itemId: string,
): ServiceItem | undefined {
  return findCategory(categoryId)?.items.find((i) => i.id === itemId);
}

/**
 * Fully-qualified key for one item ("plumbing:faucet") — what the intake form
 * tracks in state so two categories can share an item label without colliding.
 */
export function itemKey(categoryId: string, itemId: string): string {
  return `${categoryId}:${itemId}`;
}

/** Fully-qualified key for one symptom ("plumbing:faucet:Drips when shut off"). */
export function symptomKey(
  categoryId: string,
  itemId: string,
  symptom: string,
): string {
  return `${categoryId}:${itemId}:${symptom}`;
}

/**
 * Collapse a drill-down selection into the flat `affectedServices` strings the
 * triage engine and the Issues Matrix already score against. Most specific
 * level wins: symptom(s) if chosen, else the item, else the category title.
 */
export function describeSelection(selection: {
  categories: string[];
  items: string[];
  symptoms: string[];
}): string[] {
  const out: string[] = [];
  for (const cat of SERVICES) {
    if (!selection.categories.includes(cat.id)) continue;
    const chosenItems = cat.items.filter((i) =>
      selection.items.includes(itemKey(cat.id, i.id)),
    );
    if (chosenItems.length === 0) {
      out.push(cat.title);
      continue;
    }
    for (const item of chosenItems) {
      const chosenSymptoms = item.symptoms.filter((s) =>
        selection.symptoms.includes(symptomKey(cat.id, item.id, s)),
      );
      if (chosenSymptoms.length === 0) {
        out.push(item.label);
      } else {
        for (const s of chosenSymptoms) out.push(`${item.label} — ${s}`);
      }
    }
  }
  return out;
}
