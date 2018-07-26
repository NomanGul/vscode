/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import pkg from 'vs/platform/node/package';
import * as path from 'path';
import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { IRemoteExtensionsEnvironmentData, IRemoteExtensionsEnvironment } from 'vs/workbench/services/extensions/common/remoteExtensionsService';
import { ExtensionScanner, ILog, ExtensionScannerInput } from 'vs/workbench/services/extensions/node/extensionPoints';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { createRemoteURITransformer } from 'vs/workbench/node/remoteUriTransformer';
import { transformOutgoingURIs } from 'vs/workbench/services/extensions/node/rpcProtocol';

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

	private scanInstalledExtensions(): Promise<IExtensionDescription[]> {
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
