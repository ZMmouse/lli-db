import { isUndefined } from 'lodash';
import { typeUtil } from '../utils';
import type { IModel } from '../types/model';
import type { Database } from '../database';

export function processData(
    db: Database,
    data: any,
    model: IModel,
    { withDefaults = false }: { withDefaults?: boolean } = {},
) {
    const { attributes } = model;

    const obj: Record<string, unknown> = {};

    for (const key of Object.keys(attributes)) {
        const attribute = attributes[key];
        const field = db.fieldTypeManager.get(attribute.type);

        if (typeUtil.isMultiQuote(attribute)) {
            continue;
        }

        if (isUndefined(data[key])) {
            if (!isUndefined(attribute.default) && withDefaults) {
                if (typeof attribute.default === 'function') {
                    obj[key] = attribute.default();
                } else {
                    obj[key] = attribute.default;
                }
            }
            continue;
        }

        if ('validate' in field && typeof field.validate === 'function' && data[key] !== null) {
            field.validate(data[key]);
        }

        obj[key] = data[key] === null ? null : field.toDB(data[key], db, attribute);
    }
    return obj;
}
