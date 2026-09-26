import { createContactsApp } from "./app.js";

const defaultPort = 4173;
const configuredPort = Number.parseInt(process.env.CONTACTS_PORT ?? "", 10);
const port = Number.isInteger(configuredPort) ? configuredPort : defaultPort;
const host = "127.0.0.1";

const app = createContactsApp();
const server = app.listen(port, host, () => {
  console.log(`Member Contacts Admin listening at http://${host}:${port}`);
});

function shutdown(): void {
  server.close((error) => {
    if (error !== undefined) {
      console.error("Failed to close the Contacts server cleanly.");
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
