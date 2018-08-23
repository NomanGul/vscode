/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IWindowService } from 'vs/platform/windows/common/windows';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IMessagePassingProtocol } from 'vs/base/parts/ipc/node/ipc';
import { connectToRemoteExtensionHostServer } from 'vs/platform/remote/node/remoteFileSystemIpc';
import * as net from 'net';
import { Event, Emitter } from 'vs/base/common/event';
import { IInitData, IWorkspaceData, IConfigurationInitData } from 'vs/workbench/api/node/extHost.protocol';
import { IWorkspaceConfigurationService } from 'vs/workbench/services/configuration/common/configuration';
import { getScopes } from 'vs/platform/configuration/common/configurationRegistry';
import { ILogService } from 'vs/platform/log/common/log';
import { IRemoteExtensionsEnvironmentData } from 'vs/workbench/services/extensions/node/remoteExtensionsService';
import { IExtensionHostStarter } from 'vs/workbench/services/extensions/electron-browser/extensionHost';
import { RemoteAuthorityRegistry } from 'vs/workbench/services/extensions/electron-browser/remoteAuthorityRegistry';
import { MessageType, isMessageOfType, createMessageOfType } from 'vs/workbench/common/extensionHostProtocol';
import { IBroadcastService } from 'vs/platform/broadcast/electron-browser/broadcastService';
import { EXTENSION_ATTACH_BROADCAST_CHANNEL } from 'vs/platform/extensions/common/extensionHost';

export interface IInitDataProvider {
	readonly remoteAuthority: string;
	getInitData(): TPromise<IRemoteExtensionsEnvironmentData>;
}

export class RemoteExtensionHostClient implements IExtensionHostStarter {

	private _onCrashed: Emitter<[number, string]> = new Emitter<[number, string]>();
	public readonly onCrashed: Event<[number, string]> = this._onCrashed.event;

	private _connection: net.Socket;
	private _protocol: IMessagePassingProtocol;

	constructor(
		private readonly _initDataProvider: IInitDataProvider,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IWindowService private readonly _windowService: IWindowService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@IWorkspaceConfigurationService private readonly _configurationService: IWorkspaceConfigurationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
		@IBroadcastService private readonly _broadcastService: IBroadcastService
	) {
		this._connection = null;
		this._protocol = null;
		// TODO@vs-remote: listen to lifecycle service
	}

	public start(): TPromise<IMessagePassingProtocol> {
		return RemoteAuthorityRegistry.resolveAuthority(this._initDataProvider.remoteAuthority).then((resolvedAuthority) => {
			return connectToRemoteExtensionHostServer(resolvedAuthority.host, resolvedAuthority.port, this._environmentService.debugExtensionHost).then(result => {
				const { protocol, debugPort } = result;
				const isExtensionDevelopmentDebug = typeof debugPort === 'number';
				if (this._environmentService.isExtensionDevelopment) {
					this._broadcastService.broadcast({
						channel: EXTENSION_ATTACH_BROADCAST_CHANNEL,
						payload: {
							debugId: this._environmentService.debugExtensionHost.debugId,
							remoteAuthority: this._initDataProvider.remoteAuthority,
							port: debugPort
						}
					});
				}

				// 1) wait for the incoming `ready` event and send the initialization data.
				// 2) wait for the incoming `initialized` event.
				return new TPromise<IMessagePassingProtocol>((resolve, reject) => {

					let handle = setTimeout(() => {
						reject('timeout');
					}, 60 * 1000);

					const disposable = protocol.onMessage(msg => {

						if (isMessageOfType(msg, MessageType.Ready)) {
							// 1) Extension Host is ready to receive messages, initialize it
							this._createExtHostInitData(isExtensionDevelopmentDebug).then(data => protocol.send(Buffer.from(JSON.stringify(data))));
							return;
						}

						if (isMessageOfType(msg, MessageType.Initialized)) {
							// 2) Extension Host is initialized

							clearTimeout(handle);

							// stop listening for messages here
							disposable.dispose();

							// release this promise
							resolve(protocol);
							return;
						}

						console.error(`received unexpected message during handshake phase from the extension host: `, msg);
					});

				});
			});
		});
	}

	private _createExtHostInitData(isExtensionDevelopmentDebug: boolean): TPromise<IInitData> {
		return TPromise.join([this._telemetryService.getTelemetryInfo(), this._initDataProvider.getInitData()]).then(([telemetryInfo, remoteExtensionHostData]) => {
			const configurationData: IConfigurationInitData = { ...this._configurationService.getConfigurationData(), configurationScopes: {} };
			const r: IInitData = {
				parentPid: remoteExtensionHostData.agentPid,
				environment: {
					isExtensionDevelopmentDebug,
					appRoot: remoteExtensionHostData.agentAppRoot,
					appSettingsHome: remoteExtensionHostData.agentAppSettingsHome,
					extensionDevelopmentPath: this._environmentService.extensionDevelopmentPath,
					extensionTestsPath: this._environmentService.extensionTestsPath,
				},
				workspace: this._contextService.getWorkbenchState() === WorkbenchState.EMPTY ? null : <IWorkspaceData>this._contextService.getWorkspace(),
				extensions: remoteExtensionHostData.extensions,
				// Send configurations scopes only in development mode.
				configuration: !this._environmentService.isBuilt || this._environmentService.isExtensionDevelopment ? { ...configurationData, configurationScopes: getScopes() } : configurationData,
				telemetryInfo,
				windowId: this._windowService.getCurrentWindowId(),
				logLevel: this._logService.getLevel(),
				logsPath: remoteExtensionHostData.agentLogsPath,
				remoteAuthority: this._initDataProvider.remoteAuthority,
			};
			return r;
		});
	}

	getInspectPort(): number {
		return undefined;
	}

	dispose(): void {
		if (!this._protocol) {
			return;
		}

		// Send the extension host a request to terminate itself
		// (graceful termination)
		this._protocol.send(createMessageOfType(MessageType.Terminate));

		// Give the extension host 60s, after which we will
		// try to kill the process and release any resources
		setTimeout(() => {
			if (this._connection) {
				this._connection.end();
				this._connection = null;
			}
		}, 60 * 1000);

		this._protocol = null;
	}
}
