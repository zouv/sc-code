/*---------------------------------------------------------------------------------------------
 *  ScCode —— 补注册 IAccessibleViewInformationService（移植缺口）
 *
 *  为什么需要这个模块：
 *  ScCode 移植版里 `src/vs/workbench/services/accessibility/common/accessibleViewInformationService.ts`
 *  同时提供了接口和实现，但**全仓库没有任何 `registerSingleton` 调用**
 *  （上游 VSCode 负责注册的 accessibility contribution 没有被移植过来）。
 *
 *  后果：DI 容器在严格模式下取不到这个服务。`TreeViewPane` 的构造函数要求注入它
 *  （`workbench/browser/parts/views/treeView.ts` 的 `@IAccessibleViewInformationService`），
 *  于是**任何 `type: "tree"` 的扩展视图都会在构造时抛**：
 *
 *      Error: [createInstance] TreeViewPane depends on UNKNOWN service accessibleViewInformationService.
 *
 *  而 `ViewPaneContainer.onDidAddViewDescriptors` 只对 `pane.render()` 做了 try/catch，
 *  **构造函数没有**，异常会一路冒到 `createComposite()/showComposite()`；此时
 *  `CompositePart.doOpenComposite` 已经先执行了 `hideActiveComposite()` + `updateTitle()`，
 *  侧边栏就停在「有标题、但没有 active composite」的状态 —— 界面表现为
 *
 *      侧边栏只剩 "Drag a view here to display."，连点多少次都不会好。
 *
 *  实测（VAC 1.1.0，views: vac-dashboard=webview、vac-sessions=tree、vac-chat=webview）：
 *  `vac-dashboard` 构造成功，紧邻的 `vac-sessions`（tree）抛错，整个容器打不开。
 *  同理 Claude Code 的 `claude-sessions-sidebar`、内置 references-view 等 tree 视图容器也打不开。
 *
 *  本模块只做一件事：把服务注册上（`Delayed`，与上游一致）。实现只读 storage 里的一个布尔值，
 *  无额外依赖，注册后 tree 型扩展视图即可正常构造。
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions.js';
import {
	AccessibleViewInformationService,
	IAccessibleViewInformationService
} from 'vs/workbench/services/accessibility/common/accessibleViewInformationService.js';

registerSingleton(
	IAccessibleViewInformationService,
	AccessibleViewInformationService,
	InstantiationType.Delayed
);
