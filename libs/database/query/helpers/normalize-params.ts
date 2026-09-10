import type { IParams, IWhere } from '../../types/query';

const logicalKeys = new Set(['and', 'or', 'not']);

export const hasWhereConditions = (where: unknown): boolean => {
    if (!where || typeof where !== 'object' || Array.isArray(where)) {
        return false;
    }

    return Object.entries(where).some(([key, value]) => {
        if (logicalKeys.has(key)) {
            if (Array.isArray(value)) {
                return value.some(hasWhereConditions);
            }
            return hasWhereConditions(value);
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return hasWhereConditions(value);
        }

        return true;
    });
};

export const normalizeQueryParams = <T extends IParams>(params: T): T => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return params;
    }
    if (params.filters === undefined) {
        return params;
    }

    const where: IWhere =
        params.where === undefined
            ? params.filters
            : {
                  and: [params.where, params.filters],
              };
    const normalized = { ...params, where };
    delete normalized.filters;
    return normalized;
};
