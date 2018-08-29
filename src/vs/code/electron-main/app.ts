/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as cp from 'child_process';
import { app, ipcMain as ipc, systemPreferences, protocol, shell, Event, } from 'electron';
import * as platform from 'vs/base/common/platform';
import { WindowsManager } from 'vs/code/electron-main/windows';
import { IWindowsService, OpenContext, ActiveWindowManager } from 'vs/platform/windows/common/windows';
import { WindowsChannel } from 'vs/platform/windows/node/windowsIpc';
import { WindowsService } from 'vs/platform/windows/electron-main/windowsService';
import { ILifecycleService } from 'vs/platform/lifecycle/electron-main/lifecycleMain';
import { getShellEnvironment } from 'vs/code/node/shellEnv';
import { IUpdateService } from 'vs/platform/update/common/update';
import { UpdateChannel } from 'vs/platform/update/node/updateIpc';
import { Server as ElectronIPCServer } from 'vs/base/parts/ipc/electron-main/ipc.electron-main';
import { Server, connect, Client } from 'vs/base/parts/ipc/node/ipc.net';
import { SharedProcess } from 'vs/code/electron-main/sharedProcess';
import { Mutex } from 'windows-mutex';
import { LaunchService, LaunchChannel, ILaunchService } from './launch';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ILogService } from 'vs/platform/log/common/log';
import { IStateService } from 'vs/platform/state/common/state';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IURLService } from 'vs/platform/url/common/url';
import { URLHandlerChannelClient, URLServiceChannel } from 'vs/platform/url/node/urlIpc';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService, combinedAppender, LogAppender } from 'vs/platform/telemetry/common/telemetryUtils';
import { ITelemetryAppenderChannel, TelemetryAppenderClient } from 'vs/platform/telemetry/node/telemetryIpc';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { resolveCommonProperties } from 'vs/platform/telemetry/node/commonProperties';
import { getDelayedChannel } from 'vs/base/parts/ipc/node/ipc';
import product from 'vs/platform/node/product';
import pkg from 'vs/platform/node/package';
import { ProxyAuthHandler } from './auth';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { ConfigurationService } from 'vs/platform/configuration/node/configurationService';
import { TPromise } from 'vs/base/common/winjs.base';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';
import { IHistoryMainService } from 'vs/platform/history/common/history';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { CodeWindow } from 'vs/code/electron-main/window';
import { KeyboardLayoutMonitor } from 'vs/code/electron-main/keyboard';
import URI from 'vs/base/common/uri';
import { WorkspacesChannel } from 'vs/platform/workspaces/node/workspacesIpc';
import { IWorkspacesMainService } from 'vs/platform/workspaces/common/workspaces';
import { getMachineId } from 'vs/base/node/id';
import { Win32UpdateService } from 'vs/platform/update/electron-main/updateService.win32';
import { LinuxUpdateService } from 'vs/platform/update/electron-main/updateService.linux';
import { DarwinUpdateService } from 'vs/platform/update/electron-main/updateService.darwin';
import { IIssueService } from 'vs/platform/issue/common/issue';
import { IssueChannel } from 'vs/platform/issue/node/issueIpc';
import { IssueService } from 'vs/platform/issue/electron-main/issueService';
import { LogLevelSetterChannel } from 'vs/platform/log/node/logIpc';
import * as errors from 'vs/base/common/errors';
import { ElectronURLListener } from 'vs/platform/url/electron-main/electronUrlListener';
import { serve as serveDriver } from 'vs/platform/driver/electron-main/driver';
import { REMOTE_EXTENSIONS_FILE_SYSTEM_CHANNEL_NAME, RemoteExtensionsFileSystemChannelClient, connectToRemoteExtensionHostManagement } from 'vs/platform/remote/node/remoteFileSystemIpc';
import { IMenubarService } from 'vs/platform/menubar/common/menubar';
import { MenubarService } from 'vs/platform/menubar/electron-main/menubarService';
import { MenubarChannel } from 'vs/platform/menubar/node/menubarIpc';
import { ILabelService } from 'vs/platform/label/common/label';
import { CodeMenu } from 'vs/code/electron-main/menus';
import { hasArgs } from 'vs/platform/environment/node/argv';
import { RunOnceScheduler } from 'vs/base/common/async';
import { registerContextMenuListener } from 'vs/base/parts/contextmenu/electron-main/contextmenu';

export class CodeApplication {

	private static readonly MACHINE_ID_KEY = 'telemetry.machineId';

	private toDispose: IDisposable[];
	private windowsMainService: IWindowsMainService;

	private electronIpcServer: ElectronIPCServer;

	private sharedProcess: SharedProcess;
	private sharedProcessClient: TPromise<Client>;

	private wslExtensionHost: TPromise<void>;

	constructor(
		private mainIpcServer: Server,
		private userEnv: platform.IProcessEnvironment,
		@IInstantiationService private instantiationService: IInstantiationService,
		@ILogService private logService: ILogService,
		@IEnvironmentService private environmentService: IEnvironmentService,
		@ILifecycleService private lifecycleService: ILifecycleService,
		@IConfigurationService private configurationService: ConfigurationService,
		@IStateService private stateService: IStateService,
		@IHistoryMainService private historyMainService: IHistoryMainService,
		@ILabelService private labelService: ILabelService
	) {
		this.toDispose = [mainIpcServer, configurationService];

		this.registerListeners();
	}

	private registerListeners(): void {

		// We handle uncaught exceptions here to prevent electron from opening a dialog to the user
		errors.setUnexpectedErrorHandler(err => this.onUnexpectedError(err));
		process.on('uncaughtException', err => this.onUnexpectedError(err));
		process.on('unhandledRejection', (reason: any, promise: Promise<any>) => errors.onUnexpectedError(reason));

		// Contextmenu via IPC support
		registerContextMenuListener();

		app.on('will-quit', () => {
			this.logService.trace('App#will-quit: disposing resources');

			this.dispose();
		});

		app.on('accessibility-support-changed', (event: Event, accessibilitySupportEnabled: boolean) => {
			if (this.windowsMainService) {
				this.windowsMainService.sendToAll('vscode:accessibilitySupportChanged', accessibilitySupportEnabled);
			}
		});

		app.on('activate', (event: Event, hasVisibleWindows: boolean) => {
			this.logService.trace('App#activate');

			// Mac only event: open new window when we get activated
			if (!hasVisibleWindows && this.windowsMainService) {
				this.windowsMainService.openNewWindow(OpenContext.DOCK);
			}
		});

		// Security related measures (https://electronjs.org/docs/tutorial/security)
		// DO NOT CHANGE without consulting the documentation
		app.on('web-contents-created', (event: any, contents) => {
			contents.on('will-attach-webview', (event: Electron.Event, webPreferences, params) => {

				// Ensure defaults
				delete webPreferences.preload;
				webPreferences.nodeIntegration = false;

				// Verify URLs being loaded
				if (this.isValidWebviewSource(params.src) && this.isValidWebviewSource(webPreferences.preloadURL)) {
					return;
				}

				delete webPreferences.preloadUrl;

				// Otherwise prevent loading
				this.logService.error('webContents#web-contents-created: Prevented webview attach');

				event.preventDefault();
			});

			contents.on('will-navigate', event => {
				this.logService.error('webContents#will-navigate: Prevented webcontent navigation');

				event.preventDefault();
			});

			contents.on('new-window', (event: Event, url: string) => {
				event.preventDefault(); // prevent code that wants to open links

				shell.openExternal(url);
			});
		});

		const connectionPool: Map<string, ActiveConnection> = new Map<string, ActiveConnection>();

		class ActiveConnection {
			private _authority: string;
			private _client: TPromise<Client>;
			private _disposeRunner: RunOnceScheduler;

			constructor(authority: string, connectionInfo: TPromise<{ host: string; port: number; }>) {
				this._authority = authority;
				this._client = connectionInfo.then(({ host, port }) => {
					return connectToRemoteExtensionHostManagement(host, port, `main`);
				});
				this._disposeRunner = new RunOnceScheduler(() => this._dispose(), 1000);
			}

			private _dispose(): void {
				this._disposeRunner.dispose();
				connectionPool.delete(this._authority);
				this._client.then((connection) => {
					connection.dispose();
				});
			}

			public getClient(): TPromise<Client> {
				this._disposeRunner.schedule();
				return this._client;
			}
		}

		protocol.registerBufferProtocol('vscode-remote', async (request, callback) => {
			if (request.method !== 'GET') {
				return callback(null);
			}
			const uri = URI.parse(request.url);
			console.log(`REMOTE-FETCH: ${uri.toString()}`);

			let activeConnection: ActiveConnection = null;
			if (connectionPool.has(uri.authority)) {
				activeConnection = connectionPool.get(uri.authority);
			} else {
				activeConnection = new ActiveConnection(uri.authority, this.resolveAuthority(uri.authority));
				connectionPool.set(uri.authority, activeConnection);
			}
			try {
				const rawClient = await activeConnection.getClient();
				const client = new RemoteExtensionsFileSystemChannelClient(rawClient.getChannel(REMOTE_EXTENSIONS_FILE_SYSTEM_CHANNEL_NAME));
				const fileContents = await client.getFile(uri.path);
				callback(Buffer.from(fileContents, 'base64'));
			} catch (err) {
				errors.onUnexpectedError(err);
				callback(null);
			}
		});

		type IResolveAuthorityReply = { type: 'ok'; authority: string; host: string; port: number; } | { type: 'err'; authority: string; error: any; };
		ipc.on('vscode:resolveAuthorityRequest', (event: any, authority: string) => {
			const webContents = event.sender.webContents;
			this.resolveAuthority(authority).then(({ host, port }) => {
				let msg: IResolveAuthorityReply = { type: 'ok', authority, host, port };
				webContents.send('vscode:resolveAuthorityReply', msg);
			}, (error) => {
				let msg: IResolveAuthorityReply = { type: 'err', authority, error: errors.transformErrorForSerialization(error) };
				webContents.send('vscode:resolveAuthorityReply', msg);
			});
		});

		let macOpenFileURIs: URI[] = [];
		let runningTimeout: number = null;
		app.on('open-file', (event: Event, path: string) => {
			this.logService.trace('App#open-file: ', path);
			event.preventDefault();

			// Keep in array because more might come!
			macOpenFileURIs.push(URI.file(path));

			// Clear previous handler if any
			if (runningTimeout !== null) {
				clearTimeout(runningTimeout);
				runningTimeout = null;
			}

			// Handle paths delayed in case more are coming!
			runningTimeout = setTimeout(() => {
				if (this.windowsMainService) {
					this.windowsMainService.open({
						context: OpenContext.DOCK /* can also be opening from finder while app is running */,
						cli: this.environmentService.args,
						urisToOpen: macOpenFileURIs,
						preferNewWindow: true /* dropping on the dock or opening from finder prefers to open in a new window */
					});
					macOpenFileURIs = [];
					runningTimeout = null;
				}
			}, 100);
		});

		app.on('new-window-for-tab', () => {
			this.windowsMainService.openNewWindow(OpenContext.DESKTOP); //macOS native tab "+" button
		});

		ipc.on('vscode:exit', (event: Event, code: number) => {
			this.logService.trace('IPC#vscode:exit', code);

			this.dispose();
			this.lifecycleService.kill(code);
		});

		ipc.on('vscode:fetchShellEnv', (event: Event) => {
			const webContents = event.sender;
			getShellEnvironment().then(shellEnv => {
				if (!webContents.isDestroyed()) {
					webContents.send('vscode:acceptShellEnv', shellEnv);
				}
			}, err => {
				if (!webContents.isDestroyed()) {
					webContents.send('vscode:acceptShellEnv', {});
				}

				this.logService.error('Error fetching shell env', err);
			});
		});

		ipc.on('vscode:broadcast', (event: Event, windowId: number, broadcast: { channel: string; payload: any; }) => {
			if (this.windowsMainService && broadcast.channel && !isUndefinedOrNull(broadcast.payload)) {
				this.logService.trace('IPC#vscode:broadcast', broadcast.channel, broadcast.payload);

				// Handle specific events on main side
				this.onBroadcast(broadcast.channel, broadcast.payload);

				// Send to all windows (except sender window)
				this.windowsMainService.sendToAll('vscode:broadcast', broadcast, [windowId]);
			}
		});

		ipc.on('vscode:labelRegisterFormater', (event: any, { scheme, formater }) => {
			this.labelService.registerFormatter(scheme, formater);
		});

		ipc.on('vscode:toggleDevTools', (event: Event) => {
			event.sender.toggleDevTools();
		});

		ipc.on('vscode:openDevTools', (event: Event) => {
			event.sender.openDevTools();
		});

		ipc.on('vscode:reloadWindow', (event: Event) => {
			event.sender.reload();
		});

		// Keyboard layout changes
		KeyboardLayoutMonitor.INSTANCE.onDidChangeKeyboardLayout(() => {
			if (this.windowsMainService) {
				this.windowsMainService.sendToAll('vscode:keyboardLayoutChanged', false);
			}
		});
	}

	private isValidWebviewSource(source: string): boolean {
		if (!source) {
			return false;
		}

		if (source === 'data:text/html;charset=utf-8,%3C%21DOCTYPE%20html%3E%0D%0A%3Chtml%20lang%3D%22en%22%20style%3D%22width%3A%20100%25%3B%20height%3A%20100%25%22%3E%0D%0A%3Chead%3E%0D%0A%09%3Ctitle%3EVirtual%20Document%3C%2Ftitle%3E%0D%0A%3C%2Fhead%3E%0D%0A%3Cbody%20style%3D%22margin%3A%200%3B%20overflow%3A%20hidden%3B%20width%3A%20100%25%3B%20height%3A%20100%25%22%3E%0D%0A%3C%2Fbody%3E%0D%0A%3C%2Fhtml%3E') {
			return true;
		}

		const srcUri: any = URI.parse(source.toLowerCase()).toString();

		return srcUri.startsWith(URI.file(this.environmentService.appRoot.toLowerCase()).toString());
	}

	private onUnexpectedError(err: Error): void {
		if (err) {

			// take only the message and stack property
			const friendlyError = {
				message: err.message,
				stack: err.stack
			};

			// handle on client side
			if (this.windowsMainService) {
				this.windowsMainService.sendToFocused('vscode:reportError', JSON.stringify(friendlyError));
			}
		}

		this.logService.error(`[uncaught exception in main]: ${err}`);
		if (err.stack) {
			this.logService.error(err.stack);
		}
	}

	private onBroadcast(event: string, payload: any): void {

		// Theme changes
		if (event === 'vscode:changeColorTheme' && typeof payload === 'string') {
			let data = JSON.parse(payload);

			this.stateService.setItem(CodeWindow.themeStorageKey, data.baseTheme);
			this.stateService.setItem(CodeWindow.themeBackgroundStorageKey, data.background);
		}
	}

	startup(): TPromise<void> {
		this.logService.debug('Starting VS Code');
		this.logService.debug(`from: ${this.environmentService.appRoot}`);
		this.logService.debug('args:', this.environmentService.args);

		// Make sure we associate the program with the app user model id
		// This will help Windows to associate the running program with
		// any shortcut that is pinned to the taskbar and prevent showing
		// two icons in the taskbar for the same app.
		if (platform.isWindows && product.win32AppUserModelId) {
			app.setAppUserModelId(product.win32AppUserModelId);
		}

		// Fix native tabs on macOS 10.13
		// macOS enables a compatibility patch for any bundle ID beginning with
		// "com.microsoft.", which breaks native tabs for VS Code when using this
		// identifier (from the official build).
		// Explicitly opt out of the patch here before creating any windows.
		// See: https://github.com/Microsoft/vscode/issues/35361#issuecomment-399794085
		try {
			if (platform.isMacintosh && this.configurationService.getValue<boolean>('window.nativeTabs') === true && !systemPreferences.getUserDefault('NSUseImprovedLayoutPass', 'boolean')) {
				systemPreferences.setUserDefault('NSUseImprovedLayoutPass', 'boolean', true as any);
			}
		} catch (error) {
			this.logService.error(error);
		}

		// Create Electron IPC Server
		this.electronIpcServer = new ElectronIPCServer();

		// Resolve unique machine ID
		this.logService.trace('Resolving machine identifier...');
		return this.resolveMachineId().then(machineId => {
			this.logService.trace(`Resolved machine identifier: ${machineId}`);

			// Spawn shared process
			this.sharedProcess = new SharedProcess(this.environmentService, this.lifecycleService, this.logService, machineId, this.userEnv);
			this.sharedProcessClient = this.sharedProcess.whenReady().then(() => connect(this.environmentService.sharedIPCHandle, 'main'));

			// Services
			const appInstantiationService = this.initServices(machineId);

			let promise: TPromise<any> = TPromise.as(null);

			// Create driver
			if (this.environmentService.driverHandle) {
				serveDriver(this.electronIpcServer, this.environmentService.driverHandle, this.environmentService, appInstantiationService).then(server => {
					this.logService.info('Driver started at:', this.environmentService.driverHandle);
					this.toDispose.push(server);
				});
			}

			return promise.then(() => {

				// Setup Auth Handler
				const authHandler = appInstantiationService.createInstance(ProxyAuthHandler);
				this.toDispose.push(authHandler);

				// Open Windows
				appInstantiationService.invokeFunction(accessor => this.openFirstWindow(accessor));

				// Post Open Windows Tasks
				appInstantiationService.invokeFunction(accessor => this.afterWindowOpen(accessor));
			});
		});
	}

	private resolveMachineId(): TPromise<string> {
		const machineId = this.stateService.getItem<string>(CodeApplication.MACHINE_ID_KEY);
		if (machineId) {
			return TPromise.wrap(machineId);
		}

		return getMachineId().then(machineId => {

			// Remember in global storage
			this.stateService.setItem(CodeApplication.MACHINE_ID_KEY, machineId);

			return machineId;
		});
	}

	private initServices(machineId: string): IInstantiationService {
		const services = new ServiceCollection();

		if (process.platform === 'win32') {
			services.set(IUpdateService, new SyncDescriptor(Win32UpdateService));
		} else if (process.platform === 'linux') {
			services.set(IUpdateService, new SyncDescriptor(LinuxUpdateService));
		} else if (process.platform === 'darwin') {
			services.set(IUpdateService, new SyncDescriptor(DarwinUpdateService));
		}

		services.set(IWindowsMainService, new SyncDescriptor(WindowsManager, machineId));
		services.set(IWindowsService, new SyncDescriptor(WindowsService, this.sharedProcess));
		services.set(ILaunchService, new SyncDescriptor(LaunchService));
		services.set(IIssueService, new SyncDescriptor(IssueService, machineId, this.userEnv));
		services.set(IMenubarService, new SyncDescriptor(MenubarService));

		// Telemtry
		if (!this.environmentService.isExtensionDevelopment && !this.environmentService.args['disable-telemetry'] && !!product.enableTelemetry) {
			const channel = getDelayedChannel<ITelemetryAppenderChannel>(this.sharedProcessClient.then(c => c.getChannel('telemetryAppender')));
			const appender = combinedAppender(new TelemetryAppenderClient(channel), new LogAppender(this.logService));
			const commonProperties = resolveCommonProperties(product.commit, pkg.version, machineId, this.environmentService.installSourcePath);
			const piiPaths = [this.environmentService.appRoot, this.environmentService.extensionsPath];
			const config: ITelemetryServiceConfig = { appender, commonProperties, piiPaths };

			services.set(ITelemetryService, new SyncDescriptor(TelemetryService, config));
		} else {
			services.set(ITelemetryService, NullTelemetryService);
		}

		return this.instantiationService.createChild(services);
	}

	private openFirstWindow(accessor: ServicesAccessor): void {
		const appInstantiationService = accessor.get(IInstantiationService);

		// Register more Main IPC services
		const launchService = accessor.get(ILaunchService);
		const launchChannel = new LaunchChannel(launchService);
		this.mainIpcServer.registerChannel('launch', launchChannel);

		// Register more Electron IPC services
		const updateService = accessor.get(IUpdateService);
		const updateChannel = new UpdateChannel(updateService);
		this.electronIpcServer.registerChannel('update', updateChannel);

		const issueService = accessor.get(IIssueService);
		const issueChannel = new IssueChannel(issueService);
		this.electronIpcServer.registerChannel('issue', issueChannel);

		const workspacesService = accessor.get(IWorkspacesMainService);
		const workspacesChannel = appInstantiationService.createInstance(WorkspacesChannel, workspacesService);
		this.electronIpcServer.registerChannel('workspaces', workspacesChannel);

		const windowsService = accessor.get(IWindowsService);
		const windowsChannel = new WindowsChannel(windowsService);
		this.electronIpcServer.registerChannel('windows', windowsChannel);
		this.sharedProcessClient.done(client => client.registerChannel('windows', windowsChannel));

		const menubarService = accessor.get(IMenubarService);
		const menubarChannel = new MenubarChannel(menubarService);
		this.electronIpcServer.registerChannel('menubar', menubarChannel);

		const urlService = accessor.get(IURLService);
		const urlChannel = new URLServiceChannel(urlService);
		this.electronIpcServer.registerChannel('url', urlChannel);

		// Log level management
		const logLevelChannel = new LogLevelSetterChannel(accessor.get(ILogService));
		this.electronIpcServer.registerChannel('loglevel', logLevelChannel);
		this.sharedProcessClient.done(client => client.registerChannel('loglevel', logLevelChannel));

		// Lifecycle
		this.lifecycleService.ready();

		// Propagate to clients
		const windowsMainService = this.windowsMainService = accessor.get(IWindowsMainService); // TODO@Joao: unfold this

		const args = this.environmentService.args;

		// Create a URL handler which forwards to the last active window
		const activeWindowManager = new ActiveWindowManager(windowsService);
		const route = () => activeWindowManager.getActiveClientId();
		const urlHandlerChannel = this.electronIpcServer.getChannel('urlHandler', { routeCall: route, routeEvent: route });
		const multiplexURLHandler = new URLHandlerChannelClient(urlHandlerChannel);

		// On Mac, Code can be running without any open windows, so we must create a window to handle urls,
		// if there is none
		if (platform.isMacintosh) {
			const environmentService = accessor.get(IEnvironmentService);

			urlService.registerHandler({
				handleURL(uri: URI): TPromise<boolean> {
					if (windowsMainService.getWindowCount() === 0) {
						const cli = { ...environmentService.args, goto: true };
						const [window] = windowsMainService.open({ context: OpenContext.API, cli, forceEmpty: true });

						return window.ready().then(() => urlService.open(uri));
					}

					return TPromise.as(false);
				}
			});
		}

		// Register the multiple URL handker
		urlService.registerHandler(multiplexURLHandler);

		// Watch Electron URLs and forward them to the UrlService
		const urls = args['open-url'] ? args._urls : [];
		const urlListener = new ElectronURLListener(urls, urlService, this.windowsMainService);
		this.toDispose.push(urlListener);

		this.windowsMainService.ready(this.userEnv);

		// Open our first window
		const macOpenFiles = (<any>global).macOpenFiles as string[];
		const context = !!process.env['VSCODE_CLI'] ? OpenContext.CLI : OpenContext.DESKTOP;
		const hasCliArgs = hasArgs(args._);
		const hasFolderURIs = hasArgs(args['folder-uri']);
		const hasFileURIs = hasArgs(args['file-uri']);

		if (args['new-window'] && !hasCliArgs && !hasFolderURIs && !hasFileURIs) {
			this.windowsMainService.open({ context, cli: args, forceNewWindow: true, forceEmpty: true, initialStartup: true }); // new window if "-n" was used without paths
		} else if (macOpenFiles && macOpenFiles.length && !hasCliArgs && !hasFolderURIs && !hasFileURIs) {
			this.windowsMainService.open({ context: OpenContext.DOCK, cli: args, urisToOpen: macOpenFiles.map(file => URI.file(file)), initialStartup: true }); // mac: open-file event received on startup
		} else {
			this.windowsMainService.open({ context, cli: args, forceNewWindow: args['new-window'] || (!hasCliArgs && args['unity-launch']), diffMode: args.diff, initialStartup: true }); // default: read paths from cli
		}
	}

	private afterWindowOpen(accessor: ServicesAccessor): void {
		const windowsMainService = accessor.get(IWindowsMainService);

		let windowsMutex: Mutex = null;
		if (platform.isWindows) {

			// Setup Windows mutex
			try {
				const Mutex = (require.__$__nodeRequire('windows-mutex') as any).Mutex;
				windowsMutex = new Mutex(product.win32MutexName);
				this.toDispose.push({ dispose: () => windowsMutex.release() });
			} catch (e) {
				if (!this.environmentService.isBuilt) {
					windowsMainService.showMessageBox({
						title: product.nameLong,
						type: 'warning',
						message: 'Failed to load windows-mutex!',
						detail: e.toString(),
						noLink: true
					});
				}
			}

			// Ensure Windows foreground love module
			try {
				// tslint:disable-next-line:no-unused-expression
				<any>require.__$__nodeRequire('windows-foreground-love');
			} catch (e) {
				if (!this.environmentService.isBuilt) {
					windowsMainService.showMessageBox({
						title: product.nameLong,
						type: 'warning',
						message: 'Failed to load windows-foreground-love!',
						detail: e.toString(),
						noLink: true
					});
				}
			}
		}

		// TODO@sbatten: Remove when switching back to dynamic menu
		// Install Menu
		const instantiationService = accessor.get(IInstantiationService);
		const configurationService = accessor.get(IConfigurationService);

		let createNativeMenu = true;
		if (platform.isLinux) {
			createNativeMenu = configurationService.getValue<string>('window.titleBarStyle') !== 'custom';
		} else if (platform.isWindows) {
			createNativeMenu = configurationService.getValue<string>('window.titleBarStyle') === 'native';
		}

		if (createNativeMenu) {
			instantiationService.createInstance(CodeMenu);
		}

		// Jump List
		this.historyMainService.updateWindowsJumpList();
		this.historyMainService.onRecentlyOpenedChange(() => this.historyMainService.updateWindowsJumpList());

		// Start shared process after a while
		const sharedProcess = new RunOnceScheduler(() => this.sharedProcess.spawn(), 3000);
		sharedProcess.schedule();
		this.toDispose.push(sharedProcess);
	}

	private dispose(): void {
		this.toDispose = dispose(this.toDispose);
	}

	private resolveAuthority(authority: string): TPromise<{ host: string; port: number; }> {
		if (/^wsl\+/.test(authority)) {
			return this.startWslExtensionHost(this.environmentService).then(() => {
				return {
					host: 'localhost',
					port: 8000
				};
			});
		}

		// Perhaps it is a host:port URI
		const [host, strPort] = authority.split(':');
		const port = parseInt(strPort, 10);
		return TPromise.as({ host, port });
	}

	private startWslExtensionHost(environmentService: IEnvironmentService): TPromise<void> {
		if (!platform.isWindows) {
			return TPromise.as(undefined);
		}
		// We have on running.
		if (this.wslExtensionHost !== void 0) {
			this.logService.info('Remote extension host inside WSL is already running');
			return this.wslExtensionHost;
		}
		this.logService.info('Starting remote extension agent inside WSL');
		this.wslExtensionHost = new TPromise<void>((resolve, reject) => {
			let script: string = environmentService.isBuilt
				? URI.parse(require.toUrl('./wslAgent2.sh')).fsPath
				: URI.parse(require.toUrl('./wslAgent-dev.sh')).fsPath;

			cp.execFile('wsl', ['wslpath', '-a', script.replace(/\\/g, '\\\\')], { encoding: 'utf8' }, (error, stdout, stderr) => {
				if (error || (stderr && stderr.length > 0)) {
					reject(error || new Error(stderr));
				}
				let wslScript = stdout.replace('\n', '').replace('\r', '');
				// The script path contains a blank. We have to escape the blank and put single quotes around it.
				if (wslScript.indexOf(' ') >= 0) {
					wslScript = `'${wslScript.replace(/ /g, '\\ ')}'`;
				}
				let extHostProcess = cp.spawn('C:\\Windows\\System32\\bash.exe', ['-i', '-c', `"${wslScript} ${product.commit || ''}"`], { cwd: process.cwd(), windowsVerbatimArguments: true });
				if (extHostProcess.pid === void 0) {
					reject(new Error('WSL remote extension host agent couldn\'t be started'));
				} else {
					let connectPromise = new TPromise<void>((resolve, reject) => {
						let stdout: string = '';
						extHostProcess.stdout.on('data', (data) => {
							process.stdout.write(data);
							if (stdout !== void 0) {
								stdout = stdout + data.toString();
								if (stdout.indexOf('Extension host agent listening on') !== -1) {
									this.logService.info('Extension host agent is ready');
									stdout = undefined;
									resolve(undefined);
								}
							}
						});
						extHostProcess.stderr.on('data', (data) => {
							process.stderr.write(data);
						});
						extHostProcess.on('error', (error) => {
							this.logService.info(`Starting WSL extension host agent failed with\n:${error.message}`);
							console.log('Agent: Errored');
						});
						extHostProcess.on('close', (code) => {
							console.log('Agent: Closed: ' + code);
						});
					});
					// Wait max 30 seconds for the agent to start
					let rejectTimer = setTimeout(() => reject(new Error('Starting WSL extension host agent exceeded 30s')), 30000);
					connectPromise.then(() => {
						// success!
						clearTimeout(rejectTimer);
						resolve(undefined);
					});
				}
			});
		});
		return this.wslExtensionHost;
	}
}
