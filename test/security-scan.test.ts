import { scanSecurityText } from '../scripts/security-scan';

describe('security scanner redaction contract', () => {
    test('detects credential literals without retaining the matched value', () => {
        const marker = ['do', '-not', '-print', '-this'].join('');
        const content = ['pass', 'word', ": '", marker, "'"].join('');
        const findings = scanSecurityText('worktree', 'config.ts', content);

        expect(findings).toEqual([
            { scope: 'worktree', rule: 'credential-literal', path: 'config.ts', line: 1 },
        ]);
        expect(JSON.stringify(findings)).not.toContain(marker);
    });

    test('detects private keys, credential URIs and personal-data candidates by metadata only', () => {
        const content = [
            ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
            ['postgresql://user', ':value', '@db/database'].join(''),
            ['person', '@company.invalid'].join(''),
            ['138', '0013', '8000'].join(''),
        ].join('\n');
        const findings = scanSecurityText('history', 'old-config.ts', content, 'abc123');

        expect(findings.map((finding) => finding.rule)).toEqual([
            'private-key',
            'credential-uri',
            'email',
            'phone-cn',
        ]);
        expect(findings.every((finding) => finding.commit === 'abc123')).toBe(true);
        expect(findings.every((finding) => !('value' in finding))).toBe(true);
    });

    test('reserved documentation email domains do not create PII findings', () => {
        const documentationAddress = ['alice', '@example.com'].join('');
        expect(scanSecurityText('package', 'README.md', documentationAddress)).toEqual([]);
    });
});
