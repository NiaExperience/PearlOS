import { motion } from "framer-motion";
import VideoMontage from "./VideoMontage";

const pearlMarkSrc = "/assets/pearl-animated.gif";
const videoPattern = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

function InlineMedia({ src, alt, className }: { src: string; alt: string; className: string }) {
  if (videoPattern.test(src)) {
    return (
      <video
        src={src}
        aria-label={alt}
        className={className}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
    );
  }

  return <img src={src} alt={alt} className={className} />;
}

export default function TopSection() {

  return (
    <>
      {/* ── Navigation ── */}
      <nav className="fixed top-0 inset-x-0 z-50 px-6 py-4 flex items-center justify-between border-b border-white/10" style={{ background: "rgba(255,255,255,0.75)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <a href="#" className="font-serif italic text-2xl text-pearl-800 tracking-wide">
          Pearl<span className="text-accent ml-0.5">.</span>
        </a>

        <a
          href="https://app.pearlos.org/"
          className="rounded-full border border-pearl-300 px-5 py-2 text-sm text-pearl-700 hover:border-accent hover:text-accent transition-colors"
        >
          Claim your Free Pearl
        </a>
      </nav>

      {/* ── HERO ── */}
      <section id="home" className="relative min-h-screen px-6 pt-24 lg:pt-20">
        <div className="mx-auto grid min-h-[calc(100vh-6rem)] max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <motion.div
            className="order-2 lg:order-1"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: "easeOut" }}
          >
            <VideoMontage />
          </motion.div>

          <div className="order-1 flex flex-col items-center text-center lg:order-2 lg:items-end lg:text-right">
            <InlineMedia
              src={pearlMarkSrc}
              alt=""
              className="mb-3 h-20 w-20 object-contain opacity-90 md:h-28 md:w-28"
            />
            <motion.h1
              className="font-serif italic text-[clamp(3.6rem,8vw,8.5rem)] text-pearl-800 tracking-tight"
              style={{ textShadow: "0 0 40px rgba(58,123,168,0.15)" }}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
            >
              Pearl
            </motion.h1>

            <motion.p
              className="mt-4 font-serif italic text-2xl text-pearl-700 sm:text-3xl md:text-5xl lg:text-4xl"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
            >
              Everyday Intelligence
            </motion.p>

            <motion.a
              href="https://www.nvidia.com/en-us/startups/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex justify-center"
              aria-label="NVIDIA Inception Program"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.55, ease: "easeOut" }}
            >
              <img
                src="/assets/nvidia-inception-program-badge-rgb-for-screen.png"
                alt="NVIDIA Inception Program badge"
                className="h-20 w-auto opacity-90 md:h-24"
              />
            </motion.a>
          </div>
        </div>
      </section>

    </>
  );
}
