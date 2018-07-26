/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

export const IRemoteExtensionsService = createDecorator<IRemoteExtensionsService>('remoteExtensionsService');

// export interface IRemoteConnectionInformation {
// 	host: string;
// 	port: number;

// 	getHashCode(): string;
// }

export interface IRemoteExtensionsEnvironmentData {
	agentPid: number;
	agentAppRoot: string;
	agentAppSettingsHome: string;
	agentLogsPath: string;
	agentExtensionsPath: string;
	extensions: IExtensionDescription[];
}

export interface IRemoteExtensionsEnvironment {
	getRemoteExtensionInformation(remoteAuthority: string): TPromise<IRemoteExtensionsEnvironmentData>;
}

export interface IRemoteExtensionsService {
	_serviceBrand: any;

	getRemoteWorkspaceFolderConnection(workspaceFolder: IWorkspaceFolder): IRemoteWorkspaceFolderConnection;
	getRemoteWorkspaceFolderConnections(workspaceFolders: IWorkspaceFolder[]): IRemoteWorkspaceFolderConnection[];

}

export interface IRemoteWorkspaceFolderConnection {
	// readonly connectionInformation: IRemoteConnectionInformation;
	readonly remoteAuthority: string;
	getChannel<T extends IChannel>(channelName: string): T;
}
