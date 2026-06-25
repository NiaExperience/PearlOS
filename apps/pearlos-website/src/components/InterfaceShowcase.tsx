import { useState } from "react";
import { motion } from "framer-motion";

const screenCards = [
  { file: "Your Home, Clutter Free.png", desc: "Your digital space, organized around how you think. Pearl keeps it clean so you can focus on what matters." },
  { file: "Your Data, Your Control.png", desc: "You decide what Pearl can access and what others can see (Social in beta). Locked tight, running deep, and entirely yours. No data extraction, ever." },
  { file: "Your Sprite Summoner.png", desc: "Summon custom pixel art characters instantly. Pearl designs them, you use them in games, apps, and profiles." },
  { file: "Your Social Connections.png", desc: "Connect your world to Pearl. She'll help you draft posts, schedule dispatches, and keep your communities thriving." },
  { file: "Your Soundtrack.png", desc: "Music and sound woven into every moment. Pearl sets the mood whether you're working, relaxing, or exploring." },
  { file: "Your Notes, Made Magical.png", desc: "Create notes by talking, typing, and having Pearl add info, all at the same time. Never search for a note again, just ask Pearl to bring it up for you." },
  { file: "Your News.png", desc: "News that respects your time. Pearl curates what matters to you and brings it up when you're ready." },
  { file: "Your Friendly Weather Updates.png", desc: "Weather made beautiful at a glance, personalized for you. Pearl will even let you know if you need an umbrella." },
  { file: "Your Creative Studio.png", desc: "Make images, apps, games, and pixel art. Pearl's creative suite adapts to what you want to build." },
];

function HorizontalFlipCard({
  img,
  title,
  desc,
}: {
  img: string;
  title: string;
  desc: string;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      className="relative cursor-pointer [perspective:1000px]"
      style={{ aspectRatio: "16/10" }}
      onClick={() => setFlipped(!flipped)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFlipped(!flipped);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${title} — ${flipped ? "back" : "front"} side`}
    >
      <div
        className={`relative w-full h-full transition-transform duration-700 [transform-style:preserve-3d] ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        {/* Front — screenshot */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden [backface-visibility:hidden]">
          <img src={img} alt={title} className="w-full h-full object-cover" />
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-8">
            <span className="font-serif text-sm text-cream font-medium">{title}</span>
          </div>
        </div>

        {/* Back — description */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden [backface-visibility:hidden] [transform:rotateY(180deg)] flex flex-col justify-center p-6"
          style={{
            background: "rgba(26,79,114,0.9)",
            backdropFilter: "blur(12px)",
          }}
        >
          <h3 className="font-serif text-lg text-accent-bright mb-2">{title}</h3>
          <p className="text-cream/80 text-sm leading-relaxed">{desc}</p>
        </div>
      </div>
    </div>
  );
}

export default function InterfaceShowcase() {
  return (
    <motion.section
      id="inside-pearl"
      className="relative px-6 pt-8 pb-24 md:pb-32 max-w-6xl mx-auto scroll-mt-24"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.8 }}
    >
      <h2 className="font-serif text-4xl md:text-5xl text-accent-bright text-center">
        Inside Your Pearl
      </h2>
      <p className="text-cream/70 mt-4 text-center max-w-xl mx-auto">
        A glimpse at what the experience looks like. Flip for details.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 mt-14">
        {screenCards.map((card) => (
          <HorizontalFlipCard
            key={card.file}
            img={`/assets/inside-pearl/${card.file}`}
            title={card.file.replace(".png", "")}
            desc={card.desc}
          />
        ))}
      </div>
    </motion.section>
  );
}
