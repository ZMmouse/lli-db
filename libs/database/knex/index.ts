import knex from 'knex';
import type { Knex } from 'knex';
export const createKnex = (config: Knex.Config) => {
    return knex(config);
};
