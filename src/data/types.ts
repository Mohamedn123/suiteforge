export interface SdfFieldType {
    id: string;
    label: string;
    description: string;
    xmlValue: string;
}

export interface SdfScriptEntryPoint {
    id: string;
    description: string;
}

export interface SdfScriptType {
    id: string;
    label: string;
    xmlTag: string;
    scriptTypeAnnotation: string;
    entryPoints: SdfScriptEntryPoint[];
    description: string;
}

export interface SdfRecordType {
    id: string;
    label: string;
    scriptId: string;
    description: string;
}

export interface SdfCommand {
    id: string;
    label: string;
    description: string;
    flow: 'upload' | 'download' | 'local';
    icon: string;
}

export interface SdfCommandCategory {
    category: string;
    commands: SdfCommand[];
}
