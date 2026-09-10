export type IDiagnosticEventType =
    | 'query:start'
    | 'query:success'
    | 'query:error'
    | 'migration:start'
    | 'migration:success'
    | 'migration:error'
    | 'migration:model:start'
    | 'migration:model:success'
    | 'migration:model:error';

export interface IDiagnosticError {
    name: string;
    code?: string;
}

export interface IDiagnosticEvent {
    type: IDiagnosticEventType;
    timestamp: string;
    modelCode?: string;
    operation?: string;
    durationMs?: number;
    resultCount?: number;
    modelCount?: number;
    error?: Readonly<IDiagnosticError>;
}

export type IDiagnosticListener = (
    event: Readonly<IDiagnosticEvent>,
) => Promise<void> | void;

export interface IDiagnosticLogger {
    debug?(message: string, event: Readonly<IDiagnosticEvent>): Promise<void> | void;
    info?(message: string, event: Readonly<IDiagnosticEvent>): Promise<void> | void;
    warn?(message: string, event: Readonly<IDiagnosticEvent>): Promise<void> | void;
    error?(message: string, event: Readonly<IDiagnosticEvent>): Promise<void> | void;
}

export interface IDiagnosticsConfig {
    logger?: IDiagnosticLogger;
    onEvent?: IDiagnosticListener;
}
