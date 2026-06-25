import { useState } from "react";

export default function SmsOptInPage() {
  const [phone, setPhone] = useState("");
  const [consented, setConsented] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handlePhone = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 10) val = val.slice(0, 10);
    let formatted = val;
    if (val.length >= 6) {
      formatted = `(${val.slice(0, 3)}) ${val.slice(3, 6)}-${val.slice(6)}`;
    } else if (val.length >= 3) {
      formatted = `(${val.slice(0, 3)}) ${val.slice(3)}`;
    }
    setPhone(formatted);
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }
    if (!consented) {
      setError("Please check the consent box to opt in.");
      return;
    }
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen" style={{ background: "#1A4F72" }}>
      <div className="relative z-10 pt-24 pb-24 px-6 max-w-xl mx-auto">
        <a href="#/" className="text-accent-bright text-sm hover:underline mb-8 inline-block">
          &larr; Back
        </a>

        <h1 className="font-serif text-4xl md:text-5xl text-cream mt-4">SMS Opt-In</h1>
        <p className="text-cream/60 text-sm mt-2">
          Online opt-in consent disclosure for Pearl SMS
        </p>

        {submitted ? (
          <div className="mt-12 bg-white/5 border border-white/10 rounded-xl p-8 text-center">
            <p className="text-5xl mb-4">✨</p>
            <h2 className="text-2xl font-serif text-cream mb-3">You're opted in</h2>
            <p className="text-cream/70 text-sm leading-relaxed mb-6">
              Text Pearl anytime at the number below. This is a one-on-one
              conversation, not a marketing list.
            </p>
            <div className="bg-white/10 rounded-lg p-4 inline-block">
              <p className="text-xs text-cream/40 mb-1">Pearl's number</p>
              <p className="text-xl font-mono font-bold text-accent-bright">
                +1 (877) 644-9412
              </p>
            </div>
            <p className="text-cream/40 text-xs mt-6">
              Reply STOP to opt out. Msg &amp; data rates may apply.
              Msg frequency varies.{" "}
              <a href="#/privacy" className="underline text-accent-bright">
                Privacy policy
              </a>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-12">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-6">
              {/* Phone input */}
              <div>
                <label className="block text-sm text-cream/80 mb-2">
                  Phone Number
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-cream/40 text-sm bg-white/10 px-3 py-2.5 rounded-lg">
                    +1
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={handlePhone}
                    placeholder="(555) 123-4567"
                    maxLength={14}
                    className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2.5 text-cream placeholder-cream/30 focus:outline-none focus:border-accent-bright focus:ring-1 focus:ring-accent-bright transition-colors"
                  />
                </div>
              </div>

              {/* Consent checkboxes */}
              <div className="space-y-5">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={consented}
                    onChange={(e) => {
                      setConsented(e.target.checked);
                      setError("");
                    }}
                    className="mt-1 h-4 w-4 rounded border-cream/30 bg-white/10 text-accent-bright focus:ring-accent-bright focus:ring-offset-0"
                  />
                  <span className="text-sm text-cream/70 group-hover:text-cream transition-colors leading-relaxed">
                    By checking this box, you agree to receive conversational AI
                    companion messages from Pearl at the phone number provided.
                    This is not a marketing list — you are opting into
                    one-on-one conversation with your Pearl. Reply STOP to opt
                    out at any time.
                  </span>
                </label>
              </div>

              {error && (
                <p className="text-red-300 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="w-full bg-accent-bright hover:bg-accent-bright/90 text-[#0A2540] font-semibold py-3 px-6 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent-bright focus:ring-offset-2 focus:ring-offset-transparent"
              >
                Opt In
              </button>
            </div>

            <p className="text-cream/40 text-xs mt-4 text-center">
              Msg &amp; data rates may apply. Msg frequency varies.{" "}
              <a href="#/privacy" className="underline text-accent-bright">
                Privacy policy
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
