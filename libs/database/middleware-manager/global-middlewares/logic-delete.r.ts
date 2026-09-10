import type { MiddlewareManager } from '../index';
import { IMiddlewareCtx } from '../types';
import { defaults } from 'lodash';
import { INextFunction } from '../../types/middleware';
const mixinWhereCondition = async (ctx: IMiddlewareCtx, next: INextFunction) => {
    if (ctx.model.useLogicDelete) {
        const { where } = ctx.params;

        if (where) {
            defaults(where, {
                deleted: {
                    notEq: true,
                },
            });
        }

        defaults(ctx.params, {
            where: {
                deleted: {
                    notEq: true,
                },
            },
        });
    }
    await next();
};


export const registerLogicDeleteRMiddleware = (middlewareManager: MiddlewareManager) => {
    middlewareManager.registerGlobalMiddleware('findOne', mixinWhereCondition);
    middlewareManager.registerGlobalMiddleware('findMany', mixinWhereCondition);
    middlewareManager.registerGlobalMiddleware('update', mixinWhereCondition);
    middlewareManager.registerGlobalMiddleware('updateMany', mixinWhereCondition);
    middlewareManager.registerGlobalMiddleware('queryPage', mixinWhereCondition);
    middlewareManager.registerGlobalMiddleware('count', mixinWhereCondition);
    middlewareManager.registerGlobalMiddleware('max', mixinWhereCondition);
    middlewareManager.registerGlobalMiddleware('min', mixinWhereCondition);
};
