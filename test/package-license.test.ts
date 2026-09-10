import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    license?: string;
    files?: string[];
    repository?: { type?: string; url?: string };
};

describe('package licensing', () => {
    test('declares the project license and includes legal files in package metadata', () => {
        expect(packageJson).toMatchObject({
            license: 'MIT',
            repository: {
                type: 'git',
                url: 'git+https://github.com/ZMmouse/lli-db.git',
            },
        });
        expect(packageJson.files).toEqual(expect.arrayContaining(['LICENSE', 'NOTICE']));
        expect(existsSync(join(root, 'LICENSE'))).toBe(true);
        expect(existsSync(join(root, 'NOTICE'))).toBe(true);
    });

    test('preserves the Strapi source, copyright, and MIT attribution', () => {
        const notice = readFileSync(join(root, 'NOTICE'), 'utf8');
        expect(notice).toContain('Strapi Community Edition');
        expect(notice).toContain('Copyright (c) 2015-present Strapi Solutions SAS');
        expect(notice).toContain('packages/core/database/src/transaction-context.ts');
        expect(notice).toContain('Permission is hereby granted, free of charge');
    });
});
