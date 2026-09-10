import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface IPackageJson {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
}

interface ILockedPackage {
    name: string;
    version: string;
    key: string;
    dependencies: Map<string, string>;
}

const unquote = (value: string) => value.replace(/^['"]|['"]$/g, '');

const parsePackageKey = (key: string) => {
    const normalized = unquote(key);
    const separator = normalized.indexOf('@', normalized.startsWith('@') ? 1 : 0);
    const name = normalized.slice(0, separator);
    const version = normalized.slice(separator + 1).split('(')[0];
    return { name, version };
};

const parseSnapshotPackages = (lockfile: string): Map<string, ILockedPackage> => {
    const packages = new Map<string, ILockedPackage>();
    const snapshotStart = lockfile.search(/^snapshots:\s*$/m);
    if (snapshotStart < 0) throw new Error('pnpm-lock.yaml has no snapshots section.');

    let current: ILockedPackage | undefined;
    let inDependencies = false;
    for (const line of lockfile.slice(snapshotStart).split(/\r?\n/).slice(1)) {
        const packageMatch = line.match(/^  (\S.+):(?: \{\})?$/);
        if (packageMatch) {
            const key = unquote(packageMatch[1]);
            const identity = parsePackageKey(key);
            current = { ...identity, key, dependencies: new Map() };
            packages.set(key, current);
            inDependencies = false;
            continue;
        }
        if (!current) continue;
        if (/^    dependencies:$/.test(line)) {
            inDependencies = true;
            continue;
        }
        if (/^    \S/.test(line)) {
            inDependencies = false;
            continue;
        }
        if (inDependencies) {
            const dependencyMatch = line.match(/^      (.+?): (.+)$/);
            if (dependencyMatch) {
                current.dependencies.set(unquote(dependencyMatch[1]), unquote(dependencyMatch[2]));
            }
        }
    }
    return packages;
};

const parseRootVersions = (lockfile: string): Map<string, string> => {
    const versions = new Map<string, string>();
    const importer = lockfile.match(/\n  \.:\r?\n([\s\S]*?)(?=\npackages:)/)?.[1];
    const dependencies = importer?.match(/    dependencies:\r?\n([\s\S]*?)(?=    devDependencies:)/)?.[1];
    if (!dependencies) throw new Error('Unable to read root production dependencies from lockfile.');

    let dependencyName: string | undefined;
    for (const line of dependencies.split(/\r?\n/)) {
        const dependencyMatch = line.match(/^      (.+):$/);
        if (dependencyMatch) dependencyName = unquote(dependencyMatch[1]);
        const versionMatch = line.match(/^        version: (.+)$/);
        if (dependencyName && versionMatch) {
            versions.set(dependencyName, unquote(versionMatch[1]));
            dependencyName = undefined;
        }
    }
    return versions;
};

const toPurl = (name: string, version: string) =>
    `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${version}`;

const findPackage = (
    packages: Map<string, ILockedPackage>,
    name: string,
    versionReference: string,
) => packages.get(`${name}@${versionReference}`);

export const createCycloneDxFromPnpmLock = (
    packageJson: IPackageJson,
    lockfile: string,
) => {
    const packages = parseSnapshotPackages(lockfile);
    const rootVersions = parseRootVersions(lockfile);
    const included = new Map<string, ILockedPackage>();
    const queue: ILockedPackage[] = [];

    for (const name of Object.keys(packageJson.dependencies ?? {})) {
        const versionReference = rootVersions.get(name);
        const lockedPackage = versionReference
            ? findPackage(packages, name, versionReference)
            : undefined;
        if (!lockedPackage) throw new Error(`Missing locked production dependency: ${name}`);
        queue.push(lockedPackage);
    }

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (included.has(current.key)) continue;
        included.set(current.key, current);
        for (const [name, versionReference] of current.dependencies) {
            const dependency = findPackage(packages, name, versionReference);
            if (!dependency) throw new Error(`Missing lock snapshot: ${name}@${versionReference}`);
            queue.push(dependency);
        }
    }

    const rootRef = toPurl(packageJson.name, packageJson.version);
    const components = [...included.values()].map((dependency) => ({
        type: 'library',
        name: dependency.name,
        version: dependency.version,
        purl: toPurl(dependency.name, dependency.version),
        'bom-ref': toPurl(dependency.name, dependency.version),
    }));
    const dependencyGraph = [...included.values()].map((dependency) => ({
        ref: toPurl(dependency.name, dependency.version),
        dependsOn: [...dependency.dependencies]
            .map(([name, version]) => findPackage(packages, name, version))
            .filter(
                (item): item is ILockedPackage => item !== undefined && included.has(item.key),
            )
            .map((item) => toPurl(item.name, item.version)),
    }));

    return {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: `urn:uuid:${randomUUID()}`,
        version: 1,
        metadata: {
            timestamp: new Date().toISOString(),
            component: {
                type: 'library',
                name: packageJson.name,
                version: packageJson.version,
                purl: rootRef,
                'bom-ref': rootRef,
            },
        },
        components,
        dependencies: [
            {
                ref: rootRef,
                dependsOn: Object.keys(packageJson.dependencies ?? {}).map((name) => {
                    const dependency = findPackage(packages, name, rootVersions.get(name) ?? '');
                    if (!dependency) throw new Error(`Missing root dependency snapshot: ${name}`);
                    return toPurl(dependency.name, dependency.version);
                }),
            },
            ...dependencyGraph,
        ],
    };
};

export const generateSbom = (root: string, output: string) => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as IPackageJson;
    const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
    const sbom = createCycloneDxFromPnpmLock(packageJson, lockfile);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
    return sbom;
};

if (require.main === module) {
    const output = join(process.cwd(), 'artifacts', 'sbom.cdx.json');
    const sbom = generateSbom(process.cwd(), output);
    console.log(`CycloneDX SBOM generated: ${output} (${sbom.components.length} components)`);
}
