import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CardDef {
  src: string;
  type: "image" | "video";
}

const cards: CardDef[] = [
  { src: "/assets/beta-videos/ConsoleWars_w_textoverlay.mp4", type: "video" },
  { src: "/assets/beta-videos/NotAPrincess.mp4", type: "video" },
  { src: "/assets/beta-videos/Work Screen.mp4", type: "video" },
  { src: "/assets/beta-videos/Sprites In Discord.mp4", type: "video" },
  { src: "/assets/beta-videos/dinner clip.mp4", type: "video" },
  { src: "/assets/beta-videos/Moments w Pearl_oldUI_sm.mp4", type: "video" },
  { src: "/assets/pearl-faces/face-01.png", type: "image" },
  { src: "/assets/pearl-faces/face-02.png", type: "image" },
];

// Pre-computed grid positions
const grid = cards.map((_, i) => {
  const row = Math.floor(i / 2);
  const col = i % 2;
  return {
    x: `${15 + col * 22}%`,
    y: `${12 + row * 16}%`,
  };
});

function MediaCard({
  card,
  index,
  isFocused,
  onClick,
}: {
  card: CardDef;
  index: number;
  isFocused: boolean;
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pos = grid[index];

  return (
    <motion.div
      className="absolute cursor-pointer rounded-xl overflow-hidden shadow-lg"
      style={{
        width: "clamp(140px, 16vw, 220px)",
        aspectRatio: card.type === "video" ? "16/10" : "1/1",
      }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={
        isFocused
          ? {
              x: "50%",
              y: "50%",
              translateX: "-50%",
              translateY: "-50%",
              left: "50%",
              top: "50%",
              rotate: 0,
              scale: 2.2,
              width: "clamp(280px, 32vw, 440px)",
              zIndex: 50,
              opacity: 1,
              borderRadius: "16px",
            }
          : {
              left: pos.x,
              top: pos.y,
              rotate: 0,
              scale: 1,
              zIndex: 10 + index,
              opacity: 1,
            }
      }
      transition={{ type: "spring", stiffness: 200, damping: 24, mass: 0.8 }}
      onClick={onClick}
      whileHover={isFocused ? {} : { scale: 1.06, rotate: 0, zIndex: 30 }}
    >
      <div className="w-full h-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl overflow-hidden">
        {card.type === "video" ? (
          <video
            ref={videoRef}
            src={card.src}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
          />
        ) : (
          <img
            src={card.src}
            alt=""
            className="w-full h-full object-cover"
          />
        )}
      </div>
    </motion.div>
  );
}

export default function FloatingGallery() {
  const [focused, setFocused] = useState<number | null>(null);

  return (
    <div className="relative h-[60vh] min-h-[400px] w-full lg:h-[74vh]">
      {/* Backdrop when a card is focused */}
      <AnimatePresence>
        {focused !== null && (
          <motion.div
            className="absolute inset-0 z-40"
            style={{ background: "rgba(7,30,48,0.45)", backdropFilter: "blur(8px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFocused(null)}
          />
        )}
      </AnimatePresence>

      {cards.map((card, i) => (
        <MediaCard
          key={i}
          card={card}
          index={i}
          isFocused={focused === i}
          onClick={() => setFocused(focused === i ? null : i)}
        />
      ))}
    </div>
  );
}
