export interface CoolThingCard {
  title: string;
  label: string;
  detail: string;
  image: string;
  alt: string;
  icon: string;
}

type CardPalette = [string, string, string];

const previewTheme = {
  page: "#111318",
  text: "#f7f3ec",
  muted: "#c9c1b6",
  panel: "#1b1f28",
  ink: "#171717",
  paper: "#f7f3ec",
  accent: "#aee9dd",
  border: "#ffffff24",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function iconSvg(path: string, color: string): string {
  return `<svg class="thing-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
    <path d="${path}" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function coolThingImage(label: string, colors: CardPalette, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${colors[0]}"/>
        <stop offset=".58" stop-color="${colors[1]}"/>
        <stop offset="1" stop-color="${colors[2]}"/>
      </linearGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="640" height="420" rx="34" fill="url(#bg)"/>
    <circle cx="135" cy="112" r="88" fill="${accent}" opacity=".42" filter="url(#soft)"/>
    <circle cx="516" cy="292" r="122" fill="#ffffff" opacity=".16" filter="url(#soft)"/>
    <path d="M82 316c74-116 128-132 184-76 45 45 83 38 135-28 47-60 96-58 158 8v126H82z" fill="#0b1020" opacity=".44"/>
    <path d="M94 334c86-80 151-88 214-28 55 53 111 45 197-24 23-18 44-27 63-27v108H94z" fill="#ffffff" opacity=".18"/>
    <text x="50%" y="55%" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="42" font-weight="800" letter-spacing="2">${label}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const COOL_THINGS: CoolThingCard[] = [
  {
    title: "Bioluminescent Bays",
    label: "GLOW",
    detail: "Tiny organisms turn dark water into blue sparks when it moves.",
    alt: "Stylized blue glowing water",
    icon: iconSvg("M4 15c4-5 8-5 12 0m-9 3c2-2 4-2 6 0M16 6l1.2 2.8L20 10l-2.8 1.2L16 14l-1.2-2.8L12 10l2.8-1.2L16 6Z", "#62f3ff"),
    image: coolThingImage("GLOW", ["#07111f", "#046c7a", "#56f2d5"], "#62f3ff"),
  },
  {
    title: "Aurora Storms",
    label: "AURORA",
    detail: "Solar wind hits the upper atmosphere and paints the sky in sheets of light.",
    alt: "Stylized green and violet aurora",
    icon: iconSvg("M4 17c3-8 6-10 9-6 2 3 4 3 7-1M5 21c3-4 6-5 10-2", "#7dd3fc"),
    image: coolThingImage("AURORA", ["#111827", "#134e4a", "#a78bfa"], "#7dd3fc"),
  },
  {
    title: "Deep Sea Vents",
    label: "VENTS",
    detail: "Whole ecosystems live around superheated mineral chimneys with no sunlight.",
    alt: "Stylized deep sea hydrothermal vent",
    icon: iconSvg("M8 20V9m4 11V5m4 15V11M6 9c2-2 4-2 6 0m0-4c2-2 4-2 6 0", "#fb923c"),
    image: coolThingImage("VENTS", ["#020617", "#164e63", "#f97316"], "#fb923c"),
  },
  {
    title: "Modular Synths",
    label: "PATCH",
    detail: "Sound becomes physical: cables, voltage, knobs, and happy accidents.",
    alt: "Stylized synth panel with vivid light",
    icon: iconSvg("M5 8h14M5 16h14M8 5v6m8 2v6M8 8h.01M16 16h.01", "#f472b6"),
    image: coolThingImage("PATCH", ["#18181b", "#7c2d12", "#facc15"], "#f472b6"),
  },
  {
    title: "Mars Rovers",
    label: "ROVER",
    detail: "A rolling lab crosses another planet and sends postcards home.",
    alt: "Stylized Mars landscape",
    icon: iconSvg("M7 16h10l2-5H5l2 5Zm2 0v3m6-3v3M9 8h6m-3 0V4M6 20h.01M18 20h.01", "#fb7185"),
    image: coolThingImage("ROVER", ["#1c1917", "#9a3412", "#fed7aa"], "#fb7185"),
  },
];

function renderCard(thing: CoolThingCard): string {
  return `
    <button class="flip-card" type="button" aria-pressed="false">
      <span class="flip-inner">
        <span class="face front">
          <img src="${thing.image}" alt="${escapeHtml(thing.alt)}" />
          <span class="caption">${thing.icon}<span>${escapeHtml(thing.title)}</span></span>
        </span>
        <span class="face back">
          ${thing.icon}
          <span class="back-kicker">Why it is cool</span>
          <strong>${escapeHtml(thing.title)}</strong>
          <span>${escapeHtml(thing.detail)}</span>
        </span>
      </span>
    </button>`;
}

export function buildCoolThingsPreviewHtml(project: { title: string; content?: string }): string {
  const title = escapeHtml(project.title);
  const intro = escapeHtml(project.content || "Tap any card to flip it.").replace(/\n/g, "<br/>");
  const cards = COOL_THINGS.map(renderCard).join("");

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:${previewTheme.page};color:${previewTheme.text};font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
  body{padding:28px}
  header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:24px}
  h1{margin:0;font-size:clamp(26px,5vw,44px);line-height:1;letter-spacing:0}
  .intro{max-width:560px;margin:10px 0 0;color:${previewTheme.muted};line-height:1.5;font-size:14px}
  .count{border:1px solid ${previewTheme.border};border-radius:999px;padding:7px 12px;color:${previewTheme.accent};font-size:12px;white-space:nowrap}
  .grid{display:grid;grid-template-columns:repeat(5,minmax(160px,1fr));gap:14px}
  .flip-card{height:280px;padding:0;border:0;background:transparent;perspective:1100px;cursor:pointer;text-align:left}
  .flip-card:focus-visible{outline:2px solid ${previewTheme.accent};outline-offset:4px;border-radius:12px}
  .flip-inner{position:relative;display:block;width:100%;height:100%;transform-style:preserve-3d;transition:transform .55s cubic-bezier(.2,.8,.2,1)}
  .flip-card:hover .flip-inner,.flip-card.is-flipped .flip-inner{transform:rotateY(180deg)}
  .face{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #ffffff20;border-radius:8px;background:${previewTheme.panel};backface-visibility:hidden;box-shadow:0 18px 42px #00000035}
  .front img{width:100%;height:215px;object-fit:cover;display:block}
  .caption{display:flex;align-items:center;gap:9px;padding:14px 14px 16px;font-weight:800;font-size:17px;color:#fff}
  .thing-icon{width:22px;height:22px;flex:0 0 auto}
  .back{justify-content:center;gap:13px;padding:20px;transform:rotateY(180deg);background:${previewTheme.paper};color:${previewTheme.ink}}
  .back .thing-icon{width:30px;height:30px}
  .back-kicker{text-transform:uppercase;letter-spacing:.12em;font-size:10px;color:#6f675d;font-weight:800}
  .back strong{font-size:22px;line-height:1.05}
  .back span:last-child{font-size:14px;line-height:1.45;color:#3d3a35}
  @media (max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.flip-card{height:250px}}
  @media (max-width:560px){body{padding:18px}header{display:block}.count{display:inline-block;margin-top:14px}.grid{grid-template-columns:1fr}.flip-card{height:255px}}
</style></head><body>
<header>
  <div>
    <h1>${title}</h1>
    <p class="intro">${intro}</p>
  </div>
  <div class="count">5 flippable cards</div>
</header>
<main class="grid">${cards}</main>
<script>
  document.querySelectorAll('.flip-card').forEach((card) => {
    card.addEventListener('click', () => {
      card.classList.toggle('is-flipped');
      card.setAttribute('aria-pressed', card.classList.contains('is-flipped') ? 'true' : 'false');
    });
  });
</script>
</body></html>`;
}
