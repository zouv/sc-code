// Loaded synchronously before workbench modules; kept external for CSP.
			// VS Code globals — must be set before any module loads
			globalThis._VSCODE_FILE_ROOT = window.location.origin + '/src/';
			globalThis._VSCODE_NLS_LANGUAGE = localStorage.getItem('vscode.nls.locale') || 'en';
			globalThis._VSCODE_NLS_MESSAGES = [];

			globalThis.__SC_CODE_TAURI__ = true;
			try {
				const ua = navigator.userAgent || '';
				const plat = navigator.platform || '';
				if (ua.includes('Mac') || plat.includes('Mac')) {
					globalThis.__SC_CODE_ARCH__ = 'arm64';
					try {
						const gl = document.createElement('canvas').getContext('webgl');
						const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
						const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
						if (renderer && /Intel/i.test(renderer) && !/Apple/i.test(renderer)) {
							globalThis.__SC_CODE_ARCH__ = 'x64';
						}
					} catch (_) {}
				} else {
					globalThis.__SC_CODE_ARCH__ = 'x64';
				}
			} catch (_) {
				globalThis.__SC_CODE_ARCH__ = 'x64';
			}
			globalThis._VSCODE_PACKAGE_JSON = { version: '1.110.0', name: 'sc-code' };
			globalThis._VSCODE_PRODUCT_JSON = {
				nameShort: 'ScCode',
				nameLong: 'ScCode',
				applicationName: 'sc-code',
				dataFolderName: '.sc-code',
				urlProtocol: 'sc-code',
				version: '1.110.0',
				commit: '',
				date: new Date().toISOString(),
				quality: 'stable',
				reportIssueUrl: 'https://github.com/zouv/sc-code/issues/new',
				licenseName: 'MIT',
				licenseUrl: 'https://github.com/zouv/sc-code/blob/main/LICENSE',
				extensionsGallery: {
					serviceUrl: 'https://open-vsx.org/vscode/gallery',
					itemUrl: 'https://open-vsx.org/vscode/item',
					resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
					controlUrl: '',
					nlsBaseUrl: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/extension',
					publisherUrl: ''
				}
			};
