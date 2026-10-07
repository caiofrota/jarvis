import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
export async function mockVoice() {
  let transcript: string | undefined;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/health")
      res.end(
        JSON.stringify({ ready: true, voices: ["kokoro-pf_dora", "fixture-voice"], busy: false }),
      );
    else if (req.url === "/synthesize") {
      res.setHeader("content-type", "application/octet-stream");
      res.end(Buffer.alloc(6400));
    } else if (req.url?.startsWith("/transcribe"))
      res.end(
        JSON.stringify({
          speech: true,
          text: transcript ?? (body.includes("stop") ? "pode parar" : "bom dia"),
        }),
      );
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    let sent = false;
    ws.on("message", (data, binary) => {
      if (!binary && data.toString() === "clear") sent = false;
      else if (binary && !sent) {
        sent = true;
        ws.send(Buffer.from(data as Buffer));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    setTranscript: (text: string) => {
      transcript = text;
    },
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
