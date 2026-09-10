import { LliDbError } from './error/lli-db-error';

export type IDatabaseDriverFamily = 'sqlite' | 'postgresql' | 'unknown';
export type IDatabaseDriverSupport = 'supported' | 'preview' | 'unsupported';

export interface IDatabaseDriverCompatibility {
    client: string;
    family: IDatabaseDriverFamily;
    support: IDatabaseDriverSupport;
    tested: boolean;
    knexVersion: string;
    driverPackage?: string;
    driverVersion?: string;
    note: string;
}

const KNEX_VERSION = '^3.1.0';

const compatibilityByClient: Record<string, IDatabaseDriverCompatibility> = {
    'better-sqlite3': {
        client: 'better-sqlite3',
        family: 'sqlite',
        support: 'supported',
        tested: true,
        knexVersion: KNEX_VERSION,
        driverPackage: 'better-sqlite3',
        driverVersion: '^12.5.0',
        note: 'Covered by the complete isolated SQLite test suite.',
    },
    sqlite3: {
        client: 'sqlite3',
        family: 'sqlite',
        support: 'preview',
        tested: false,
        knexVersion: KNEX_VERSION,
        driverPackage: 'sqlite3',
        driverVersion: '^5.1.7',
        note: 'Accepted for compatibility, but not covered by the current contract suite.',
    },
    pg: {
        client: 'pg',
        family: 'postgresql',
        support: 'preview',
        tested: false,
        knexVersion: KNEX_VERSION,
        driverPackage: 'pg',
        driverVersion: '^8.16.3',
        note: 'PostgreSQL support is provisional until the container contract suite is enabled.',
    },
    postgres: {
        client: 'postgres',
        family: 'postgresql',
        support: 'preview',
        tested: false,
        knexVersion: KNEX_VERSION,
        driverPackage: 'pg',
        driverVersion: '^8.16.3',
        note: 'Alias of pg; PostgreSQL contract tests are still pending.',
    },
    postgresql: {
        client: 'postgresql',
        family: 'postgresql',
        support: 'preview',
        tested: false,
        knexVersion: KNEX_VERSION,
        driverPackage: 'pg',
        driverVersion: '^8.16.3',
        note: 'Alias of pg; PostgreSQL contract tests are still pending.',
    },
};

export const databaseDriverCompatibility = Object.freeze(compatibilityByClient);

export const getDatabaseClientName = (client: unknown): string =>
    typeof client === 'string' ? client.toLowerCase() : String(client);

export const getDatabaseDriverCompatibility = (
    client: unknown,
): IDatabaseDriverCompatibility => {
    const clientName = getDatabaseClientName(client);
    return (
        databaseDriverCompatibility[clientName] ?? {
            client: clientName,
            family: 'unknown',
            support: 'unsupported',
            tested: false,
            knexVersion: KNEX_VERSION,
            note: 'This Knex client is outside the documented compatibility matrix.',
        }
    );
};

export const validateDatabaseClient = (client: unknown): IDatabaseDriverCompatibility => {
    const compatibility = getDatabaseDriverCompatibility(client);
    if (compatibility.support === 'unsupported') {
        throw new LliDbError(
            `Unsupported database client: ${compatibility.client}`,
            'LLI400',
            { compatibility },
        );
    }
    return compatibility;
};
