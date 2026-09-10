import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    parseConventionalCommits,
    renderVersionSection,
    updateChangelogContent,
    writeChangelogAtomically,
} from '../scripts/changelog-generator';

describe('changelog generator', () => {
    test('parses scoped and breaking conventional commits and removes duplicates', () => {
        expect(
            parseConventionalCommits([
                'feat(query): add cursor',
                'fix!: change null handling',
                'feat(query): add cursor',
                'unstructured commit',
            ]),
        ).toEqual([
            { category: '✨ 新功能', message: 'add cursor', breaking: false },
            { category: '🐞 修复问题', message: 'change null handling', breaking: true },
        ]);
    });

    test('replaces an existing version section idempotently', () => {
        const original = '# Changelog\n\n## Unreleased\n\n- pending\n\n## 1.0.0\n\n- old\n';
        const subjects = ['fix(database): preserve transactions'];
        const first = updateChangelogContent(original, '1.0.0', subjects);
        const second = updateChangelogContent(first, '1.0.0', subjects);

        expect(second).toBe(first);
        expect(first.match(/^## 1\.0\.0$/gm)).toHaveLength(1);
        expect(first).not.toContain('- old');
        expect(first).toContain('- preserve transactions');
    });

    test('rejects invalid versions or empty conventional history before writing', () => {
        expect(() => renderVersionSection('next', ['fix: valid subject'])).toThrow(
            'Invalid release version',
        );
        expect(() => renderVersionSection('1.0.0', ['unstructured commit'])).toThrow(
            'No conventional commits found',
        );
    });

    test('atomically replaces the target and removes its temporary file', () => {
        const directory = mkdtempSync(join(tmpdir(), 'lli-db-changelog-'));
        const changelog = join(directory, 'CHANGELOG.md');
        writeFileSync(changelog, '# Changelog\n\n## Unreleased\n', 'utf8');

        try {
            writeChangelogAtomically(changelog, '1.2.3', ['feat: stable release notes']);
            expect(readFileSync(changelog, 'utf8')).toContain('## 1.2.3');
            expect(existsSync(join(directory, `.CHANGELOG.md.${process.pid}.tmp`))).toBe(false);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('leaves the original file untouched when generation validation fails', () => {
        const directory = mkdtempSync(join(tmpdir(), 'lli-db-changelog-failure-'));
        const changelog = join(directory, 'CHANGELOG.md');
        const original = '# Changelog\n\n## Unreleased\n\n- keep this\n';
        writeFileSync(changelog, original, 'utf8');

        try {
            expect(() =>
                writeChangelogAtomically(changelog, '1.2.3', ['unstructured commit']),
            ).toThrow('No conventional commits found');
            expect(readFileSync(changelog, 'utf8')).toBe(original);
            expect(existsSync(join(directory, `.CHANGELOG.md.${process.pid}.tmp`))).toBe(false);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
