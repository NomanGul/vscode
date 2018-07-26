/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import { IRemoteExtensionsService, IRemoteWorkspaceFolderConnection, IRemoteConnectionInformation } from 'vs/workbench/services/extensions/common/remoteExtensionsService';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { Client } from 'vs/base/parts/ipc/node/ipc.net';
import { getDelayedChannel, IChannel } from 'vs/base/parts/ipc/common/ipc';
import { Disposable } from 'vs/base/common/lifecycle';
import { connectToRemoteExtensionHostManagement } from 'vs/platform/remote/node/remoteFileSystemIpc';
// import { RemoteAuthorityRegistry } from 'vs/workbench/services/extensions/electron-browser/remoteAuthorityRegistry';

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
			// // TODO@vs-remote: do not split authority
			// const authority = `${connectionInformation.host}:${connectionInformation.port}`;
			// RemoteAuthorityRegistry.resolveAuthority(authority).then((resolvedAuthority) => {
			// 	console.log(`received a resolved authority`);
			// });
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
