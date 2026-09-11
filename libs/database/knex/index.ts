import knex from 'knex';
import type { Knex } from 'knex';
import type { ISqliteConfig } from '../types/database';
import { LliDbError } from '../error/lli-db-error';

const journalModes = new Set(['wal', 'delete']);
const synchronousModes = new Set(['off', 'normal', 'full', 'extra']);

export const validateSqliteConfig = (config: Knex.Config, sqlite?: ISqliteConfig) => {
    if (!sqlite) return;
    if (String(config.client).toLowerCase() !== 'better-sqlite3') {
        throw new LliDbError(
            'sqlite runtime options require the better-sqlite3 client',
            'LLI400',
        );
    }
    if (sqlite.journalMode !== undefined && !journalModes.has(sqlite.journalMode)) {
        throw new LliDbError('Invalid sqlite.journalMode', 'LLI400');
    }
    if (sqlite.synchronous !== undefined && !synchronousModes.has(sqlite.synchronous)) {
        throw new LliDbError('Invalid sqlite.synchronous', 'LLI400');
    }
    if (sqlite.foreignKeys !== undefined && typeof sqlite.foreignKeys !== 'boolean') {
        throw new LliDbError('sqlite.foreignKeys must be a boolean', 'LLI400');
    }
    if (
        sqlite.busyTimeoutMs !== undefined &&
        (!Number.isSafeInteger(sqlite.busyTimeoutMs) || sqlite.busyTimeoutMs < 0)
    ) {
        throw new LliDbError('sqlite.busyTimeoutMs must be a non-negative integer', 'LLI400');
    }
};

export const createKnex = (config: Knex.Config, sqlite?: ISqliteConfig) => {
    validateSqliteConfig(config, sqlite);
    if (!sqlite || String(config.client).toLowerCase() !== 'better-sqlite3') {
        return knex(config);
    }
    const previousAfterCreate = config.pool?.afterCreate;
    const configured: Knex.Config = {
        ...config,
        pool: {
            ...config.pool,
            afterCreate(connection: any, done: (error: Error | null, connection: any) => void) {
                try {
                    if (sqlite.journalMode) {
                        connection.pragma(`journal_mode = ${sqlite.journalMode.toUpperCase()}`);
                    }
                    if (sqlite.foreignKeys !== undefined) {
                        connection.pragma(`foreign_keys = ${sqlite.foreignKeys ? 'ON' : 'OFF'}`);
                    }
                    if (sqlite.busyTimeoutMs !== undefined) {
                        connection.pragma(`busy_timeout = ${sqlite.busyTimeoutMs}`);
                    }
                    if (sqlite.synchronous) {
                        connection.pragma(`synchronous = ${sqlite.synchronous.toUpperCase()}`);
                    }
                    if (previousAfterCreate) {
                        previousAfterCreate(connection, done);
                    } else {
                        done(null, connection);
                    }
                } catch (error) {
                    done(error as Error, connection);
                }
            },
        },
    };
    return knex(configured);
};
