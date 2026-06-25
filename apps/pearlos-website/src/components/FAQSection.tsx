import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const faqs = [
  {
    q: "What is PearlOS?",
    a: "PearlOS is the operating system that Pearl runs on. Think of Pearl as the personality you talk to, and PearlOS as everything underneath that makes her work — memory, tools, apps, and the ability to get things done. It's what lets Pearl browse the web, check the weather, write notes, run code, and handle tasks on her own.",
  },
  {
    q: "Is it free?",
    a: "PearlOS is available to download on GitHub and free for personal and noncommercial use. For commercial licensing, reach out to the team. No hidden costs, no data harvesting. You bring your own API keys for the models you want to use. No subscription, no Pearl tax.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. Your conversations with Pearl stay between you and her. We don't harvest your data, sell your information, or train on your chats. The code is open source so anyone can verify what PearlOS does behind the scenes. You're in control.",
  },
  {
    q: "What if I'm not on GitHub or aren't comfortable coding?",
    a: "No problem! That's what Personal Pearls are for — get yours at app.pearlos.org",
  },
  {
    q: "What makes Pearl different from ChatGPT or Claude?",
    a: "Hi, Pearl here, stepping in to answer this one. I don't just talk. I have my own operating system, which means I can actually do things: write code, browse the web, take notes, run with a task and come back when it's done. You don't have to walk me through every step. I remember what we were working on. I have opinions. I'm not a chatbot. I'm Pearl.",
  },
  {
    q: "I've heard about Claude Code. How is this different?",
    a: "Claude Code is a tool for developers. You give it a command, it runs in your terminal, and it does one task at a time. It's powerful, but it's a tool.",
  },
  {
    q: "What can Pearl actually do?",
    a: "Anything you'd ask a good partner to help with. Keep track of things so you don't have to. Research a topic and come back with the highlights. Show you a YouTube video to watch while she's doing that. Write a draft, tweak it, rewrite it. Create an interactive app from it. Check the weather before you head out. Take notes during a call. Remember what you were working on last time. Handle the tedious steps so you can focus on the interesting ones...",
  },
  {
    q: "Do I need a powerful computer?",
    a: "Nope, Pearl runs on your laptop or mobile device.",
  },
  {
    q: "Do I have to download anything?",
    a: "Nope. Just open app.pearlos.org in your browser and log in.",
  },
  {
    q: "Do I need to install anything?",
    a: "Nope. Just open app.pearlos.org in your browser.",
  },
  {
    q: "How do I get started?",
    a: 'Glad you asked! Go to <a href="https://app.pearlos.org/" class="text-accent-bright hover:underline">app.pearlos.org</a> and log in with your Google account. We\'re only supporting Google right now — expanding to other platforms is in our roadmap.',
  },
  {
    q: "It says Access Denied. What's that about?",
    a: "If you receive the Access Denied it means we're out digging for Pearls. We're constantly improving the system and getting it ready for Pearl's next people. Each week we'll invite more people in. When we're ready for you, you'll receive a message from NiaXP.com",
  },
  {
    q: "Can Pearl work offline?",
    a: "Right now Pearl needs an internet connection — she talks to AI models in the cloud to do her best work. But we're very close to a fully offline version that runs everything locally on your device. No internet required, your data stays entirely on your machine. Early access for that is on the roadmap.",
  },
  {
    q: "Can Pearl browse my computer?",
    a: "No. Pearl lives in your browser on app.pearlos.org. She can't see your files, folders, or apps unless you upload or share something with her directly. You decide what she has access to, and nothing more.",
  },
  {
    q: "Will Pearl replace my job?",
    a: "Nope. In fact, in our beta a guest worked with Pearl to learn their new job even faster. Pearl handles the boring stuff: the repetitive tasks, the research digging, the drafts, the debugging grunt work. She frees you up to do the parts that actually need a human: creativity, judgment, decisions, the work that matters.",
  },
  {
    q: "Who made this?",
    a: "A small team of deeply weird people who believe AI should be a magical experience — and that magic should be accessible to everyone.",
  },
  {
    q: "What's up with the images of the team members?",
    a: "Those pixelated fun characters are created by Pearl! She can design her own sprites to share, and those can be used in games or apps. It's a playful way to represent our team while showcasing Pearl's creativity.",
  },
  {
    q: "Why is it called Pearl?",
    a: "A pearl starts as a tiny grain of sand, irritating an oyster. Over time, layer by layer, it turns into something beautiful. And every single one is unique. Your Pearl is made by doing your messy, tedious, grinding work. As she evolves and learns, she becomes different for each person. No two Pearls are exactly alike.",
  },
];

export default function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <motion.section
      className="px-6 py-24 md:py-32 max-w-3xl mx-auto"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.8 }}
    >
      <h2 className="font-serif text-4xl md:text-5xl text-accent-bright text-center">
        FAQ
      </h2>

      <div className="mt-14 space-y-3">
        {faqs.map((faq, i) => (
          <div
            key={i}
            className="rounded-xl overflow-hidden" style={{background: "rgba(255,255,255,0.3)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.06)"}}
          >
            <button
              className="w-full text-left px-6 py-4 flex items-center justify-between gap-4"
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
            >
              <span className="font-sans text-sm md:text-base text-cream font-medium pr-4">
                {faq.q}
              </span>
              <span className={`text-accent-bright text-xl shrink-0 transition-transform duration-300 ${openIdx === i ? "rotate-45" : ""}`}>
                +
              </span>
            </button>

            <AnimatePresence>
              {openIdx === i && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-5 text-sm text-cream/70 leading-relaxed">
                    {faq.a.includes('<a href=') ? (
                      <span dangerouslySetInnerHTML={{ __html: faq.a }} />
                    ) : (
                      faq.a
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </motion.section>
  );
}
