import { notFound } from 'next/navigation';

import { AssistantActions } from '@nia/prism/core/actions';
import { getHtmlGeneration } from '@interface/features/HtmlGeneration/actions/html-generation-actions';
import { HtmlGenerationViewer } from '@interface/features/HtmlGeneration/components/HtmlGenerationViewer';

export default async function AppletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const applet = await getHtmlGeneration(id);

  if (!applet) {
    notFound();
  }

  let assistantConfig = null;
  const assistantName = applet.metadata?.assistantName;

  if (assistantName) {
    const assistantRecord = await AssistantActions.getAssistantBySubDomain(assistantName);
    if (assistantRecord) {
      const record = assistantRecord as any;
      assistantConfig = {
        assistantName,
        tenantId: assistantRecord.tenantId,
        personalityId: record.personality_config?.personalityId,
        voiceId: record.voice_config?.voiceId,
        voiceProvider: record.voice_config?.provider,
        voiceParameters: record.voice_config?.voiceParameters,
        supportedFeatures: assistantRecord.supportedFeatures || [],
        persona: record.persona_name,
      };
    }
  }

  return (
    <div className="h-screen w-screen bg-white overflow-hidden">
      <HtmlGenerationViewer 
        htmlGeneration={applet} 
        onClose={() => {}} 
        isFullscreen={true}
        assistantConfig={assistantConfig}
      />
    </div>
  );
}
