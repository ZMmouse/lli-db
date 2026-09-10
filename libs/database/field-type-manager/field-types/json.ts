import { IField } from '../../types/i-field';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export const JsonField: IField = {
    dbFiledType: DBFieldTypeEnum.JSON,
    name: SysFieldTypeEnum.JSON,

    toDB(value: unknown): unknown {
        return JSON.stringify(value);
    },
    fromDB(value: unknown): unknown {
        try {
            if (typeof value === 'string') {
                return JSON.parse(value);
            }
        } catch {
            return value;
        }
        return value;
    },
};
