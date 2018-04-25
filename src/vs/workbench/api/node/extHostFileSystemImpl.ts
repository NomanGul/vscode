/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as path from 'path';

import URI from 'vs/base/common/uri';
import * as pfs from 'vs/base/node/pfs';
import FileWatcher from './extHostFileWatcher';

import * as vscode from 'vscode';

export default class FileSystemProvider implements vscode.FileSystemProvider {

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

	constructor(fileWatcher: FileWatcher) {
		this.onDidChangeFile = fileWatcher.onFileChange;
	}

	watch(uri: vscode.Uri, options: { recursive?: boolean; excludes?: string[]; }): vscode.Disposable {
		return {
			dispose: () => { }
		};
	}

	public async stat(resource: URI): Promise<vscode.FileStat> {
		return this._stat(resource.fsPath);
	}

	private async _stat(fsPath: string): Promise<vscode.FileStat> {
		let stats = await pfs.stat(fsPath);
		return {
			isFile: stats.isFile(),
			isDirectory: stats.isDirectory(),
			isSymbolicLink: stats.isSymbolicLink(),
			mtime: stats.mtime.getTime(),
			size: stats.size
		};
	}

	public async readDirectory(uri: vscode.Uri, options: {}, token: vscode.CancellationToken): Promise<[string, vscode.FileStat][]> {
		let fsPath = uri.fsPath;
		let files = await pfs.readdir(fsPath);
		let absoluteFiles = files.map(file => path.join(fsPath, file));
		let statPromises: Promise<vscode.FileStat>[] = absoluteFiles.map(file => this._stat(file));
		let stats = await Promise.all(statPromises);
		let result: [string, vscode.FileStat][] = [];
		for (let i = 0; i < files.length; i++) {
			result.push([files[i], stats[i]]);
		}
		return result;
	}

	public async createDirectory(uri: vscode.Uri, options: {}, token: vscode.CancellationToken): Promise<vscode.FileStat> {
		let fsPath = uri.fsPath;
		await pfs.mkdirp(fsPath);
		return this._stat(fsPath);
	}

	public readFile(uri: vscode.Uri, options: vscode.FileOptions, token: vscode.CancellationToken): Uint8Array | Thenable<Uint8Array> {
		return pfs.readFile(uri.fsPath);
	}

	public writeFile(uri: vscode.Uri, content: Uint8Array, options: vscode.FileOptions, token: vscode.CancellationToken): void | Thenable<void> {
		return pfs.writeFile(uri.fsPath, content);
	}

	public async delete(uri: vscode.Uri, options: {}, token: vscode.CancellationToken): Promise<void> {
		await pfs.rimraf(uri.fsPath);
	}

	public async rename(source: vscode.Uri, target: vscode.Uri, options: vscode.FileOptions, token: vscode.CancellationToken): Promise<vscode.FileStat> {
		await pfs.rename(source.fsPath, target.fsPath);
		return this.stat(target);
	}

	public async copy(source: vscode.Uri, target: vscode.Uri, options: vscode.FileOptions, token: vscode.CancellationToken): Promise<vscode.FileStat> {
		await pfs.copy(source.fsPath, target.fsPath);
		return this.stat(target);
	}
}
