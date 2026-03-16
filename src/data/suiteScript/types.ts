export interface SsMethodParam {
    name: string;
    type: string;
    description: string;
    optional?: boolean;
}

export interface SsMethod {
    name: string;
    description: string;
    params: SsMethodParam[];
    supportedIn?: string[];
    returns: string;
    returnType?: string;
}

export interface SsProperty {
    name: string;
    type: string;
    description: string;
    readOnly?: boolean;
}

export interface SsEnum {
    name: string;
    description: string;
    members: { name: string; value: string; description: string }[];
}

export interface SsObjectType {
    name: string;
    description: string;
    supportedIn?: string[];
    methods: SsMethod[];
    properties: SsProperty[];
}

export interface SsModuleDefinition {
    module: string;
    description: string;
    methods: SsMethod[];
    enums: SsEnum[];
    objectTypes: SsObjectType[];
    supportedIn?: string[];
}
