import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCycloneDxFromPnpmLock } from '../scripts/generate-sbom';
import {
    validateProvenanceEnvironment,
    validateReleaseMetadata,
    validateReleaseTag,
} from '../scripts/release-check';

const root = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('release supply-chain controls', () => {
    test('release metadata requires public npm provenance and legal package files', () => {
        expect(validateReleaseMetadata(packageJson)).toEqual([]);
        expect(packageJson.scripts).toMatchObject({
            sbom: expect.any(String),
            'package:smoke': expect.any(String),
            'security:scan': expect.any(String),
            'security:scan:history': expect.any(String),
            'release:check': expect.any(String),
            'release:verify': expect.any(String),
            prepublishOnly: 'npm run release:check',
        });
        expect(packageJson.files).toEqual(
            expect.arrayContaining(['dist', 'LICENSE', 'NOTICE', 'CHANGELOG.md']),
        );
        expect(packageJson.dependencies.tslib).toBe('^2.8.1');
        expect(packageJson.devDependencies.tslib).toBeUndefined();
        expect(packageJson.peerDependencies['better-sqlite3']).toBe('^12.5.0');
        expect(packageJson.peerDependenciesMeta['better-sqlite3']).toEqual({ optional: true });
        expect(packageJson.devDependencies['napi-postinstall']).toBe('0.3.2');
    });

    test('release tag must exactly match the package version', () => {
        expect(validateReleaseTag('1.2.3', ['v1.2.3'])).toEqual([]);
        expect(validateReleaseTag('1.2.3', ['1.2.3', 'v1.2.2'])).toEqual([
            'HEAD must have the exact tag v1.2.3.',
        ]);
    });

    test('provenance requires a supported CI repository matching package metadata', () => {
        const repository = 'git+https://github.com/example/lli-db.git';
        expect(
            validateProvenanceEnvironment(repository, {
                GITHUB_ACTIONS: 'true',
                GITHUB_REPOSITORY: 'example/lli-db',
            }),
        ).toEqual([]);
        expect(validateProvenanceEnvironment(repository, {})).toHaveLength(1);
        expect(
            validateProvenanceEnvironment(repository, {
                GITHUB_ACTIONS: 'true',
                GITHUB_REPOSITORY: 'other/lli-db',
            }),
        ).toHaveLength(1);
    });

    test('CycloneDX SBOM contains the root and complete locked production graph', () => {
        const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
        const sbom = createCycloneDxFromPnpmLock(packageJson, lockfile);
        const componentNames = sbom.components.map((component) => component.name);

        expect(sbom).toMatchObject({
            bomFormat: 'CycloneDX',
            specVersion: '1.5',
            metadata: {
                component: { name: '@llii/db', version: packageJson.version },
            },
        });
        expect(componentNames).toEqual(
            expect.arrayContaining(['dayjs', 'knex', 'lodash', 'tslib', 'uuid', 'tarn']),
        );
        expect(componentNames).not.toContain('jest');
        expect(sbom.dependencies[0].dependsOn).toHaveLength(
            Object.keys(packageJson.dependencies).length,
        );
    });

    test('GitHub workflows enforce CI and tokenless trusted publishing', () => {
        const ciWorkflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
        const publishWorkflow = readFileSync(
            join(root, '.github', 'workflows', 'publish.yml'),
            'utf8',
        );

        expect(ciWorkflow).toContain('pnpm install --frozen-lockfile');
        expect(ciWorkflow).toContain('runtime: node@22');
        expect(ciWorkflow).toContain('npm run package:smoke');
        expect(ciWorkflow).toContain('npm run security:scan');
        expect(publishWorkflow).toContain('id-token: write');
        expect(publishWorkflow).toContain('environment: npm');
        expect(publishWorkflow).toContain('runtime: node@22');
        expect(publishWorkflow).toContain('workflow_dispatch:');
        expect(publishWorkflow).toContain('ref: ${{ inputs.tag || github.ref }}');
        expect(publishWorkflow).toContain('npm install --global npm@11.19.1');
        expect(publishWorkflow).toContain('npm run release:verify');
        expect(publishWorkflow).toContain('npm publish --access public');
        expect(publishWorkflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/);
        expect(`${ciWorkflow}\n${publishWorkflow}`).not.toMatch(
            /^\s*uses:\s*[^\s#]+@(?![a-f0-9]{40}(?:\s|$))/m,
        );
    });
});
