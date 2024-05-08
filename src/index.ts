// eslint-disable-next-line import/namespace,import/no-extraneous-dependencies
import { camelCase } from 'change-case';
import { type Plugin } from 'graphql-yoga';
import {
    getCurrentOtelContext,
    setCurrentOtelContext,
    useOpenTelemetry as useEnvelopeOpenTelemetry,
} from '@envelop/opentelemetry';
import { hashObject } from '@graphql-mesh/string-interpolation';
import { type MeshPlugin, type MeshPluginOptions } from '@graphql-mesh/types';
import * as opentelemetry from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { B3InjectEncoding, B3Propagator } from '@opentelemetry/propagator-b3';
import { Resource } from '@opentelemetry/resources';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
    SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
    SEMRESATTRS_SERVICE_NAME,
    SEMRESATTRS_SERVICE_NAMESPACE,
} from '@opentelemetry/semantic-conventions';
import { type OpentelemetryPluginConfig } from './types';
import { cleanPath, evaluate, findParentPath, removeTypename } from './utils';

enum AttributeName {
    CLUSTER = 'cluster',
    DELEGATION_ARGS = 'graphql.delegation.args',
    DELEGATION_TYPE_NAME = 'graphql.delegation.typeName',
    DELEGATION_SOURCE_NAME = 'graphql.delegation.sourceName',
    DELEGATION_FIELD_NAME = 'graphql.delegation.fieldName',
    DELEGATION_BATCH = 'graphql.delegation.batch',
    DELEGATION_RESULT = 'graphql.delegation.result',
    DELEGATION_EXCEPTION = 'graphql.delegation.exception',
}

export default function useOpenTelemetry(
    pluginOptions: MeshPluginOptions<OpentelemetryPluginConfig>,
): MeshPlugin<any> {
    const options: MeshPluginOptions<OpentelemetryPluginConfig> = Object.keys(pluginOptions).reduce(
        function (result: any, key) {
            // @ts-expect-error
            result[key] = evaluate(pluginOptions[key]);

            return result;
        },
        {},
    );

    const spanByPath = new WeakMap<any, opentelemetry.Span>();
    const wrappedTraceKeys = new WeakMap<any, Set<string>>();

    const tracingProvider = new NodeTracerProvider({
        resource: Resource.default().merge(
            new Resource({
                [SEMRESATTRS_SERVICE_NAME]: options.serviceName ?? 'graphql-mesh',
                [SEMRESATTRS_SERVICE_NAMESPACE]: options.serviceNamespace ?? 'unknown',
                [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: options.cluster ?? 'unknown',
            }),
        ),
    });

    let exporter: ConsoleSpanExporter | OTLPTraceExporter = new ConsoleSpanExporter();
    if (options.exporter === 'otlp' && options.endpoint) {
        exporter = new OTLPTraceExporter({
            url: options.endpoint,
        });
    }

    tracingProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    tracingProvider.register();

    const tracer = tracingProvider.getTracer(options.serviceName ?? 'graphql-mesh');

    const propagator = new CompositePropagator({
        propagators: [
            new B3Propagator(),
            new B3Propagator({ injectEncoding: B3InjectEncoding.MULTI_HEADER }),
            new W3CTraceContextPropagator(),
        ],
    });

    opentelemetry.propagation.setGlobalPropagator(propagator);

    const contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    opentelemetry.context.setGlobalContextManager(contextManager);

    const defaultSpanAttrs = {
        [AttributeName.CLUSTER]: options.cluster ?? 'unknown',
    };

    return {
        onPluginInit: function ({ addPlugin }) {
            addPlugin({
                onExecute({ args, extendContext }) {
                    const parentContext = propagator.extract(
                        getCurrentOtelContext(args.contextValue),
                        args.contextValue.request.headers,
                        {
                            keys(carrier: Headers): string[] {
                                return Object.keys(carrier);
                            },
                            get(carrier: Headers, key: string): string | undefined {
                                return carrier.has(key) ? carrier.get(key) : undefined;
                            },
                        },
                    );
                    setCurrentOtelContext(args.contextValue, parentContext);

                    extendContext({
                        propagator: new Proxy(args.contextValue, {
                            get: function (context, field: string): string | undefined {
                                const currOtelContext =
                                    // @ts-expect-error
                                    contextManager._stack.length > 0
                                        ? contextManager.active()
                                        : getCurrentOtelContext(context);

                                const propagators: Record<string, string | undefined> = {
                                    traceId: opentelemetry.trace
                                        .getSpan(currOtelContext)
                                        ?.spanContext().traceId,
                                };

                                propagator.inject(currOtelContext, propagators, {
                                    set(
                                        carrier: Record<string, string>,
                                        key: string,
                                        value: string,
                                    ): void {
                                        carrier[camelCase(key)] = value;
                                    },
                                });

                                return Object.keys(propagators).includes(field)
                                    ? propagators[field]
                                    : undefined;
                            },
                        }),
                    } as any);
                },
            } as Plugin);
            addPlugin(
                useEnvelopeOpenTelemetry(
                    {
                        result: options.result as boolean | undefined,
                        variables: options.variables as boolean | undefined,
                        document: options.document as boolean | undefined,
                        traceIdInResult: options.traceIdInResult ? 'traceId' : undefined,
                    },
                    tracingProvider,
                    undefined,
                    defaultSpanAttrs,
                    options.serviceName ?? 'graphql-mesh',
                ),
            );
        },
        onDelegate(payload) {
            let keys: Set<string> = new Set<string>();
            if (wrappedTraceKeys.has(payload.context)) {
                keys = wrappedTraceKeys.get(payload.context);
            }

            if (keys.has(payload.key)) {
                // eslint-disable-next-line no-void
                return void 0;
            }

            const currentPath = payload?.info?.path;

            const spanName = `${payload.sourceName}.${payload.typeName}.${payload.fieldName}`;

            let currOtelContext = getCurrentOtelContext(payload.context);

            const parentPath = findParentPath(currentPath?.prev);
            const cleanedParentPath = cleanPath(parentPath);

            if (keys.has(hashObject({ spanName, cleanedParentPath }))) {
                // eslint-disable-next-line no-void
                return void 0;
            }

            if (parentPath) {
                const parentSpan = spanByPath.get(parentPath);
                if (parentSpan) {
                    currOtelContext = opentelemetry.trace.setSpan(currOtelContext, parentSpan);
                }
            }

            let args = payload.args;
            if (payload.key && payload.argsFromKeys) {
                args = payload.argsFromKeys([payload.key]);
            }

            const delegateSpan = tracer.startSpan(
                `${payload.sourceName}.${payload.typeName}.${payload.fieldName}`.toLowerCase(),
                {
                    kind: SpanKind.SERVER,
                    attributes: {
                        ...defaultSpanAttrs,
                        [AttributeName.DELEGATION_TYPE_NAME]: payload.typeName,
                        [AttributeName.DELEGATION_SOURCE_NAME]: payload.sourceName,
                        [AttributeName.DELEGATION_FIELD_NAME]: payload.fieldName,
                        [AttributeName.DELEGATION_BATCH]: !!payload.key,
                        ...(options.delegationArgs
                            ? {
                                  [AttributeName.DELEGATION_ARGS]: JSON.stringify(args ?? {}),
                              }
                            : {}),
                    },
                },
                currOtelContext,
            );

            if (payload.key) {
                keys.add(payload.key);
            } else if (cleanedParentPath) {
                keys.add(hashObject({ spanName, cleanedParentPath }));
            }

            wrappedTraceKeys.set(payload.context, keys);

            spanByPath.set(currentPath, delegateSpan);

            // @ts-expect-error
            contextManager._enterContext(
                opentelemetry.trace.setSpan(currOtelContext, delegateSpan),
            );

            return ({ result }) => {
                if (result instanceof Error) {
                    delegateSpan.recordException({
                        name: AttributeName.DELEGATION_EXCEPTION,
                        message: JSON.stringify(result),
                    });
                } else if (result && options.result) {
                    delegateSpan.setAttribute(
                        AttributeName.DELEGATION_RESULT,
                        JSON.stringify(removeTypename(result)),
                    );
                }

                delegateSpan.end();

                // @ts-expect-error
                contextManager._exitContext();
            };
        },
    };
}
