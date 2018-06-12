/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import { ParsedArgs, IEnvironmentService } from 'vs/platform/environment/common/environment';
import { TPromise } from 'vs/base/common/winjs.base';
import { Server } from 'vs/base/parts/ipc/node/ipc.net';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
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
import { DialogChannelClient } from 'vs/platform/dialogs/common/dialogIpc';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ExtensionManagementChannel } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { RemoteExtensionsEnvironment } from 'vs/workbench/services/extensions/node/remoteExtensionsServiceImpl';
import { RemoteExtensionsEnvironmentChannel } from 'vs/workbench/services/extensions/node/remoteExtensionsIpc';

export interface IExtensionsManagementProcessInitData {
	args: ParsedArgs;
}

export class RemoteExtensionManagementServer {

	constructor(private environmentService: IEnvironmentService) { }

	start(port: number): void {
		this._createServer(port)
			.then(
				server => this._createServices(server),
				error => {
					console.error('Extensions Management server received error');
					if (error) {
						console.error(error);
					}
				});
	}

	private _createServer(port: number): TPromise<Server> {
		return new TPromise((c, e) => {
			const server = net.createServer();
			server.on('error', e);
			server.listen(port, () => {
				console.log(`Extensions Management Server listening on ${port}`);
				server.removeListener('error', e);
				c(new Server(server));
			});
		});
	}

	private _createServices(server: Server): void {
		const services = new ServiceCollection();

		services.set(IEnvironmentService, this.environmentService);
		services.set(ILogService, new NullLogService());
		services.set(IConfigurationService, new SyncDescriptor(ConfigurationService));
		services.set(IRequestService, new SyncDescriptor(RequestService));
		services.set(ITelemetryService, NullTelemetryService);
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));

		const dialogChannel = server.getChannel('dialog', { route: () => { throw new Error('not supported'); } });
		services.set(IDialogService, new DialogChannelClient(dialogChannel));

		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));

		const instantiationService = new InstantiationService(services);

		instantiationService.invokeFunction(accessor => {
			const remoteExtensionsEnvironemntChannel = new RemoteExtensionsEnvironmentChannel(new RemoteExtensionsEnvironment(this.environmentService));
			server.registerChannel('remoteextensionsenvironment', remoteExtensionsEnvironemntChannel);

			const extensionManagementService = accessor.get(IExtensionManagementService);
			const channel = new ExtensionManagementChannel(extensionManagementService);
			server.registerChannel('extensions', channel);

			// clean up deprecated extensions
			(extensionManagementService as ExtensionManagementService).removeDeprecatedExtensions();
		});
	}
}