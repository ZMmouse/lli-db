import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const categoryByType = {
    feat: '✨ 新功能',
    fix: '🐞 修复问题',
    perf: '⚡ 性能优化',
    refactor: '♻️ 重构优化',
    docs: '📚 文档变更',
    test: '✅ 测试',
    build: '📦 构建与发布',
    ci: '👷 持续集成',
    chore: '🔧 其他修改',
} as const;

type ChangelogCategory = (typeof categoryByType)[keyof typeof categoryByType] | '📦 其他';

export interface IChangelogEntry {
    category: ChangelogCategory;
    message: string;
    breaking: boolean;
}

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const parseConventionalCommits = (subjects: string[]): IChangelogEntry[] => {
    const entries: IChangelogEntry[] = [];
    const seen = new Set<string>();

    for (const subject of subjects) {
        const match = subject.match(/^([a-z]+)(?:\([^)]+\))?(!)?:\s+(.+)$/i);
        if (!match) continue;
        const [, rawType, breakingMarker, rawMessage] = match;
        const message = rawMessage.trim();
        if (!message) continue;
        const type = rawType.toLowerCase();
        const category = categoryByType[type as keyof typeof categoryByType] ?? '📦 其他';
        const key = `${category}:${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ category, message, breaking: Boolean(breakingMarker) });
    }
    return entries;
};

export const renderVersionSection = (version: string, subjects: string[]): string => {
    if (!versionPattern.test(version)) throw new Error(`Invalid release version: ${version}`);
    const entries = parseConventionalCommits(subjects);
    if (entries.length === 0) {
        throw new Error('No conventional commits found; CHANGELOG was not modified.');
    }

    const grouped = new Map<ChangelogCategory, IChangelogEntry[]>();
    for (const entry of entries) {
        const values = grouped.get(entry.category) ?? [];
        values.push(entry);
        grouped.set(entry.category, values);
    }

    const lines = [`## ${version}`, ''];
    for (const [category, values] of grouped) {
        lines.push(`### ${category}`, '');
        for (const entry of values) {
            lines.push(`- ${entry.breaking ? '**BREAKING:** ' : ''}${entry.message}`);
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd();
};

export const updateChangelogContent = (
    current: string,
    version: string,
    subjects: string[],
): string => {
    const section = renderVersionSection(version, subjects);
    const normalized = current.replace(/\r\n/g, '\n').trimEnd();
    const heading = `## ${version}`;
    const lines = normalized.split('\n');
    const start = lines.findIndex((line) => line.trim() === heading);

    if (start >= 0) {
        let end = lines.length;
        for (let index = start + 1; index < lines.length; index += 1) {
            if (/^##\s+/.test(lines[index])) {
                end = index;
                break;
            }
        }
        return `${[...lines.slice(0, start), section, ...lines.slice(end)].join('\n').trimEnd()}\n`;
    }

    const unreleasedIndex = normalized.indexOf('\n## Unreleased');
    if (unreleasedIndex >= 0) {
        const nextHeading = normalized.indexOf('\n## ', unreleasedIndex + '\n## Unreleased'.length);
        if (nextHeading >= 0) {
            return `${normalized.slice(0, nextHeading).trimEnd()}\n\n${section}\n\n${normalized
                .slice(nextHeading)
                .trimStart()}\n`;
        }
    }
    return `${normalized}\n\n${section}\n`;
};

export const writeChangelogAtomically = (
    path: string,
    version: string,
    subjects: string[],
): void => {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '# Changelog\n';
    const next = updateChangelogContent(current, version, subjects);
    const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);

    try {
        writeFileSync(temporaryPath, next, 'utf8');
        const verified = readFileSync(temporaryPath, 'utf8');
        if (verified !== next || !verified.includes(`## ${version}`)) {
            throw new Error('Temporary CHANGELOG verification failed.');
        }
        renameSync(temporaryPath, path);
    } finally {
        rmSync(temporaryPath, { force: true });
    }
};

const git = (root: string, args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export const getReleaseCommitSubjects = (root: string, version: string): string[] => {
    const tags = git(root, ['tag', '--list', '--sort=-version:refname'])
        .split(/\r?\n/)
        .filter(Boolean);
    const currentTag = `v${version}`;
    const previousTag = tags.find((tag) => tag !== currentTag);
    const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
    return git(root, ['log', range, '--pretty=format:%s'])
        .split(/\r?\n/)
        .filter(Boolean);
};

const readArgument = (name: string) => {
    const prefix = `--${name}=`;
    return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

if (require.main === module) {
    try {
        const root = process.cwd();
        const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
            version: string;
        };
        const version = readArgument('version') ?? packageJson.version;
        const subjects = getReleaseCommitSubjects(root, version);
        writeChangelogAtomically(join(root, 'CHANGELOG.md'), version, subjects);
        console.log(`CHANGELOG.md updated atomically for ${version}.`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
