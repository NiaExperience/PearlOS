export type CouncilCategoryKey =
  | "play"
  | "creative"
  | "career"
  | "relationships"
  | "private-council"
  | "build"
  | "research"
  | "learn"
  | "life-admin"
  | "health"
  | "legal"
  | "money"
  | "travel"
  | "home"
  | "school"
  | "business"
  | "media"
  | "shopping"
  | "events"
  | "growth";

export type CouncilRoomSize = "solo" | "pair" | "trio" | "council" | "swarm";
export type CouncilMode = "text" | "voice";

export type CouncilCategory = {
  key: CouncilCategoryKey;
  title: string;
  subtitle: string;
  prompt: string;
  color: string;
  background: string;
  agents: string[];
  keywords: RegExp[];
  artifactLabel: string;
};

export type CouncilRoom = {
  id: string;
  title: string;
  prompt: string;
  category: CouncilCategoryKey;
  size: CouncilRoomSize;
  mode: CouncilMode;
  status: "live" | "working" | "ready";
  createdAt: number;
};

export const COUNCIL_ROOM_SIZES: Array<{ key: CouncilRoomSize; label: string; count: number; hint: string }> = [
  { key: "solo", label: "Solo", count: 1, hint: "Fast" },
  { key: "pair", label: "Pair", count: 2, hint: "Focused" },
  { key: "trio", label: "Trio", count: 3, hint: "Balanced" },
  { key: "council", label: "Council", count: 5, hint: "Deep" },
  { key: "swarm", label: "Swarm", count: 7, hint: "Full room" },
];

export const COUNCIL_CATEGORIES: CouncilCategory[] = [
  {
    key: "play",
    title: "Play",
    subtitle: "Games, roleplay, and fun",
    prompt: "Start a game, scene, bit, fictional world, or playful experiment.",
    color: "#f59e0b",
    background: "/agency-assets/rooms/backg4.png",
    agents: ["Story Actor", "Chaos Friend", "World Keeper", "Game Guide", "Bit Writer", "Continuity"],
    keywords: [/play/i, /game/i, /roleplay/i, /rpg/i, /fun/i, /scene/i, /character/i, /adventure/i, /joke/i, /pretend/i],
    artifactLabel: "Scene, game, or world",
  },
  {
    key: "creative",
    title: "Creative",
    subtitle: "Stories, scripts, brand, ideas",
    prompt: "Make or improve a creative artifact.",
    color: "#ec4899",
    background: "/agency-assets/rooms/backg4.png",
    agents: ["Story Director", "Writer", "Editor", "Worldbuilder", "Style Mixer", "Continuity"],
    keywords: [/story/i, /script/i, /creative/i, /write/i, /brand/i, /lyrics/i, /poem/i, /world/i, /draft/i],
    artifactLabel: "Draft or concept",
  },
  {
    key: "career",
    title: "Career",
    subtitle: "Jobs, resumes, interviews",
    prompt: "Bring a resume, job post, interview goal, or career decision.",
    color: "#38bdf8",
    background: "/agency-assets/rooms/backg3.png",
    agents: ["Career Coach", "Resume Reviewer", "Recruiter", "Interview Coach", "Negotiator", "ATS Reader"],
    keywords: [/resume/i, /job/i, /career/i, /interview/i, /cover letter/i, /linkedin/i, /salary/i, /recruiter/i],
    artifactLabel: "Career plan or draft",
  },
  {
    key: "relationships",
    title: "Relationships",
    subtitle: "People, conflict, messages",
    prompt: "Talk through what happened and what you want to say or do.",
    color: "#fb7185",
    background: "/agency-assets/rooms/backg5.png",
    agents: ["Listener", "Boundary Coach", "Message Drafter", "Reality Checker", "Pattern Spotter"],
    keywords: [/relationship/i, /dating/i, /friend/i, /family/i, /conflict/i, /apology/i, /boundary/i, /text/i],
    artifactLabel: "Message or conversation plan",
  },
  {
    key: "private-council",
    title: "Private Council",
    subtitle: "Sensitive decisions",
    prompt: "Use this room for high-stakes private questions.",
    color: "#a78bfa",
    background: "/agency-assets/rooms/backg2.png",
    agents: ["Advisor", "Risk Reviewer", "Skeptic", "Synthesizer", "Next Step Planner"],
    keywords: [/private/i, /council/i, /sensitive/i, /decision/i, /landlord/i, /medical/i, /legal/i, /finance/i],
    artifactLabel: "Council memo",
  },
  {
    key: "build",
    title: "Build",
    subtitle: "Code, apps, fixes, systems",
    prompt: "Describe what should be built, fixed, or shipped.",
    color: "#60a5fa",
    background: "/agency-assets/rooms/backg1.png",
    agents: ["Architect", "Builder", "Reviewer", "QA Runner", "Release Lead"],
    keywords: [/code/i, /build/i, /bug/i, /app/i, /website/i, /api/i, /deploy/i, /repo/i, /fix/i],
    artifactLabel: "Build plan",
  },
  {
    key: "research",
    title: "Research",
    subtitle: "Sources and comparisons",
    prompt: "Ask for a sourced answer, comparison, or decision memo.",
    color: "#2dd4bf",
    background: "/agency-assets/rooms/backg3.png",
    agents: ["Researcher", "Source Checker", "Analyst", "Synthesizer", "Skeptic"],
    keywords: [/research/i, /compare/i, /source/i, /study/i, /evidence/i, /market/i, /review/i],
    artifactLabel: "Sourced brief",
  },
  {
    key: "learn",
    title: "Learn",
    subtitle: "Tutoring and practice",
    prompt: "Pick a topic and choose explanation, practice, or quiz mode.",
    color: "#34d399",
    background: "/agency-assets/rooms/backg6.png",
    agents: ["Tutor", "Explainer", "Quiz Coach", "Practice Partner"],
    keywords: [/learn/i, /teach/i, /explain/i, /study/i, /quiz/i, /practice/i, /homework/i],
    artifactLabel: "Lesson or practice plan",
  },
  {
    key: "life-admin",
    title: "Life Admin",
    subtitle: "Plans, chores, reminders",
    prompt: "Get the logistics out of your head and into a simple plan.",
    color: "#facc15",
    background: "/agency-assets/rooms/backg5.png",
    agents: ["Planner", "Organizer", "Reminder Clerk", "Email Drafter"],
    keywords: [/plan/i, /organize/i, /task/i, /reminder/i, /schedule/i, /email/i, /errand/i],
    artifactLabel: "Checklist",
  },
  {
    key: "health",
    title: "Health",
    subtitle: "Wellness and safety triage",
    prompt: "Talk through symptoms, habits, workouts, sleep, or wellness goals.",
    color: "#4ade80",
    background: "/agency-assets/rooms/backg6.png",
    agents: ["Wellness Coach", "Safety Checker", "Habit Planner", "Question Preparer"],
    keywords: [/health/i, /medical/i, /doctor/i, /symptom/i, /sleep/i, /workout/i, /nutrition/i],
    artifactLabel: "Wellness next steps",
  },
  {
    key: "legal",
    title: "Legal and Civic",
    subtitle: "Rights, forms, disputes",
    prompt: "Understand the situation, risks, and questions to ask a professional.",
    color: "#818cf8",
    background: "/agency-assets/rooms/backg2.png",
    agents: ["Rights Guide", "Risk Reviewer", "Document Reader", "Message Drafter"],
    keywords: [/legal/i, /lawyer/i, /lease/i, /landlord/i, /tenant/i, /contract/i, /rights/i, /court/i],
    artifactLabel: "Issue map",
  },
  {
    key: "money",
    title: "Money",
    subtitle: "Budget, business, decisions",
    prompt: "Compare options, plan a budget, or understand financial tradeoffs.",
    color: "#22c55e",
    background: "/agency-assets/rooms/backg3.png",
    agents: ["Budget Coach", "Risk Analyst", "Scenario Planner", "Decision Reviewer"],
    keywords: [/money/i, /budget/i, /finance/i, /debt/i, /invest/i, /price/i, /business model/i],
    artifactLabel: "Money plan",
  },
  {
    key: "travel",
    title: "Travel",
    subtitle: "Trips and logistics",
    prompt: "Plan an itinerary, packing list, route, or local recommendations.",
    color: "#06b6d4",
    background: "/agency-assets/rooms/backg6.png",
    agents: ["Trip Planner", "Local Guide", "Logistics", "Budget Watcher"],
    keywords: [/travel/i, /trip/i, /flight/i, /hotel/i, /itinerary/i, /packing/i, /restaurant/i],
    artifactLabel: "Trip plan",
  },
  {
    key: "home",
    title: "Home",
    subtitle: "Household and repairs",
    prompt: "Organize a repair, move, meal plan, chore, or home project.",
    color: "#f97316",
    background: "/agency-assets/rooms/backg5.png",
    agents: ["Home Planner", "Repair Guide", "Meal Planner", "Organizer"],
    keywords: [/home/i, /repair/i, /move/i, /chore/i, /meal/i, /clean/i, /decorate/i],
    artifactLabel: "Home plan",
  },
  {
    key: "school",
    title: "School",
    subtitle: "Assignments and study",
    prompt: "Get tutoring, feedback, a study plan, or project structure.",
    color: "#c084fc",
    background: "/agency-assets/rooms/backg6.png",
    agents: ["Tutor", "Essay Coach", "Project Planner", "Quiz Coach"],
    keywords: [/school/i, /class/i, /homework/i, /essay/i, /exam/i, /study/i, /teacher/i],
    artifactLabel: "Study plan",
  },
  {
    key: "business",
    title: "Business",
    subtitle: "Strategy, sales, operations",
    prompt: "Plan strategy, positioning, hiring, sales, operations, or an investor memo.",
    color: "#93c5fd",
    background: "/agency-assets/rooms/backg1.png",
    agents: ["Operator", "Strategist", "Sales Lead", "Market Analyst", "Investor Editor"],
    keywords: [/business/i, /startup/i, /sales/i, /ops/i, /hiring/i, /customer/i, /investor/i],
    artifactLabel: "Business memo",
  },
  {
    key: "media",
    title: "Media Studio",
    subtitle: "Image, video, audio",
    prompt: "Generate, edit, storyboard, narrate, transcribe, or analyze media.",
    color: "#f472b6",
    background: "/agency-assets/rooms/backg6.png",
    agents: ["Image Artist", "Video Director", "Voice Lead", "Storyboarder", "Editor"],
    keywords: [/image/i, /video/i, /audio/i, /voice/i, /photo/i, /music/i, /transcribe/i, /storyboard/i],
    artifactLabel: "Media brief",
  },
  {
    key: "shopping",
    title: "Shopping",
    subtitle: "Buying decisions",
    prompt: "Compare products, gifts, vendors, or options.",
    color: "#fbbf24",
    background: "/agency-assets/rooms/backg3.png",
    agents: ["Buyer", "Reviewer", "Budget Checker", "Decision Maker"],
    keywords: [/buy/i, /shopping/i, /product/i, /gift/i, /compare/i, /recommend/i, /purchase/i],
    artifactLabel: "Decision table",
  },
  {
    key: "events",
    title: "Events",
    subtitle: "Plans and social moments",
    prompt: "Plan a party, dinner, group trip, invitation, speech, or event run-of-show.",
    color: "#fb923c",
    background: "/agency-assets/rooms/backg4.png",
    agents: ["Host", "Planner", "Invite Writer", "Logistics"],
    keywords: [/event/i, /party/i, /wedding/i, /dinner/i, /invite/i, /speech/i, /social/i],
    artifactLabel: "Event plan",
  },
  {
    key: "growth",
    title: "Personal Growth",
    subtitle: "Goals and reflection",
    prompt: "Work through goals, confidence, values, habits, or reflection.",
    color: "#a3e635",
    background: "/agency-assets/rooms/backg5.png",
    agents: ["Coach", "Reflection Guide", "Habit Builder", "Accountability"],
    keywords: [/goal/i, /growth/i, /habit/i, /journal/i, /confidence/i, /values/i, /reflect/i],
    artifactLabel: "Growth plan",
  },
];

export function categoryByKey(key: CouncilCategoryKey): CouncilCategory {
  return COUNCIL_CATEGORIES.find((category) => category.key === key) || COUNCIL_CATEGORIES[0];
}

export function roomSizeByKey(key: CouncilRoomSize) {
  return COUNCIL_ROOM_SIZES.find((size) => size.key === key) || COUNCIL_ROOM_SIZES[0];
}

export function inferCouncilCategory(input: string): CouncilCategory {
  const text = input.trim();
  if (!text) return COUNCIL_CATEGORIES[0];
  return COUNCIL_CATEGORIES.find((category) => category.keywords.some((pattern) => pattern.test(text))) || COUNCIL_CATEGORIES[4];
}

export function agentsForRoom(category: CouncilCategory, size: CouncilRoomSize): string[] {
  const count = roomSizeByKey(size).count;
  return Array.from({ length: count }, (_, index) => category.agents[index % category.agents.length]);
}

export function roomTitleFromPrompt(prompt: string, category: CouncilCategory): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return `${category.title} Room`;
  const title = clean.length > 44 ? `${clean.slice(0, 41).trim()}...` : clean;
  return `${category.title}: ${title}`;
}
