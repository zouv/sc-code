/*---------------------------------------------------------------------------------------------
 *  ScCode Orchestrator — Public API
 *--------------------------------------------------------------------------------------------*/

import './orchestration.css';

export { ScCodeOrchestrator } from './orchestratorService.js';
export type { OrchestratorState } from './orchestratorService.js';
export { OrchestrationView } from './orchestrationView.js';
export { StreamConsumer, collectStream, waitForEvent } from './streamConsumer.js';
export { ScCodeLearningService } from './learningService.js';
export type {
	TaskNode,
	TaskNodeType,
	TaskStatus,
	TaskHandoff,
	TaskMeasurement,
	OrchestrationPlan,
	OrchestratorEvent,
	OrchestratorConfig,
	SpawnTaskRequest,
	VerifierVerdict,
} from './types.js';
export { DEFAULT_ORCHESTRATOR_CONFIG } from './types.js';
