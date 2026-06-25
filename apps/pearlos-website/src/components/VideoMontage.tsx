import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface PolaroidData {
  src: string;
  note: string;
}

const polaroids: PolaroidData[] = [
  { src: "/assets/beta-videos/dinner clip.mp4", note: "cooking dinner while Pearl drafts proposal" },
  { src: "/assets/beta-videos/NotAPrincess.mp4", note: "super quick image editor" },
  { src: "/assets/beta-videos/Moments w Pearl_oldUI_sm.mp4", note: "We ♥ our beta testers" },
  { src: "/assets/beta-videos/Sprites In Discord.mp4", note: "make a character for anything!" },
  { src: "/assets/beta-videos/Work Screen.mp4", note: "what Pearl's like at work" },
  { src: "/assets/beta-videos/new-clip.mp4", note: "just chatting & laughing w Pearl" },
];

const CARDS = [
  { left: 2,  top: 4,  rotate: -2.5, driftX: 4, driftY: 3, driftDur: 14 },
  { left: 36, top: 0,  rotate: 1.8,  driftX: -3, driftY: 5, driftDur: 16 },
  { left: 68, top: 5,  rotate: -1.2, driftX: 5,  driftY: -4, driftDur: 13 },
  { left: 10, top: 52, rotate: 3.0,  driftX: -4, driftY: 2, driftDur: 15 },
  { left: 44, top: 46, rotate: -0.8, driftX: 3,  driftY: -5, driftDur: 12 },
  { left: 68, top: 52, rotate: 2.2,  driftX: -5, driftY: -3, driftDur: 18 },
];

function PolaroidCard({
  polaroid,
  cfg,
  index,
  onClick,
}: {
  polaroid: PolaroidData;
  cfg: typeof CARDS[number];
  index: number;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <motion.div
      className="absolute cursor-pointer group"
      style={{
        left: `${cfg.left}%`,
        top: `${cfg.top}%`,
        width: "28%",
        transform: `rotate(${cfg.rotate}deg)`,
        transformOrigin: "center center",
      }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: 0.6,
        delay: index * 0.12,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      whileHover={{
        scale: 1.1,
        rotate: 0,
        zIndex: 30,
        transition: { duration: 0.3 },
      }}
      onClick={onClick}
    >
      <motion.div
        className="w-full"
        animate={{
          x: [0, cfg.driftX, -cfg.driftX * 0.8, 0],
          y: [0, -cfg.driftY, cfg.driftY * 0.7, 0],
        }}
        transition={{
          x: { duration: cfg.driftDur, repeat: Infinity, ease: "easeInOut" },
          y: { duration: cfg.driftDur + 2, repeat: Infinity, ease: "easeInOut", delay: 0.7 },
        }}
      >
        <div
          className="overflow-hidden"
          style={{
            aspectRatio: "3/4",
            background: "#fff",
            borderRadius: "4px",
            padding: "5px 5px 28px 5px",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06), 0 1px 0 rgba(0,0,0,0.04)",
          }}
        >
          {/* Video fills the top portion */}
          <div className="w-full overflow-hidden" style={{ borderRadius: "1px", aspectRatio: "3/4" }}>
            <video
              ref={videoRef}
              src={polaroid.src}
              className="w-full h-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            />
          </div>

          {/* Handwritten note */}
          <div className="px-1 pt-1.5">
            <p
              className="text-center leading-tight"
              style={{
                fontFamily: "'Caveat', 'Comic Sans MS', cursive",
                fontSize: "clamp(8px, 1vw, 11px)",
                color: "#2c3e50",
                transform: `rotate(${cfg.rotate * -0.3}deg)`,
              }}
            >
              {polaroid.note}
            </p>
          </div>
        </div>
      </motion.div>

      <div
        className="absolute -inset-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          boxShadow: "0 0 0 2px rgba(168,204,224,0.4), 0 4px 20px rgba(168,204,224,0.15)",
        }}
      />
    </motion.div>
  );
}

function ExpandedVideo({ src, onClose }: { src: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 rounded-[2rem]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <motion.div
        className="max-w-[88vw] max-h-[82vh] rounded-2xl overflow-hidden shadow-2xl"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        onClick={(e) => e.stopPropagation()}
      >
        <video
          ref={videoRef}
          src={src}
          className="max-h-[82vh] max-w-[88vw]"
          autoPlay
          loop
          playsInline
          preload="auto"
        />
      </motion.div>
    </motion.div>
  );
}

export default function VideoMontage() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="relative w-full overflow-hidden rounded-[2rem]" style={{ aspectRatio: "4/4.2" }}>
      {polaroids.map((p, i) => (
        <PolaroidCard
          key={p.src}
          polaroid={p}
          cfg={CARDS[i]}
          index={i}
          isExpanded={expandedIndex === i}
          onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
        />
      ))}

      <AnimatePresence>
        {expandedIndex !== null && (
          <ExpandedVideo
            src={polaroids[expandedIndex].src}
            onClose={() => setExpandedIndex(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
