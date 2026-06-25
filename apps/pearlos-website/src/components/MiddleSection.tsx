import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";

/* ── Discover carousel data ── */
const discoverCards = [
  {
    img: "/assets/discover/C1 Phenomenal You 250x370.png",
    title: "Be your Phenomenal You",
    body: "What if all the planning, research, worries and hurdles were taken care of? What would you spend your time doing?",
    cta: "Find out",
    link: "https://app.pearlos.org/",
  },
  {
    img: "/assets/discover/C2 Intelligence for your Day 250x370.png",
    title: "Intelligence for your Day, Everyday",
    body: "Imagine the version of your day where busy work is done, you do zero web searches and you have a friend ready to help 24/7.",
    cta: "Your Pearl is Here",
    link: "https://app.pearlos.org/",
  },
  {
    img: "/assets/discover/C3 Superpowers 250x370.png",
    title: "Superpowers, on Demand",
    body: "Be a creative, a builder, a strategist, and a social organizer — all before lunch. Your Pearl shifts her own skill sets to rise to your occasion.",
    cta: "Share your story",
    link: "https://discord.gg/gcba4gb6kz",
  },
  {
    img: "/assets/discover/C4 Clamshell 250x370.png",
    title: "Tight as a Clamshell",
    body: "Locked tight, running deep and yours alone. No data extraction, no surveillance, no hidden costs.",
    cta: "Find Out More",
    link: "#/faq",
  },
  {
    img: "/assets/discover/C5 Your Now 250x370.png",
    title: "This is Your Now",
    body: "Whether you need to talk it out, covertly text, write it out, or listen for hours, your Pearl meets you in your moment.",
    cta: "Say hi",
    link: "https://app.pearlos.org/",
  },
  {
    img: "/assets/discover/C6 Open Future 250x370.png",
    title: "Open Source, Open Future",
    body: "We build in the open because we have nothing to hide and everything to share. We believe in technology for human flourishing instead of optimization at humanity's expense.",
    cta: "Star on GitHub",
    link: "https://github.com/NiaExperience/PearlOS",
  },
];

/* ── Use cases data ── */
const useCases = [
  {
    img: "/assets/usecases/card_05_Business_and_Work.png",
    title: "Business & Work",
    items: [
      "Starting a new job",
      "Website redesign",
      "Tracking customer",
      "International meeting coordinator",
      "Group collaboration",
      "Global gatherings",
      "Business Partner",
      "Marketing ideas",
    ],
  },
  {
    img: "/assets/usecases/card_01_Learning_and_Growth.png",
    title: "Learning & Growth",
    items: [
      "Studying for test",
      "Interview prep",
      "Personal trivia game",
      "Studying for Professional Exam",
      "YouTube searches",
    ],
  },
  {
    img: "/assets/usecases/card_03_Writing_and_Communication.png",
    title: "Writing & Communication",
    items: [
      "Cringe check",
      "Social media dispatch",
      "Content creation",
      "Translation",
      "Writing evaluation",
      "Social ideas",
      "Journaling",
      "Article aggregation",
      "Adversarial writing",
    ],
  },
  {
    img: "/assets/usecases/card_04_Planning_and_Organization.png",
    title: "Planning & Organization",
    items: [
      "Baby feeding tracker",
      "Daily reminders",
      "Gut checks",
      "Outlines of ideas",
      "Project reminders",
      "Brainstorming",
      "Scheduling recommendations",
      "Deck outlines",
    ],
  },
  {
    img: "/assets/usecases/card_02_Research_and_Information.png",
    title: "Research & Information",
    items: ["News updates", "Research", "Note taking", "Google search to notes", "YouTube viewing", "Weather updates", "Topic recommendations", "Counter arguments", "Research strategy"],
  },
  {
    img: "/assets/usecases/card_06_Creativity_and_Making.png",
    title: "Creativity & Making",
    items: [
      "Brainstorming",
      "Kids bedtime stories",
      "Solar system learning app",
      "Image editing",
      "Summoned sprites",
      "Bad sci-fi jokes",
      "Writing partner",
      "Making games",
    ],
  },
];

/* ═══════════════════════════════════════════════
   DISCOVER SCROLL — 3D ring + scroll-tracked cards
   Adapted from scroll-demo.html
   ═══════════════════════════════════════════════ */

function DiscoverScroll({ cards }: { cards: typeof discoverCards }) {
  const ringRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [useRingLayout, setUseRingLayout] = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollFrame = useRef<number | null>(null);
  const N = cards.length;
  const RING_R = 300;

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateLayout = () => setUseRingLayout(desktopQuery.matches && !reducedMotionQuery.matches);

    updateLayout();
    desktopQuery.addEventListener("change", updateLayout);
    reducedMotionQuery.addEventListener("change", updateLayout);

    return () => {
      desktopQuery.removeEventListener("change", updateLayout);
      reducedMotionQuery.removeEventListener("change", updateLayout);
    };
  }, []);

  // Desktop: IntersectionObserver tracks which right-side card is in view
  useEffect(() => {
    if (!useRingLayout) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const idx = cardRefs.current.indexOf(e.target as HTMLDivElement);
            if (idx >= 0) setActive(idx);
          }
        });
      },
      { threshold: 0.5 }
    );
    // Copy refs to local array since refs callback fires after mount
    const refs = cardRefs.current;
    const timer = setTimeout(() => {
      refs.forEach((el) => el && obs.observe(el));
    }, 100);
    return () => {
      clearTimeout(timer);
      refs.forEach((el) => el && obs.unobserve(el));
    };
  }, [useRingLayout, cards]);

  // Desktop: rotate 3D ring to match active card
  useEffect(() => {
    if (!ringRef.current || !useRingLayout) return;
    ringRef.current.style.setProperty("--ry", -(active / N) * 360 + "deg");
  }, [active, N, useRingLayout]);

  // Mobile: track horizontal scroll position
  const handleMobileScroll = useCallback(() => {
    if (mobileScrollFrame.current !== null) return;

    mobileScrollFrame.current = window.requestAnimationFrame(() => {
      mobileScrollFrame.current = null;
      if (!mobileScrollRef.current) return;

      const el = mobileScrollRef.current;
      const firstCard = el.children[0] as HTMLElement | undefined;
      const gap = 16;
      const cardWidth = firstCard?.offsetWidth || 300;
      const idx = Math.round(el.scrollLeft / (cardWidth + gap));
      setActive((current) => {
        const next = Math.min(Math.max(idx, 0), N - 1);
        return current === next ? current : next;
      });
    });
  }, [N]);

  useEffect(() => {
    return () => {
      if (mobileScrollFrame.current !== null) {
        window.cancelAnimationFrame(mobileScrollFrame.current);
      }
    };
  }, []);

  const goToCard = useCallback((idx: number) => {
    setActive(idx);

    if (!useRingLayout && mobileScrollRef.current) {
      const card = mobileScrollRef.current.children[idx] as HTMLElement | undefined;
      card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [useRingLayout]);

  return (
    <div className="mt-12">
      {useRingLayout ? (
        /* ── Desktop: split layout ── */
        <div className="flex items-start max-w-7xl mx-auto">
          {/* Left: 3D ring */}
          <div className="w-2/5 sticky top-24 h-[80vh] flex items-center justify-center">
            <div
              className="scene-desktop"
              style={{
                width: "280px",
                height: "370px",
                perspective: "1200px",
                perspectiveOrigin: "55% 50%",
              }}
            >
              <div
                ref={ringRef}
                className="ring-3d"
                style={{
                  width: "100%",
                  height: "100%",
                  position: "relative",
                  transformStyle: "preserve-3d",
                  transform: "rotateZ(-12deg) rotateY(var(--ry, 0deg))",
                  transition: "transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1)",
                }}
              >
                {cards.map((card, i) => {
                  const angle = (i / N) * Math.PI * 2;
                  return (
                    <div
                      key={i}
                      className="card-3d"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        transformStyle: "preserve-3d",
                        transform: `rotateY(${angle}rad) translateZ(${RING_R}px)`,
                      }}
                    >
                      {/* Front face */}
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: "28px",
                          overflow: "hidden",
                          backfaceVisibility: "hidden",
                          boxShadow: "0px 8px 32px rgba(0,0,0,0.3), 0px 30px 40px rgba(0,0,0,0.15)",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }}
                      >
                        <img
                          src={card.img}
                          alt={card.title}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      </div>
                      {/* Back face — image reversed */}
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: "28px",
                          overflow: "hidden",
                          backfaceVisibility: "hidden",
                          transform: "rotateY(180deg)",
                          boxShadow: "0px 8px 32px rgba(0,0,0,0.3)",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }}
                      >
                        <img
                          src={card.img}
                          alt=""
                          aria-hidden="true"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: scroll-tracked cards */}
          <div className="w-3/5 relative z-10" style={{ paddingTop: "10vh", paddingBottom: "10vh" }}>
            {cards.map((card, i) => (
              <div
                key={i}
                ref={(el) => { cardRefs.current[i] = el; }}
                className="flex items-center justify-center"
                style={{ height: "70vh", padding: "2rem" }}
              >
                <div
                  className="glass rounded-2xl p-8 max-w-md w-full transition-all duration-500"
                  style={{
                    opacity: active === i ? 1 : 0.35,
                    transform: active === i ? "scale(1)" : "scale(0.96)",
                  }}
                >
                  <span className="text-xs uppercase tracking-[0.2em] text-accent opacity-70 mb-4 block">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-serif text-2xl md:text-3xl text-cream mb-4">{card.title}</h3>
                  <p className="text-cream/80 leading-relaxed mb-6">{card.body}</p>
                  {card.cta && (
                    <a
                      href={card.link}
                      className="inline-flex items-center gap-2 bg-pearl-500 text-cream px-6 py-3 rounded-full text-sm font-medium hover:bg-accent transition-colors"
                    >
                      {card.cta}
                      <span className="inline-block transition-transform group-hover:translate-x-1">&rarr;</span>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Mobile: horizontal snap scroll ── */
        <div
          ref={mobileScrollRef}
          onScroll={handleMobileScroll}
          className="discover-mobile-strip flex overflow-x-auto snap-x snap-mandatory gap-4 px-6 pb-4"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
        >
          {cards.map((card, i) => (
            <div
              key={i}
              className="mobile-discover-card snap-center shrink-0 w-[82vw] max-w-[400px] glass rounded-2xl overflow-hidden"
            >
              <img
                src={card.img}
                alt={card.title}
                className="w-full h-48 object-cover"
              />
              <div className="p-5">
                <h3 className="font-serif text-xl text-cream">{card.title}</h3>
                <p className="text-sm text-cream/80 mt-2 leading-relaxed">{card.body}</p>
                {card.cta && (
                  <a
                    href={card.link}
                    className="inline-flex items-center gap-2 bg-pearl-500 text-cream px-5 py-2.5 rounded-full text-sm font-medium hover:bg-accent transition-colors mt-auto"
                  >
                    {card.cta} &rarr;
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation dots */}
      <div className="flex justify-center gap-2 mt-6">
        {cards.map((_, i) => (
          <button
            key={i}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i === active ? "bg-accent-bright w-6" : "bg-white/20"
            }`}
            aria-label={`Go to card ${i + 1}`}
            onClick={() => goToCard(i)}
          />
        ))}
      </div>
    </div>
  );
}

function FlipCard({ img, title, items }: { img: string; title: string; items: string[] }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      className="relative aspect-[2/3] cursor-pointer [perspective:1000px]"
      onClick={() => setFlipped(!flipped)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFlipped(!flipped);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${title} use cases — ${flipped ? "back" : "front"} side`}
    >
      <div
        className={`relative w-full h-full transition-transform duration-700 [transform-style:preserve-3d] ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        {/* Front — category image */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden [backface-visibility:hidden]">
          <img src={img} alt={title} className="w-full h-full object-cover rounded-2xl" />
        </div>

        {/* Back — use case items */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden [backface-visibility:hidden] [transform:rotateY(180deg)] flex flex-col justify-start p-6"
          style={{ background: "rgba(26,79,114,0.9)", backdropFilter: "blur(12px)" }}
        >
          <h3 className="font-serif text-lg text-accent-bright mb-4">{title}</h3>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-cream/90">
                <span className="text-accent mt-0.5 shrink-0">·</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}



export default function MiddleSection() {
  return (
    <>
      {/* ═══ DISCOVER CAROUSEL ═══ */}
      <motion.section
        id="discover"
        className="relative py-24 md:py-32 scroll-mt-24"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8 }}
      >
        <div className="px-6">
          <h2 className="font-serif text-4xl md:text-6xl text-pearl-900 text-center max-w-3xl mx-auto">
            Your Life, with Superpowers
          </h2>
          <p className="text-pearl-700 mt-4 text-center max-w-2xl mx-auto leading-relaxed">
            Pearl is on your side to help you have enough hours in the day to be the business owner,
            musician, parent, traveller, superhero and dreamer you are ready to be.
          </p>
        </div>
{/* Horizontal snap-scroll carousel */}
        <DiscoverScroll cards={discoverCards} />
      </motion.section>

      {/* ═══ ABOUT / MISSION ═══ */}
      <motion.section
        id="about"
        className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pb-2 scroll-mt-24"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <motion.h2
          className="font-serif text-4xl sm:text-5xl md:text-7xl text-cream leading-tight max-w-4xl"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          Bringing Intelligence to Everyone&rsquo;s Everyday
        </motion.h2>

        <motion.p
          className="font-sans text-lg md:text-xl text-cream/70 mt-8 max-w-2xl leading-relaxed"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Finally, the smart stuff is the easy stuff too.
        </motion.p>

        <motion.a
          href="https://app.pearlos.org/"
          className="mt-10 inline-block rounded-full border border-cream/30 px-8 py-4 text-cream text-lg hover:border-accent-bright hover:text-accent-bright transition-colors"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          Claim Your Free Pearl
        </motion.a>
      </motion.section>

      {/* ═══ USE CASES ═══ */}
      <motion.section
        id="use-cases"
        className="relative px-6 py-24 md:py-32 max-w-6xl mx-auto scroll-mt-24"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8 }}
      >
        <h2 className="font-serif text-4xl md:text-5xl text-accent-bright text-center">
          Pearl&rsquo;s Possibilities
        </h2>
        <p className="text-cream/80 mt-4 text-center max-w-xl mx-auto">
          Turn the cards to see how people have used their Pearls in Beta
        </p>
<div className="mt-14">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 max-w-4xl mx-auto mt-14">
          {useCases.map((uc) => (
            <FlipCard key={uc.title} {...uc} />
          ))}
        </div>
        </div>
      </motion.section>
    </>
  );
}
