import { SysFieldTypeEnum } from '../enum/field-type-enum';
import { LliDbError } from '../error/lli-db-error';
import type { IAttribute, IModel } from '../types/model';

export interface IValidateModelsOptions {
    isFieldTypeRegistered?: (type: string) => boolean;
    allowImplicitSystemAttributes?: boolean;
}

const implicitAttributeCodes = new Set(['id']);

const fail = (path: string, message: string): never => {
    throw new LliDbError(`Invalid model definition at ${path}: ${message}`, 'LLI400');
};

const requireNonEmptyString = (value: unknown, path: string) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        fail(path, 'expected a non-empty string');
    }
};

const hasAttribute = (model: IModel, code: string) => {
    if (implicitAttributeCodes.has(code) || Object.prototype.hasOwnProperty.call(model.attributes, code)) {
        return true;
    }
    if (model.useRevision && code === 'revision') return true;
    if (model.useCreatedFields && (code === 'createdAt' || code === 'createdBy')) return true;
    if (model.useUpdatedFields && (code === 'updatedAt' || code === 'updatedBy')) return true;
    if (
        model.useLogicDelete &&
        (code === 'deletedAt' || code === 'deletedBy' || code === 'deleted')
    ) {
        return true;
    }
    if (model.useEnabled && (code === 'enabled' || code === 'enabledAt' || code === 'enabledBy')) {
        return true;
    }
    return model.useTree === true && ['parentId', 'parentCode', 'parentUri'].includes(code);
};

const requireAttribute = (model: IModel, code: unknown, path: string) => {
    requireNonEmptyString(code, path);
    if (!hasAttribute(model, code as string)) {
        fail(path, `attribute "${String(code)}" does not exist on model "${model.code}"`);
    }
};

const validateAttribute = (
    model: IModel,
    key: string,
    attribute: IAttribute,
    modelPath: string,
    options: IValidateModelsOptions,
) => {
    const path = `${modelPath}.attributes.${key}`;
    if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)) {
        fail(path, 'expected an attribute object');
    }
    if (attribute.code !== key) {
        fail(`${path}.code`, `expected "${key}", received "${String(attribute.code)}"`);
    }
    requireNonEmptyString(attribute.columnName, `${path}.columnName`);
    requireNonEmptyString(attribute.type, `${path}.type`);

    if (
        attribute.primitiveType !== undefined &&
        !Object.values(SysFieldTypeEnum).includes(attribute.primitiveType)
    ) {
        fail(`${path}.primitiveType`, `unknown primitive field type "${attribute.primitiveType}"`);
    }
    if (options.isFieldTypeRegistered && !options.isFieldTypeRegistered(attribute.type)) {
        fail(`${path}.type`, `field type "${attribute.type}" is not registered`);
    }
};

/**
 * Validates model definitions without mutating them.
 *
 * Pass `isFieldTypeRegistered` immediately before migration, after custom field
 * types have had a chance to register. Without it, the validator performs only
 * structural and cross-model checks and is safe to call before opening a database.
 */
export const validateModels = (
    models: IModel[],
    options: IValidateModelsOptions = {},
): true => {
    if (!Array.isArray(models)) {
        fail('models', 'expected an array');
    }

    const modelsByCode = new Map<string, IModel>();
    const modelCodePaths = new Map<string, string>();
    const tableNamePaths = new Map<string, string>();
    const indexNamePaths = new Map<string, string>();

    models.forEach((model, modelIndex) => {
        const path = `models[${modelIndex}]`;
        if (!model || typeof model !== 'object' || Array.isArray(model)) {
            fail(path, 'expected a model object');
        }
        requireNonEmptyString(model.code, `${path}.code`);
        requireNonEmptyString(model.tableName, `${path}.tableName`);
        if (model.useRevision && model.useLogicDelete) {
            fail(path, 'useRevision cannot be combined with useLogicDelete');
        }

        const previousCodePath = modelCodePaths.get(model.code);
        if (previousCodePath) {
            fail(`${path}.code`, `duplicate model code "${model.code}"; first declared at ${previousCodePath}`);
        }
        modelCodePaths.set(model.code, `${path}.code`);

        const previousTablePath = tableNamePaths.get(model.tableName);
        if (previousTablePath) {
            fail(
                `${path}.tableName`,
                `duplicate table name "${model.tableName}"; first declared at ${previousTablePath}`,
            );
        }
        tableNamePaths.set(model.tableName, `${path}.tableName`);

        if (!model.attributes || typeof model.attributes !== 'object' || Array.isArray(model.attributes)) {
            fail(`${path}.attributes`, 'expected an attribute map');
        }
        if (
            model.useRevision &&
            Object.prototype.hasOwnProperty.call(model.attributes, 'revision') &&
            !options.allowImplicitSystemAttributes
        ) {
            fail(`${path}.attributes.revision`, 'revision is an implicit system attribute');
        }

        const columnNamePaths = new Map<string, string>();
        Object.entries(model.attributes).forEach(([key, attribute]) => {
            validateAttribute(model, key, attribute, path, options);
            const columnPath = `${path}.attributes.${key}.columnName`;
            const previousColumnPath = columnNamePaths.get(attribute.columnName);
            if (previousColumnPath) {
                fail(
                    columnPath,
                    `duplicate column name "${attribute.columnName}"; first declared at ${previousColumnPath}`,
                );
            }
            columnNamePaths.set(attribute.columnName, columnPath);
        });

        const indexes = model.indexes ?? [];
        if (!Array.isArray(indexes)) {
            fail(`${path}.indexes`, 'expected an array');
        }
        indexes.forEach((index, indexPosition) => {
            const indexPath = `${path}.indexes[${indexPosition}]`;
            if (!index || typeof index !== 'object' || Array.isArray(index)) {
                fail(indexPath, 'expected an index object');
            }
            requireNonEmptyString(index.name, `${indexPath}.name`);
            const previousIndexPath = indexNamePaths.get(index.name);
            if (previousIndexPath) {
                fail(
                    `${indexPath}.name`,
                    `duplicate index name "${index.name}"; first declared at ${previousIndexPath}`,
                );
            }
            indexNamePaths.set(index.name, `${indexPath}.name`);
            if (!Array.isArray(index.codes) || index.codes.length === 0) {
                fail(`${indexPath}.codes`, 'expected at least one attribute code');
            }
            const codes = new Set<string>();
            index.codes.forEach((code, codePosition) => {
                const codePath = `${indexPath}.codes[${codePosition}]`;
                requireAttribute(model, code, codePath);
                if (codes.has(code)) {
                    fail(codePath, `duplicate attribute code "${code}"`);
                }
                codes.add(code);
            });
            if (index.type !== undefined && index.type !== 'primary' && index.type !== 'unique') {
                fail(`${indexPath}.type`, `unsupported index type "${String(index.type)}"`);
            }
        });

        modelsByCode.set(model.code, model);
    });

    models.forEach((model, modelIndex) => {
        const modelPath = `models[${modelIndex}]`;
        Object.entries(model.attributes).forEach(([key, attribute]) => {
            if (
                attribute.type !== SysFieldTypeEnum.SINGLE_QUOTE &&
                attribute.type !== SysFieldTypeEnum.MULTI_QUOTE
            ) {
                return;
            }

            const path = `${modelPath}.attributes.${key}`;
            const relation = attribute as IAttribute & {
                refCode?: string;
                refFieldCode?: string;
                refDisplayCode?: string;
                refLinkQueryCodes?: string[];
                midCode?: string;
                selfInMidFieldCode?: string;
                refInMidFieldCode?: string;
            };
            requireNonEmptyString(relation.refCode, `${path}.refCode`);
            const refModel =
                modelsByCode.get(relation.refCode!) ??
                fail(`${path}.refCode`, `referenced model "${relation.refCode}" does not exist`);
            requireAttribute(refModel, relation.refFieldCode, `${path}.refFieldCode`);
            requireAttribute(refModel, relation.refDisplayCode, `${path}.refDisplayCode`);
            if (relation.refLinkQueryCodes !== undefined) {
                if (!Array.isArray(relation.refLinkQueryCodes)) {
                    fail(`${path}.refLinkQueryCodes`, 'expected an array');
                }
                relation.refLinkQueryCodes.forEach((code, position) =>
                    requireAttribute(refModel, code, `${path}.refLinkQueryCodes[${position}]`),
                );
            }

            if (attribute.type === SysFieldTypeEnum.MULTI_QUOTE) {
                requireNonEmptyString(relation.midCode, `${path}.midCode`);
                const midModel =
                    modelsByCode.get(relation.midCode!) ??
                    fail(
                        `${path}.midCode`,
                        `intermediate model "${relation.midCode}" does not exist`,
                    );
                requireAttribute(midModel, relation.selfInMidFieldCode, `${path}.selfInMidFieldCode`);
                requireAttribute(midModel, relation.refInMidFieldCode, `${path}.refInMidFieldCode`);
            }
        });

        if (model.parentCode !== undefined) {
            requireNonEmptyString(model.parentCode, `${modelPath}.parentCode`);
            const parentModel = modelsByCode.get(model.parentCode);
            if (!parentModel) {
                fail(`${modelPath}.parentCode`, `parent model "${model.parentCode}" does not exist`);
            }
            requireAttribute(model, model.parentRefFieldCode, `${modelPath}.parentRefFieldCode`);
        } else if (model.parentRefFieldCode !== undefined) {
            fail(`${modelPath}.parentRefFieldCode`, 'requires parentCode');
        }

        if (model.childCodes !== undefined) {
            if (!Array.isArray(model.childCodes)) {
                fail(`${modelPath}.childCodes`, 'expected an array');
            }
            const childCodes = new Set<string>();
            model.childCodes.forEach((childCode, position) => {
                const path = `${modelPath}.childCodes[${position}]`;
                requireNonEmptyString(childCode, path);
                if (childCodes.has(childCode)) {
                    fail(path, `duplicate child model code "${childCode}"`);
                }
                childCodes.add(childCode);
                const childModel =
                    modelsByCode.get(childCode) ??
                    fail(path, `child model "${childCode}" does not exist`);
                if (childModel.parentCode !== model.code) {
                    fail(path, `model "${childCode}" does not declare parentCode "${model.code}"`);
                }
            });
        }
    });

    return true;
};
