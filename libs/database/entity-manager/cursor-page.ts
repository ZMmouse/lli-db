import type { Knex } from 'knex';
import type { Database } from '../database';
import { DBFieldTypeEnum } from '../enum/field-type-enum';
import { LliDbError } from '../error/lli-db-error';
import { QueryBuilder } from '../query';
import { applyWhere, buildWhere } from '../query/helpers/where';
import { toColumnName, fromRow } from '../query/helpers/transform';
import { validateQueryPagination } from '../query/helpers/limits';
import type { ICursorOrder, ICursorPageParams, IWhere } from '../types/query';
import type { ICursorPageResult } from '../types/i-result';
import type { IModel } from '../types/model';
import { transactionCtx } from '../transaction-ctx';
import { toDiagnosticError } from '../diagnostics';

const fail = (modelCode: string, reason: string): never => {
    throw new LliDbError(`Invalid cursor page for ${modelCode}: ${reason}`, 'LLI40021', {
        modelCode,
        reason,
    });
};

const normalizeOrder = (
    db: Database,
    model: IModel,
    orderBy: ICursorOrder[],
): ICursorOrder[] => {
    if (!Array.isArray(orderBy) || orderBy.length === 0) {
        fail(model.code, 'orderBy must contain at least one field');
    }
    const seen = new Set<string>();
    const result = orderBy.map((order) => {
        if (!order || typeof order.field !== 'string' || !['asc', 'desc'].includes(order.direction)) {
            fail(model.code, 'orderBy contains an invalid item');
        }
        if (seen.has(order.field)) fail(model.code, `duplicate order field ${order.field}`);
        const attribute = model.attributes[order.field];
        if (!attribute) fail(model.code, `unknown order field ${order.field}`);
        const base = db.fieldTypeManager.getBaseFieldType(attribute.type);
        if (base.dbFiledType === DBFieldTypeEnum.JSON || base.isColumn === false) {
            fail(model.code, `field ${order.field} cannot be used for cursor ordering`);
        }
        seen.add(order.field);
        return { field: order.field, direction: order.direction };
    });
    if (!seen.has('id')) result.push({ field: 'id', direction: 'asc' });
    return result;
};

const validateAfter = (
    db: Database,
    model: IModel,
    orderBy: ICursorOrder[],
    after?: Record<string, string | number | boolean | null>,
) => {
    if (after === undefined) return undefined;
    if (!after || typeof after !== 'object' || Array.isArray(after)) {
        fail(model.code, 'after must be an object');
    }
    const expected = orderBy.map((item) => item.field);
    const actual = Object.keys(after);
    if (actual.length !== expected.length || actual.some((field) => !expected.includes(field))) {
        fail(model.code, 'after must contain exactly the final order fields');
    }
    const result: Record<string, unknown> = {};
    for (const field of expected) {
        const value = after[field];
        if (
            value !== null &&
            typeof value !== 'string' &&
            typeof value !== 'number' &&
            typeof value !== 'boolean'
        ) {
            fail(model.code, `after field ${field} is not a scalar`);
        }
        const attribute = model.attributes[field];
        const fieldType = db.fieldTypeManager.get(attribute.type);
        result[field] = value === null ? null : fieldType.toDB(value, db, attribute);
    }
    return result;
};

const applyEquality = (query: Knex.QueryBuilder, column: string, value: unknown) => {
    if (value === null) query.whereNull(column);
    else query.where(column, value);
};

const applyAfter = (
    query: Knex.QueryBuilder,
    column: string,
    direction: 'asc' | 'desc',
    value: unknown,
) => {
    if (value === null) return false;
    query.where((branch) => {
        branch.where(column, direction === 'asc' ? '>' : '<', value as Knex.Value).orWhereNull(column);
    });
    return true;
};

const applyKeysetWhere = (
    query: Knex.QueryBuilder,
    model: IModel,
    orderBy: ICursorOrder[],
    after: Record<string, unknown>,
) => {
    query.where((outer) => {
        orderBy.forEach((order, position) => {
            outer.orWhere((branch) => {
                for (let index = 0; index < position; index += 1) {
                    const prefix = orderBy[index];
                    applyEquality(branch, toColumnName(model, prefix.field), after[prefix.field]);
                }
                const applied = applyAfter(
                    branch,
                    toColumnName(model, order.field),
                    order.direction,
                    after[order.field],
                );
                if (!applied) branch.whereRaw('0 = 1');
            });
        });
    });
};

export const findCursorPage = async <T>(
    db: Database,
    code: string,
    params: ICursorPageParams,
): Promise<ICursorPageResult<T>> => {
    const startedAt = Date.now();
    db.diagnostics.emit({ type: 'cursor:page:start', modelCode: code, operation: 'findCursorPage' });
    try {
        const model = db.modelStore.get(code);
        const where: IWhere | undefined =
            params.filters === undefined
                ? params.where
                : params.where === undefined
                  ? params.filters
                  : { and: [params.where, params.filters] };
        const limit = params.limit ?? 50;
        validateQueryPagination({ limit }, db.config.query);
        const orderBy = normalizeOrder(db, model, params.orderBy);
        const after = validateAfter(db, model, orderBy, params.after);
        const helper = new QueryBuilder(db, code);
        const query = db.getConnection(model.tableName);
        const transaction = transactionCtx.get();
        if (transaction) query.transacting(transaction);

        for (const [field, attribute] of Object.entries(model.attributes)) {
            if (db.fieldTypeManager.getBaseFieldType(attribute.type).isColumn === false) continue;
            query.select({ [field]: toColumnName(model, field) });
        }
        if (where) {
            applyWhere(
                buildWhere(where, { db, alias: '', qb: helper, code }),
                { db, query, qb: helper, code },
            );
        }
        if (after) applyKeysetWhere(query, model, orderBy, after);
        orderBy.forEach((order) => {
            const column = toColumnName(model, order.field);
            query.orderByRaw(`?? IS NULL ASC, ?? ${order.direction}`, [column, column]);
        });
        query.limit(limit + 1);

        const rawRows = await query;
        const hasMore = rawRows.length > limit;
        const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
        const rows = fromRow(db, model, pageRows) as T[];
        const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
        const nextPosition =
            hasMore && last
                ? (Object.fromEntries(
                      orderBy.map((order) => [order.field, last[order.field]]),
                  ) as Record<string, string | number | boolean | null>)
                : undefined;
        const result = {
            rows,
            hasMore,
            ...(nextPosition ? { nextPosition } : {}),
        };
        db.diagnostics.emit({
            type: 'cursor:page:success',
            modelCode: code,
            operation: 'findCursorPage',
            durationMs: Date.now() - startedAt,
            resultCount: rows.length,
        });
        return result;
    } catch (error) {
        db.diagnostics.emit({
            type: 'cursor:page:error',
            modelCode: code,
            operation: 'findCursorPage',
            durationMs: Date.now() - startedAt,
            error: toDiagnosticError(error),
        });
        throw error;
    }
};
