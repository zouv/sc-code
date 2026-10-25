/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IFileService } from '../../files/common/files.js';
import { FileAccess, Schemas } from '../../../base/common/network.js';
import { IProductService } from '../../product/common/productService.js';
import { IStorageService } from '../../storage/common/storage.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import {
	AbstractExtensionResourceLoaderService,
	IExtensionResourceLoaderService
} from '../common/extensionResourceLoader.js';
import { IExtensionGalleryManifestService } from '../../extensionManagement/common/extensionGalleryManifest.js';

class ExtensionResourceLoaderService extends AbstractExtensionResourceLoaderService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@IProductService productService: IProductService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExtensionGalleryManifestService extensionGalleryManifestService: IExtensionGalleryManifestService,
		@ILogService logService: ILogService
	) {
		super(
			fileService,
			storageService,
			productService,
			environmentService,
			configurationService,
			extensionGalleryManifestService,
			logService
		);
	}

	async readExtensionResource(uri: URI): Promise<string> {
		// ScCode: ScCode(Tauri)：file:// 必须直接走 IFileService
		// 根因：FileAccess.uriToBrowserUri 在 Tauri 下会把 file:// 改写成供 <img src>/fetch 用的
		// 资源 URL（见 base/common/network.ts；CUSTOM-20261015-001 起为 Tauri 官方 asset 协议
		// https://asset.localhost/<enc>，此前为自造的 sc-code-asset://）。但本方法紧接着按 scheme 分派，
		// 改写后的 URL 不属预期分支 → 读磁盘上扩展的 package.json/nls 会走错通道（先前 sc-code-asset
		// 无 IFileService provider 必失败，报 "Cannot find a valid extension from the location file:///..."，
		// 从 VSIX 安装扩展时踩到）。故 file:// 一律前置拦截直接读文件系统。
		if ((globalThis as any).__SC_CODE_TAURI__ === true && uri.scheme === Schemas.file) {
			const result = await this._fileService.readFile(uri);
			return result.value.toString();
		}

		uri = FileAccess.uriToBrowserUri(uri);

		if (
			uri.scheme !== Schemas.http &&
			uri.scheme !== Schemas.https &&
			uri.scheme !== Schemas.data &&
			uri.scheme !== Schemas.tauri
		) {
			const result = await this._fileService.readFile(uri);
			return result.value.toString();
		}

		const requestInit: RequestInit = {};
		if (await this.isExtensionGalleryResource(uri)) {
			requestInit.headers = await this.getExtensionGalleryRequestHeaders();
			requestInit.mode = 'cors'; /* set mode to cors so that above headers are always passed */
		}

		const response = await fetch(uri.toString(true), requestInit);
		if (response.status !== 200) {
			this._logService.info(`Request to '${uri.toString(true)}' failed with status code ${response.status}`);
			throw new Error(response.statusText);
		}
		return response.text();
	}
}

registerSingleton(IExtensionResourceLoaderService, ExtensionResourceLoaderService, InstantiationType.Delayed);
