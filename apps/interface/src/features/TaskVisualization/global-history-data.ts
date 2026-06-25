import type { LucideIcon } from "lucide-react";
import { BookOpen, Compass, Crown, Flame, Radio, Sprout } from "lucide-react";

export interface HistoryEra {
  id: string;
  title: string;
  years: string;
  region: string;
  mood: string;
  color: string;
  glow: string;
  Icon: LucideIcon;
  summary: string;
  dispatch: string;
  artifact: string;
  puzzle: {
    prompt: string;
    options: string[];
    answer: number;
    reveal: string;
  };
  coordinate: { x: number; y: number };
  connections: string[];
  lensNotes: {
    trade: string;
    power: string;
    ideas: string;
  };
}

export const historyEras: HistoryEra[] = [
  {
    id: "river-cities",
    title: "River City Sparks",
    years: "3500-1200 BCE",
    region: "Nile, Tigris, Euphrates, Indus, Yellow River",
    mood: "mudbrick, starlight, irrigation math",
    color: "#f3d483",
    glow: "rgba(243, 212, 131, 0.28)",
    Icon: Sprout,
    summary: "Farming villages became cities, scribes turned grain into records, and rivers made rulers useful enough to tolerate.",
    dispatch: "Balance the flood gates before the barley ledger collapses.",
    artifact: "Clay tablet with a tax note, a moon mark, and one suspiciously dramatic goat sketch.",
    puzzle: {
      prompt: "What made these early cities powerful enough to outgrow villages?",
      options: ["Predictable river harvests", "Steam engines", "Satellite maps"],
      answer: 0,
      reveal: "Rivers fed the surplus, surplus fed specialists, and specialists built the first bureaucratic headache.",
    },
    coordinate: { x: 51, y: 48 },
    connections: ["Writing", "Irrigation", "Bronze"],
    lensNotes: {
      trade: "Granaries, docks, and tally marks turned food into a network instead of a local miracle.",
      power: "Flood control made leaders useful, then tax records made them hard to ignore.",
      ideas: "Writing began as practical accounting and quietly became memory with a clay backbone.",
    },
  },
  {
    id: "silk-sea",
    title: "Silk Road & Monsoon Sea",
    years: "200 BCE-1400 CE",
    region: "Central Asia, Indian Ocean, East Africa, China",
    mood: "caravans, dhow sails, cardamom, paper",
    color: "#8bdc9a",
    glow: "rgba(139, 220, 154, 0.24)",
    Icon: Compass,
    summary: "Merchants, monks, sailors, and translators moved goods and ideas across deserts and oceans faster than any empire could police.",
    dispatch: "Route a caravan through three language zones without losing the cinnamon.",
    artifact: "Compass bowl, silk scrap, and a port receipt written in two scripts.",
    puzzle: {
      prompt: "Which force made Indian Ocean routes unusually reliable?",
      options: ["Monsoon wind patterns", "Railroad timetables", "Printed newspapers"],
      answer: 0,
      reveal: "Seasonal monsoons turned ocean travel into a calendar, which is excellent news if your cargo dislikes improvisation.",
    },
    coordinate: { x: 64, y: 44 },
    connections: ["Buddhism", "Paper", "Spices"],
    lensNotes: {
      trade: "Silk, spices, glass, horses, and ceramics moved through relay teams of people who rarely saw the whole route.",
      power: "Ports and oasis cities became gatekeepers because geography was the original app store fee.",
      ideas: "Religions, recipes, math, music, and stories traveled as easily as cargo when translators did the heavy lifting.",
    },
  },
  {
    id: "golden-labs",
    title: "Golden Age Labs",
    years: "750-1258 CE",
    region: "Baghdad, Cordoba, Cairo, Samarkand",
    mood: "ink, astrolabes, geometry, midnight debates",
    color: "#9dc8ff",
    glow: "rgba(157, 200, 255, 0.26)",
    Icon: BookOpen,
    summary: "Scholars translated, tested, argued, and improved knowledge from Greece, Persia, India, Africa, and beyond.",
    dispatch: "Tune an astrolabe, copy a star table, then defend your math in public.",
    artifact: "Astrolabe plate etched with star paths and tiny correction marks.",
    puzzle: {
      prompt: "What made the great translation centers so explosive?",
      options: ["Knowledge moved across languages", "Everyone used one calendar", "Libraries banned arguments"],
      answer: 0,
      reveal: "Translation made old ideas portable, then debate and experiment made them sharper.",
    },
    coordinate: { x: 56, y: 41 },
    connections: ["Algebra", "Medicine", "Astronomy"],
    lensNotes: {
      trade: "Paper, patronage, and urban wealth paid for scholars to compare notes across continents.",
      power: "Rulers turned libraries and observatories into prestige engines with very sharp margins.",
      ideas: "Translation was only the launchpad. The fun part was correcting, testing, arguing, and improving.",
    },
  },
  {
    id: "revolutions",
    title: "Age of Revolutions",
    years: "1750-1914",
    region: "Atlantic world, Haiti, France, Americas, Europe",
    mood: "pamphlets, factories, barricades, steam",
    color: "#f0a0a0",
    glow: "rgba(240, 160, 160, 0.25)",
    Icon: Flame,
    summary: "Political rights, industrial power, anticolonial struggle, and mass politics collided hard enough to redraw daily life.",
    dispatch: "Print a banned pamphlet while the engine room shakes the floor.",
    artifact: "Factory time card beside a revolutionary broadside.",
    puzzle: {
      prompt: "Which pairing best explains why this era moved so loudly?",
      options: ["Pamphlets and factories", "Bronze and pyramids", "Astrolabes and incense"],
      answer: 0,
      reveal: "Ideas traveled on paper while labor moved by machine time. Subtle it was not.",
    },
    coordinate: { x: 34, y: 37 },
    connections: ["Citizenship", "Steam", "Abolition"],
    lensNotes: {
      trade: "Factories and Atlantic markets rewired labor, goods, and profits at an alarming speed.",
      power: "Crowds, constitutions, revolts, and armies made sovereignty a public argument.",
      ideas: "Rights language escaped elite rooms and became a tool for people who were never meant to wield it.",
    },
  },
  {
    id: "signal-planet",
    title: "Signal Planet",
    years: "1945-present",
    region: "Everywhere with cables, satellites, streets, and screens",
    mood: "broadcast towers, protest songs, chips, climate maps",
    color: "#d7b6ff",
    glow: "rgba(215, 182, 255, 0.25)",
    Icon: Radio,
    summary: "Decolonization, Cold War systems, networks, climate pressure, and digital culture made the planet feel intimate and unruly.",
    dispatch: "Patch the satellite feed while three timelines argue in the chat.",
    artifact: "Pocket radio taped to a cracked smartphone with a weather alert open.",
    puzzle: {
      prompt: "What changed when signals became planetary?",
      options: ["Local events became global stories", "Empires stopped existing overnight", "Weather became optional"],
      answer: 0,
      reveal: "Radio, TV, satellites, and networks made distance feel smaller while making consequences harder to hide.",
    },
    coordinate: { x: 28, y: 53 },
    connections: ["Networks", "Independence", "Climate"],
    lensNotes: {
      trade: "Container ships, air freight, and data centers made supply chains feel invisible until they broke.",
      power: "Cold War blocs, new nations, movements, and platforms fought over who got to narrate reality.",
      ideas: "The same signal can carry a weather warning, a protest song, a meme, and a revolution plan.",
    },
  },
  {
    id: "court-intrigue",
    title: "Courts of Power",
    years: "1500-1800",
    region: "Mughal India, Qing China, Ottoman lands, West Africa",
    mood: "gardens, gunpowder, porcelain, petitions",
    color: "#ffbf8a",
    glow: "rgba(255, 191, 138, 0.24)",
    Icon: Crown,
    summary: "Imperial courts staged authority through architecture, art, armies, tax systems, and extremely consequential etiquette.",
    dispatch: "Decode court protocol before presenting a treaty and a jeweled clock.",
    artifact: "Miniature painting with a trade seal pressed into the margin.",
    puzzle: {
      prompt: "Why did court ritual matter beyond looking impressive?",
      options: ["It organized rank and negotiation", "It replaced tax collection", "It made gunpowder quieter"],
      answer: 0,
      reveal: "Ritual told everyone where power sat before anyone said the dangerous part out loud.",
    },
    coordinate: { x: 69, y: 52 },
    connections: ["Gunpowder", "Porcelain", "Diplomacy"],
    lensNotes: {
      trade: "Luxury goods, tribute, taxes, and port deals moved through etiquette as much as through markets.",
      power: "Ceremony made hierarchy visible before cannons and accountants handled the follow-through.",
      ideas: "Court art, garden design, language, and protocol broadcast legitimacy in high resolution.",
    },
  },
];
