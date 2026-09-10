import type {
    IDiagnosticError,
    IDiagnosticEvent,
    IDiagnosticEventType,
    IDiagnosticListener,
    IDiagnosticLogger,
    IDiagnosticsConfig,
} from './types/diagnostics';

type IDiagnosticInput = Omit<IDiagnosticEvent, 'timestamp'>;
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const logLevels: Record<IDiagnosticEventType, LogLevel> = {
    'query:start': 'debug',
    'query:success': 'debug',
    'query:error': 'error',
    'migration:start': 'info',
    'migration:success': 'info',
    'migration:error': 'error',
    'migration:model:start': 'debug',
    'migration:model:success': 'debug',
    'migration:model:error': 'error',
};

const safelyInvoke = (callback: () => Promise<void> | void) => {
    try {
        const result = callback();
        if (result && typeof result.then === 'function') {
            void result.catch(() => undefined);
        }
    } catch {
        // Diagnostics must never change database behavior.
    }
};

export const toDiagnosticError = (error: unknown): IDiagnosticError => {
    if (error instanceof Error) {
        const code = (error as Error & { code?: unknown }).code;
        return {
            name: error.name || 'Error',
            ...(typeof code === 'string' || typeof code === 'number'
                ? { code: String(code) }
                : {}),
        };
    }
    return { name: 'UnknownError' };
};

export class Diagnostics {
    private readonly listeners = new Set<IDiagnosticListener>();
    private readonly logger?: IDiagnosticLogger;

    constructor(config?: IDiagnosticsConfig) {
        this.logger = config?.logger;
        if (config?.onEvent) {
            this.listeners.add(config.onEvent);
        }
    }

    subscribe(listener: IDiagnosticListener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    emit(input: IDiagnosticInput) {
        const event = Object.freeze({
            ...input,
            ...(input.error ? { error: Object.freeze({ ...input.error }) } : {}),
            timestamp: new Date().toISOString(),
        }) as Readonly<IDiagnosticEvent>;

        for (const listener of this.listeners) {
            safelyInvoke(() => listener(event));
        }

        const level = logLevels[event.type];
        const log = this.logger?.[level];
        if (log) {
            safelyInvoke(() => log.call(this.logger, event.type, event));
        }
        return event;
    }
}

export const getDiagnosticResultCount = (result: unknown): number | undefined => {
    if (Array.isArray(result)) {
        return result.length;
    }
    if (typeof result === 'number' && Number.isFinite(result)) {
        return result;
    }
    return undefined;
};
