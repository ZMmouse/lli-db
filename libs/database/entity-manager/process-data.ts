import { isUndefined } from 'lodash';
import { typeUtil } from '../utils';
import type { IModel } from '../types/model';
import type { Database } from '../database';
import { validateStrictFieldValue } from './validate-write';

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

        let value = data[key];
        if (isUndefined(value)) {
            if (isUndefined(attribute.default) || !withDefaults) continue;
            value =
                typeof attribute.default === 'function'
                    ? attribute.default()
                    : attribute.default;
        }

        if (db.config.validation?.mode === 'strict') {
            validateStrictFieldValue(db, model, key, attribute, value);
        }

        if ('validate' in field && typeof field.validate === 'function' && value !== null) {
            field.validate(value);
        }

        obj[key] = value === null ? null : field.toDB(value, db, attribute);
    }
    return obj;
}
