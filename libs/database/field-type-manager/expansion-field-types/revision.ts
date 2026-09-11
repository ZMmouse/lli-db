import { assign, isPlainObject } from 'lodash';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';
import { toChildValueKey } from '../../entity-manager/transform';
import { LliDbError } from '../../error/lli-db-error';
import type { IMiddlewareCtx } from '../../middleware-manager/types';
import type { IExpansionField } from '../../types/i-field';
import type { IModel } from '../../types/model';

const revisionAttributes = (model: IModel) =>
    Object.values(model.attributes).filter(
        (attribute) => attribute.type === SysExpansionFieldTypeEnum.REVISION,
    );

const initializeRevision = (model: IModel, data: unknown) => {
    if (!isPlainObject(data)) return;
    for (const attribute of revisionAttributes(model)) {
        assign(data, { [attribute.code]: 1 });
    }
};

const removeCallerRevision = (model: IModel, data: unknown) => {
    if (!isPlainObject(data)) return;
    const record = data as Record<string, unknown>;
    for (const attribute of revisionAttributes(model)) {
        delete record[attribute.code];
    }
};

const initializeChildRevisions = (ctx: IMiddlewareCtx) => {
    for (const childCode of ctx.model.childCodes ?? []) {
        const childModel = ctx.db.modelStore.get(childCode);
        const childData = ctx.params.data[toChildValueKey(childCode)];
        if (!Array.isArray(childData)) continue;
        for (const item of childData) {
            if (item?.__op === 'create' || !item?.__op) {
                initializeRevision(childModel, item);
            }
        }
    }
};

export default {
    inherit: SysFieldTypeEnum.INT,
    name: SysExpansionFieldTypeEnum.REVISION,
    validate(value: unknown) {
        if (!Number.isSafeInteger(value) || (value as number) < 1) {
            throw new LliDbError('Revision must be a positive safe integer', 'LLI40020', {
                fieldCode: 'revision',
                reason: 'expected a positive safe integer',
            });
        }
    },
    middlewares: {
        async create(ctx, next) {
            initializeRevision(ctx.model, ctx.params.data);
            await next();
        },
        async createMany(ctx, next) {
            if (Array.isArray(ctx.params.data)) {
                for (const item of ctx.params.data) initializeRevision(ctx.model, item);
            }
            await next();
        },
        async update(ctx, next) {
            removeCallerRevision(ctx.model, ctx.params.data);
            await next();
        },
        async updateMany(ctx, next) {
            removeCallerRevision(ctx.model, ctx.params.data);
            await next();
        },
        async createChild(ctx, next) {
            initializeChildRevisions(ctx);
            await next();
        },
        async createChildMany(ctx, next) {
            if (Array.isArray(ctx.params.data)) {
                for (const data of ctx.params.data) {
                    initializeChildRevisions({ ...ctx, params: { ...ctx.params, data } });
                }
            }
            await next();
        },
    },
} as IExpansionField;
