import { CreationLaunchpad } from '@interface/features/CreationLaunchpad';
import { TopBarTitle } from '@interface/components/TopBarTitle';

// Skip static prerendering — this page mounts a client-side gallery that
// fetches `/api/launchpad/projects` at runtime, so trying to render it at
// build time hits a Server Components error during SSG. Server-side render
// it on demand instead.
export const dynamic = 'force-dynamic';

export default function LaunchpadPage() {
  return (
    <div className="h-svh w-screen overflow-hidden bg-[#0a0614] pt-16">
      <TopBarTitle />
      <CreationLaunchpad />
    </div>
  );
}
