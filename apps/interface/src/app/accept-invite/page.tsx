import { AcceptInvite } from '@interface/components/auth/AcceptInvite';
import { AssistantThemeProvider } from '@interface/theme/AssistantThemeContext';
import { AssistantActions, AssistantThemeActions } from '@nia/prism/core/actions';
import type { IAssistantTheme } from '@nia/prism/core/blocks/assistantTheme.block';
import { getLogger } from '@interface/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AcceptInvitePage({
	searchParams,
}: {
	searchParams?: Promise<{ token?: string; assistant?: string }>;
}) {
	const log = getLogger('AcceptInvite');
    const params = await searchParams;
	const assistantParam = params?.assistant || '';
	let theme: IAssistantTheme | undefined = undefined;
	if (assistantParam) {
		try {
			const assistantRecord = await AssistantActions.getAssistantBySubDomain(assistantParam);
			if (assistantRecord) {
				theme = await AssistantThemeActions.getAssistantTheme(
					assistantRecord?._id?.toString() || '',
					(assistantRecord?.name as string) || ''
				);
			}
		} catch (e) {
			log.warn('Failed to load assistant theme', { assistantParam, error: e });
		}
	}
	return (
		<AssistantThemeProvider theme={theme}>
			<AcceptInvite />
		</AssistantThemeProvider>
	);
}
