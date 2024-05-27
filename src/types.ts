export interface OpentelemetryPluginConfig {
    endpoint: string;
    exporter: 'console' | 'otlp' | string;
    cluster: string;
    serviceName: string;
    serviceNamespace: string;
    result: boolean | string;
    variables: boolean | string;
    document: boolean | string;
    delegationArgs: boolean | string;
    traceIdInResult: boolean | string;
    batch?: OpentelemetryPluginBatchConfig;
}

export interface OpentelemetryPluginBatchConfig {
    maxQueueSize: number;
    maxExportBatchSize: number;
    scheduledDelayMillis: number;
    exportTimeoutMillis: number;
}
