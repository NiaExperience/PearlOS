import TopSection from "../components/TopSection";
import InterfaceShowcase from "../components/InterfaceShowcase";
import EventsSection from "../components/EventsSection";
import MiddleSection from "../components/MiddleSection";
import BottomSection from "../components/BottomSection";

export default function HomePage() {
  return (
    <div className="relative">
      <div className="ocean-bg" aria-hidden="true" />
      <div className="ocean-shimmer" aria-hidden="true" />

      <div className="relative z-10">
        <TopSection />
        <MiddleSection />
        <InterfaceShowcase />
        <EventsSection />
        <BottomSection />
      </div>
    </div>
  );
}
