/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as path from 'path';
import URI from 'vs/base/common/uri';
import * as pfs from 'vs/base/node/pfs';
import FileWatcher from './extHostFileWatcher';
import * as files from 'vs/platform/files/common/files';
import * as vscode from 'vscode';

export default class FileSystemProvider implements vscode.FileSystemProvider {

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

	constructor(fileWatcher: FileWatcher) {
		this.onDidChangeFile = fileWatcher.onFileChange;
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		return {
			dispose: () => { }
		};
	}

	public async stat(resource: URI): Promise<vscode.FileStat> {
		return this._stat(resource.fsPath);
	}

	private async _stat(fsPath: string): Promise<vscode.FileStat> {
		let stats = await pfs.stat(fsPath);
		const fileType = (
			(stats.isFile() ? files.FileType.File : 0)
			| (stats.isDirectory() ? files.FileType.Directory : 0)
			| (stats.isSymbolicLink() ? files.FileType.SymbolicLink : 0)
		);
		return {
			type: fileType,
			ctime: stats.ctime.getTime(),
			mtime: stats.mtime.getTime(),
			size: stats.size
		};
	}

	public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		let fsPath = uri.fsPath;
		let files = await pfs.readdir(fsPath);
		let absoluteFiles = files.map(file => path.join(fsPath, file));
		let statPromises: Promise<vscode.FileStat>[] = absoluteFiles.map(file => this._stat(file));
		let stats = await Promise.all(statPromises);
		let result: [string, vscode.FileType][] = [];
		for (let i = 0; i < files.length; i++) {
			result.push([files[i], stats[i].type]);
		}
		return result;
	}

	public async createDirectory(uri: vscode.Uri): Promise<void> {
		let fsPath = uri.fsPath;
		await pfs.mkdirp(fsPath);
	}

	public readFile(uri: vscode.Uri): Thenable<Uint8Array> {
		return pfs.readFile(uri.fsPath);
	}

	public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void | Thenable<void> {
		return pfs.writeFile(uri.fsPath, content);
	}

	public async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
		await pfs.rimraf(uri.fsPath);
	}

	public async rename(source: vscode.Uri, target: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		await pfs.rename(source.fsPath, target.fsPath);
	}

	public async copy(source: vscode.Uri, target: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		await pfs.copy(source.fsPath, target.fsPath);
	}
}
