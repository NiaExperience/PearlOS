export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: "#1A4F72" }}>
      <div className="relative z-10 pt-24 pb-24 px-6 max-w-3xl mx-auto">
        <a href="#/" className="text-accent-bright text-sm hover:underline mb-8 inline-block">
          &larr; Back
        </a>

        <h1 className="font-serif text-4xl md:text-5xl text-cream mt-4">Privacy Policy</h1>
        <p className="text-cream/60 text-sm mt-2">Last updated: March 19, 2026</p>

        <div className="mt-12 space-y-10">
          <Section
            num="1"
            title="Our Philosophy"
            body="PearlOS is built on a simple principle: your data belongs to you. We do not harvest, sell, or monetize your personal information. Ever."
          />
          <Section
            num="2"
            title="What We Collect"
            body={
              <>
                <p className="mb-3">
                  <strong className="text-cream">When you use pearlos.org (this website):</strong>{" "}
                  We may collect basic analytics (page views, referrer) to understand how people find
                  us. No personal data is collected from the website.
                </p>
                <p>
                  <strong className="text-cream">When you self-host PearlOS:</strong>{" "}
                  PearlOS runs entirely on your own infrastructure. Your conversations, files, notes, and
                  AI interactions stay on your machine. We have zero access to your self-hosted instance.
                </p>
              </>
            }
          />
          <Section
            num="3"
            title="Third Party Services"
            body="PearlOS can connect to third party AI providers (Anthropic, OpenAI, Google, etc.), voice services, and social platforms at your direction. When you enable these integrations, data is shared with those providers according to their privacy policies. We encourage you to review their terms."
          />
          <Section
            num="4"
            title="Social Login"
            body="If you connect social accounts (TikTok, YouTube, etc.) to your PearlOS instance, we request only the permissions needed for the features you use. Authentication tokens are stored locally on your instance, not on our servers."
          />
          <Section
            num="5"
            title="Cookies"
            body="This website uses minimal cookies for basic functionality. No tracking cookies. No ad networks."
          />
          <Section
            num="6"
            title="Data Retention"
            body="Since PearlOS is self-hosted, you control all data retention. You can delete your data at any time by removing it from your own infrastructure."
          />
          <Section
            num="7"
            title="Children's Privacy"
            body="PearlOS is not directed at children under 13. We do not knowingly collect personal information from children."
          />
          <Section
            num="8"
            title="Changes to This Policy"
            body="We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date."
          />
          <Section
            num="9"
            title="Contact"
            body={
              <>
                Questions about privacy? Reach us at{" "}
                <a href="mailto:hello@niaxp.com" className="text-accent-bright hover:underline">
                  hello@niaxp.com
                </a>
                .
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

function Section({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="font-serif text-2xl text-cream">
        <span className="text-cream/40 mr-2">{num}.</span>
        {title}
      </h2>
      <div className="mt-3 text-cream/80 leading-relaxed">{body}</div>
    </div>
  );
}
