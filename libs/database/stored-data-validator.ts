import type { Database } from './database';
import type { Knex } from 'knex';
import { DBFieldTypeEnum } from './enum/field-type-enum';
import { LliDbError } from './error/lli-db-error';
import { SysExpansionFieldTypeEnum } from './enum/field-type-enum';
import { validateStrictFieldValue } from './entity-manager/validate-write';
import type {
    IStoredDataValidationIssue,
    IStoredDataValidationOptions,
    IStoredDataValidationReport,
} from './types/database';

const validatePositive = (value: number, field: string) => {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new LliDbError(`${field} must be a positive safe integer`, 'LLI400');
    }
};

export const validateStoredData = async (
    db: Database,
    options: IStoredDataValidationOptions = {},
    transaction?: Knex.Transaction,
): Promise<IStoredDataValidationReport> => {
    const batchSize = options.batchSize ?? 500;
    const stopAfterErrors = options.stopAfterErrors ?? 100;
    validatePositive(batchSize, 'batchSize');
    validatePositive(stopAfterErrors, 'stopAfterErrors');

    const requested = options.models ? new Set(options.models) : undefined;
    if (requested) {
        for (const code of requested) {
            if (!db.modelStore.has(code)) {
                throw new LliDbError(`Model ${code} does not exist`, 'LLI400');
            }
        }
    }
    const models = db.modelStore
        .getModels()
        .filter((model) => model.code !== 'lliModelRecord')
        .filter((model) => !requested || requested.has(model.code));
    const issues: IStoredDataValidationIssue[] = [];
    let checkedRows = 0;
    let truncated = false;

    for (const model of models) {
        let offset = 0;
        while (true) {
            let query = db
                .getConnection(model.tableName)
                .select('*')
                .orderBy(model.attributes.id.columnName, 'asc')
                .limit(batchSize)
                .offset(offset);
            if (transaction) query = query.transacting(transaction);
            const rows = await query;
            if (rows.length === 0) break;
            for (const row of rows) {
                checkedRows += 1;
                for (const [fieldCode, attribute] of Object.entries(model.attributes)) {
                    const base = db.fieldTypeManager.getBaseFieldType(attribute.type);
                    if (base.isColumn === false) continue;
                    try {
                        const raw = row[attribute.columnName];
                        let value: unknown;
                        if (raw === null || raw === undefined) {
                            value = null;
                        } else if (base.dbFiledType === DBFieldTypeEnum.JSON && typeof raw === 'string') {
                            value = JSON.parse(raw);
                        } else {
                            value = db.fieldTypeManager.get(attribute.type).fromDB(raw, db, attribute);
                        }
                        validateStrictFieldValue(db, model, fieldCode, attribute, value);
                        if (
                            attribute.type === SysExpansionFieldTypeEnum.REVISION &&
                            (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
                        ) {
                            throw new LliDbError('Stored revision must be positive', 'LLI40020', {
                                modelCode: model.code,
                                fieldCode,
                                reason: 'expected a positive safe integer',
                            });
                        }
                    } catch (error) {
                        const detail =
                            error instanceof LliDbError && error.detail && typeof error.detail === 'object'
                                ? error.detail
                                : undefined;
                        issues.push({
                            modelCode: model.code,
                            fieldCode,
                            recordId: String(row[model.attributes.id.columnName]),
                            reason:
                                typeof detail?.reason === 'string'
                                    ? detail.reason
                                    : error instanceof SyntaxError
                                      ? 'invalid stored JSON'
                                      : 'stored value failed validation',
                        });
                        if (issues.length >= stopAfterErrors) {
                            truncated = true;
                            return {
                                ok: false,
                                checkedRows,
                                errorCount: issues.length,
                                truncated,
                                issues,
                            };
                        }
                    }
                }
            }
            if (rows.length < batchSize) break;
            offset += rows.length;
        }
    }

    return {
        ok: issues.length === 0,
        checkedRows,
        errorCount: issues.length,
        truncated,
        issues,
    };
};
