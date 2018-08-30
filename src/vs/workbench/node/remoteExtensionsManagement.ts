/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedArgs, IEnvironmentService } from 'vs/platform/environment/common/environment';
import { Protocol } from 'vs/base/parts/ipc/node/ipc.net';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILogService, LogLevel } from 'vs/platform/log/common/log';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ConfigurationService } from 'vs/platform/configuration/node/configurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IRequestService } from 'vs/platform/request/node/request';
import { RequestService } from 'vs/platform/request/node/requestService';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IExtensionGalleryService, IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/node/extensionGalleryService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { DialogChannelClient } from 'vs/platform/dialogs/node/dialogIpc';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ExtensionManagementChannel } from 'vs/platform/extensionManagement/node/extensionManagementIpc';
import { RemoteExtensionsEnvironment } from 'vs/workbench/services/extensions/node/remoteExtensionsEnvironment';
import { RemoteExtensionsEnvironmentChannel } from 'vs/workbench/services/extensions/node/remoteExtensionsIpc';
import { REMOTE_EXTENSIONS_FILE_SYSTEM_CHANNEL_NAME, RemoteExtensionsFileSystemImpl, RemoteExtensionsFileSystemChannel } from 'vs/platform/remote/node/remoteFileSystemIpc';
import { TPromise } from 'vs/base/common/winjs.base';
import { Emitter } from 'vs/base/common/event';
import { IPCServer, ClientConnectionEvent } from 'vs/base/parts/ipc/node/ipc';
import { IDownloadService } from 'vs/platform/download/common/download';
import { DownloadServiceChannelClient } from 'vs/platform/download/node/downloadIpc';
import { IURITransformer } from 'vs/base/common/uriIpc';
import URI, { UriComponents } from 'vs/base/common/uri';
import { FollowerLogService, LogLevelSetterChannelClient } from 'vs/platform/log/node/logIpc';
import { createSpdLogService } from 'vs/platform/log/node/spdlogService';

export interface IExtensionsManagementProcessInitData {
	args: ParsedArgs;
}

class SocketServer extends IPCServer {

	private _onDidConnectEmitter: Emitter<ClientConnectionEvent>;

	constructor() {
		const emitter = new Emitter<ClientConnectionEvent>();
		super(emitter.event);
		this._onDidConnectEmitter = emitter;
	}

	public acceptConnection(protocol: Protocol): void {
		this._onDidConnectEmitter.fire({
			protocol: protocol,
			onDidClientDisconnect: protocol.onClose
		});
	}
}

function createRemoteUriTransformer(): IURITransformer {
	return <IURITransformer>{
		transformIncoming: (uriComponents: UriComponents): UriComponents => {
			return uriComponents;
		},
		transformOutgoing: (uri: URI): URI => {
			if (uri.scheme === 'vscode-local') {
				const r = URI.file(uri.path);
				return r;
			}
			return uri;
		}
	};
}

export class RemoteExtensionManagementServer {

	private readonly _socketServer: SocketServer;

	constructor(
		private readonly _environmentService: IEnvironmentService
	) {
		this._socketServer = new SocketServer();
		this._createServices(this._socketServer);
	}

	public acceptConnection(protocol: Protocol): void {
		this._socketServer.acceptConnection(protocol);
	}

	private _createServices(server: SocketServer): void {
		const services = new ServiceCollection();

		const route = () => TPromise.as('renderer');
		const logLevelClient = new LogLevelSetterChannelClient(server.getChannel('loglevel', { routeCall: route, routeEvent: route }));
		const logService = new FollowerLogService(logLevelClient, createSpdLogService('sharedprocess', LogLevel.Info, this._environmentService.logsPath));

		services.set(IEnvironmentService, this._environmentService);
		services.set(ILogService, logService);
		services.set(IConfigurationService, new SyncDescriptor(ConfigurationService));
		services.set(IRequestService, new SyncDescriptor(RequestService));
		services.set(ITelemetryService, NullTelemetryService);
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));

		const dialogChannel = server.getChannel('dialog', { routeCall: route, routeEvent: route });
		services.set(IDialogService, new DialogChannelClient(dialogChannel));

		const downloadChannel = server.getChannel('download', { routeCall: route, routeEvent: route });
		services.set(IDownloadService, new DownloadServiceChannelClient(downloadChannel, createRemoteUriTransformer()));

		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));

		const instantiationService = new InstantiationService(services);

		instantiationService.invokeFunction(accessor => {
			const remoteExtensionsEnvironmentChannel = new RemoteExtensionsEnvironmentChannel(new RemoteExtensionsEnvironment(this._environmentService));
			server.registerChannel('remoteextensionsenvironment', remoteExtensionsEnvironmentChannel);

			const remoteExtensionsFileSystemChannel = new RemoteExtensionsFileSystemChannel(new RemoteExtensionsFileSystemImpl());
			server.registerChannel(REMOTE_EXTENSIONS_FILE_SYSTEM_CHANNEL_NAME, remoteExtensionsFileSystemChannel);

			const extensionManagementService = accessor.get(IExtensionManagementService);
			const channel = new ExtensionManagementChannel(extensionManagementService);
			server.registerChannel('extensions', channel);

			// clean up deprecated extensions
			(extensionManagementService as ExtensionManagementService).removeDeprecatedExtensions();
		});
	}
}