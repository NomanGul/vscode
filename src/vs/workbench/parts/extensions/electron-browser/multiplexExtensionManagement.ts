/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import { Event, EventMultiplexer } from 'vs/base/common/event';
import { IExtensionManagementService, ILocalExtension, IGalleryExtension, LocalExtensionType, InstallExtensionEvent, DidInstallExtensionEvent, IExtensionIdentifier, DidUninstallExtensionEvent, IReportedExtension, IGalleryMetadata } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { flatten } from 'vs/base/common/arrays';
import URI from 'vs/base/common/uri';

export interface IExtensionManagementServer {
	extensionManagementService: IExtensionManagementService;
	location: URI;
}

export class ExtensionManagementService implements IExtensionManagementService {

	_serviceBrand: any;

	onInstallExtension: Event<InstallExtensionEvent>;
	onDidInstallExtension: Event<DidInstallExtensionEvent>;
	onUninstallExtension: Event<IExtensionIdentifier>;
	onDidUninstallExtension: Event<DidUninstallExtensionEvent>;

	constructor(
		private servers: IExtensionManagementServer[],
		@IExtensionService private extensionService: IExtensionService
	) {
		this.onInstallExtension = this.servers.reduce((emitter: EventMultiplexer<InstallExtensionEvent>, server) => { emitter.add(server.extensionManagementService.onInstallExtension); return emitter; }, new EventMultiplexer<InstallExtensionEvent>()).event;
		this.onDidInstallExtension = this.servers.reduce((emitter: EventMultiplexer<DidInstallExtensionEvent>, server) => { emitter.add(server.extensionManagementService.onDidInstallExtension); return emitter; }, new EventMultiplexer<DidInstallExtensionEvent>()).event;
		this.onUninstallExtension = this.servers.reduce((emitter: EventMultiplexer<IExtensionIdentifier>, server) => { emitter.add(server.extensionManagementService.onUninstallExtension); return emitter; }, new EventMultiplexer<IExtensionIdentifier>()).event;
		this.onDidUninstallExtension = this.servers.reduce((emitter: EventMultiplexer<DidUninstallExtensionEvent>, server) => { emitter.add(server.extensionManagementService.onDidUninstallExtension); return emitter; }, new EventMultiplexer<DidUninstallExtensionEvent>()).event;
	}

	getInstalled(type?: LocalExtensionType): TPromise<ILocalExtension[]> {
		return this.extensionService.getExtensions()
			.then(runningExtensions => TPromise.join(
				this.servers.map(({ extensionManagementService }) => extensionManagementService.getInstalled(type)
					.then(installed => installed.filter(i => runningExtensions.some(r => r.extensionLocation.path === i.location.path))))))
			.then(result => flatten(result));
	}

	uninstall(extension: ILocalExtension, force?: boolean): TPromise<void> {
		return this.getServer(extension).extensionManagementService.uninstall(extension, force);
	}

	reinstallFromGallery(extension: ILocalExtension): TPromise<ILocalExtension> {
		return this.getServer(extension).extensionManagementService.reinstallFromGallery(extension);
	}

	updateMetadata(extension: ILocalExtension, metadata: IGalleryMetadata): TPromise<ILocalExtension> {
		return this.getServer(extension).extensionManagementService.updateMetadata(extension, metadata);
	}

	install(zipPath: string): TPromise<ILocalExtension> {
		return this.servers[0].extensionManagementService.install(zipPath);
	}

	installFromGallery(extension: IGalleryExtension): TPromise<ILocalExtension> {
		return this.servers[0].extensionManagementService.installFromGallery(extension);
	}

	getExtensionsReport(): TPromise<IReportedExtension[]> {
		return this.servers[0].extensionManagementService.getExtensionsReport();
	}

	private getServer(extension: ILocalExtension): IExtensionManagementServer {
		return this.servers.filter(server => extension.location.path.indexOf(server.location.path) === 0)[0];
	}

}