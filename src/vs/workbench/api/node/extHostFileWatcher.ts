/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';

import URI from 'vs/base/common/uri';
import { Emitter } from 'vs/base/common/event';
import * as extHostTypes from 'vs/workbench/api/node/extHostTypes';
import { FileChangeType } from 'vs/platform/files/common/files';
import { ChokidarWatcherService } from 'vs/workbench/services/files/node/watcher/unix/chokidarWatcherService';

import { isPromiseCanceledError } from 'vs/base/common/errors';
import { TPromise } from 'vs/base/common/winjs.base';
import { IRawFileChange } from 'vs/workbench/services/files/node/watcher/common';
import { LogLevel } from 'vs/platform/log/common/log';

import { ExtHostWorkspace } from 'vs/workbench/api/node/extHostWorkspace';
import { ExtHostConfiguration } from 'vs/workbench/api/node/extHostConfiguration';
import { ExtHostLogService } from 'vs/workbench/api/node/extHostLogService';
import { ExtHostFileSystemEventService } from 'vs/workbench/api/node/extHostFileSystemEventService';

export default class FileWatcher {

	private readonly eventEmmiter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

	private readonly watcherService: ChokidarWatcherService;
	private isDisposed: boolean;

	constructor(
		private extHostWorkspace: ExtHostWorkspace,
		private extHostConfiguration: ExtHostConfiguration,
		private extHostFileSystemEventService: ExtHostFileSystemEventService,
		private logService: ExtHostLogService) {
		this.eventEmmiter = new Emitter<vscode.FileChangeEvent[]>();
		this.watcherService = this.getService();
	}


	get onFileChange(): vscode.Event<vscode.FileChangeEvent[]> {
		return this.eventEmmiter.event;
	}

	private getService(): ChokidarWatcherService {
		return new ChokidarWatcherService(); // run in the same process
	}

	public startWatching(): vscode.Disposable {
		const diposable = {
			dispose: () => {
				this.isDisposed = true;
				this.watcherService.stop();
			}
		};

		const logger = console; // use console until the logService works remotely
		let verboseLogging = this.logService.getLevel() === LogLevel.Debug;
		this.logService.onDidChangeLogLevel(logLevel => verboseLogging = logLevel === LogLevel.Debug);


		// look for file:// workspace folders
		const folders = this.extHostWorkspace.getWorkspaceFolders().filter(f => f.uri.scheme === 'file');
		if (folders.length === 0) {
			logger.warn(`[FileWatcher] No local workspace folders found: ${this.extHostWorkspace.getWorkspaceFolders().map(f => f.uri.toString()).join(', ')}`);
			return diposable;
		} else if (folders.length > 1) {
			logger.warn(`[FileWatcher] More than one local workspace folder: ${folders.map(f => f.uri.toString()).join(', ')}. Only first folder is watched.`);
		} else {
			logger.info(`[FileWatcher] Watching ${folders[0].uri.fsPath}`);
		}
		let folderUri = folders[0].uri;

		// get ignore rules
		let ignored: string[] = [];
		const excludes = this.extHostConfiguration.getConfiguration('files', folderUri).get('watcherExclude', void 0);
		if (excludes) {
			ignored = Object.keys(excludes).filter(k => !!excludes[k]);
		}
		logger.info(`[FileWatcher] Ignoring: ${ignored.join(', ')}`);


		// set up file watcher
		const basePath: string = path.normalize(folderUri.fsPath);
		this.watcherService.watch({ basePath: basePath, ignored, verboseLogging }).then(null, err => {
			if (!this.isDisposed && !isPromiseCanceledError(err)) {
				return TPromise.wrapError(err); // the service lib uses the promise cancel error to indicate the process died, we do not want to bubble this up
			}

			return void 0;
		}, (events: IRawFileChange[]) => {
			if (this.isDisposed) {
				return;
			}

			// Emit through event emitter
			if (events.length > 0) {
				const fileEvents = events.map(e => {
					return {
						type: e.type === FileChangeType.UPDATED ? extHostTypes.FileChangeType.Changed : e.type === FileChangeType.ADDED ? extHostTypes.FileChangeType.Created : extHostTypes.FileChangeType.Deleted,
						uri: URI.file(e.path)
					};
				});
				if (verboseLogging) {
					let eventToString = (e: IRawFileChange) => `[${e.type === FileChangeType.UPDATED ? 'updated' : e.type === FileChangeType.ADDED ? 'created' : 'deleted'}] ${e.path}`;
					logger.info(`[FileWatcher] emitting file event(s): ${events.map(eventToString).join(', ')}`);
				}
				this.eventEmmiter.fire(fileEvents);
			}

		}).done(() => {
			// TODO: our watcher app should never be completed because it keeps on watching. being in here indicates
			// that the watcher process died and we want to restart it here.
		}, error => {
			if (!this.isDisposed) {
				logger.error(error);
			}
		});

		if (verboseLogging) {
			// install a ext host file system watcher to observe if our events are received
			const fileWatcher = this.extHostFileSystemEventService.createFileSystemWatcher('**');
			fileWatcher.onDidChange(u => logger.info(`[FileWatcher] observing file event: [changed] ${u.toString()}`));
			fileWatcher.onDidDelete(u => logger.info(`[FileWatcher] observing file event: [deleted] ${u.toString()}`));
			fileWatcher.onDidCreate(u => logger.info(`[FileWatcher] observing file event: [created] ${u.toString()}`));
		}

		return diposable;
	}
}
