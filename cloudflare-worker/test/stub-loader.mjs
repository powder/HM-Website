// Lets the Worker's Durable Object module load under plain Node for tests: the 'cloudflare:workers' module only exists inside the Workers runtime.
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
  return next(specifier, context);
}
