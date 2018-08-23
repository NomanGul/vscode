/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import { IRemoteExtensionsService, IRemoteHostConnection } from 'vs/workbench/services/extensions/node/remoteExtensionsService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { Client } from 'vs/base/parts/ipc/node/ipc.net';
import { getDelayedChannel, IChannel } from 'vs/base/parts/ipc/node/ipc';
import { Disposable } from 'vs/base/common/lifecycle';
import { connectToRemoteExtensionHostManagement } from 'vs/platform/remote/node/remoteFileSystemIpc';
import { RemoteAuthorityRegistry } from 'vs/workbench/services/extensions/electron-browser/remoteAuthorityRegistry';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IWindowConfiguration } from 'vs/platform/windows/common/windows';

const AUTHORITY_STORAGE_KEY = 'remoteHostAuthority';

export class RemoteExtensionsService implements IRemoteExtensionsService {

	_serviceBrand: any;

	private readonly _channels: Map<string, TPromise<Client>>;
	private readonly _authority: string;

	constructor(
		window: IWindowConfiguration,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService
	) {
		this._channels = new Map<string, TPromise<Client>>();

		this._authority = this._getAuthority(window, contextService) || storageService.get(AUTHORITY_STORAGE_KEY, StorageScope.WORKSPACE, '');
		storageService.store(AUTHORITY_STORAGE_KEY, this._authority, StorageScope.WORKSPACE);
	}

	getRemoteConnection(): IRemoteHostConnection {
		if (this._authority) {
			return new RemoteHostConnection(this._authority, this);
		}
		return null;
	}

	getChannel<T extends IChannel>(remoteAuthority: string, channelName: string): T {
		if (!this._channels.has(remoteAuthority)) {
			this._channels.set(remoteAuthority, this._getClient(remoteAuthority));
		}
		return <T>getDelayedChannel(this._channels.get(remoteAuthority).then(c => c.getChannel(channelName)));
	}

	registerChannel<T extends IChannel>(remoteAuthority: string, channelName: string, channel: IChannel): void {
		if (!this._channels.has(remoteAuthority)) {
			this._channels.set(remoteAuthority, this._getClient(remoteAuthority));
		}
		this._channels.get(remoteAuthority).then(client => client.registerChannel(channelName, channel));
	}

	private _getClient(remoteAuthority: string): TPromise<Client> {
		return RemoteAuthorityRegistry.resolveAuthority(remoteAuthority).then((resolvedAuthority) => {
			// TODO@vs-remote: dispose this connection when all remote folders pointing to the same address have been removed.
			return connectToRemoteExtensionHostManagement(resolvedAuthority.host, resolvedAuthority.port, `renderer`);
		});
	}

	private _getAuthority(window: IWindowConfiguration, contextService: IWorkspaceContextService) {
		const folders = contextService.getWorkspace().folders;
		if (folders.length) {
			const folderUri = folders[0].uri;
			return folderUri.scheme === 'vscode-remote' ? folderUri.authority : null;
		}
		for (const files of [window.filesToOpen, window.filesToCreate, window.filesToDiff]) {
			if (Array.isArray(files) && files.length) {
				const fileUri = files[0].fileUri;
				return fileUri.scheme === 'vscode-remote' ? fileUri.authority : null;
			}
		}
		return null;
	}
}

class RemoteHostConnection extends Disposable implements IRemoteHostConnection {
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

	registerChannel<T extends IChannel>(channelName: string, channel: T): void {
		this._parent.registerChannel(this.remoteAuthority, channelName, channel);
	}
}
