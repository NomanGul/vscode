/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as fs from 'fs';
import * as path from 'path';

import URI from 'vs/base/common/uri';
import { IStat, FileType } from 'vs/platform/files/common/files';

import * as vscode from 'vscode';

export default class FileSystemProvider implements vscode.FileSystemProvider {
	constructor() {
	}

	private asFileSystemStat(stat: fs.Stats): IStat {
		return {
			id: stat.ino,
			mtime: stat.mtime.getTime(),
			size: stat.size,
			type: stat.isDirectory() ? FileType.Dir : stat.isFile() ? FileType.File : FileType.Symlink
		};
	}

	public utimes(resource: URI, mtime: number, atime: number): Promise<IStat> {
		let fsPath = resource.fsPath;
		return new Promise<IStat>((_resolve, reject) => {
			fs.utimes(fsPath, atime, mtime, (err) => {
				if (err) {
					reject(err);
					return;
				}
			});
		}).then(() => {
			return this.stat(resource);
		});
	}

	public async stat(resource: URI): Promise<IStat> {
		return this._stat(resource.fsPath);
	}

	public async _stat(fsPath: string): Promise<IStat> {
		let stats = await this.fsStat(fsPath);
		return this.asFileSystemStat(stats);
	}

	public async read(resource: URI, offset: number, length: number, progress: vscode.Progress<Uint8Array>): Promise<number> {
		let fsPath = resource.fsPath;
		let totalLength = length !== void 0 ? length : void 0;
		if (totalLength === 0) {
			return 0;
		}
		// Sometime toRead is -1 indicating to read until
		// the end of the file.
		if (totalLength <= 0) {
			totalLength = undefined;
		}
		let position = offset !== void 0 ? offset : 0;
		let bufferSize = totalLength !== void 0 && totalLength < 65536 ? totalLength : 65536;
		let buffer: Buffer = new Buffer(bufferSize);

		let totalRead: number = 0;
		let fd: number | undefined;
		try {
			fd = await this.fsopen(fsPath, 'r');
			let bytesRead: number;
			do {
				let length = totalLength === void 0 ? bufferSize : Math.min(bufferSize, totalLength - totalRead);
				[bytesRead,] = await this.fsread(fd, buffer, 0, length, position + totalRead);
				if (bytesRead > 0) {
					progress.report(new Uint8Array(bytesRead === bufferSize ? buffer : buffer.slice(0, bytesRead)));
					totalRead += bytesRead;
				}
			} while (bytesRead > 0 && (totalLength === void 0 ? true : totalRead < totalLength));
		} finally {
			if (fd !== void 0) {
				await this.fsclose(fd);
			}
		}
		return totalRead;
	}

	public async write(resource: URI, content: Uint8Array): Promise<void> {
		let fsPath = resource.fsPath;
		let buffer = Buffer.from(content);

		let fd: number | undefined;
		let totalWritten: number = 0;
		try {
			fd = await this.fsopen(fsPath, 'w');
			let written: number;
			do {
				[written,] = await this.fswrite(fd, buffer, totalWritten, content.length - totalWritten, totalWritten);
				totalWritten += written;
			} while (totalWritten < content.length);
		} finally {
			if (fd !== void 0) {
				await this.fsclose(fd);
			}
		}
	}

	public async readdir(resource: URI): Promise<[URI, IStat][]> {
		let fsPath = resource.fsPath;
		let files = await this.fsreaddir(fsPath);
		files = files.map(file => path.join(fsPath, file));
		let statPromises: Promise<IStat>[] = files.map(file => this._stat(file));
		let stats = await Promise.all(statPromises);
		let result: [URI, IStat][] = [];
		for (let i = 0; i < files.length; i++) {
			result.push([URI.file(files[i]), stats[i]]);
		}
		return result;
	}

	public async unlink(resource: URI): Promise<void> {
		let fsPath = resource.fsPath;
		return this.fsunlink(fsPath);
	}

	public async mkdir(resource: URI): Promise<IStat> {
		let fsPath = resource.fsPath;
		await this.fsmkdir(fsPath);
		return this._stat(fsPath);
	}

	public async rmdir(resource: URI): Promise<void> {
		return this.fsrmdir(resource.fsPath);
	}

	public async move(resource: URI, target: URI): Promise<IStat> {
		await this.fsrename(resource.fsPath, target.fsPath);
		return this._stat(target.fsPath);
	}

	private fsStat(path: string): Promise<fs.Stats> {
		return new Promise<fs.Stats>((resolve, reject) => {
			fs.stat(path, (err, stat) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(stat);
			});
		});
	}

	private fsopen(path: string, flags: string): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			fs.open(path, flags, (err, fd) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(fd);
			});
		});
	}

	private fsread(fd: number, buffer: Buffer, offset: number, length: number, position: number): Promise<[number, Buffer]> {
		return new Promise<[number, Buffer]>((resolve, reject) => {
			fs.read(fd, buffer, offset, length, position, (err, bytesRead, buffer) => {
				if (err) {
					reject(err);
					return;
				}
				resolve([bytesRead, buffer]);
			});
		});
	}

	private fswrite(fd: number, buffer: Buffer, offset: number, length: number, position: number): Promise<[number, Buffer]> {
		return new Promise<[number, Buffer]>((resolve, reject) => {
			fs.write(fd, buffer, offset, length, position, (err, written, buffer) => {
				if (err) {
					reject(err);
					return;
				}
				resolve([written, buffer]);
			});
		});
	}

	private fsclose(fd: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.close(fd, (err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}

	private fsunlink(path: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.unlink(path, (err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}

	private fsreaddir(path: string): Promise<string[]> {
		return new Promise<string[]>((resolve, reject) => {
			fs.readdir(path, (err, files) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(files);
			});
		});
	}

	private fsmkdir(path: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.mkdir(path, (err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}

	private fsrmdir(path: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.rmdir(path, (err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}

	private fsrename(oldPath: string, newPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			fs.rename(oldPath, newPath, (err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}
}
