import type { SdfFieldType, SdfScriptType, SdfRecordType, SdfCommandCategory } from './types';

import fieldTypesRaw from './sdf/fieldTypes.json';
import scriptTypesRaw from './sdf/scriptTypes.json';
import recordTypesRaw from './sdf/recordTypes.json';
import sdfCommandsRaw from './sdf/sdfCommands.json';

export type { SdfFieldType, SdfScriptType, SdfRecordType, SdfCommandCategory };
export type { SdfCommand } from './types';

export const sdfFieldTypes: SdfFieldType[] = fieldTypesRaw as SdfFieldType[];
export const sdfScriptTypes: SdfScriptType[] = scriptTypesRaw as SdfScriptType[];
export const sdfRecordTypes: SdfRecordType[] = recordTypesRaw as SdfRecordType[];
export const sdfCommandCategories: SdfCommandCategory[] = sdfCommandsRaw as SdfCommandCategory[];
