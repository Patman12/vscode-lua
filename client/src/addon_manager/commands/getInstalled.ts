import * as vscode from "vscode";
import { createChildLogger } from "../../services/logging.service";
import { ADDONS_DIRECTORY } from "../config";

const MAX_TRAVERSAL_DEPTH = 10;

const localLogger = createChildLogger("Get Installed");

/** Traverses directory, calculating size of child files
 * @param path The path to start at
 */
async function traverse<T extends number>(
    path: vscode.Uri,
    depth: number
): Promise<number | false>;
async function traverse(path: vscode.Uri): Promise<number>;
async function traverse(path: vscode.Uri, depth = 0) {
    let size = 0;

    return new Promise<number | false>(async (resolve, reject) => {
        if (depth >= MAX_TRAVERSAL_DEPTH) {
            localLogger.warn(
                `Max traversal depth (${MAX_TRAVERSAL_DEPTH}) reached while reading addons directory. Stopped at ${path.path}`
            );
            resolve(false);
        }

        const files = await vscode.workspace.fs.readDirectory(path);

        for (const file of files) {
            const name = file[0];
            const type = file[1];
            const uri = vscode.Uri.joinPath(path, name);

            switch (type) {
                case vscode.FileType.File:
                    localLogger.verbose(`Found file ${uri.path}`);
                    const stats = await vscode.workspace.fs.stat(uri);
                    size += stats.size;
                    break;
                case vscode.FileType.Directory:
                    localLogger.verbose(`Found directory ${uri.path}`);
                    const sum = await traverse(uri, depth + 1);
                    if (!sum) {
                        break;
                    }
                    size += sum;
                    break;
                default:
                    localLogger.warn(
                        `Found unsupported file type @ ${uri.path}`
                    );
                    break;
            }
        }
        resolve(size);
    });
}

type Addon = {
    name: string;
    description: string;
    size: number;
    hash?: string;
};

export default async (
    context: vscode.ExtensionContext,
    webview: vscode.Webview
) => {
    const extensionStorageURI = context.globalStorageUri;
    const addonsDirectoryURI = vscode.Uri.joinPath(
        extensionStorageURI,
        ADDONS_DIRECTORY
    );

    const addons: Addon[] = [];
    let totalSize = 0;

    try {
        const entries = await vscode.workspace.fs.readDirectory(
            addonsDirectoryURI
        );

        for (const entry of entries) {
            const name = entry[0];
            const addonUri = vscode.Uri.joinPath(addonsDirectoryURI, name);
            const configFileURI = vscode.Uri.joinPath(addonUri, "config.json");
            const versionFileURI = vscode.Uri.joinPath(addonUri, ".version");

            const addon: Addon = {
                name,
                description: "Unknown",
                size: 0,
            };

            // Get config file
            // Gets description of addon
            try {
                const content = await vscode.workspace.fs.readFile(
                    configFileURI
                );
                const json = JSON.parse(content.toString());
                addon.description = json.description;
            } catch (e) {
                localLogger.error(
                    `Failed to get installed addon (${name}) description! (${e})`
                );
            }

            // Get version info
            try {
                const content = await vscode.workspace.fs.readFile(
                    versionFileURI
                );
                addon.hash = content.toString();
            } catch (e) {
                localLogger.error(
                    `Failed to get version info for ${name} (${e})`
                );
            }

            const size = await traverse(addonUri);
            addon.size = size;
            totalSize += size;
            addons.push(addon);
        }

        webview.postMessage({
            command: "localAddons",
            addons,
            totalSize,
        });
    } catch (e) {
        localLogger.error(`Failed to read addons install directory (${e})`);
    }
};
