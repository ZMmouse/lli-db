import { cloneDeep } from 'lodash';
import type { IModel } from '../types/model';
import { ModelStore } from './model-store';
import type { Database } from '../database';
import { SysExpansionFieldTypeEnum } from '../enum/field-type-enum';

export { validateModels } from './validate-models';
export type { IValidateModelsOptions } from './validate-models';

export const createModelStore = (db: Database, models: IModel[] = []) => {
    const modelStore = new ModelStore(db);
    models = cloneDeep(models);

    for (const model of models) {
        modelStore.add({
            ...model,
            attributes: {
                id: {
                    code: 'id',
                    required: true,
                    columnName: 'id',
                    type: SysExpansionFieldTypeEnum.UID,
                    name: 'ID',
                },
                ...model.attributes,
            },
            middlewares: model.middlewares ?? {},
            indexes: model.indexes ?? [],
        });
    }
    return modelStore;
};
