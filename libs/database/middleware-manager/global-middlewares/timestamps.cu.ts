import type { MiddlewareManager } from '../index';
import { INextFunction } from '../../types/middleware';
import { defaults, assign } from 'lodash';
import { IMiddlewareCtx } from '../types';
import { toChildValueKey } from '../../entity-manager/transform';

const createMiddleware = async (ctx: IMiddlewareCtx, next: INextFunction) => {
    const { data } = ctx.params;
    const now = new Date();
    defaults(data, {
        createdAt: now,
        updatedAt: now,
    });
    await next();
};

const createChildMiddleware = async (ctx: IMiddlewareCtx, next: INextFunction) => {
    const { data } = ctx.params;
    const now = new Date();

    const model = ctx.model;

    const childCodes = model.childCodes;

    if (childCodes?.length) {
        childCodes.forEach((childCode) => {
            const childModel = ctx.db.modelStore.get(childCode);

            const childData = data[toChildValueKey(childModel.code)];

            if (Array.isArray(childData)) {
                childData.forEach((item) => {
                    if (item.__op === 'delete') {
                        defaults(item, {
                            deletedAt: now,
                        });
                    } else if (item.__op === 'update') {
                        defaults(item, {
                            updatedAt: now,
                        });
                    } else {
                        defaults(item, {
                            createdAt: now,
                            updatedAt: now,
                        });
                    }
                });
            }
        });
    }
    await next();
};

const createManyMiddleware = async (ctx: IMiddlewareCtx, next: INextFunction) => {
    const { data } = ctx.params;
    const now = new Date();
    if (Array.isArray(data)) {
        data.forEach((item) => {
            defaults(item, {
                createdAt: now,
                updatedAt: now,
            });
        });
    }
    await next();
};

export const updateMiddleware = async (ctx: IMiddlewareCtx, next: INextFunction) => {
    const { data } = ctx.params;
    assign(data, {
        updatedAt: new Date(),
    });
    await next();
};
export const updateManyMiddleware = async (ctx: IMiddlewareCtx, next: INextFunction) => {
    const { data } = ctx.params;

    const now = new Date();
    assign(data, {
        updatedAt: now,
    });
    await next();
};

export const registerTimestampsCUMiddleware = (middlewareManager: MiddlewareManager) => {
    middlewareManager.registerGlobalMiddleware('create', createMiddleware);
    middlewareManager.registerGlobalMiddleware('createChild', createChildMiddleware);
    middlewareManager.registerGlobalMiddleware('createMany', createManyMiddleware);
    middlewareManager.registerGlobalMiddleware('update', updateMiddleware);
    middlewareManager.registerGlobalMiddleware('updateMany', updateManyMiddleware);
};
