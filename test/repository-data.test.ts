import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(__dirname, '..');
const databaseFilePattern = /\.(?:db|db3|s3db|sqlite|sqlite3)(?:-(?:journal|shm|wal))?$/i;
const databaseFileAllowlist = new Set<string>();

describe('repository data hygiene', () => {
    test('does not track database snapshots or SQLite sidecar files', () => {
        const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
            cwd: root,
            encoding: 'utf8',
        })
            .split('\0')
            .filter(Boolean);

        const unexpectedDatabaseFiles = trackedFiles.filter((file) => {
            if (!databaseFilePattern.test(file) || databaseFileAllowlist.has(file)) {
                return false;
            }
            return existsSync(join(root, file));
        });

        expect(unexpectedDatabaseFiles.map((file) => relative(root, join(root, file)))).toEqual([]);
    });
});
