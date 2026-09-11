import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const binary = process.argv[2] ?? process.env.LLI_DB_ELECTRON_BINARY;
if (!binary) {
    throw new Error(
        'Provide an Electron executable as the first argument or LLI_DB_ELECTRON_BINARY.',
    );
}
const executable = resolve(binary);
if (!existsSync(executable)) throw new Error(`Electron executable not found: ${executable}`);

const fixture = resolve(__dirname, 'electron-smoke-app.cjs');
const result = spawnSync(executable, [fixture], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    windowsHide: true,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
if (result.status !== 0 || !result.stdout.includes('LLI_DB_ELECTRON_SMOKE_OK')) {
    throw new Error(`Electron ABI smoke failed with exit code ${result.status ?? 'unknown'}`);
}
