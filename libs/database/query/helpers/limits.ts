import type { IQueryConfig } from '../../types/database';
import type { IParams } from '../../types/query';
import { LliDbError } from '../../error/lli-db-error';

export const DEFAULT_QUERY_LIMITS: Required<IQueryConfig> = {
    maxPageSize: 1000,
    maxLimit: 1000,
    maxOffset: 100000,
    populateBatchSize: 500,
};

export const resolveQueryLimits = (config?: IQueryConfig): Required<IQueryConfig> => ({
    maxPageSize: config?.maxPageSize ?? DEFAULT_QUERY_LIMITS.maxPageSize,
    maxLimit: config?.maxLimit ?? DEFAULT_QUERY_LIMITS.maxLimit,
    maxOffset: config?.maxOffset ?? DEFAULT_QUERY_LIMITS.maxOffset,
    populateBatchSize: config?.populateBatchSize ?? DEFAULT_QUERY_LIMITS.populateBatchSize,
});

const assertIntegerInRange = (name: string, value: number, min: number, max: number) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        LliDbError.throw400(`${name}必须是${min}到${max}之间的安全整数`);
    }
};

export const validateQueryConfig = (config?: IQueryConfig) => {
    const limits = resolveQueryLimits(config);
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1) {
            LliDbError.throw500(`query.${name}必须是大于0的安全整数`);
        }
    }
    return limits;
};

export const validateQueryPagination = (params: IParams, config?: IQueryConfig) => {
    const limits = validateQueryConfig(config);
    const hasPage = params.page !== undefined;
    const hasPageSize = params.pageSize !== undefined;

    if (hasPage !== hasPageSize) {
        LliDbError.throw400('page和pageSize必须同时提供');
    }
    if (hasPage && hasPageSize) {
        assertIntegerInRange('page', params.page!, 1, Number.MAX_SAFE_INTEGER);
        assertIntegerInRange('pageSize', params.pageSize!, 1, limits.maxPageSize);
        const calculatedOffset = (params.page! - 1) * params.pageSize!;
        assertIntegerInRange('分页偏移', calculatedOffset, 0, limits.maxOffset);
    }
    if (params.limit !== undefined) {
        assertIntegerInRange('limit', params.limit, 1, limits.maxLimit);
    }
    if (params.offset !== undefined) {
        assertIntegerInRange('offset', params.offset, 0, limits.maxOffset);
    }
    if ((hasPage || hasPageSize) && (params.limit !== undefined || params.offset !== undefined)) {
        LliDbError.throw400('page/pageSize不能与limit/offset同时使用');
    }

    return limits;
};

export const splitIntoBatches = <T>(values: T[], batchSize: number): T[][] => {
    const batches: T[][] = [];
    for (let index = 0; index < values.length; index += batchSize) {
        batches.push(values.slice(index, index + batchSize));
    }
    return batches;
};
