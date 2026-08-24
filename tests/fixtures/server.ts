import http from "node:http";
import { gzipSync } from "node:zlib";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

export interface Fixture {
  origin: string;
  close: () => Promise<void>;
}

/**
 * Local HTTP fixture server on 127.0.0.1. Routes exercise the transport's
 * accept/redirect/limit/failure paths. Tests never touch the public internet.
 */
export async function startFixture(): Promise<Fixture> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
      default:
        res.writeHead(404).end("not found");
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
