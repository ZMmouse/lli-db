import { toString } from 'lodash';
import dayjs from 'dayjs';
import { LliDbError } from '../../error/lli-db-error';
import { IField } from '../../types/i-field';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export const TimeField: IField = {
    dbFiledType: DBFieldTypeEnum.TIME,
    name: SysFieldTypeEnum.TIME,
    toDB(value: unknown): unknown {
        const date = dayjs(value as any);
        if (date.isValid()) {
            return date.format('hh:mm:ss');
        }
        LliDbError.throw400(`错误日期格式: ${toString(value)}`);
    },
    fromDB(value: unknown): unknown {
        return value;
    },
};
