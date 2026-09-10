import { isNil } from 'lodash';
import dayjs from 'dayjs';
import { LliDbError } from '../../error/lli-db-error';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';
import { IField } from '../../types/i-field';

export const DatetimeField: IField = {
    dbFiledType: DBFieldTypeEnum.DATETIME,
    name: SysFieldTypeEnum.DATETIME,
    toDB(value: string) {
        if (!dayjs(value).isValid()) {
            LliDbError.throw400(`错误日期格式: ${value}`);
        }
        return new Date(value);
    },
    fromDB(value: string) {
        if (isNil(value)) {
            return null;
        }
        return dayjs(value).format('YYYY-MM-DD hh:mm:ss');
    },
};
