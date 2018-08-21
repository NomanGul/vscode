/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRemoteExtensionsService } from 'vs/workbench/services/extensions/node/remoteExtensionsService';
import { ExtensionManagementChannelClient, IExtensionManagementChannel } from 'vs/platform/extensionManagement/node/extensionManagementIpc';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IExtensionManagementService, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/platform/extensionManagement/common/extensionManagement';
import URI, { UriComponents } from 'vs/base/common/uri';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { IURITransformer } from 'vs/base/common/uriIpc';

const localExtensionManagementServerAuthority: string = 'vscode-local';

function createRemoteUriTransformer(authority: string): IURITransformer {
	return <IURITransformer>{
		transformIncoming: (uriComponents: UriComponents): UriComponents => {
			// TODO@vs-remote
			if (uriComponents.scheme === Schemas.file) {
				const r = URI.from({ ...uriComponents, authority, scheme: 'vscode-remote', path: uriComponents.path.replace(/\\/g, '/') });
				return <UriComponents>r.toJSON();
			}
			return uriComponents;
		},
		transformOutgoing: (uri: URI): URI => {
			// TODO@vs-remote
			if (uri.scheme === 'vscode-remote') {
				const r = URI.file(uri.path);
				return r;
			}
			if (uri.scheme === Schemas.file) {
				const r = URI.from({ scheme: 'vscode-local', path: uri.path });
				return r;
			}
			return uri;
		}
	};
}

export class ExtensionManagementServerService extends Disposable implements IExtensionManagementServerService {

	_serviceBrand: any;

	private _localExtensionManagemetServer: IExtensionManagementServer;
	private _extensionManagementServers: IExtensionManagementServer[];

	constructor(
		localExtensionManagementService: IExtensionManagementService,
		@IWorkspaceContextService private workspaceService: IWorkspaceContextService,
		@IRemoteExtensionsService private remoteExtensionsService: IRemoteExtensionsService
	) {
		super();
		this._localExtensionManagemetServer = { extensionManagementService: localExtensionManagementService, authority: localExtensionManagementServerAuthority, label: 'local' };
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => this.updateServers()));
		this.updateServers();
	}

	get extensionManagementServers(): IExtensionManagementServer[] {
		return this._extensionManagementServers;
	}

	getExtensionManagementServer(location: URI): IExtensionManagementServer {
		if (location.scheme === Schemas.file) {
			return this._localExtensionManagemetServer;
		}
		return this._extensionManagementServers.filter(server => location.authority === server.authority)[0];
	}

	private updateServers(): void {
		this._extensionManagementServers = [this._localExtensionManagemetServer];
		for (const remoteWorkspaceFolderConnection of this.remoteExtensionsService.getRemoteWorkspaceFolderConnections(this.workspaceService.getWorkspace().folders)) {
			const extensionManagementService = new ExtensionManagementChannelClient(remoteWorkspaceFolderConnection.getChannel<IExtensionManagementChannel>('extensions'), createRemoteUriTransformer(remoteWorkspaceFolderConnection.remoteAuthority));
			this._extensionManagementServers.push({ authority: remoteWorkspaceFolderConnection.remoteAuthority, extensionManagementService, label: remoteWorkspaceFolderConnection.remoteAuthority });
		}
	}

	getLocalExtensionManagementServer(): IExtensionManagementServer {
		return this._localExtensionManagemetServer;
	}
}

export class SingleServerExtensionManagementServerService implements IExtensionManagementServerService {

	_serviceBrand: any;

	readonly extensionManagementServers: IExtensionManagementServer[];

	constructor(
		extensionManagementServer: IExtensionManagementServer
	) {
		this.extensionManagementServers = [extensionManagementServer];
	}

	getExtensionManagementServer(location: URI): IExtensionManagementServer {
		const authority = location.scheme === Schemas.file ? localExtensionManagementServerAuthority : location.authority;
		return this.extensionManagementServers.filter(server => authority === server.authority)[0];
	}

	getLocalExtensionManagementServer(): IExtensionManagementServer {
		return this.extensionManagementServers[0];
	}
}