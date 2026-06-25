export default function TermsPage() {
  return (
    <div className="min-h-screen" style={{ background: "#F0F6FA" }}>
      <div className="relative z-10 pt-24 pb-24 px-6 max-w-3xl mx-auto">
        <a href="#/" className="text-pearl-500 text-sm hover:underline mb-8 inline-block">
          &larr; Back
        </a>

        <h1 className="font-serif text-4xl md:text-5xl text-pearl-800 mt-4">Terms of Service</h1>
        <p className="text-pearl-500 text-sm mt-2">Last updated: March 19, 2026</p>

        <div className="mt-12 space-y-10">
          <Section
            num="1"
            title="Acceptance of Terms"
            body='By accessing or using PearlOS ("the Service"), provided by NIAXP ("we", "us", "our"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.'
          />
          <Section
            num="2"
            title="Description of Service"
            body="PearlOS is an open source, voice-first AI companion platform. It runs on your own hardware or cloud infrastructure. We provide the software; you control your data."
          />
          <Section
            num="3"
            title="Open Source License"
            body={
              <>
                PearlOS is released under the MIT License. You may use, modify, and distribute the
                software in accordance with that license. The full license text is available at{" "}
                <a
                  href="https://github.com/NiaExperience/PearlOS"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pearl-500 hover:underline"
                >
                  github.com/NiaExperience/PearlOS
                </a>
                .
              </>
            }
          />
          <Section
            num="4"
            title="User Responsibilities"
            body="You are responsible for your use of PearlOS, including any content you create, store, or share through the platform. You agree not to use the Service for any unlawful purpose."
          />
          <Section
            num="5"
            title="Third Party Services"
            body="PearlOS may integrate with third party services (AI providers, voice services, social platforms). Your use of those services is governed by their respective terms. We are not responsible for third party service availability or policies."
          />
          <Section
            num="6"
            title="No Warranty"
            body='THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT GUARANTEE UNINTERRUPTED OR ERROR-FREE OPERATION.'
          />
          <Section
            num="7"
            title="Limitation of Liability"
            body="TO THE MAXIMUM EXTENT PERMITTED BY LAW, NIAXP SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE SERVICE."
          />
          <Section
            num="8"
            title="Changes to Terms"
            body="We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the updated Terms."
          />
          <Section
            num="9"
            title="Contact"
            body={
              <>
                Questions about these Terms? Reach us at{" "}
                <a href="mailto:hello@niaxp.com" className="text-pearl-500 hover:underline">
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
      <h2 className="font-serif text-2xl text-pearl-800">
        <span className="text-pearl-300 mr-2">{num}.</span>
        {title}
      </h2>
      <div className="mt-3 text-pearl-600 leading-relaxed">{body}</div>
    </div>
  );
}
