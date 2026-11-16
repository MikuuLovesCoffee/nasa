// Labs: extra mini-apps for other NASA Space Apps 2026 challenges.
// Only this small list is in the main bundle; each lab's code (and data) loads when it is opened.
export const LABS = [
  {
    id: "trend", title: "Earth System Trend Detective", level: "Hard",
    blurb: "Pick a variable and any area: is it really changing, and is the change significant?",
    challenge: "Be An Earth System Trend Detective!", where: "earth",
    load: () => import("./trend.js"),
  },
  {
    id: "flame", title: "Flame in Freefall", level: "Hard",
    blurb: "What decades of fire experiments in microgravity mean for fire safety on the Moon and Mars.",
    challenge: "Flame in Freefall", where: "orbit", load: () => import("./flame.js"),
  },
  {
    id: "sar", title: "Dancing with the SARs", level: "Hard",
    blurb: "NISAR radar sees burn scars and floods through smoke and cloud.",
    challenge: "Dancing with the SARs", where: "earth", load: () => import("./sar.js"),
  },
  {
    id: "analogs", title: "Moon & Mars on Earth", level: "Easy",
    blurb: "The places on Earth that are most like the Moon and Mars.",
    challenge: "Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars", where: "earth", load: () => import("./analogs.js"),
  },
  {
    id: "hardware", title: "Abandoned but not Forgotten", level: "Easy",
    blurb: "Fly to the Moon and Mars and meet the NASA hardware still there.",
    challenge: "Abandoned but not Forgotten", where: "moon-mars", load: () => import("./hardware.js"),
  },
  {
    id: "marswalk", title: "Martian Map", level: "Easy",
    blurb: "Plan a Marswalk with layers from NASA's Mars missions.",
    challenge: "Interplanetary Survival Guide: Martian Map", where: "mars", load: () => import("./marswalk.js"),
  },
];
