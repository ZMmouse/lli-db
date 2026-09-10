import { IExpansionField } from '../../types/i-field';
import { assign } from 'lodash';
import { v4 as uuidV4 } from 'uuid';
import { toChildValueKey } from '../../entity-manager/transform';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export default {
    inherit: SysFieldTypeEnum.TEXT,
    name: SysExpansionFieldTypeEnum.UID,

    middlewares: {
        async create(ctx, next) {
            const { data } = ctx.params;
            const { model } = ctx;

            for (const key in model.attributes) {
                const attr = model.attributes[key];
                if (attr.type === SysExpansionFieldTypeEnum.UID) {
                    assign(data, {
                        [key]: uuidV4(),
                    });
                }
            }
            await next();
        },

        async createMany(ctx, next) {
            const { data } = ctx.params;
            const { model } = ctx;

            const uidAttrs = Object.values(model.attributes).filter(
                (attr) => attr.type === SysExpansionFieldTypeEnum.UID,
            );

            if (Array.isArray(data)) {
                for (const item of data) {
                    for (const attr of uidAttrs) {
                        assign(item, {
                            [attr.code]: uuidV4(),
                        });
                    }
                }
            }
            await next();
        },

        async createChild(ctx, next) {
            const { data } = ctx.params;

            const model = ctx.model;

            const childCodes = model.childCodes;

            if (childCodes?.length) {
                childCodes.forEach((childCode) => {
                    const childModel = ctx.db.modelStore.get(childCode);
                    const uidAttrs = Object.values(childModel.attributes).filter(
                        (attr) => attr.type === SysExpansionFieldTypeEnum.UID,
                    );

                    const childData = data[toChildValueKey(childModel.code)];

                    if (Array.isArray(childData)) {
                        childData.forEach((item) => {
                            if (item.__op === 'create' || !item.__op) {
                                for (const attr of uidAttrs) {
                                    assign(item, {
                                        [attr.code]: uuidV4(),
                                    });
                                }
                            }
                        });
                    }
                });
            }
            await next();
        },

        async createChildMany(ctx, next) {
            const { data } = ctx.params;

            const model = ctx.model;

            const childCodes = model.childCodes;

            if (!Array.isArray(data)) {
                return;
            }

            if (childCodes?.length) {
                childCodes.forEach((childCode) => {
                    const childModel = ctx.db.modelStore.get(childCode);

                    const uidAttrs = Object.values(childModel.attributes).filter(
                        (attr) => attr.type === SysExpansionFieldTypeEnum.UID,
                    );
                    data.forEach((row: any) => {
                        const childData = row[toChildValueKey(childModel.code)];

                        if (Array.isArray(childData)) {
                            childData.forEach((item) => {
                                if (item.__op === 'create' || !item.__op) {
                                    for (const attr of uidAttrs) {
                                        assign(item, {
                                            [attr.code]: uuidV4(),
                                        });
                                    }
                                }
                            });
                        }
                    });
                });
            }
            await next();
        },
    },
} as IExpansionField;
