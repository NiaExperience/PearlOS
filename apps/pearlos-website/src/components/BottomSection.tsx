import { motion } from "framer-motion";

const teamSprites = [
  { src: "/assets/team/Ninja Lioness Ready.png", name: "Stephanie" },
  { src: "/assets/team/Blair_Little_Angry_Thanos.png", name: "Blair" },
  { src: "/assets/team/VoidSprite.png", name: "Himanshu" },
  { src: "/assets/team/Kia Unicorn.png", name: "Kia" },
  { src: "/assets/team/Paddy Croc.png", name: "Paddy" },
  { src: "/assets/team/Angel Funky Chameleon.png", name: "Angel" },
  { src: "/assets/team/Nitesh Sloth.png", name: "Nitesh" },
];

const footerLinks = {
  Product: ["Your Life, with Superpowers", "About", "Inside Pearl", "Use Cases", "Pearly Events", "Folks", "FAQ"],
  Community: ["Discord", "GitHub", "Reddit", "YouTube"],
  Company: ["Contact", "Press", "Careers"],
  Legal: ["Privacy Policy", "Terms of Service"],
};

const footerUrl = (name: string) => {
  const urls: Record<string, string> = {
    Discord: "https://discord.gg/gcba4gb6kz",
    GitHub: "https://github.com/NiaExperience/PearlOS",
    Reddit: "https://www.reddit.com/r/PearlOS/",
    YouTube: "https://youtube.com/@yourpearlos",
    LinkedIn: "https://www.linkedin.com/company/nia-xp",
    About: "#about",
    "Your Life, with Superpowers": "#discover",
    "Use Cases": "#use-cases",
    "Inside Pearl": "#inside-pearl",
    "Pearly Events": "#events",
    Folks: "#team",
    FAQ: "#/faq",
    "Privacy Policy": "#/privacy",
    "Terms of Service": "#/terms",
    Contact: "mailto:hello@niaxp.com",
    Press: "mailto:angel@niaxp.com",
    Careers: "mailto:hello@niaxp.com",
  };
  return urls[name] || "#";
};

const socialLinks = [
  "Discord",
  "GitHub",
  "Reddit",
  "YouTube",
  "LinkedIn",
];

export default function BottomSection() {
  return (
    <>
      {/* ═══ TEAM ═══ */}
      <motion.section
        id="team"
        className="relative px-6 py-24 md:py-32 scroll-mt-24"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8 }}
      >
<h2 className="font-serif text-4xl md:text-5xl text-accent-bright text-center">
          The Folks Who Brought You Pearl
        </h2>
        <p className="text-pearl-200 mt-4 text-center max-w-3xl mx-auto leading-relaxed">
          We are engineers who are artists, designers who code, and experiential creatives who bridge
          tech and story. We&rsquo;re mothers and fathers, pet parents and world travelers, musicians
          and filmmakers, community organizers and volunteers. We create experiences. We design for a
          better future.<br /><br />but this is how Pearl sees us&hellip;
        </p>

        {/* Auto-scrolling sprite carousel */}
        <div className="mt-14 overflow-visible py-1">
          <div className="team-scroll flex w-max">
            {[...teamSprites, ...teamSprites].map((sprite, i) => (
              <div key={i} className="sprite-glisten w-32 h-32 md:w-40 md:h-40 shrink-0 mx-3">
                <img
                  src={sprite.src}
                  alt={sprite.name}
                  className="w-full h-full object-contain rounded-full p-1"
                />
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ═══ FOOTER ═══ */}
      <footer className="px-6 py-16 md:py-20 bg-black/20 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {/* Brand column */}
            <div className="col-span-2 md:col-span-1">
              <span className="font-serif italic text-2xl text-cream">Pearl</span>
              <p className="text-white/50 text-sm mt-2">Everyday Intelligence</p>
            </div>

            {/* Link columns */}
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <h4 className="text-xs uppercase tracking-[0.15em] text-white/40 mb-3">
                  {category}
                </h4>
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link}>
                      <a href={footerUrl(link)} className="text-sm text-white/60 hover:text-accent-bright transition-colors" target={footerUrl(link).startsWith("http") ? "_blank" : undefined} rel={footerUrl(link).startsWith("http") ? "noopener noreferrer" : undefined}>
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Social row */}
          <div className="flex flex-wrap gap-4 mt-10 pt-8 border-t border-white/5">
            {socialLinks.map((link) => (
              <a key={link} href={footerUrl(link)} target="_blank" rel="noopener noreferrer" className="text-sm text-white/40 hover:text-accent-bright transition-colors">
                {link}
              </a>
            ))}
          </div>

          {/* Bottom bar */}
          <p className="text-xs text-white/25 mt-6">
            &copy; 2026 Nia Holdings Inc
          </p>
        </div>
      </footer>
    </>
  );
}
