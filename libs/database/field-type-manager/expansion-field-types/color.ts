import { IExpansionField } from '../../types/i-field';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';
import { LliDbError } from '../../error/lli-db-error';

// 检查字符串是否是颜色值 支持rgb hex rgba hsl
export const isColor = (value: string): boolean => {
    value = value.replace(/\s+/g, '').toLowerCase();
    const hexReg = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/;
    if (hexReg.test(value)) {
        return true;
    }
    const rgbReg = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
    if (rgbReg.test(value)) {
        return true;
    }
    const rgbaReg = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d+(\.\d+)?)\s*\)$/;
    if (rgbaReg.test(value)) {
        return true;
    }
    const hslReg = /^hsl\((\d{1,3}),(\d{1,3})%?,(\d{1,3})%?\)$/;
    if (hslReg.test(value)) {
        return true;
    }
    const hslaReg = /^hsla\((\d{1,3}),(\d{1,3})%?,(\d{1,3})%?,([01]|0?\.\d{1,3}|1\.0{0,3})\)$/;
    return hslaReg.test(value);
};

export default {
    inherit: SysFieldTypeEnum.TEXT,
    name: SysExpansionFieldTypeEnum.COLOR,

    toDB(value: unknown) {
        if (typeof value !== 'string') {
            LliDbError.throw400(`${value}必须为字符串`);
        }
        if (!isColor(value)) {
            LliDbError.throw400(`${value}必须为颜色值,支持hex、rgba、rgb、hsl、hsla`);
        }
        return value;
    },
} as IExpansionField;
