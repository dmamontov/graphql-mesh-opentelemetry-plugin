# Opentelemetry Plugin for GraphQL Mesh

Opentelemetry Plugin is a plugin integrates OpenTelemetry tracing into GraphQL Mesh, allowing you to monitor and trace your GraphQL queries, mutations, and subscriptions.

## Installation

Before you can use the Opentelemetry Plugin, you need to install it along with GraphQL Mesh if you haven't already done so. You can install these using npm or yarn.

```bash
npm install @dmamontov/graphql-mesh-opentelemetry-plugin
```

or

```bash
yarn add @dmamontov/graphql-mesh-opentelemetry-plugin
```

## Configuration

### Modifying tsconfig.json

To make TypeScript recognize the Opentelemetry Plugin, you need to add an alias in your tsconfig.json.

Add the following paths configuration under the compilerOptions in your tsconfig.json file:

```json
{
  "compilerOptions": {
    "paths": {
       "opentelemetry": ["node_modules/@dmamontov/graphql-mesh-opentelemetry-plugin"]
    }
  }
}
```

### Adding the Plugin to GraphQL Mesh

You need to include the Opentelemetry Plugin in your GraphQL Mesh configuration file (usually .meshrc.yaml). Below is an example configuration that demonstrates how to use this plugin:

```yaml
plugins:
  - opentelemetry:
      endpoint: '{env.OPENTELEMETRY_ENDPOINT}'
      exporter: '{env.OPENTELEMETRY_EXPORTER}'
      cluster: '{env.OPENTELEMETRY_CLUSTER}'
      serviceName: '{env.OPENTELEMETRY_SERVICE_NAME}'
      serviceNamespace: '{env.OPENTELEMETRY_SERVICE_NAMESPACE}'
      delegationArgs: true
      traceIdInResult: '{env.OPENTELEMETRY_TRACE_IN_RESULT}'
```

## Conclusion

Remember, always test your configurations in a development environment before applying them in production to ensure that everything works as expected.