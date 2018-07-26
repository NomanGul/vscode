/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import { IRemoteExtensionsService, IRemoteWorkspaceFolderConnection } from 'vs/workbench/services/extensions/common/remoteExtensionsService';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { Client } from 'vs/base/parts/ipc/node/ipc.net';
import { getDelayedChannel, IChannel } from 'vs/base/parts/ipc/common/ipc';
import { Disposable } from 'vs/base/common/lifecycle';
import { connectToRemoteExtensionHostManagement } from 'vs/platform/remote/node/remoteFileSystemIpc';
import { RemoteAuthorityRegistry } from 'vs/workbench/services/extensions/electron-browser/remoteAuthorityRegistry';

export class RemoteExtensionsService implements IRemoteExtensionsService {

	_serviceBrand: any;

	private readonly _channels: Map<string, TPromise<Client>>;

	constructor(
		private readonly _windowId: number // TODO@vs-remote: remove windowId
	) {
		this._channels = new Map<string, TPromise<Client>>();
	}

	getRemoteWorkspaceFolderConnection(workspaceFolder: IWorkspaceFolder): IRemoteWorkspaceFolderConnection {
		const authority = this._getAuthority(workspaceFolder);
		return (authority ? new RemoteWorkspaceFolder(authority, this) : null);
	}

	getRemoteWorkspaceFolderConnections(workspaceFolders: IWorkspaceFolder[]): IRemoteWorkspaceFolderConnection[] {
		let resultMap = new Map<string, IRemoteWorkspaceFolderConnection>();
		for (let i = 0; i < workspaceFolders.length; i++) {
			const workspaceFolder = workspaceFolders[i];
			const workspaceFolderConnection = this.getRemoteWorkspaceFolderConnection(workspaceFolder);
			if (!workspaceFolderConnection) {
				continue;
			}
			resultMap.set(workspaceFolderConnection.remoteAuthority, workspaceFolderConnection);
		}

		let result: IRemoteWorkspaceFolderConnection[] = [];
		resultMap.forEach((el) => result.push(el));
		return result;
	}

	getChannel<T extends IChannel>(remoteAuthority: string, channelName: string): T {
		if (!this._channels.has(remoteAuthority)) {
			this._channels.set(remoteAuthority, this._getClient(remoteAuthority));
		}
		return <T>getDelayedChannel(this._channels.get(remoteAuthority).then(c => c.getChannel(channelName)));
	}

	private _getClient<T extends IChannel>(remoteAuthority: string): TPromise<Client> {
		return RemoteAuthorityRegistry.resolveAuthority(remoteAuthority).then((resolvedAuthority) => {
			// TODO@vs-remote: dispose this connection when all remote folders pointing to the same address have been removed.
			return connectToRemoteExtensionHostManagement(resolvedAuthority.host, resolvedAuthority.port, `window:${this._windowId}`);
		});
	}

	private _getAuthority(folder: IWorkspaceFolder): string {
		if (folder.uri.scheme === 'vscode-remote') {
			return folder.uri.authority;
		}
		return null;
	}
}

class RemoteWorkspaceFolder extends Disposable implements IRemoteWorkspaceFolderConnection {
	readonly remoteAuthority: string;
	private readonly _parent: RemoteExtensionsService;

	constructor(remoteAuthority: string, parent: RemoteExtensionsService) {
		super();
		this.remoteAuthority = remoteAuthority;
		this._parent = parent;
	}

	getChannel<T extends IChannel>(channelName: string): T {
		return this._parent.getChannel(this.remoteAuthority, channelName);
	}
}
