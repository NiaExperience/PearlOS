import { HashRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import FAQSection from "./components/FAQSection";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import SmsOptInPage from "./pages/SmsOptInPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/faq"
          element={
            <div className="relative min-h-screen bg-[#071e30]">
              <div className="relative z-10 pt-24">
                <div className="px-6 max-w-3xl mx-auto mb-8">
                  <a href="#/" className="text-accent-bright text-sm hover:underline">
                    &larr; Back
                  </a>
                </div>
                <FAQSection />
              </div>
            </div>
          }
        />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/sms-opt-in" element={<SmsOptInPage />} />
      </Routes>
    </HashRouter>
  );
}
