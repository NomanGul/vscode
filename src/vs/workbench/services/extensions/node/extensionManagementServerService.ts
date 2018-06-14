/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRemoteExtensionsService } from 'vs/workbench/services/extensions/common/remoteExtensionsService';
import { ExtensionManagementChannelClient, IExtensionManagementChannel } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IExtensionManagementService, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/platform/extensionManagement/common/extensionManagement';
import URI, { UriComponents } from 'vs/base/common/uri';
import { Disposable } from 'vs/base/common/lifecycle';
import { IURITransformer } from 'vs/base/parts/ipc/common/ipc';
import { Schemas } from 'vs/base/common/network';

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
		this._localExtensionManagemetServer = { extensionManagementService: localExtensionManagementService, location: URI.file('') };
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => this.updateServers()));
		this.updateServers();
	}

	get extensionManagementServers(): IExtensionManagementServer[] {
		return this._extensionManagementServers;
	}

	getExtensionManagementServer(location: URI): IExtensionManagementServer {
		return this._extensionManagementServers.filter(server => location.authority === server.location.authority)[0];
	}

	private updateServers(): void {
		this._extensionManagementServers = [this._localExtensionManagemetServer];
		for (const remoteWorkspaceFolderConnection of this.remoteExtensionsService.getRemoteWorkspaceFolderConnections(this.workspaceService.getWorkspace().folders)) {
			const location = URI.from({ scheme: 'vscode-remote', authority: `${remoteWorkspaceFolderConnection.connectionInformation.host}:${remoteWorkspaceFolderConnection.connectionInformation.extensionHostPort}` });
			const extensionManagementService = new ExtensionManagementChannelClient(remoteWorkspaceFolderConnection.getChannel<IExtensionManagementChannel>('extensions'), createRemoteUriTransformer(location.authority));
			this._extensionManagementServers.push({ location, extensionManagementService });
		}
	}
}