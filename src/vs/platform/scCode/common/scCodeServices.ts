export { ScCodeEditorBridge } from './scCodeEditorService.js';
export { ScCodeSyntaxService } from './scCodeSyntaxService.js';
export { ScCodeGitService } from './scCodeGitService.js';
export { ScCodeSearchService } from './scCodeSearchService.js';
export { ScCodeSettingsService } from './scCodeSettingsService.js';
export { ScCodeThemeService } from './scCodeThemeService.js';
export { ScCodeExtensionService } from './scCodeExtensionService.js';
export { ScCodeKeymapService } from './scCodeKeymapService.js';
export { ScCodeTaskService, IScCodeTaskService } from './scCodeTaskService.js';
export type {
	DetectedTask,
	TaskDefinition,
	TaskSpawnOptions,
	TaskOutputEvent,
	TaskExitEvent
} from './scCodeTaskService.js';
export { ScCodeFileSystemProvider } from '../browser/scCodeFileSystemProvider.js';
export { IScCodeExtensionApiService, ScCodeExtensionApiService } from './scCodeExtensionApiService.js';
export type { ExtCommandInfo, ExtNamespace, ExtCommandResult } from './scCodeExtensionApiService.js';
