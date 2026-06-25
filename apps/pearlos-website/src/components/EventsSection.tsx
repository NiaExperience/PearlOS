import { motion } from "framer-motion";

function EventCard({
  day,
  label,
  title,
  body,
  meta,
  sprite,
}: {
  day: string;
  label: string;
  title: string;
  body: string;
  meta: string;
  sprite?: string;
}) {
  return (
    <div className="glass rounded-2xl p-6 flex flex-col relative overflow-hidden">
      {sprite && (
        <img
          src={sprite}
          alt=""
          aria-hidden="true"
          className="absolute bottom-0 right-0 w-24 h-24 md:w-28 md:h-28 object-contain opacity-80 pointer-events-none"
        />
      )}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-full border border-cream/30 flex items-center justify-center shrink-0 text-cream font-serif text-sm bg-white/10">
          {day}
        </div>
        <div>
          <span className="text-xs uppercase tracking-[0.2em] text-cream/50">{label}</span>
          <h3 className="font-serif text-2xl text-cream mt-1">{title}</h3>
        </div>
      </div>
      <p className="text-cream/80 mt-4 leading-relaxed flex-1">{body}</p>
      <p className="text-cream/60 text-sm mt-4">{meta}</p>
      <a
        href="https://discord.gg/gcba4gb6kz"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-3 text-cream/60 text-sm hover:text-accent-bright hover:underline font-medium"
      >
        Join the Village &rarr;
      </a>
    </div>
  );
}

export default function EventsSection() {
  return (
    <motion.section
      id="events"
      className="relative px-6 py-24 md:py-32 max-w-6xl mx-auto scroll-mt-24"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.8 }}
    >
      <h2 className="font-serif text-4xl md:text-5xl text-cream text-center">Pearly Events</h2>
      <p className="text-cream/70 mt-4 text-center max-w-xl mx-auto">
        Join us for upcoming virtual and in-person events exploring Pearl, PearlOS, and Everyday Intelligence.
      </p>

      <div className="grid md:grid-cols-2 gap-6 mt-12">
        <EventCard
          day="Mon"
          label="Virtual"
          title="Founders Happy Hour"
          body="Who&rsquo;s happy on Monday afternoon? We are! Join members of Pearl&rsquo;s founding team every Monday for a practical walkthrough of the PearlOS ecosystem. Learn what&rsquo;s new and what&rsquo;s next, get tips and insider information, and bring your questions to the team."
          meta="Pearl Village Discord · 1–2 PM ET / 5–6 PM GMT / 10:30–11:30 PM IST"
          sprite="/assets/events/guitarist.png"
        />
        <EventCard
          day="Thu"
          label="Virtual"
          title="Pearl&rsquo;s Social Hour"
          body="A no-agenda social gathering for the Village. Dawn-breaking in the US and round out the day for our Eurasia family. Come meet the rest of the community. Show up because it takes a Village."
          meta="Pearl Village Discord · 8–9 AM ET / 12–1 PM GMT / 5:30–6:30 PM IST"
          sprite="/assets/events/panda.png"
        />
      </div>
    </motion.section>
  );
}
