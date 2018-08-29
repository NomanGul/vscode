/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

let _minimist = require('minimist');
let _fs = require('fs');
let _path = require('path');
let _url = require('url');
let _cp = require('child_process');

const options = [
	{ id: 'diff', type: 'boolean', cat: 'o', alias: 'd', args: ['file', 'file'], description: localize('diff', "Compare two files with each other.") },
	{ id: 'add', type: 'boolean', cat: 'o', alias: 'a', args: 'folder', description: localize('add', "Add folder(s) to the last active window.") },
	{ id: 'goto', type: 'boolean', cat: 'o', alias: 'g', args: 'file:line[:character]', description: localize('goto', "Open a file at the path on the specified line and character position.") },
	{ id: 'new-window', type: 'boolean', cat: 'o', alias: 'n', description: localize('newWindow', "Force to open a new window.") },
	{ id: 'reuse-window', type: 'boolean', cat: 'o', alias: 'r', description: localize('reuseWindow', "Force to open a file or folder in an already opened window.") },
	{ id: 'wait', type: 'boolean', cat: 'o', alias: 'w', description: localize('wait', "Wait for the files to be closed before returning.") },
	{ id: 'locale', type: 'string', cat: 'o', args: 'locale', description: localize('locale', "The locale to use (e.g. en-US or zh-TW).") },
	{ id: 'user-data-dir', type: 'string', unsupported: true, cat: 'o', args: 'dir', description: localize('userDataDir', "Specifies the directory that user data is kept in. Can be used to open multiple distinct instances of Code.") },
	{ id: 'version', type: 'boolean', cat: 'o', alias: 'v', description: localize('version', "Print version.") },
	{ id: 'help', type: 'boolean', cat: 'o', alias: 'h', description: localize('help', "Print usage.") },
	{ id: 'folder-uri', type: 'string', cat: 'o', args: 'uri', description: localize('folderUri', "Opens a window with given folder uri(s)") },
	{ id: 'file-uri', type: 'string', cat: 'o', args: 'uri', description: localize('fileUri', "Opens a window with given file uri(s)") },

	{ id: 'extensions-dir', type: 'string', cat: 'e', args: 'dir', unsupported: true, description: localize('extensionHomePath', "Set the root path for extensions.") },
	{ id: 'list-extensions', type: 'boolean', cat: 'e', description: localize('listExtensions', "List the installed extensions.") },
	{ id: 'show-versions', type: 'boolean', cat: 'e', description: localize('showVersions', "Show versions of installed extensions, when using --list-extension.") },
	{ id: 'install-extension', type: 'string', cat: 'e', args: 'extension-id', description: localize('installExtension', "Installs an extension.") },
	{ id: 'uninstall-extension', type: 'string', cat: 'e', args: 'extension-id', description: localize('uninstallExtension', "Uninstalls an extension.") },
	{ id: 'enable-proposed-api', type: 'string', cat: 'e', args: 'extension-id', description: localize('experimentalApis', "Enables proposed API features for extensions. Can receive one or more extension IDs to enable individually.") },

	{ id: 'verbose', type: 'boolean', cat: 't', description: localize('verbose', "Print verbose output (implies --wait).") },
	{ id: 'log', type: 'string', cat: 't', args: 'level', description: localize('log', "Log level to use. Default is 'info'. Allowed values are 'critical', 'error', 'warn', 'info', 'debug', 'trace', 'off'.") },
	{ id: 'status', type: 'boolean', alias: 's', cat: 't', description: localize('status', "Print process usage and diagnostics information.") },
	{ id: 'performance', type: 'boolean', alias: 'p', cat: 't', description: localize('performance', "Start with the 'Developer: Startup Performance' command enabled.") },
	{ id: 'prof-startup', type: 'boolean', cat: 't', description: localize('prof-startup', "Run CPU profiler during startup") },
	{ id: 'disable-extensions', type: 'boolean', cat: 't', description: localize('disableExtensions', "Disable all installed extensions.") },
	{ id: 'disable-extension', type: 'string', cat: 't', args: 'extension-id', description: localize('disableExtension', "Disable an extension.") },
	{ id: 'inspect-extensions', type: 'string', cat: 't', description: localize('inspect-extensions', "Allow debugging and profiling of extensions. Check the developer tools for the connection URI.") },
	{ id: 'inspect-brk-search', type: 'string', cat: 't', description: localize('inspect-brk-extensions', "Allow debugging and profiling of extensions with the extension host being paused after start. Check the developer tools for the connection URI.") },
	{ id: 'disable-gpu', type: 'boolean', cat: 't', description: localize('disableGPU', "Disable GPU hardware acceleration.") },
	{ id: 'upload-logs', type: 'string', cat: 't', description: localize('uploadLogs', "Uploads logs from current session to a secure endpoint.") },
	{ id: 'max-memory', type: 'boolean', cat: 't', description: localize('maxMemory', "Max memory size for a window (in Mbytes).") },

	{ id: 'extensionDevelopmentPath', type: 'string' },
	{ id: 'extensionTestsPath', type: 'string' },
	{ id: 'debugId', type: 'string' },
	{ id: 'inspect-search', type: 'string' },
	{ id: 'inspect-brk-extensions', type: 'string' },
	{ id: 'export-default-configuration', type: 'string', unsupported: true },
	{ id: 'install-source', type: 'string', unsupported: true },
	{ id: 'driver', type: 'string', unsupported: true },
	{ id: 'logExtensionHostCommunication', type: 'boolean' },
	{ id: 'skip-getting-started', type: 'boolean' },
	{ id: 'skip-release-notes', type: 'boolean' },
	{ id: 'sticky-quickopen', type: 'boolean' },
	{ id: 'disable-restore-windows', type: 'boolean' },
	{ id: 'disable-telemetry', type: 'boolean' },
	{ id: 'disable-updates', type: 'boolean' },
	{ id: 'disable-crash-reporter', type: 'boolean' },
	{ id: 'skip-add-to-recently-opened', type: 'boolean' },
	{ id: 'unity-launch', type: 'boolean' },
	{ id: 'open-url', type: 'boolean' },
	{ id: 'nolazy', type: 'boolean' },
	{ id: 'issue', type: 'boolean' },
	{ id: 'file-write', type: 'boolean' },
	{ id: 'file-chmod', type: 'boolean' },
	{ id: 'driver-verbose', type: 'boolean' },
];

const minimistOptions = {
	string: options.filter(o => !o.unsupported && o.type === 'string').map(o => o.id),
	boolean: options.filter(o => !o.unsupported && o.type === 'boolean').map(o => o.id),
	alias: {}
};

const aliases = {};
const unsupported = {};
for (let o of options) {
	if (o.alias) {
		minimistOptions[o.id] = o.alias;
		aliases[o.alias] = true;
	}
	if (o.unsupported) {
		unsupported[o.id] = true;
	}
}

function main(args, wslExecutable, vsCodeWinExecutable) {
	var parsedArgs = _minimist(args, minimistOptions);

	if (parsedArgs['help']) {
		printHelp(wslExecutable);
		return;
	}

	if (parsedArgs['extensionDevelopmentPath']) {
		parsedArgs['extensionDevelopmentPath'] = mapFileUri(pathToURI(parsedArgs['extensionDevelopmentPath']).href);
	}

	let folderURIs = toArray(parsedArgs['folder-uri']).map(mapFileUri);
	parsedArgs['folder-uri'] = folderURIs;

	let fileURIs = toArray(parsedArgs['file-uri']).map(mapFileUri);
	parsedArgs['file-uri'] = fileURIs;

	let inputPaths = toArray(parsedArgs['_']);
	for (let input of inputPaths) {
		translatePath(input, folderURIs, fileURIs);
	}
	let newCommandline = [];
	for (let key in parsedArgs) {
		if (key == '_' || aliases[key]) {
			continue;
		}
		if (unsupported[key]) {
			console.log(`Ignoring option ${key}: not supported for code in wsl`);
			continue;
		}
		let val = parsedArgs[key];
		if (typeof val === 'boolean') {
			if (val) {
				newCommandline.push('--' + key);
			}
		} else if (Array.isArray(val)) {
			for (let entry of val) {
				newCommandline.push('--' + key);
				newCommandline.push(entry.toString());
			}
		} else if (val) {
			newCommandline.push('--' + key);
			newCommandline.push(val.toString());
		}
	}

	const ext = _path.extname(vsCodeWinExecutable);
	if (ext === '.bat' || ext === '.cmd') {
		if (parsedArgs['verbose']) {
			console.log(`Invoking: cmd.exe /C ${vsCodeWinExecutable} ${newCommandline.join(' ')}`);
		}
		_cp.spawn("cmd.exe", ["/C", vsCodeWinExecutable, ...newCommandline], {
			stdio: 'inherit'
		});
	} else {
		if (parsedArgs['verbose']) {
			console.log(`Invoking: ${vsCodeWinExecutable} ${newCommandline.join(' ')}`);
		}
		_cp.spawn(vsCodeWinExecutable, newCommandline, {
			stdio: 'inherit'
		});
	}
}

function pathToURI(input) {
	input = input.trim();
	input = _path.resolve(input);
	return new _url.URL('file:///' + input);
}

function translatePath(input, folderURIS, fileURIS) {
	input = input.trim();
	input = _path.resolve(input);
	let url = new _url.URL('file:///' + input);
	let mappedUri = mapFileUri(url.href);
	try {
		let stat = _fs.lstatSync(input);
		if (stat.isFile()) {
			fileURIS.push(mappedUri);
		} else {
			folderURIS.push(mappedUri);
		}
	} catch (e) {
		if (e.code == 'ENOENT') {
			fileURIS.push(mappedUri);
		} else {
			console.log(`Problem accessing file ${input}. Ignoring file`, e);
		}
		return null;
	}
}

function toArray(items) {
	if (!items) {
		return [];
	}
	if (!Array.isArray(items)) {
		return [items];
	}
	return items;
}

function mapFileUri(uri) {
	return uri.replace(/^file:\/\//, "vscode-remote://wsl+default");
}

function localize(key, value) {
	return value;
}

function formatUsage(option) {
	let args = '';
	if (option.args) {
		if (Array.isArray(option.args)) {
			args = ` <${option.args.join('> <')}>`;
		} else {
			args = ` <${option.args}>`;
		}
	}
	if (option.alias) {
		return `-${option.alias} --${option.id}${args}`;
	}
	return `--${option.id}${args}`;
}

function formatOptions(category, columns) {
	let docOptions = options.filter(o => !!o.description && !o.unsupported && o.cat === category);
	let usageTexts = docOptions.map(formatUsage);

	let argLength = Math.max.apply(null, usageTexts.map(k => k.length)) + 2/*left padding*/ + 1/*right padding*/;
	if (columns - argLength < 25) {
		// Use a condensed version on narrow terminals
		return docOptions.reduce((r, o, i) => r.concat([`  ${usageTexts[i]}`, `      ${options[o.description]}`]), []).join('\n');
	}
	let descriptionColumns = columns - argLength - 1;
	let result = '';
	docOptions.forEach((o, i) => {
		let usage = usageTexts[i];
		let wrappedDescription = wrapText(o.description, descriptionColumns);
		let keyPadding = ' '.repeat(argLength - usage.length - 2/*left padding*/);
		if (result.length > 0) {
			result += '\n';
		}
		result += '  ' + usage + keyPadding + wrappedDescription[0];
		for (let i = 1; i < wrappedDescription.length; i++) {
			result += '\n' + ' '.repeat(argLength) + wrappedDescription[i];
		}
	});
	return result;
}

function wrapText(text, columns) {
	let lines = [];
	while (text.length) {
		let index = text.length < columns ? text.length : text.lastIndexOf(' ', columns);
		let line = text.slice(0, index).trim();
		text = text.slice(index);
		lines.push(line);
	}
	return lines;
}

function printHelp(wslExecutable) {
	const columns = (process.stdout).isTTY ? (process.stdout).columns : 80;
	let executable = _path.basename(wslExecutable);

	console.log(`
${ localize('usage', "Usage")}: ${executable} [${localize('options', "options")}] [${localize('paths', 'paths')}...]

${ localize('optionsUpperCase', "Options")}:
${formatOptions('o', columns)}

${ localize('extensionsManagement', "Extensions Management")}:
${formatOptions('e', columns)}

${ localize('troubleshooting', "Troubleshooting")}:
${formatOptions('t', columns)}`
	);
}

let [, , wslExecutable, vsCodeWinExecutable, ...args] = process.argv;
main(args, wslExecutable, vsCodeWinExecutable);