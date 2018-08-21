/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const path = require('path');
const es = require('event-stream');
const util = require('./lib/util');
const common = require('./lib/optimize');
const product = require('../product.json');
const rename = require('gulp-rename');
const filter = require('gulp-filter');
const json = require('gulp-json-editor');
const _ = require('underscore');
const deps = require('./dependencies');
const ext = require('./lib/extensions');
const vfs = require('vinyl-fs');
const packageJson = require('../package.json');
const remote = require('gulp-remote-src');
const flatmap = require('gulp-flatmap');
const gunzip = require('gulp-gunzip');
const untar = require('gulp-untar');
const File = require('vinyl');

const REPO_ROOT = path.dirname(__dirname);
const commit = util.getVersion(REPO_ROOT);
const BUILD_ROOT = path.dirname(REPO_ROOT);
const REMOTE_FOLDER = path.join(REPO_ROOT, 'remote');

const productionDependencies = deps.getProductionDependencies(REMOTE_FOLDER);


// @ts-ignore
const baseModules = Object.keys(process.binding('natives')).filter(n => !/^_|\//.test(n));
const nodeModules = ['electron', 'original-fs']
	// @ts-ignore JSON checking: dependencies property is optional
	.concat(Object.keys(product.dependencies || {}))
	.concat(_.uniq(productionDependencies.map(d => d.name)))
	.concat(baseModules);

const BUNDLED_FILE_HEADER = [
	'/*!--------------------------------------------------------',
	' * Copyright (C) Microsoft Corporation. All rights reserved.',
	' *--------------------------------------------------------*/'
].join('\n');

const vscodeResources = [
	'out-build/bootstrap.js',
	'out-build/bootstrap-amd.js',
	'out-build/paths.js',
	'out-build/remoteExtensionHostAgent.js',
	'!**/test/**'
];

gulp.task('clean-optimized-vscode-reh', util.rimraf('out-vscode-reh'));
gulp.task('optimize-vscode-reh', ['clean-optimized-vscode-reh', 'compile-build', 'compile-extensions-build'], common.optimizeTask({
	src: 'out-build',
	entryPoints: [
		{
			name: 'vs/workbench/node/remoteExtensionHostAgent',
			exclude: ['vs/css', 'vs/nls']
		},
		{
			name: 'vs/workbench/node/extensionHostProcess',
			exclude: ['vs/css', 'vs/nls']
		}
	],
	otherSources: [],
	resources: vscodeResources,
	loaderConfig: common.loaderConfig(nodeModules),
	header: BUNDLED_FILE_HEADER,
	out: 'out-vscode-reh',
	bundleInfo: undefined
}));

const baseUrl = `https://ticino.blob.core.windows.net/sourcemaps/${commit}/core`;
gulp.task('clean-minified-vscode-reh', util.rimraf('out-vscode-reh-min'));
gulp.task('minify-vscode-reh', ['clean-minified-vscode-reh', 'optimize-vscode-reh'], common.minifyTask('out-vscode-reh', baseUrl));

function nodejs(arch) {
	const VERSION = `8.9.3`;
	if (process.platform === 'win32') {
		let url;
		if (arch === 'x64') {
			url = `https://nodejs.org/dist/v${VERSION}/win-x64/node.exe`;
		} else {
			url = `https://nodejs.org/dist/v${VERSION}/win-x86/node.exe`;
		}

		const options = {
			base: url,
			requestOptions: {
				gzip: true,
				headers: undefined
			}
		};

		return (
			remote('', options)
		);
	}
	if (process.platform === 'darwin' || process.platform === 'linux') {
		let url;
		if (process.platform === 'darwin') {
			url = `https://nodejs.org/dist/v${VERSION}/node-v${VERSION}-darwin-x64.tar.gz`;
		} else {
			if (arch === 'x64') {
				url = `https://nodejs.org/dist/v${VERSION}/node-v${VERSION}-linux-x64.tar.gz`;
			} else {
				url = `https://nodejs.org/dist/v${VERSION}/node-v${VERSION}-linux-x86.tar.gz`;
			}
		}
		const options = {
			base: url,
			requestOptions: {
				gzip: true,
				headers: undefined
			}
		};

		return (
			remote('', options)
				.pipe(flatmap(stream => {
					return (
						stream
							.pipe(gunzip())
							.pipe(untar())
					);
				}))
				.pipe(es.through(function (data) {
					// base comes in looking like `https:/nodejs.org/dist/v8.9.3/node-v8.9.3-darwin-x64.tar.gz`
					// => we must remove the `.tar.gz`
					// Also, keep only bin/node
					if (/\/bin\/node$/.test(data.path)) {
						//@ts-ignore
						let f = new File({
							path: data.path.replace(/bin\/node$/, 'node'),
							base: data.base.replace(/\.tar\.gz$/, ''),
							contents: data.contents,
							stat: {
								isFile: true,
								mode: /* 100755 */ 33261
							}
						});
						this.emit('data', f);
						this.emit('data', new File({
							path: 'version',
							contents: new Buffer(VERSION)
						}));
					}
				}))
		);
	}
}

function getNode(arch) {
	// arch: The current possible values are: 'arm', 'arm64', 'ia32', 'mips', 'mipsel', 'ppc', 'ppc64', 's390', 's390x', 'x32', and 'x64'.
	// platform: Currently possible values are: 'aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'
	return () => {
		return (
			nodejs(arch)
				.pipe(vfs.dest('.build/node'))
		);
	};
}

function packageTask(platform, arch, opts) {
	opts = opts || {};

	const destination = path.join(BUILD_ROOT, 'vscode-reh') + (platform ? '-' + platform : '') + (arch ? '-' + arch : '');

	return () => {
		const out = opts.minified ? 'out-vscode-reh-min' : 'out-vscode-reh';

		const src = gulp.src(out + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname.replace(new RegExp('^' + out), 'out'); }))
			.pipe(util.setExecutableBit(['**/*.sh']))
			.pipe(filter(['**', '!**/*.js.map']));

		const sources = es.merge(src, ext.packageExtensionsStream({
			desiredExtensions: ['extension-editing', 'configuration-editing', 'search-rg',
				'css-language-features', 'git', 'grunt', 'gulp', 'html-language-features',
				'json-language-features', 'markdown-language-features', 'npm',
				'php-language-features', 'typescript-language-features',
				'ms-vscode.node-debug', 'ms-vscode.node-debug2',
			]
		}));

		let version = packageJson.version;
		// @ts-ignore JSON checking: quality is optional
		const quality = product.quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;
		const packageJsonStream = gulp.src(['remote/package.json'], { base: 'remote' })
			.pipe(json({ name, version }));

		const date = new Date().toISOString();

		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			.pipe(json({ commit, date }));

		const license = gulp.src(['remote/LICENSE'], { base: 'remote' });

		const depsSrc = [
			..._.flatten(productionDependencies.map(d => path.relative(REPO_ROOT, d.path)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`])),
			// @ts-ignore JSON checking: dependencies is optional
			..._.flatten(Object.keys(product.dependencies || {}).map(d => [`node_modules/${d}/**`, `!node_modules/${d}/**/{test,tests}/**`]))
		];

		const deps = gulp.src(depsSrc, { base: 'remote', dot: true })
			.pipe(filter(['**', '!**/package-lock.json']))
			.pipe(util.cleanNodeModule('fsevents', ['binding.gyp', 'fsevents.cc', 'build/**', 'src/**', 'test/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('oniguruma', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node', 'src/*.js']))
			.pipe(util.cleanNodeModule('windows-mutex', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-keymap', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-is-elevated', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-watchdog', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('spdlog', ['binding.gyp', 'build/**', 'deps/**', 'src/**', 'test/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('jschardet', ['dist/**']))
			.pipe(util.cleanNodeModule('windows-foreground-love', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('windows-process-tree', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('gc-signals', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node', 'src/index.js']))
			.pipe(util.cleanNodeModule('keytar', ['binding.gyp', 'build/**', 'src/**', 'script/**', 'node_modules/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('node-pty', ['binding.gyp', 'build/**', 'src/**', 'tools/**'], ['build/Release/*.exe', 'build/Release/*.dll', 'build/Release/*.node']))
			.pipe(util.cleanNodeModule('vscode-nsfw', ['binding.gyp', 'build/**', 'src/**', 'openpa/**', 'includes/**'], ['**/*.node', '**/*.a']))
			.pipe(util.cleanNodeModule('vsda', ['binding.gyp', 'README.md', 'build/**', '*.bat', '*.sh', '*.cpp', '*.h'], ['build/Release/vsda.node']));

		let all = es.merge(
			packageJsonStream,
			productJsonStream,
			license,
			sources,
			deps,
			nodejs(arch)
		);

		let result = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions());

		return result.pipe(vfs.dest(destination));
	};
}

gulp.task('clean-node', util.rimraf('.build/node'));
gulp.task('node', ['clean-node'], getNode(process.arch));


gulp.task('clean-vscode-reh-win32-ia32', util.rimraf(path.join(BUILD_ROOT, 'vscode-reh-win32-ia32')));
gulp.task('clean-vscode-reh-win32-x64', util.rimraf(path.join(BUILD_ROOT, 'vscode-reh-win32-x64')));
gulp.task('clean-vscode-reh-darwin', util.rimraf(path.join(BUILD_ROOT, 'vscode-reh-darwin')));
gulp.task('clean-vscode-reh-linux-ia32', util.rimraf(path.join(BUILD_ROOT, 'vscode-reh-linux-ia32')));
gulp.task('clean-vscode-reh-linux-x64', util.rimraf(path.join(BUILD_ROOT, 'vscode-reh-linux-x64')));
gulp.task('clean-vscode-reh-linux-arm', util.rimraf(path.join(BUILD_ROOT, 'vscode-reh-linux-arm')));

gulp.task('vscode-reh-win32-ia32', ['optimize-vscode-reh', 'clean-vscode-reh-win32-ia32'], packageTask('win32', 'ia32'));
gulp.task('vscode-reh-win32-x64', ['optimize-vscode-reh', 'clean-vscode-reh-win32-x64'], packageTask('win32', 'x64'));
gulp.task('vscode-reh-darwin', ['optimize-vscode-reh', 'clean-vscode-reh-darwin'], packageTask('darwin'));
gulp.task('vscode-reh-linux-ia32', ['optimize-vscode-reh', 'clean-vscode-reh-linux-ia32'], packageTask('linux', 'ia32'));
gulp.task('vscode-reh-linux-x64', ['optimize-vscode-reh', 'clean-vscode-reh-linux-x64'], packageTask('linux', 'x64'));
gulp.task('vscode-reh-linux-arm', ['optimize-vscode-reh', 'clean-vscode-reh-linux-arm'], packageTask('linux', 'arm'));

gulp.task('vscode-reh-win32-ia32-min', ['minify-vscode-reh', 'clean-vscode-reh-win32-ia32'], packageTask('win32', 'ia32', { minified: true }));
gulp.task('vscode-reh-win32-x64-min', ['minify-vscode-reh', 'clean-vscode-reh-win32-x64'], packageTask('win32', 'x64', { minified: true }));
gulp.task('vscode-reh-darwin-min', ['minify-vscode-reh', 'clean-vscode-reh-darwin'], packageTask('darwin', null, { minified: true }));
gulp.task('vscode-reh-linux-ia32-min', ['minify-vscode-reh', 'clean-vscode-reh-linux-ia32'], packageTask('linux', 'ia32', { minified: true }));
gulp.task('vscode-reh-linux-x64-min', ['minify-vscode-reh', 'clean-vscode-reh-linux-x64'], packageTask('linux', 'x64', { minified: true }));
gulp.task('vscode-reh-linux-arm-min', ['minify-vscode-reh', 'clean-vscode-reh-linux-arm'], packageTask('linux', 'arm', { minified: true }));
