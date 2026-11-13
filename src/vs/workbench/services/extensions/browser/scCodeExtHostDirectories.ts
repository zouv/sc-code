/*---------------------------------------------------------------------------------------------
 *  ScCode — native extension-host storage/log directories.
 *
 *  The real Node extension host creates output-channel log folders with a
 *  non-recursive `mkdir` (DiskFileSystemProvider#mkdir). The main thread only
 *  creates these directories for us when the host uses virtual web storage;
 *  with `file://` init data we must pre-create every directory we hand over.
 *
 *  Regression: VAC activates and immediately calls
 *  `vscode.window.createOutputChannel`, which triggers
 *  `mkdir(<logsLocation>/output_logging_…)`. If `logsLocation` does not exist
 *  the rejection is unhandled and the whole extension host exits, so the VAC
 *  sidebar and chat never open.
 *--------------------------------------------------------------------------------------------*/

/**
 * Create the native directories required by the extension host. Failures are
 * reported through `onError` instead of aborting host startup: an extension
 * that never creates an output channel can still work with a missing log dir.
 */
export async function ensureScCodeExtHostDirectories(
	directories: readonly string[],
	mkdir: (path: string) => Promise<unknown>,
	onError: (directory: string, error: unknown) => void
): Promise<void> {
	for (const directory of directories) {
		try {
			await mkdir(directory);
		} catch (error) {
			onError(directory, error);
		}
	}
}
