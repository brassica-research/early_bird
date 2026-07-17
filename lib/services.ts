// Service catalog shown on the landing page and offered as chips on the intake
// form. Category ids match the heuristic config so selections feed triage.

export interface ServiceDef {
  id: string;
  icon: string;
  title: string;
  blurb: string;
  /** Example chips the customer can tap on the intake form. */
  examples: string[];
}

export const SERVICES: ServiceDef[] = [
  {
    id: "plumbing",
    icon: "🚰",
    title: "Plumbing",
    blurb:
      "Leaky faucets, running toilets, slow or clogged drains, garbage disposals, water-heater checks.",
    examples: [
      "Leaky faucet",
      "Running toilet",
      "Clogged drain",
      "Garbage disposal",
      "Low water pressure",
      "Water heater",
    ],
  },
  {
    id: "electrical",
    icon: "💡",
    title: "Electrical",
    blurb:
      "Dead outlets, switches, light fixtures, ceiling fans, GFCI resets, dimmers, doorbells.",
    examples: [
      "Dead outlet",
      "Light fixture",
      "Ceiling fan",
      "Flickering lights",
      "GFCI / breaker reset",
      "Dimmer switch",
    ],
  },
  {
    id: "appliance",
    icon: "🧺",
    title: "Appliances",
    blurb:
      "Refrigerators, dishwashers, washers & dryers, ovens, microwaves, ice makers — diagnostics & repair.",
    examples: [
      "Refrigerator",
      "Dishwasher",
      "Washer / dryer",
      "Oven / stove",
      "Microwave",
      "Ice maker",
    ],
  },
  {
    id: "hvac",
    icon: "🌡️",
    title: "HVAC & Air Quality",
    blurb:
      "Thermostats, filter changes, airflow issues, humidifiers/dehumidifiers, basic heating & cooling checks.",
    examples: [
      "Thermostat",
      "No heat",
      "Not cooling",
      "Air filter",
      "Humidifier",
      "Airflow / vents",
    ],
  },
  {
    id: "repair",
    icon: "🛠️",
    title: "Basic Home Repair",
    blurb:
      "Patching & drywall, caulking, grout, squeaks, lubricating hinges, mounting, weatherstripping, touch-ups.",
    examples: [
      "Drywall patch",
      "Caulking",
      "Grout",
      "Squeaky door",
      "Mount / hang",
      "Weatherstripping",
    ],
  },
  {
    id: "connectivity",
    icon: "📶",
    title: "Internet & Connectivity",
    blurb:
      "Wi-Fi dead zones, router/modem setup, mesh networks, ethernet runs, smart-home connectivity.",
    examples: [
      "Wi-Fi dead zone",
      "Router / modem",
      "Slow internet",
      "Mesh network",
      "Ethernet",
      "Smart home",
    ],
  },
];
