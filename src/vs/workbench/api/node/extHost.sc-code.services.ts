/*---------------------------------------------------------------------------------------------
 *  ScCode — Node-side extension host service registrations.
 *
 *  Mirrors VSCode's `extHost.node.services.ts`, minus the services whose
 *  workbench counterparts were not ported (debug, tunnels, MCP, sign). Those
 *  decorators fall back to the web-worker/no-op implementations registered by
 *  `extHost.common.services.ts`.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService, ILoggerService } from '../../../platform/log/common/log.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { IExtHostExtensionService } from '../common/extHostExtensionService.js';
import { IExtHostSearch } from '../common/extHostSearch.js';
import { IExtHostTask } from '../common/extHostTask.js';
import { IExtHostTerminalService } from '../common/extHostTerminalService.js';
import { IExtensionStoragePaths } from '../common/extHostStoragePaths.js';
import { IExtHostVariableResolverProvider } from '../common/extHostVariableResolverService.js';
import { IExtHostAuthentication } from '../common/extHostAuthentication.js';
import { ExtHostTelemetry, IExtHostTelemetry } from '../common/extHostTelemetry.js';
import { ExtHostLogService } from '../common/extHostLogService.js';
import { ExtHostExtensionService } from './extHostExtensionService.js';
import { NativeExtHostSearch } from './extHostSearch.js';
import { ExtHostTask } from './extHostTask.js';
import { ExtHostTerminalService } from './extHostTerminalService.js';
import { ExtensionStoragePaths } from './extHostStoragePaths.js';
import { NodeExtHostVariableResolverProviderService } from './extHostVariableResolverService.js';
import { NodeExtHostAuthentication } from './extHostAuthentication.js';
import { ExtHostLoggerService } from './extHostLoggerService.js';

registerSingleton(IExtHostExtensionService, ExtHostExtensionService, InstantiationType.Eager);
registerSingleton(ILoggerService, ExtHostLoggerService, InstantiationType.Delayed);
registerSingleton(ILogService, new SyncDescriptor(ExtHostLogService, [false], true));
registerSingleton(IExtensionStoragePaths, ExtensionStoragePaths, InstantiationType.Eager);
registerSingleton(IExtHostTelemetry, new SyncDescriptor(ExtHostTelemetry, [false], true));
registerSingleton(IExtHostAuthentication, NodeExtHostAuthentication, InstantiationType.Eager);
registerSingleton(IExtHostSearch, NativeExtHostSearch, InstantiationType.Eager);
registerSingleton(IExtHostTask, ExtHostTask, InstantiationType.Eager);
registerSingleton(IExtHostTerminalService, ExtHostTerminalService, InstantiationType.Eager);
registerSingleton(IExtHostVariableResolverProvider, NodeExtHostVariableResolverProviderService, InstantiationType.Eager);
