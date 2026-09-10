import type { IModel } from '../types/model';
import type { Knex } from 'knex';
import type { Database } from '../database';
import type { IOrderBy, IParams, IPopulate, ISelect, IState, IWhere } from '../types/query';
import { applyOrderBy, buildOrderBy } from './helpers/order-by';
import { buildSelect, applySelect } from './helpers/select';
import { applyWhere, buildWhere } from './helpers/where';
import type { IStateJoin } from '../types/query';
import { applyPopulate, buildPopulate } from './helpers/populate';
import { applyJoins } from './helpers/join';
import { fromRow, toColumnName, toRow } from './helpers/transform';
import { transactionCtx } from '../transaction-ctx';
import { applyGroupBy, applyGroupByWithSelect } from './helpers/group-by';
import { applyDecrements, applyIncrements } from './helpers/decrement-increment';
import { LliDbError } from '../error/lli-db-error';
import { getDuplicateErrorMessage, isDuplicateKeyError } from './helpers/error';
import { normalizeQueryParams } from './helpers/normalize-params';
import { validateQueryPagination } from './helpers/limits';
import { getDiagnosticResultCount, toDiagnosticError } from '../diagnostics';

export class QueryBuilder {
    private readonly db: Database;
    private readonly code: string;
    private readonly model: IModel;
    private params: IParams = {};
    private state: IState = {
        returning: null,
        data: null,
        joins: [],
        orderBy: [],
        groupBy: [],
        groupByWithSelect: false,
        select: [],
        type: null,
        where: [],
        populate: null,
        count: null,
        first: null,
        max: null,
        min: null,
        onConflict: null,
        merge: null,
        ignore: false,
        transaction: null,
        limit: null,
        offset: null,
        page: null,
        pageSize: null,
        increments: [],
        decrements: [],
    };

    private _alias: string = '';

    private index: number = 0;

    private aliasCache: Record<string, string> = {};

    constructor(db: Database, code: string) {
        this.db = db;
        this.code = code;
        this.model = db.modelStore.get(code);
        if (!this.model) {
            LliDbError.throwModelNotFound(code);
        }
    }

    get alias() {
        if (this.checkUseAlias() && !this._alias) {
            this._alias = this.getAlias();
        }
        return this._alias;
    }

    getAlias(code?: string) {
        if (code) {
            if (!this.aliasCache[code]) {
                this.aliasCache[code] = this.getAlias();
            }
            return this.aliasCache[code];
        }
        this.index += 1;
        return `l${this.index}`;
    }

    aliasColumn(key: any, alias?: string) {
        if (key.indexOf('.') > 0) {
            return key;
        }
        if (alias) {
            return `${alias}.${key}`;
        }
        return this.checkUseAlias() ? `${this.alias}.${key}` : key;
    }

    private checkUseAlias() {
        return ['select', 'count'].includes(this.state.type ?? '');
    }

    init(params: IParams) {
        params = normalizeQueryParams(params);
        validateQueryPagination(params, this.db.config.query);
        this.params = params;

        if (params.orderBy) {
            this.orderBy(params.orderBy);
        }

        if (params.groupBy) {
            this.groupBy(params.groupBy);
        }

        if (params.select) {
            this.select(params.select);
        }

        if (params.data) {
            this.state.data = params.data;
        }

        if (params.where) {
            this.where(params.where);
        }

        if (params.populate) {
            this.populate(params.populate);
        }

        if (params.page !== undefined && params.pageSize !== undefined) {
            this.state.page = params.page;
            this.state.pageSize = params.pageSize;
        }
        if (params.limit !== undefined) {
            this.limit(params.limit);
        }
        if (params.offset !== undefined) {
            this.offset(params.offset);
        }

        return this;
    }

    private buildQuery() {
        if (
            !this.state.type ||
            (this.state.type === 'select' && (!this.state.select || this.state.select.length === 0))
        ) {
            if (this.state.select?.length) {
                this.state.type = 'select';
            } else {
                this.select('*');
            }
        }

        const aliasTableName = this.checkUseAlias()
            ? `${this.model.tableName} as ${this.alias}`
            : this.model.tableName;

        const query = this.db.getConnection(aliasTableName);

        switch (this.state.type) {
            case 'select':
                applySelect(this.state.select, {
                    query,
                    qb: this,
                    db: this.db,
                    code: this.code,
                });
                break;
            case 'count': {
                const columnName = this.aliasColumn(toColumnName(this.model, this.state.count!));
                query.count({
                    count: columnName,
                });
                break;
            }
            case 'max': {
                const columnName = this.aliasColumn(toColumnName(this.model, this.state.max!));
                query.max({
                    max: columnName,
                });
                break;
            }
            case 'min': {
                const columnName = this.aliasColumn(toColumnName(this.model, this.state.min!));
                query.min({
                    min: columnName,
                });
                break;
            }
            case 'insert':
                if (this.state.data) {
                    query.insert(toRow(this.model, this.state.data));
                }
                break;
            case 'update':
                if (this.state.data) {
                    query.update(toRow(this.model, this.state.data));
                }
                break;
            case 'delete':
                query.del();
                break;
        }

        if (this.state.where) {
            applyWhere(this.state.where, {
                query,
                qb: this,
                db: this.db,
                code: this.code,
            });
        }

        if (this.state.joins) {
            applyJoins(this.state.joins, {
                query,
                qb: this,
                db: this.db,
                code: this.code,
            });
        }

        if (this.state.orderBy) {
            applyOrderBy(this.state.orderBy, {
                db: this.db,
                query,
                qb: this,
                code: this.code,
            });
        }

        if (this.state.groupBy) {
            applyGroupBy(this.state.groupBy, {
                alias: this.alias,
                db: this.db,
                query,
                qb: this,
                code: this.code,
            });
        }

        if (this.state.groupByWithSelect && !this.state.groupBy?.length) {
            applyGroupByWithSelect(this.state.select, {
                alias: this.alias,
                db: this.db,
                query,
                qb: this,
                code: this.code,
            });
        }

        if (this.state.onConflict) {
            if (this.state.merge) {
                query.onConflict(this.state.onConflict).merge(this.state.merge);
            } else if (this.state.ignore) {
                query.onConflict(this.state.onConflict).ignore();
            }
        }

        if (this.state.returning) {
            if (this.state.returning in this.model.attributes) {
                query.returning(toColumnName(this.model, this.state.returning));
            }
        }

        if (this.state.transaction) {
            query.transacting(this.state.transaction);
        }

        if (this.state.first) {
            query.first();
        }

        if (this.state.limit) {
            query.limit(this.state.limit);
        }
        if (this.state.offset) {
            query.offset(this.state.offset);
        }

        if (this.state.page && this.state.pageSize) {
            query.limit(this.state.pageSize).offset((this.state.page - 1) * this.state.pageSize);
        }

        if (this.state.increments.length) {
            applyIncrements(this.state.increments, {
                query,
                db: this.db,
                qb: this,
                code: this.code,
                alias: this.alias,
            });
        }
        if (this.state.decrements.length) {
            applyDecrements(this.state.decrements, {
                query,
                db: this.db,
                qb: this,
                code: this.code,
                alias: this.alias,
            });
        }

        return query;
    }

    async execute<T = any>(): Promise<T> {
        const startedAt = Date.now();
        const operation = this.state.type ?? 'select';
        this.db.diagnostics.emit({
            type: 'query:start',
            modelCode: this.code,
            operation,
        });

        try {
            const query = this.buildQuery();

            const transaction = transactionCtx.get();

            if (transaction) {
                query.transacting(transaction);
            }

            let rows: any = await query;

            if (this.state.type === 'select') {
                rows = fromRow(this.db, this.model, rows);
            }

            if (this.state.populate) {
                await applyPopulate(rows, this.state.populate, {
                    db: this.db,
                    qb: this,
                    code: this.code,
                });
            }

            const resultCount = getDiagnosticResultCount(rows);
            this.db.diagnostics.emit({
                type: 'query:success',
                modelCode: this.code,
                operation,
                durationMs: Date.now() - startedAt,
                ...(resultCount === undefined ? {} : { resultCount }),
            });

            return rows as T;
        } catch (error) {
            this.db.diagnostics.emit({
                type: 'query:error',
                modelCode: this.code,
                operation,
                durationMs: Date.now() - startedAt,
                error: toDiagnosticError(error),
            });
            if (isDuplicateKeyError(this.db.knex, error)) {
                const errorMessage = getDuplicateErrorMessage(this.db.knex, this.model, error);
                throw LliDbError.throw40010(errorMessage.message, errorMessage);
            }
            throw error;
        }
    }

    select(select: ISelect) {
        this.state.type = 'select';
        this.state.select = buildSelect(select, {
            db: this.db,
            alias: this.alias,
            qb: this,
            code: this.code,
        });
        return this;
    }

    addSelect(select: ISelect) {
        this.state.select.push(
            ...buildSelect(select, {
                db: this.db,
                alias: this.alias,
                qb: this,
                code: this.code,
            }),
        );
    }

    where(where: IWhere) {
        this.state.where.push(
            ...buildWhere(where, {
                db: this.db,
                alias: this.alias,
                qb: this,
                code: this.code,
            }),
        );
        return this;
    }

    orderBy(orderBy: IOrderBy) {
        this.state.orderBy.push(
            ...buildOrderBy(orderBy, {
                db: this.db,
                alias: this.alias,
                qb: this,
                code: this.code,
            }),
        );
        return this;
    }

    groupBy(groupBy: string[]) {
        this.state.groupBy.push(...groupBy);
        return this;
    }

    groupByWithSelect(groupByWithSelect = true) {
        this.state.groupByWithSelect = groupByWithSelect;
    }

    count(count = 'id') {
        this.state.type = 'count';
        this.state.count = count;
        return this;
    }

    first() {
        this.state.first = true;
        return this;
    }

    limit(limit: number) {
        validateQueryPagination({ limit }, this.db.config.query);
        this.state.limit = limit;
        return this;
    }
    offset(offset: number) {
        validateQueryPagination({ offset }, this.db.config.query);
        this.state.offset = offset;
        return this;
    }

    max(column: string) {
        this.state.max = column;
        this.state.type = 'max';
        return this;
    }

    min(column: string) {
        this.state.type = 'min';
        this.state.min = column;
        return this;
    }

    onConflict(args: any) {
        this.state.onConflict = args;
        return this;
    }

    ignore() {
        this.state.ignore = true;
        return this;
    }

    merge(args: any) {
        if (args.length) {
            this.state.merge = args;
        } else {
            this.state.merge = true;
        }
        return this;
    }

    returning(fieldCode: string) {
        this.state.returning = fieldCode;
        return this;
    }

    populate(populate: IPopulate) {
        if (!this.state.populate) {
            this.state.populate = {};
        }
        Object.assign(
            this.state.populate,
            buildPopulate(populate, {
                db: this.db,
                qb: this,
                code: this.code,
            }),
        );
        return this;
    }

    join(data: IStateJoin) {
        if (
            this.state.joins.some((item) => {
                return (
                    item.code === data.code &&
                    item.fieldCode === data.fieldCode &&
                    item.refCode === data.refCode &&
                    item.refFieldCode === data.refFieldCode
                );
            })
        ) {
            return this;
        }
        // 添加到 joins 状态中
        this.state.joins.push(data);
        return this;
    }

    update(data: any) {
        this.state.type = 'update';
        this.state.data = data;
        return this;
    }

    increment(fieldCode: string, amount = 1) {
        this.state.type = 'update';
        this.state.increments.push({ fieldCode, amount });

        return this;
    }

    decrement(fieldCode: string, amount = 1) {
        this.state.type = 'update';
        this.state.decrements.push({ fieldCode, amount });

        return this;
    }

    insert(data: any | any[]) {
        this.state.type = 'insert';
        this.state.data = data;
        return this;
    }

    delete() {
        this.state.type = 'delete';
        return this;
    }

    transacting(transaction?: Knex.Transaction) {
        if (transaction) this.state.transaction = transaction;
        return this;
    }
}
