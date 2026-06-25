"use client";

import { useState } from "react";

export default function SmsOptIn() {
  const [phone, setPhone] = useState("");
  const [consented, setConsented] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handlePhone = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Format as user types: (XXX) XXX-XXXX
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
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🖤</div>
          <h1 className="text-3xl font-bold mb-2">Opt-In Consent</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            This is an online opt-in consent disclosure. By opting in, you agree
            to receive conversational AI companion messages from Pearl at the
            phone number provided. This is a one-on-one conversation service,
            not a marketing list.
          </p>
        </div>

        {submitted ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <div className="text-4xl mb-4">✨</div>
            <h2 className="text-xl font-semibold mb-3">You&apos;re in</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Pearl will text you soon. In the meantime, you can always reach
              out first — just text the number below and say hello.
            </p>
            <div className="mt-6 bg-zinc-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Pearl&apos;s number</p>
              <p className="text-xl font-mono font-bold text-purple-400">
                +1 (877) 644-9412
              </p>
            </div>
            <p className="text-xs text-gray-600 mt-6">
              Reply STOP to opt out. Msg &amp; data rates may apply.
              Msg frequency varies.{" "}
              <a href="/privacy-policy" className="underline text-purple-400">
                Privacy policy
              </a>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
              {/* Phone input */}
              <div>
                <label
                  htmlFor="phone"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Phone Number
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm bg-zinc-800 px-3 py-2.5 rounded-lg">
                    +1
                  </span>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={handlePhone}
                    placeholder="(555) 123-4567"
                    maxLength={14}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
                  />
                </div>
              </div>

              {/* Consent */}
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={consented}
                    onChange={(e) => {
                      setConsented(e.target.checked);
                      setError("");
                    }}
                    className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                  />
                  <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors leading-relaxed">
                    By checking this box, you agree to receive conversational AI
                    companion messages from Pearl at the phone number provided.
                    This is not a marketing list — you are opting into
                    one-on-one conversation with your Pearl. Reply STOP to opt
                    out at any time.
                  </span>
                </label>
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-medium py-3 px-6 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                Opt In
              </button>
            </div>

            <p className="text-xs text-gray-600 mt-4 text-center">
              Msg &amp; data rates may apply. Msg frequency varies.{" "}
              <a href="/privacy-policy" className="underline text-purple-400">
                Privacy policy
              </a>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
