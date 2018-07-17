/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as azure from 'azure-storage';
import * as minimist from 'minimist';

interface Options {
	'commit': string;
	'upload': string;
	'download': string;
}

function getBlobService(): azure.BlobService {
	const storageAccount = process.env['AZURE_STORAGE_ACCOUNT_2'];

	return azure.createBlobService(storageAccount, process.env['AZURE_STORAGE_ACCESS_KEY_2'])
		.withFilter(new azure.ExponentialRetryPolicyFilter(20));
}

async function assertContainer(blobService: azure.BlobService, container: string): Promise<void> {
	await new Promise((c, e) => blobService.createContainerIfNotExists(container, { publicAccessLevel: 'blob' }, err => err ? e(err) : c()));
}

async function uploadBlob(blobService: azure.BlobService, container: string, name: string, file: string): Promise<void> {
	const blobOptions: azure.BlobService.CreateBlockBlobRequestOptions = {
		contentSettings: {
			contentType: 'application/gzip',
			cacheControl: 'max-age=31536000, public'
		}
	};

	await new Promise((c, e) => blobService.createBlockBlobFromLocalFile(container, name, file, blobOptions, err => err ? e(err) : c()));
}

async function upload(commit: string, file: string): Promise<void> {
	const blobService = getBlobService();
	await assertContainer(blobService, 'wsl');
	await uploadBlob(blobService, 'wsl', `${commit}/VSCode-wsl-x64.tar.gz`, file);

	console.log(`Uploaded '${commit}/VSCode-wsl-x64.tar.gz' from: ${file}`);
}

async function downloadBlob(blobService: azure.BlobService, container: string, name: string, file: string): Promise<void> {
	await new Promise((c, e) => blobService.getBlobToLocalFile(container, name, file, err => err ? e(err) : c()));
}

async function download(commit: string, file: string): Promise<void> {
	const blobService = getBlobService();
	await assertContainer(blobService, 'wsl');

	let retries = 0;
	while (retries < 180) { // wait for 30 minutes MAX
		try {
			await downloadBlob(blobService, 'wsl', `${commit}/VSCode-wsl-x64.tar.gz`, file);
		} catch (err) {
			if (err.code !== 'NotFound') {
				throw err;
			}

			retries++;
			console.warn(`Not found: ${commit}/VSCode-wsl-x64.tar.gz. Retrying in 10 seconds...`);
			await new Promise(c => setTimeout(c, 10 * 1000)); // 10 seconds
		}
	}

	console.log(`Downloaded '${commit}/VSCode-wsl-x64.tar.gz' to: ${file}`);
}

async function main(args: string[]): Promise<void> {
	const opts = minimist<Options>(args, {
		string: ['commit', 'upload', 'download']
	});

	if (!opts.commit) {
		throw 'Missing commit';
	}

	if (opts.upload) {
		await upload(opts.commit, opts.upload);
	} else if (opts.download) {
		await download(opts.commit, opts.download);
	} else {
		throw 'Invalid usage';
	}
}

main(process.argv.slice(2))
	.then(() => process.exit(0))
	.catch(err => { console.error('wsl.js:', err); process.exit(1); });
