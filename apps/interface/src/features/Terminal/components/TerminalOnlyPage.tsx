import TerminalView from './TerminalView';
import { PearlOSCodeResetPanel } from '@interface/components/settings-panels/PearlOSCodeResetPanel';

export default function TerminalOnlyPage() {
  return (
    <main
      className="relative h-svh w-screen overflow-hidden bg-[#05070a] text-white"
      data-pearl-terminal="true"
    >
      <details className="absolute right-3 top-3 z-20 w-[min(360px,calc(100vw-24px))] rounded-md border border-red-500/30 bg-[#0b1012]/95 text-white shadow-xl">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-red-100">
          RESET PEARLOS CODE
        </summary>
        <div className="border-t border-red-500/20 p-3">
          <PearlOSCodeResetPanel compact />
        </div>
      </details>
      <TerminalView />
    </main>
  );
}
