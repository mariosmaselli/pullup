import type { MiddlewareHandler } from 'hono'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const parse = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

// Pullup is a local app, but any website open in the same browser can still send requests to
// localhost. This guard rejects:
// - requests whose Host isn't localhost (DNS rebinding: a hostile domain resolving to 127.0.0.1)
// - any request from another origin — browsers attach Origin to cross-origin fetches, including
//   reads, so other sites (even other localhost dev servers) can neither read nor change data
// - state-changing requests marked cross-site that carry no Origin.
export function localOnly(ports: number[]): MiddlewareHandler {
  const allowedPorts = new Set(ports.map(String))

  return async (c, next) => {
    const host = c.req.header('host')
    if (host && !LOCAL_HOSTS.has(parse(`http://${host}`)?.hostname ?? '')) {
      return c.json({ error: 'Forbidden host' }, 403)
    }

    const origin = c.req.header('origin')
    if (origin) {
      const url = parse(origin)
      if (!url || !LOCAL_HOSTS.has(url.hostname) || !allowedPorts.has(url.port)) {
        return c.json({ error: 'Cross-origin request blocked' }, 403)
      }
    } else if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.header('sec-fetch-site') === 'cross-site'
    ) {
      return c.json({ error: 'Cross-origin request blocked' }, 403)
    }
    await next()
  }
}
