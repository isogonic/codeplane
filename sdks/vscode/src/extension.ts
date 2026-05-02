import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as vscode from "vscode";

type ServerHandle = {
  port: number
  url: string
  cwd?: string
  process: ChildProcessWithoutNullStreams
  output: vscode.OutputChannel
}

const servers = new Set<ServerHandle>();
let activeServer: ServerHandle | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("codeplane.openWebApp", () => run(() => openWebApp({ reuse: true }))),
    vscode.commands.registerCommand("codeplane.openNewWebApp", () => run(() => openWebApp({ reuse: false }))),
    vscode.commands.registerCommand("codeplane.openWebAppWithFileReference", () =>
      run(async () => {
        const fileRef = getActiveFile();
        await openWebApp({ reuse: true, prompt: fileRef ? `In ${fileRef}` : undefined });
      }),
    ),
    { dispose: stopServers },
  );
}

export function deactivate() {
  stopServers();
}

function run(task: () => Promise<void>) {
  void task().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Codeplane failed to open: ${message}`);
  });
}

async function openWebApp(input: { reuse: boolean; prompt?: string }) {
  const cwd = getWorkspaceDirectory();
  const server = await ensureServer(input.reuse, cwd);
  await vscode.env.openExternal(vscode.Uri.parse(webUrl(server, cwd, input.prompt)));
}

async function ensureServer(reuse: boolean, cwd?: string) {
  if (reuse && activeServer && activeServer.cwd === cwd && isRunning(activeServer)) {
    return activeServer;
  }

  const server = startServer(cwd);
  activeServer = server;
  await waitForServer(server);
  return server;
}

function startServer(cwd?: string): ServerHandle {
  const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;
  const output = vscode.window.createOutputChannel(`Codeplane ${port}`);
  const proc = spawn("codeplane", ["serve", "--hostname=127.0.0.1", `--port=${port}`], {
    cwd,
    env: {
      ...process.env,
      CODEPLANE_CALLER: "vscode",
    },
    shell: process.platform === "win32",
  });
  const server = {
    port,
    cwd,
    process: proc,
    output,
    url: `http://127.0.0.1:${port}`,
  };

  servers.add(server);
  proc.stdout.on("data", (chunk) => output.append(chunk.toString()));
  proc.stderr.on("data", (chunk) => output.append(chunk.toString()));
  proc.once("error", (error) => {
    output.appendLine(`Failed to start Codeplane: ${error.message}`);
    output.show(true);
  });
  proc.once("exit", (code, signal) => {
    servers.delete(server);
    if (activeServer === server) {
      activeServer = undefined;
    }
    output.appendLine(`Codeplane server exited with ${signal ?? code ?? "unknown"}`);
  });

  return server;
}

async function waitForServer(server: ServerHandle) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!isRunning(server)) {
      throw new Error("server exited before becoming ready");
    }
    const healthy = await fetch(`${server.url}/global/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  server.output.show(true);
  throw new Error(`server did not become ready at ${server.url}`);
}

function isRunning(server: ServerHandle) {
  return server.process.exitCode === null && !server.process.killed;
}

function stopServers() {
  for (const server of servers) {
    if (isRunning(server)) {
      server.process.kill();
    }
    server.output.dispose();
  }
  servers.clear();
  activeServer = undefined;
}

function webUrl(server: ServerHandle, cwd?: string, prompt?: string) {
  const url = new URL(server.url);
  if (cwd) {
    url.pathname = `/${base64Encode(cwd)}/session`;
  }
  if (prompt) {
    url.searchParams.set("prompt", prompt);
  }
  return url.toString();
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function getWorkspaceDirectory() {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getActiveFile() {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
  if (!workspaceFolder) {
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
  const selection = activeEditor.selection;
  if (selection.isEmpty) {
    return `@${relativePath}`;
  }

  const startLine = selection.start.line + 1;
  const endLine = selection.end.line + 1;
  if (startLine === endLine) {
    return `@${relativePath}#L${startLine}`;
  }
  return `@${relativePath}#L${startLine}-${endLine}`;
}
