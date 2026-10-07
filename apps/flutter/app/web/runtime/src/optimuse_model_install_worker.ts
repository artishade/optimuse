export {};

interface WorkerRuntimeBridge {
  call(request: Uint8Array): Promise<Uint8Array>;
}

interface WorkerStorageChange {
  key: string;
  bytes: Uint8Array | null;
}

interface WorkerSecret {
  key: string;
  bytes: Uint8Array;
}

interface WorkerSecretChange {
  key: string;
  bytes: Uint8Array | null;
}

interface WorkerDownload {
  url: string;
  bytes: Uint8Array;
}

interface WorkerDownloadRequest {
  fileId: string;
  url: string;
  headers?: Array<[string, string] | { key: string; value: string }>;
  expectedBytes?: number;
  targetPath: string;
}

interface WorkerRuntimeGlobals {
  __OPTIMUSE_MODEL_INSTALL_WORKER__?: boolean;
  __optimuseRuntime?: WorkerRuntimeBridge;
  __optimuseModelInstallWorkerStorageChanges?: () => Promise<WorkerStorageChange[]>;
  __optimuseModelInstallWorkerSetSecrets?: (secrets: WorkerSecret[]) => void;
  __optimuseModelInstallWorkerSetDownloads?: (downloads: WorkerDownload[]) => void;
  __optimuseModelInstallWorkerDownloadRequests?: () => WorkerDownloadRequest[];
  __optimuseModelInstallWorkerSecretChanges?: () => WorkerSecretChange[];
}

interface InstallWorkerRequest {
  type: "install";
  request: Uint8Array;
  secrets: WorkerSecret[];
  downloads: WorkerDownload[];
}

const workerGlobal = globalThis as typeof globalThis & WorkerRuntimeGlobals;

workerGlobal.__OPTIMUSE_MODEL_INSTALL_WORKER__ = true;
const workerReady = initializeWorkerRuntime();
workerGlobal.addEventListener("message", handleWorkerMessage);

/** Handles one local model installation request from the browser UI thread. */
function handleWorkerMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (!isInstallWorkerRequest(message)) {
    return;
  }
  void workerReady.then(() => installModel(message), error => {
    postWorkerMessage({ type: "error", message: errorMessage(error) });
  });
}

/** Loads the shared browser runtime bridge into the installation worker. */
async function initializeWorkerRuntime(): Promise<void> {
  await importWorkerScript("./optimuse_runtime_bridge.js");
}

/** Dynamically imports one browser runtime script relative to this worker. */
function importWorkerScript(path: string): Promise<void> {
  const dynamicImport = new Function("path", "return import(path)") as (
    modulePath: string,
  ) => Promise<void>;
  return dynamicImport(path);
}

/** Validates one structured local model installation worker request. */
function isInstallWorkerRequest(value: unknown): value is InstallWorkerRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as Partial<InstallWorkerRequest>;
  return message.type === "install" && message.request instanceof Uint8Array;
}

/** Executes one model installation through the isolated WebAssembly runtime. */
async function installModel(message: InstallWorkerRequest): Promise<void> {
  try {
    const runtime = workerGlobal.__optimuseRuntime;
    const collectStorageChanges = workerGlobal.__optimuseModelInstallWorkerStorageChanges;
    const setSecrets = workerGlobal.__optimuseModelInstallWorkerSetSecrets;
    const setDownloads = workerGlobal.__optimuseModelInstallWorkerSetDownloads;
    const collectDownloadRequests = workerGlobal.__optimuseModelInstallWorkerDownloadRequests;
    const collectSecretChanges = workerGlobal.__optimuseModelInstallWorkerSecretChanges;
    if (
      runtime === undefined ||
      collectStorageChanges === undefined ||
      setSecrets === undefined ||
      setDownloads === undefined ||
      collectDownloadRequests === undefined ||
      collectSecretChanges === undefined
    ) {
      throw new Error("local model installation worker runtime is unavailable");
    }
    setSecrets(message.secrets);
    setDownloads(message.downloads);
    const response = Uint8Array.from(await runtime.call(message.request));
    const downloadRequests = collectDownloadRequests();
    if (downloadRequests.length > 0) {
      postWorkerMessage({ type: "downloadRequests", requests: downloadRequests });
      return;
    }
    const changes = await collectStorageChanges();
    const secretChanges = collectSecretChanges();
    const transferables: Transferable[] = [response.buffer];
    const serializedChanges = changes.map(change => {
      if (change.bytes !== null) {
        transferables.push(change.bytes.buffer);
      }
      return change;
    });
    const serializedSecretChanges = secretChanges.map(change => {
      if (change.bytes !== null) {
        transferables.push(change.bytes.buffer);
      }
      return change;
    });
    postWorkerMessage(
      {
        type: "result",
        response,
        changes: serializedChanges,
        secretChanges: serializedSecretChanges,
      },
      transferables,
    );
  } catch (error) {
    postWorkerMessage({ type: "error", message: errorMessage(error) });
  }
}

/** Sends one structured reply from the model installation worker. */
function postWorkerMessage(message: object, transferables: Transferable[] = []): void {
  const post = workerGlobal.postMessage as unknown as (
    payload: object,
    transfers: Transferable[],
  ) => void;
  post.call(workerGlobal, message, transferables);
}

/** Converts one worker exception into a transport-safe error message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
