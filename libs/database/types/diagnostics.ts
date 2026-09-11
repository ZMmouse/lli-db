export type IDiagnosticEventType =
    | 'query:start'
    | 'query:success'
    | 'query:error'
    | 'migration:start'
    | 'migration:success'
    | 'migration:error'
    | 'migration:model:start'
    | 'migration:model:success'
    | 'migration:model:error'
    | 'revision:conflict'
    | 'cursor:page:start'
    | 'cursor:page:success'
    | 'cursor:page:error'
    | 'snapshot:open'
    | 'snapshot:close'
    | 'snapshot:expire'
    | 'snapshot:limit'
    | 'backup:start'
    | 'backup:success'
    | 'backup:error'
    | 'integrity-check:start'
    | 'integrity-check:success'
    | 'integrity-check:error'
    | 'stored-data-validation:start'
    | 'stored-data-validation:success'
    | 'stored-data-validation:error';

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
    snapshotCount?: number;
    checkedRows?: number;
    errorCount?: number;
    size?: number;
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
