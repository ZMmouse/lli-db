import { FieldTypeManager } from '../index';
import { SwitchField } from './switch';
import { DateField } from './date';
import { DatetimeField } from './datetime';
import { FloatField } from './float';
import { IntField } from './int';
import { JsonField } from './json';
import { LongTextField } from './long-text';
import { TimeField } from './time';
import { TextField } from './text';
import { MultiQuoteField } from './multi-quote';
import { SingleQuoteField } from './single-quote';

export const registerFieldTypes = (fieldTypeManager: FieldTypeManager) => {
    fieldTypeManager.extends(SwitchField);
    fieldTypeManager.extends(DateField);
    fieldTypeManager.extends(DatetimeField);
    fieldTypeManager.extends(FloatField);
    fieldTypeManager.extends(IntField);
    fieldTypeManager.extends(JsonField);
    fieldTypeManager.extends(LongTextField);
    fieldTypeManager.extends(MultiQuoteField);
    fieldTypeManager.extends(SingleQuoteField);
    fieldTypeManager.extends(TimeField);
    fieldTypeManager.extends(TextField);
};
