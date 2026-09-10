import { execFileSync } from 'node:child_process';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface IPackResult {
    filename: string;
}

const npmExecPath = process.env.npm_execpath;

const run = (args: string[], cwd: string) => {
    if (!npmExecPath) {
        throw new Error('package smoke must be launched through npm run package:smoke.');
    }
    return execFileSync(process.execPath, [npmExecPath, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
    });
};

export const runPackageSmoke = (root: string) => {
    const directory = mkdtempSync(join(tmpdir(), 'lli-db-package-smoke-'));
    const packageDirectory = join(directory, 'package');
    const cacheDirectory = join(root, 'artifacts', 'npm-smoke-cache');
    mkdirSync(packageDirectory, { recursive: true });
    mkdirSync(cacheDirectory, { recursive: true });

    try {
        const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
            devDependencies: Record<string, string>;
        };
        const packOutput = run(
            [
                'pack',
                '--ignore-scripts',
                '--json',
                '--pack-destination',
                packageDirectory,
                '--cache',
                cacheDirectory,
            ],
            root,
        );
        const packResult = JSON.parse(packOutput) as IPackResult[];
        if (!packResult[0]?.filename) throw new Error('npm pack did not return a tarball filename.');
        const tarball = join(packageDirectory, packResult[0].filename);

        writeFileSync(
            join(packageDirectory, 'package.json'),
            `${JSON.stringify({ name: 'lli-db-package-smoke', version: '1.0.0', private: true }, null, 2)}\n`,
            'utf8',
        );
        copyFileSync(
            join(root, 'scripts', 'package-smoke-runner.cjs'),
            join(packageDirectory, 'smoke.cjs'),
        );

        run(
            [
                'install',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                '--cache',
                cacheDirectory,
                tarball,
                `better-sqlite3@${packageJson.devDependencies['better-sqlite3']}`,
            ],
            packageDirectory,
        );
        run(['ls', '--omit=dev', '--all'], packageDirectory);
        const smokeOutput = execFileSync(process.execPath, ['smoke.cjs'], {
            cwd: packageDirectory,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        process.stdout.write(smokeOutput);
        return true;
    } finally {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
};

if (require.main === module) {
    try {
        runPackageSmoke(process.cwd());
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
