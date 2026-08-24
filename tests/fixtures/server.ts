import http from "node:http";
import { gzipSync } from "node:zlib";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

export interface Fixture {
  origin: string;
  requests: string[];
  maxConcurrentRequests: () => number;
  close: () => Promise<void>;
}

/**
 * Local HTTP fixture server on 127.0.0.1. Routes exercise the transport's
 * accept/redirect/limit/failure paths. Tests never touch the public internet.
 */
export async function startFixture(): Promise<Fixture> {
  const requests: string[] = [];
  let activeRequests = 0;
  let maxConcurrentRequests = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${url.pathname}${url.search}`);
    activeRequests += 1;
    maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      activeRequests -= 1;
    };
    res.once("finish", finish);
    res.once("close", finish);
    switch (url.pathname) {
      case "/":
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body>hello world</body></html>");
        return;
      case "/gzip": {
        const body = gzipSync(Buffer.from("gzipped body content"));
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        res.end(body);
        return;
      }
      case "/redirect-once":
        res.writeHead(302, { location: "/" });
        res.end();
        return;
      case "/loop":
        res.writeHead(302, { location: "/loop" });
        res.end();
        return;
      case "/chain": {
        const n = Number(url.searchParams.get("n") ?? "0");
        if (n > 0) {
          res.writeHead(302, { location: `/chain?n=${n - 1}` });
          res.end();
        } else {
          res.writeHead(200).end("done");
        }
        return;
      }
      case "/ftp-redirect":
        res.writeHead(302, { location: "ftp://example.com/resource" });
        res.end();
        return;
      case "/cross-origin-redirect":
        res.writeHead(302, { location: "https://outside.example/resource" });
        res.end();
        return;
      case "/bigheader":
        res.writeHead(200, { "x-big": "a".repeat(20_000) });
        res.end("ok");
        return;
      case "/bigbody":
        res.writeHead(200);
        res.end(Buffer.alloc(50_000, 0x61));
        return;
      case "/biggzip": {
        // Small compressed payload, large decompressed output (decompression bomb).
        const body = gzipSync(Buffer.alloc(200_000, 0x61));
        res.writeHead(200, { "content-encoding": "gzip" });
        res.end(body);
        return;
      }
      case "/slow":
        setTimeout(() => {
          res.writeHead(200).end("late");
        }, 1_000);
        return;
      case "/site-entry":
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body>site entry</body></html>");
        return;
      case "/private":
      case "/crawler-private":
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body>private content</body></html>");
        return;
      case "/robots.txt":
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(
          "User-agent: geo-aeo-audit\nDisallow: /crawler-private\nDisallow: /private\nAllow: /private/public\n" +
            "User-agent: OAI-SearchBot\nAllow: /\n" +
            "User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: /sitemap-index.xml\n",
        );
        return;
      case "/sitemap.xml":
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      case "/sitemap-index.xml":
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          "<?xml version=\"1.0\"?><sitemapindex>" +
            "<sitemap><loc>/sitemap-a.xml</loc></sitemap>" +
            "<sitemap><loc>/sitemap-b.xml</loc></sitemap>" +
            "<sitemap><loc>https://outside.example/sitemap.xml</loc></sitemap>" +
            "</sitemapindex>",
        );
        return;
      case "/sitemap-a.xml":
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          `<?xml version="1.0"?><urlset>` +
            `<url><loc>http://${req.headers.host}/public-a#fragment</loc></url>` +
            `<url><loc>http://${req.headers.host}/private</loc></url>` +
            `<url><loc>https://outside.example/page</loc></url>` +
            `<url><loc>not a URL</loc></url>` +
            `</urlset>`,
        );
        return;
      case "/sitemap-b.xml":
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          `<?xml version="1.0"?><urlset>` +
            `<url><loc>http://${req.headers.host}/public-a</loc></url>` +
            `<url><loc>http://${req.headers.host}/public-b?x=1&amp;y=2</loc></url>` +
            `<url><loc>http://${req.headers.host}/private/public</loc></url>` +
            `</urlset>`,
        );
        return;
      case "/public-a":
      case "/public-b":
      case "/private/public":
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(`<html><body>${url.pathname}</body></html>`);
        }, 40);
        return;
      default:
        res.writeHead(404).end("not found");
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    maxConcurrentRequests: () => maxConcurrentRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
