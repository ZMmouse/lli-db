import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

type ScanScope = 'worktree' | 'package' | 'history';

interface IAllowEntry {
    rule: string;
    path: string;
    scopes: ScanScope[];
    reason: string;
}

export interface ISecurityFinding {
    scope: ScanScope;
    rule: string;
    path: string;
    line?: number;
    commit?: string;
}

interface IRule {
    id: string;
    expression: RegExp;
}

const rules: IRule[] = [
    { id: 'private-key', expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
    { id: 'aws-access-key', expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
    { id: 'github-token', expression: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/ },
    { id: 'npm-token', expression: /\bnpm_[A-Za-z0-9]{20,}\b/ },
    {
        id: 'credential-uri',
        expression: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)\:\/\/[^\s:@]+:[^\s@]+@/i,
    },
    {
        id: 'credential-literal',
        expression:
            /(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["'`]([^"'`\r\n]{4,})["'`]/i,
    },
    {
        id: 'absolute-database-path',
        expression: /\b[A-Za-z]:[\\/][^\r\n"'`]+\.(?:db|db3|s3db|sqlite|sqlite3)\b/i,
    },
    {
        id: 'email',
        expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    },
    { id: 'phone-cn', expression: /(?:^|\D)1[3-9]\d{9}(?:\D|$)/ },
];

const databaseFilePattern = /\.(?:db|db3|s3db|sqlite|sqlite3)(?:-(?:journal|shm|wal))?$/i;
const historyCandidate =
    'PRIVATE KEY|AKIA|ASIA|github_pat|ghp_|gho_|ghu_|ghs_|npm_|password|passwd|pwd|secret|token|postgres|mysql|mongodb|@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|1[3-9][0-9]{9}|[A-Za-z]:[/\\\\]';

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/^package\//, '');

const pathMatches = (path: string, pattern: string) => {
    const normalizedPath = normalizePath(path);
    const normalizedPattern = normalizePath(pattern);
    return normalizedPattern.endsWith('/**')
        ? normalizedPath.startsWith(normalizedPattern.slice(0, -3))
        : normalizedPath === normalizedPattern;
};

const isAllowed = (
    finding: ISecurityFinding,
    allowlist: IAllowEntry[],
): boolean =>
    allowlist.some(
        (entry) =>
            (entry.rule === '*' || entry.rule === finding.rule) &&
            entry.scopes.includes(finding.scope) &&
            pathMatches(finding.path, entry.path) &&
            entry.reason.trim().length > 0,
    );

const isReservedExampleEmail = (line: string) =>
    /@[A-Z0-9.-]*example\.(?:com|net|org)\b/i.test(line);

const scanLine = (
    scope: ScanScope,
    path: string,
    line: string,
    lineNumber: number,
    commit?: string,
): ISecurityFinding[] => {
    const findings: ISecurityFinding[] = [];
    for (const rule of rules) {
        if (!rule.expression.test(line)) continue;
        if (rule.id === 'email' && isReservedExampleEmail(line)) continue;
        findings.push({ scope, rule: rule.id, path: normalizePath(path), line: lineNumber, commit });
    }
    return findings;
};

export const scanSecurityText = (
    scope: ScanScope,
    path: string,
    content: string,
    commit?: string,
): ISecurityFinding[] =>
    content
        .split(/\r?\n/)
        .flatMap((line, index) => scanLine(scope, path, line, index + 1, commit));

const scanFile = (root: string, scope: ScanScope, path: string): ISecurityFinding[] => {
    const absolutePath = resolve(root, path);
    if (databaseFilePattern.test(path)) {
        return [{ scope, rule: 'database-artifact', path: normalizePath(path) }];
    }
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return [];
    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) return [];
    return scanSecurityText(scope, path, buffer.toString('utf8'));
};

const git = (root: string, args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const listWorktreeFiles = (root: string) =>
    execFileSync(
        'git',
        ['-c', 'core.quotePath=false', 'ls-files', '-z', '-c', '-o', '--exclude-standard'],
        { cwd: root, encoding: 'utf8' },
    )
        .split('\0')
        .filter(Boolean);

const listPackageFiles = (root: string) => {
    const npmExecPath = process.env.npm_execpath;
    if (!npmExecPath) throw new Error('Package scan must be launched through npm run security:scan.');
    const cache = join(root, 'artifacts', 'npm-smoke-cache');
    const output = execFileSync(
        process.execPath,
        [npmExecPath, 'pack', '--dry-run', '--ignore-scripts', '--json', '--cache', cache],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const result = JSON.parse(output) as Array<{ files?: Array<{ path: string }> }>;
    return (result[0]?.files ?? []).map((file) => file.path);
};

const scanHistory = (root: string): ISecurityFinding[] => {
    const findings: ISecurityFinding[] = [];
    const seen = new Set<string>();
    const commits = git(root, ['rev-list', '--all']).split(/\r?\n/).filter(Boolean);

    for (const commit of commits) {
        const result = spawnSync(
            'git',
            ['-c', 'core.quotePath=false', 'grep', '-I', '-n', '-E', historyCandidate, commit, '--'],
            { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
        );
        if (result.status !== 0 && result.status !== 1) {
            throw new Error(`git grep failed for commit ${commit.slice(0, 12)}.`);
        }
        for (const outputLine of (result.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
            const match = outputLine.match(/^[^:]+:(.*?):(\d+):(.*)$/);
            if (!match) continue;
            const [, path, lineNumber, line] = match;
            for (const finding of scanLine(
                'history',
                path,
                line,
                Number(lineNumber),
                commit.slice(0, 12),
            )) {
                const key = `${finding.rule}:${finding.path}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    findings.push(finding);
                }
            }
        }
    }

    const historicalPaths = execFileSync(
        'git',
        ['-c', 'core.quotePath=false', 'log', '-z', '--all', '--name-only', '--format='],
        { cwd: root, encoding: 'utf8' },
    )
        .split('\0')
        .map((path) => path.trim())
        .filter((path) => databaseFilePattern.test(path));
    for (const path of new Set(historicalPaths)) {
        const key = `database-artifact:${normalizePath(path)}`;
        if (seen.has(key)) continue;
        const commit = git(root, ['log', '-1', '--format=%H', '--', path]).slice(0, 12);
        findings.push({ scope: 'history', rule: 'database-artifact', path: normalizePath(path), commit });
    }
    return findings;
};

export const runSecurityScan = (root: string, includeHistory = false) => {
    const allowlist = (
        JSON.parse(readFileSync(join(root, 'security-scan-allowlist.json'), 'utf8')) as {
            entries: IAllowEntry[];
        }
    ).entries;
    const findings = [
        ...listWorktreeFiles(root).flatMap((path) => scanFile(root, 'worktree', path)),
        ...listPackageFiles(root).flatMap((path) => scanFile(root, 'package', path)),
        ...(includeHistory ? scanHistory(root) : []),
    ].filter((finding) => !isAllowed(finding, allowlist));

    const unique = Array.from(
        new Map(
            findings.map((finding) => [
                `${finding.scope}:${finding.rule}:${finding.path}:${finding.line ?? ''}:${finding.commit ?? ''}`,
                finding,
            ]),
        ).values(),
    );
    return unique;
};

const formatFinding = (finding: ISecurityFinding) => {
    const location = `${finding.path}${finding.line ? `:${finding.line}` : ''}`;
    const commit = finding.commit ? ` commit=${finding.commit}` : '';
    return `[${finding.scope}] ${finding.rule} ${location}${commit}`;
};

if (require.main === module) {
    const includeHistory = process.argv.includes('--history');
    const findings = runSecurityScan(process.cwd(), includeHistory);
    if (findings.length > 0) {
        console.error(`Security scan found ${findings.length} unapproved item(s):`);
        for (const finding of findings.slice(0, 100)) console.error(`- ${formatFinding(finding)}`);
        if (findings.length > 100) console.error(`- ... ${findings.length - 100} more item(s)`);
        process.exitCode = 1;
    } else {
        console.log(`Security scan passed (${includeHistory ? 'worktree, package, history' : 'worktree, package'}).`);
    }
}
