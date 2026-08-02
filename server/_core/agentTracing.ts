export const configureHostedAgentTracing = () => {
  if (
    process.env.AGENT_TRACING_ENABLED !== "true" &&
    process.env.OPENAI_AGENTS_DISABLE_TRACING === undefined
  ) {
    process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";
  }
};
