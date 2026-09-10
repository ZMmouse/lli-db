import { has } from 'lodash';
import { IAnyObject } from '../../types/any-object';
import { IModel } from '../../types/model';
import { LliDbError } from '../../error/lli-db-error';
import { MiddlewareManager } from '../index';

const validateUri = (data: IAnyObject, model: IModel) => {
    if (!model.useTree) return;
    if (!has(data, 'parentUri') || !data.parentUri) {
        LliDbError.throw400('parentUri必须要传值');
    }

    if (!has(data, 'code') || !data.code) {
        LliDbError.throw400('code必须要传值');
    }
};

export const registerTreeCUMiddleware = (middlewareManager: MiddlewareManager) => {
    middlewareManager.registerGlobalMiddleware('create', async (ctx, next) => {
        validateUri(ctx.params.data, ctx.model);
        await next();
    });
    middlewareManager.registerGlobalMiddleware('createMany', async (ctx, next) => {
        const { data } = ctx.params;

        if (Array.isArray(data)) {
            for (const item of data) {
                validateUri(item, ctx.model);
            }
        }
        await next();
    });
    middlewareManager.registerGlobalMiddleware('update', async (ctx, next) => {
        const { data } = ctx.params;
        if (data?.parentId) validateUri(data, ctx.model);
        await next();
    });
    middlewareManager.registerGlobalMiddleware('updateMany', async (ctx, next) => {
        const { data } = ctx.params;
        if (data?.parentId) validateUri(data, ctx.model);
        await next();
    });
};
