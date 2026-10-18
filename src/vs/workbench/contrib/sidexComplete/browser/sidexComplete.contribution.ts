/*---------------------------------------------------------------------------------------------
 *  Sidex Complete — Registers the FIM inline-completion provider.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { SidexCompleteProvider } from './sidexCompleteProvider.js';
import { resolveServerEndpoint, serverHttpUrl } from '../../sidexChat/browser/localServer.js';

class SidexCompleteContribution implements IWorkbenchContribution {
	static readonly ID = 'sidex.complete';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		// Defaults to the agent server the app runs locally; an explicit
		// setting points completions somewhere else. The endpoint is resolved on
		// the first completion request (not at startup) so merely opening the
		// editor does not spawn the Go agent server. The URL is re-read per
		// request, so a server restart doesn't strand the provider on a dead port.
		const resolveUrl = async () => {
			const explicit = configurationService.getValue<string>('sidex.complete.serverUrl');
			if (!explicit) {
				await resolveServerEndpoint();
			}
			return serverHttpUrl(explicit);
		};
		const provider = new SidexCompleteProvider(resolveUrl);
		languageFeaturesService.inlineCompletionsProvider.register('*', provider);
	}
}

registerWorkbenchContribution2(SidexCompleteContribution.ID, SidexCompleteContribution, WorkbenchPhase.AfterRestored);
