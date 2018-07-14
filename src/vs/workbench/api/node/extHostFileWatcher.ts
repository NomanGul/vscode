/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as vscode from 'vscode';

import URI from 'vs/base/common/uri';
import * as extHostTypes from 'vs/workbench/api/node/extHostTypes';
import { FileChangeType } from 'vs/platform/files/common/files';
import { ChokidarWatcherService } from 'vs/workbench/services/files/node/watcher/unix/chokidarWatcherService';

import { IRawFileChange } from 'vs/workbench/services/files/node/watcher/common';
import { IWatcherRequest } from '../../services/files/node/watcher/unix/watcher';

export interface FileWatcher {
	watch(path: URI, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable;
	terminate();
}

export function createWatcher(verboseLogging: boolean, eventEmmiter: vscode.EventEmitter<vscode.FileChangeEvent[]>): FileWatcher {
	let watcherService = new ChokidarWatcherService();
	let requests: IWatcherRequest[] = [];

	// TODO(joao): Verify I changed initialize to watch correctly
	// set up file watcher
	const onWatchEvent = watcherService.watch({ verboseLogging });
	onWatchEvent((events: IRawFileChange[]) => {
		if (!watcherService) {
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
				console.info(`[FileWatcher] emitting file event(s): ${events.map(eventToString).join(', ')}`);
			}
			eventEmmiter.fire(fileEvents);
		}
	});
	return {
		watch(path: URI, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
			if (!watcherService) {
				throw Error('Watcher has already been terminated');
			}
			console.info(`[FileWatcher] start watching: ${path}, ignoring: ${options.excludes.join(', ')}`);

			const request = { basePath: path.fsPath, ignored: options.excludes, recursive: options.recursive };
			requests.push(request);
			watcherService.setRoots(requests);
			return {
				dispose: () => {
					requests = requests.filter(r => r !== request);
					if (watcherService) {
						watcherService.setRoots(requests);
					}
				}
			};
		},
		terminate: () => {
			watcherService.stop();
			watcherService = null;
		}
	};
}
