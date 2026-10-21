// Rebuilds the .vsix, uninstalls the installed copy (if any) and installs the new package in VS Code.
// Usage: npm run reinstall (does not run `npm run check`). In WSL / remote sessions `code` is the remote CLI, so the
// extension is installed in the remote extension host, where it runs. Then run "Developer: Reload Window".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

// On Windows `code` and `npm` are .cmd files, which need a shell
const shell = process.platform === 'win32';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit', shell });
}

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', shell });
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const extensionId = `${pkg.publisher}.${pkg.name}`;
const vsix = `${pkg.name}-${pkg.version}.vsix`;

// A failed build must not leave the previous package behind to be installed
rmSync(vsix, { force: true });
run('npm', ['run', 'package']);
if (!existsSync(vsix)) {
  throw new Error(`${vsix} was not built`);
}

const installed = output('code', ['--list-extensions'])
  .split(/\r?\n/)
  .some((id) => id.trim().toLowerCase() === extensionId.toLowerCase());
if (installed) {
  run('code', ['--uninstall-extension', extensionId]);
}
run('code', ['--install-extension', vsix, '--force']);

const version = output('code', ['--list-extensions', '--show-versions'])
  .split(/\r?\n/)
  .find((line) => line.toLowerCase().startsWith(`${extensionId.toLowerCase()}@`));
console.log(`\nInstalled ${version ?? extensionId}. Run "Developer: Reload Window" in every open window to load it.`);
