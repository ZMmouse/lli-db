import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface IReleasePackageJson {
    name?: string;
    version?: string;
    private?: boolean;
    files?: string[];
    repository?: { url?: string };
    publishConfig?: {
        access?: string;
        provenance?: boolean;
        registry?: string;
    };
}

export const validateReleaseMetadata = (packageJson: IReleasePackageJson): string[] => {
    const errors: string[] = [];
    if (!packageJson.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
        errors.push('package.json version must be a valid SemVer value.');
    }
    if (packageJson.private === true) errors.push('package.json must not be private.');
    for (const requiredFile of ['dist', 'LICENSE', 'NOTICE', 'CHANGELOG.md']) {
        if (!packageJson.files?.includes(requiredFile)) {
            errors.push(`package.json files must include ${requiredFile}.`);
        }
    }
    if (packageJson.publishConfig?.access !== 'public') {
        errors.push('publishConfig.access must be public.');
    }
    if (packageJson.publishConfig?.provenance !== true) {
        errors.push('publishConfig.provenance must be true.');
    }
    if (packageJson.publishConfig?.registry !== 'https://registry.npmjs.org/') {
        errors.push('publishConfig.registry must target the public npm registry.');
    }
    if (!packageJson.repository?.url) errors.push('package.json repository.url is required.');
    return errors;
};

export const validateReleaseTag = (version: string, tags: string[]): string[] =>
    tags.includes(`v${version}`) ? [] : [`HEAD must have the exact tag v${version}.`];

export const validateProvenanceEnvironment = (
    repositoryUrl: string,
    environment: NodeJS.ProcessEnv,
): string[] => {
    if (environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_REPOSITORY) {
        return repositoryUrl.toLowerCase().includes(
            `github.com/${environment.GITHUB_REPOSITORY.toLowerCase()}`,
        )
            ? []
            : ['package.json repository must match GITHUB_REPOSITORY for npm provenance.'];
    }
    if (environment.GITLAB_CI === 'true' && environment.CI_PROJECT_URL) {
        return repositoryUrl.toLowerCase().includes(environment.CI_PROJECT_URL.toLowerCase())
            ? []
            : ['package.json repository must match CI_PROJECT_URL for npm provenance.'];
    }
    return ['Strict release requires a supported GitHub Actions or GitLab CI provenance runner.'];
};

const runGit = (root: string, args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export const runReleaseCheck = (root: string, metadataOnly = false): void => {
    const packageJson = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
    ) as IReleasePackageJson;
    const errors = validateReleaseMetadata(packageJson);

    for (const file of ['LICENSE', 'NOTICE', 'CHANGELOG.md']) {
        if (!existsSync(join(root, file))) errors.push(`${file} is missing.`);
    }

    if (!metadataOnly && packageJson.version) {
        const tags = runGit(root, ['tag', '--points-at', 'HEAD'])
            .split(/\r?\n/)
            .filter(Boolean);
        errors.push(...validateReleaseTag(packageJson.version, tags));
        if (runGit(root, ['status', '--porcelain'])) {
            errors.push('Release worktree must be clean, including untracked files.');
        }
        const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
        if (!changelog.includes(`## ${packageJson.version}`)) {
            errors.push(`CHANGELOG.md must contain a "## ${packageJson.version}" section.`);
        }
        errors.push(
            ...validateProvenanceEnvironment(packageJson.repository?.url ?? '', process.env),
        );
    }

    if (errors.length > 0) {
        throw new Error(`Release check failed:\n- ${errors.join('\n- ')}`);
    }
};

if (require.main === module) {
    const metadataOnly = process.argv.includes('--metadata-only');
    try {
        runReleaseCheck(process.cwd(), metadataOnly);
        console.log(metadataOnly ? 'Release metadata check passed.' : 'Strict release check passed.');
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
