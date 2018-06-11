/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { List } from 'vs/base/browser/ui/list/listWidget';
import { IRemoteExtensionsService, IRemoteConnectionInformation, IRemoteWorkspaceFolderConnection } from 'vs/workbench/services/extensions/common/remoteExtensions';
import { dispose } from 'vs/base/common/lifecycle';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService, ContextKeyExpr, IContextKey, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { localize } from 'vs/nls';
import { IListEvent, IDelegate, IRenderer } from 'vs/base/browser/ui/list/list';
import { ExtensionsViewlet as BaseExtensionsViewlet } from 'vs/workbench/parts/extensions/electron-browser/extensionsViewlet';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { IEditorGroupsService } from 'vs/workbench/services/group/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IExtensionManagementService, IExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ViewLocation, IViewDescriptor, ViewsRegistry } from 'vs/workbench/common/views';
import { IViewletViewOptions, ViewsViewletPanel } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IExtensionsWorkbenchService } from 'vs/workbench/parts/extensions/common/extensions';
import { IModeService } from 'vs/editor/common/services/modeService';
import { append, $ } from 'vs/base/browser/dom';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ExtensionManagementChannelClient, IExtensionManagementChannel } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { TPromise } from 'vs/base/common/winjs.base';
import { flatten } from 'vs/base/common/arrays';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ExtensionsWorkbenchService } from 'vs/workbench/parts/extensions/node/extensionsWorkbenchService';
import { ExtensionsListView, InstalledExtensionsView, RecommendedExtensionsView, WorkspaceRecommendedExtensionsView, BuiltInExtensionsView, BuiltInThemesExtensionsView, BuiltInBasicsExtensionsView } from 'vs/workbench/parts/extensions/electron-browser/extensionsViews';

const RemoteExtensionsContext = new RawContextKey<boolean>('remoteExtensions', false);
const DonotShowInstalledExtensionsContext = new RawContextKey<boolean>('donotshowExtensions', false);

interface ILocalConnectionInformation {
	local: boolean;
}
type IExtensionManagementServer = IRemoteConnectionInformation | ILocalConnectionInformation;

export class ExtensionsViewlet extends BaseExtensionsViewlet {

	private remoteExtensionsContextKey: IContextKey<boolean>;
	private donotShowInstalledExtensionsContext: IContextKey<boolean>;
	private selectedRemoteConnectionInformations: IRemoteConnectionInformation[];

	constructor(
		@IPartService partService: IPartService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProgressService progressService: IProgressService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IExtensionManagementService extensionManagementService: IExtensionManagementService,
		@INotificationService notificationService: INotificationService,
		@IViewletService viewletService: IViewletService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IRemoteExtensionsService private remoteExtensionService: IRemoteExtensionsService
	) {
		super(partService, telemetryService, progressService, instantiationService, editorGroupService, extensionManagementService,
			notificationService, viewletService, themeService, configurationService, storageService, contextService, contextKeyService, contextMenuService, extensionService);
		this.remoteExtensionsContextKey = RemoteExtensionsContext.bindTo(contextKeyService);
		this.donotShowInstalledExtensionsContext = DonotShowInstalledExtensionsContext.bindTo(contextKeyService);

		ViewsRegistry.registerViews([this.createExtensionManagementServersViewDescriptor(), ...this.createRemoteExtensionsListViewDescriptors()]);

		const remoteWorkspaceFolderConnections = remoteExtensionService.getRemoteWorkspaceFolderConnections(contextService.getWorkspace().folders);
		this.remoteExtensionsContextKey.set(!!remoteWorkspaceFolderConnections.length);
	}

	private createExtensionManagementServersViewDescriptor(): IViewDescriptor {
		return {
			id: ExtensionManagementServers.ID,
			name: localize('extensions.servers', "Extension Management Servers"),
			location: ViewLocation.Extensions,
			ctor: ExtensionManagementServers,
			weight: 50,
			order: 0,
			canToggleVisibility: true,
			when: ContextKeyExpr.and(ContextKeyExpr.has('remoteExtensions')),
		};
	}

	private createRemoteExtensionsListViewDescriptors(): IViewDescriptor[] {
		return [{
			id: 'extensions.remote.listView',
			name: localize('marketPlace', "Marketplace"),
			location: ViewLocation.Extensions,
			ctor: ExtensionsListView,
			when: ContextKeyExpr.and(ContextKeyExpr.has('donotshowExtensions'), ContextKeyExpr.has('searchExtensions'), ContextKeyExpr.not('searchInstalledExtensions'), ContextKeyExpr.not('searchBuiltInExtensions'), ContextKeyExpr.not('recommendedExtensions')),
			weight: 100
		}, {
			id: 'extensions.remote.recommendedList',
			name: localize('recommendedExtensions', "Recommended"),
			location: ViewLocation.Extensions,
			ctor: RecommendedExtensionsView,
			when: ContextKeyExpr.and(ContextKeyExpr.has('donotshowExtensions'), ContextKeyExpr.not('searchExtensions'), ContextKeyExpr.has('defaultRecommendedExtensions')),
			weight: 70,
			order: 2,
			canToggleVisibility: true
		}, {
			id: 'extensions.remomte.otherrecommendedList',
			name: localize('otherRecommendedExtensions', "Other Recommendations"),
			location: ViewLocation.Extensions,
			ctor: RecommendedExtensionsView,
			when: ContextKeyExpr.and(ContextKeyExpr.has('donotshowExtensions'), ContextKeyExpr.has('recommendedExtensions')),
			weight: 50,
			canToggleVisibility: true,
			order: 2
		}, {
			id: 'extensions.remote.workspaceRecommendedList',
			name: localize('workspaceRecommendedExtensions', "Workspace Recommendations"),
			location: ViewLocation.Extensions,
			ctor: WorkspaceRecommendedExtensionsView,
			when: ContextKeyExpr.and(ContextKeyExpr.has('donotshowExtensions'), ContextKeyExpr.has('recommendedExtensions'), ContextKeyExpr.has('nonEmptyWorkspace')),
			weight: 50,
			canToggleVisibility: true,
			order: 1
		}];
	}

	private createInstalledExtensionsViewDescriptors(remoteConnectionInformation: IRemoteConnectionInformation): IViewDescriptor[] {
		return [{
			id: `${remoteConnectionInformation.getHashCode()}.installedList`,
			name: localize('installed extensions in remote management server', "Installed: {0}", `${remoteConnectionInformation.host}:${remoteConnectionInformation.extensionManagementPort}`),
			location: ViewLocation.Extensions,
			ctor: InstalledExtensionsView,
			when: ContextKeyExpr.not('searchExtensions'),
			order: 1,
			weight: 100
		}, {
			id: `${remoteConnectionInformation.getHashCode()}.searchInstalledList`,
			name: localize('installed extensions in remote management server', "Installed: {0}", `${remoteConnectionInformation.host}:${remoteConnectionInformation.extensionManagementPort}`),
			location: ViewLocation.Extensions,
			ctor: InstalledExtensionsView,
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchInstalledExtensions')),
			order: 1,
			weight: 100
		}, {
			id: `${remoteConnectionInformation.getHashCode()}.builtInExtensionsList`,
			name: localize('builtInExtensions extensions in remote management server', "Features: {0}", `${remoteConnectionInformation.host}:${remoteConnectionInformation.extensionManagementPort}`),
			location: ViewLocation.Extensions,
			ctor: BuiltInExtensionsView,
			when: ContextKeyExpr.has('searchBuiltInExtensions'),
			weight: 100,
			canToggleVisibility: true
		}, {
			id: `${remoteConnectionInformation.getHashCode()}.builtInThemesExtensionsList`,
			name: localize('builtInThemesExtensions extensions in remote management server', "Themes: {0}", `${remoteConnectionInformation.host}:${remoteConnectionInformation.extensionManagementPort}`),
			location: ViewLocation.Extensions,
			ctor: BuiltInThemesExtensionsView,
			when: ContextKeyExpr.has('searchBuiltInExtensions'),
			weight: 100,
			canToggleVisibility: true
		}, {
			id: `${remoteConnectionInformation.getHashCode()}.builtInBasicsExtensionsList`,
			name: localize('builtInBasicsExtensions extensions in remote management server', "Programming Languages: {0}", `${remoteConnectionInformation.host}:${remoteConnectionInformation.extensionManagementPort}`),
			location: ViewLocation.Extensions,
			ctor: BuiltInBasicsExtensionsView,
			when: ContextKeyExpr.has('searchBuiltInExtensions'),
			weight: 100,
			canToggleVisibility: true
		}];
	}

	protected createView(viewDescriptor: IViewDescriptor, options: IViewletViewOptions): ViewsViewletPanel {
		if (viewDescriptor.id === ExtensionManagementServers.ID) {
			return this.instantiationService.createInstance(ExtensionManagementServers, options, (servers) => this.onDidSelectServers(servers));
		}

		const remoteWorkspaceFolderConnections = this.remoteExtensionService.getRemoteWorkspaceFolderConnections(this.contextService.getWorkspace().folders);
		if (viewDescriptor.id.indexOf('extensions.remote') === 0) {
			if (this.selectedRemoteConnectionInformations.length) {
				const remoteWorkspaceFolderConnection = remoteWorkspaceFolderConnections.filter(r => r.connectionInformation.getHashCode() === this.selectedRemoteConnectionInformations[0].getHashCode())[0];
				options.name = `${options.name}: ${remoteWorkspaceFolderConnection.connectionInformation.host}:${remoteWorkspaceFolderConnection.connectionInformation.extensionManagementPort}`;
				return this.createExtensionsView(viewDescriptor, options, remoteWorkspaceFolderConnection);
			}
			return super.createView(viewDescriptor, options);
		}

		for (const remoteWorkspaceFolderConnection of remoteWorkspaceFolderConnections) {
			if (viewDescriptor.id.indexOf(remoteWorkspaceFolderConnection.connectionInformation.getHashCode()) === 0) {
				return this.createExtensionsView(viewDescriptor, options, remoteWorkspaceFolderConnection);
			}
		}

		return super.createView(viewDescriptor, options);
	}

	private createExtensionsView(viewDescriptor: IViewDescriptor, options: IViewletViewOptions, remoteWorkspaceFolderConnection: IRemoteWorkspaceFolderConnection): ViewsViewletPanel {
		const servicesCollection: ServiceCollection = new ServiceCollection();
		servicesCollection.set(IExtensionManagementService, new ExtensionManagementChannelClient(remoteWorkspaceFolderConnection.getChannel<IExtensionManagementChannel>('extensions')));
		servicesCollection.set(IExtensionsWorkbenchService, new SyncDescriptor(ExtensionsWorkbenchService));
		const instantiationService = this.instantiationService.createChild(servicesCollection);
		return instantiationService.createInstance(viewDescriptor.ctor, options) as ViewsViewletPanel;
	}

	private onDidSelectServers(servers: IExtensionManagementServer[]): void {

		const isLocalSelected = servers.some(s => !!(<ILocalConnectionInformation>s).local);
		this.donotShowInstalledExtensionsContext.set(!isLocalSelected);

		this.selectedRemoteConnectionInformations = <IRemoteConnectionInformation[]>servers.filter(s => !(<ILocalConnectionInformation>s).local);
		const remoteWorkspaceFolderConnections = this.remoteExtensionService.getRemoteWorkspaceFolderConnections(this.contextService.getWorkspace().folders);
		const toAdd = this.selectedRemoteConnectionInformations.filter(r => !ViewsRegistry.getView(r.getHashCode()));
		const toRemove = remoteWorkspaceFolderConnections.map(r => r.connectionInformation).filter(r => this.selectedRemoteConnectionInformations.every(rem => rem.getHashCode() !== r.getHashCode()));

		if (toRemove.length) {
			ViewsRegistry.deregisterViews(flatten(toRemove.map(r =>
				[
					`${r.getHashCode()}.installedList`,
					`${r.getHashCode()}.searchInstalledList`,
					`${r.getHashCode()}.builtInExtensionsList`,
					`${r.getHashCode()}.builtInThemesExtensionsList`,
					`${r.getHashCode()}.builtInBasicsExtensionsList`
				])), ViewLocation.Extensions);
		}

		if (toAdd.length) {
			ViewsRegistry.registerViews(flatten(toAdd.map(r => this.createInstalledExtensionsViewDescriptors(r))));
		}
	}

}

class ProvidersListDelegate implements IDelegate<IExtensionManagementServer> {

	getHeight(element: IExtensionManagementServer): number {
		return 22;
	}

	getTemplateId(element: IExtensionManagementServer): string {
		return 'extensionManagementServerTemplate';
	}
}

interface RemoteWorkspaceFolderConnectionTemplateData {
	title: HTMLElement;
}

class ExtensionManagementServerRenderer implements IRenderer<IExtensionManagementServer, RemoteWorkspaceFolderConnectionTemplateData> {

	readonly templateId = 'extensionManagementServerTemplate';

	renderTemplate(container: HTMLElement): RemoteWorkspaceFolderConnectionTemplateData {
		container.style.padding = '0 12px 0 20px';
		container.style.lineHeight = '22px';

		const provider = append(container, $('.remote-connection'));
		const name = append(provider, $('.name'));
		const title = append(name, $('span.title'));
		return { title };
	}

	renderElement(extensionMangementServer: IExtensionManagementServer, index: number, templateData: RemoteWorkspaceFolderConnectionTemplateData): void {
		if ((<IRemoteConnectionInformation>extensionMangementServer).host) {
			const { host, extensionManagementPort } = <IRemoteConnectionInformation>extensionMangementServer;
			templateData.title.textContent = `${host}:${extensionManagementPort}`;
		} else {
			templateData.title.textContent = `local`;
		}
	}

	disposeTemplate(templateData: RemoteWorkspaceFolderConnectionTemplateData): void {
	}
}


class ExtensionManagementServers extends ViewsViewletPanel {

	static ID = 'extensions.servers';

	private list: List<IExtensionManagementServer>;

	constructor(
		options: IViewletViewOptions,
		private onDidSelect: (servers: IExtensionManagementServer[]) => void,
		@INotificationService notificationService: INotificationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IExtensionService extensionService: IExtensionService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorInputService: IEditorGroupsService,
		@IExtensionTipsService tipsService: IExtensionTipsService,
		@IModeService modeService: IModeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IRemoteExtensionsService private remoteExtensionService: IRemoteExtensionsService
	) {
		super(options, keybindingService, contextMenuService, configurationService);
	}

	focus(): void {
		super.focus();
		this.list.domFocus();
	}

	async show(query: string): TPromise<void> {
		return TPromise.as(null);
	}

	protected renderBody(container: HTMLElement): void {
		const delegate = new ProvidersListDelegate();
		const renderer = this.instantiationService.createInstance(ExtensionManagementServerRenderer);

		this.list = this.instantiationService.createInstance(WorkbenchList, container, delegate, [renderer], {
			multipleSelectionSupport: false,
			identityProvider: repository => repository.host ? `${repository.host}:${repository.extensionManagementPort}` : 'local'
		}) as WorkbenchList<IExtensionManagementServer>;

		this.list.onSelectionChange(this.onListSelectionChange, this, this.disposables);
		this.list.splice(0, 0, [{ local: true }, ...this.remoteExtensionService.getRemoteWorkspaceFolderConnections(this.contextService.getWorkspace().folders).map(r => r.connectionInformation)]);
		this.maximumBodySize = 22 * this.list.length;

		this.disposables.push(this.list);
	}

	protected layoutBody(size: number): void {
		this.list.layout(size);
	}

	private onListSelectionChange(e: IListEvent<IExtensionManagementServer>): void {
		if (e.elements.length === 0 && this.list.length > 0) {
			this.restoreSelection();
			return;
		}
		this.onDidSelect(e.elements);
	}

	private restoreSelection(): void {
		this.list.setSelection([0]);
		this.list.setFocus([0]);
	}

	dispose() {
		dispose(this.disposables);
	}
}