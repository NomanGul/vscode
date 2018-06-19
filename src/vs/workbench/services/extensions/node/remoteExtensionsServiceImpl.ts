/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import pkg from 'vs/platform/node/package';
import * as path from 'path';
import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { IRemoteExtensionsEnvironmentData, IRemoteExtensionsService, IRemoteExtensionsEnvironment, IRemoteWorkspaceFolderConnection, IRemoteConnectionInformation } from 'vs/workbench/services/extensions/common/remoteExtensionsService';
import { ExtensionScanner, ILog, ExtensionScannerInput } from 'vs/workbench/services/extensions/node/extensionPoints';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { Client } from 'vs/base/parts/ipc/node/ipc.net';
import { getDelayedChannel, IChannel } from 'vs/base/parts/ipc/common/ipc';
import { Disposable } from 'vs/base/common/lifecycle';
import { createRemoteURITransformer } from 'vs/workbench/node/remoteUriTransformer';
import { transformOutgoingURIs } from 'vs/workbench/services/extensions/node/rpcProtocol';
import { connectToRemoteExtensionHostManagement } from 'vs/platform/remote/node/remoteFileSystemIpc';

export class RemoteExtensionsService implements IRemoteExtensionsService {

	_serviceBrand: any;

	private readonly _channels: Map<string, TPromise<Client>>;

	constructor(
		private readonly _windowId: number // TODO@vs-remote: remove windowId
	) {
		this._channels = new Map<string, TPromise<Client>>();
	}

	getRemoteWorkspaceFolderConnection(workspaceFolder: IWorkspaceFolder): IRemoteWorkspaceFolderConnection {
		const connectionInformation = this._parseRemoteConnectionInformation(workspaceFolder);
		return (connectionInformation ? new RemoteWorkspaceFolder(connectionInformation, this) : null);
	}

	getRemoteWorkspaceFolderConnections(workspaceFolders: IWorkspaceFolder[]): IRemoteWorkspaceFolderConnection[] {
		let resultMap = new Map<string, IRemoteWorkspaceFolderConnection>();
		for (let i = 0; i < workspaceFolders.length; i++) {
			const workspaceFolder = workspaceFolders[i];
			const workspaceFolderConnection = this.getRemoteWorkspaceFolderConnection(workspaceFolder);
			if (!workspaceFolderConnection) {
				continue;
			}
			resultMap.set(workspaceFolderConnection.connectionInformation.getHashCode(), workspaceFolderConnection);
		}

		let result: IRemoteWorkspaceFolderConnection[] = [];
		resultMap.forEach((el) => result.push(el));
		return result;
	}

	getChannel<T extends IChannel>(connectionInformation: IRemoteConnectionInformation, channelName: string): T {
		const hashCode = connectionInformation.getHashCode();
		if (!this._channels.has(hashCode)) {
			// TODO@vs-remote: dispose this connection when all remote folders pointing to the same address have been removed.
			const result = connectToRemoteExtensionHostManagement(connectionInformation.host, connectionInformation.port, `window:${this._windowId}`);
			this._channels.set(hashCode, result);
		}
		return <T>getDelayedChannel(this._channels.get(hashCode).then(c => c.getChannel(channelName)));
	}

	private _parseRemoteConnectionInformation(folder: IWorkspaceFolder): IRemoteConnectionInformation {
		if (folder.uri.scheme === 'vscode-remote') {
			let [host, strPort] = folder.uri.authority.split(':');
			let port = strPort ? parseInt(strPort, 10) : NaN;
			if (host && !isNaN(port)) {
				return {
					host: host,
					port,
					getHashCode: () => host + port
				};
			}
		}
		return null;
	}
}

class RemoteWorkspaceFolder extends Disposable implements IRemoteWorkspaceFolderConnection {
	readonly connectionInformation: IRemoteConnectionInformation;
	private readonly _parent: RemoteExtensionsService;

	constructor(connectionInformation: IRemoteConnectionInformation, parent: RemoteExtensionsService) {
		super();
		this.connectionInformation = connectionInformation;
		this._parent = parent;
	}

	getChannel<T extends IChannel>(channelName: string): T {
		return this._parent.getChannel(this.connectionInformation, channelName);
	}
}

export class RemoteExtensionsEnvironment implements IRemoteExtensionsEnvironment {

	_serviceBrand: any;

	constructor(
		private environmentService: IEnvironmentService
	) { }

	getRemoteExtensionInformation(remoteAuthority: string): TPromise<IRemoteExtensionsEnvironmentData> {
		const uriTransformer = createRemoteURITransformer(remoteAuthority);
		return this.scanExtensions()
			.then(extensions => {
				return <IRemoteExtensionsEnvironmentData>{
					agentPid: process.pid,
					agentAppRoot: this.environmentService.appRoot,
					agentAppSettingsHome: this.environmentService.appSettingsHome,
					agentLogsPath: this.environmentService.logsPath,
					agentExtensionsPath: this.environmentService.extensionsPath,
					extensions: transformOutgoingURIs(extensions, uriTransformer)
				};
			});
	}

	private async scanExtensions(): TPromise<IExtensionDescription[]> {
		return TPromise.join([
			this.scanBuiltinExtensions(),
			this.scanInstalledExtensions()
		]).then(([builtinExtensions, installedExtensions]) => {
			let result: { [extensionId: string]: IExtensionDescription; } = {};

			builtinExtensions.forEach((builtinExtension) => {
				if (!builtinExtension) {
					return;
				}
				result[builtinExtension.id] = builtinExtension;
			});

			installedExtensions.forEach((installedExtension) => {
				if (!installedExtension) {
					return;
				}
				if (result.hasOwnProperty(installedExtension.id)) {
					console.warn(nls.localize('overwritingExtension', "Overwriting extension {0} with {1}.", result[installedExtension.id].extensionLocation.fsPath, installedExtension.extensionLocation.fsPath));
				}
				result[installedExtension.id] = installedExtension;
			});

			return Object.keys(result).map((extId) => result[extId]);
		});
	}

	private scanBuiltinExtensions(): TPromise<IExtensionDescription[]> {
		const builtinExtensions: string[] = this.environmentService.args['builtin-extensions'];
		return TPromise.join(
			builtinExtensions.map((extensionPath) => {
				const absoluteExtensionPath = path.join(this.environmentService.args['builtin-extensions-dir'], extensionPath);
				return ExtensionScanner.scanExtension(
					pkg.version,
					consoleLogger,
					absoluteExtensionPath,
					true, // isBuiltin
					true, // isUnderDevelopment
					{ devMode: true, locale: 'en', pseudo: false, translations: {} }// TODO@vs-remote
				).then(extensionDescription => {
					if (!extensionDescription) {
						console.log(`Unable to resolve extension at ${absoluteExtensionPath}`);
					}
					return extensionDescription;
				});
			})
		);
	}

	private scanInstalledExtensions(): TPromise<IExtensionDescription[]> {
		const input = new ExtensionScannerInput(
			pkg.version,
			null,
			'en', // TODO@vs-remote
			true,
			this.environmentService.extensionsPath,
			false, // isBuiltin
			true, // isUnderDevelopment
			{}
		);

		return ExtensionScanner.scanExtensions(input, consoleLogger);
	}
}

const consoleLogger = new class implements ILog {
	public error(source: string, message: string): void {
		console.error(source, message);
	}
	public warn(source: string, message: string): void {
		console.warn(source, message);
	}
	public info(source: string, message: string): void {
		console.info(source, message);
	}
};