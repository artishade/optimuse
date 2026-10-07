import {packLayout} from '../src/layout/package-layout.mjs';
import {request} from './transport.js';
import {errorMessage, query} from './types.js';
import type {
  DeploySetupOptions,
  DeviceCapabilities,
  FlashState,
  SerialPortsResponse,
} from './types.js';

/** Converts a typed byte array into an ArrayBuffer accepted by Blob and fetch. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Starts a browser download for an in-memory file. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Installs layout export, device deployment and firmware flashing actions. */
export function setupDeploy({snapshot, notify}: DeploySetupOptions): void {
  const dialog = query<HTMLDialogElement>('#deploy-dialog');
  const feedback = query<HTMLElement>('#deploy-feedback');
  const packageSize = query<HTMLElement>('#package-size');
  const addressInput = query<HTMLInputElement>('#device-address');
  const tokenInput = query<HTMLInputElement>('#device-token');
  const portSelect = query<HTMLSelectElement>('#flash-port');
  const flashOutput = query<HTMLElement>('#flash-output');
  const flashRuntimeButton = query<HTMLButtonElement>('#flash-runtime');
  const usbLayoutButton = query<HTMLButtonElement>('#usb-layout');
  let pollingTimer: number | null = null;

  /** Displays a deployment status message. */
  function info(text: string): void {
    feedback.textContent = text;
  }

  /** Stops the active flash-status poll. */
  function stopPolling(): void {
    if (pollingTimer === null) return;
    window.clearInterval(pollingTimer);
    pollingTimer = null;
  }

  /** Polls the firmware flashing process and updates both controls and output. */
  async function pollFlash(): Promise<void> {
    try {
      const state = await request<FlashState>('/api/deploy/flash');
      flashRuntimeButton.disabled = state.running;
      usbLayoutButton.disabled = state.running;
      flashOutput.textContent = state.error ?? state.output;
      if (!state.running) stopPolling();
    } catch (error) {
      info(errorMessage(error));
    }
  }

  /** Begins polling the firmware flashing process. */
  function startPolling(): void {
    stopPolling();
    pollingTimer = window.setInterval(() => void pollFlash(), 1000);
  }

  /** Opens the deployment dialog with the current draft package size. */
  function openDialog(): void {
    try {
      const bytes = packLayout(snapshot().document).byteLength;
      packageSize.textContent = `当前项目 ${bytes.toLocaleString()} 字节 · 上限 28 KiB · 页面修改无需编译`;
      info('下发的是当前草稿；保存项目用于保留可继续编辑的源文件。');
    } catch (error) {
      info(errorMessage(error));
    }
    if (!dialog.open) dialog.showModal();
  }

  /** Exports the editable layout JSON. */
  function exportLayout(): void {
    const body = JSON.stringify(snapshot().document, null, 2) + '\n';
    download(new Blob([body], {type: 'application/json'}), 'layout.json');
  }

  /** Exports the binary device layout package. */
  function exportPackage(): void {
    try {
      const bytes = packLayout(snapshot().document);
      download(new Blob([asArrayBuffer(bytes)], {type: 'application/octet-stream'}), 'optimuse-ui.oui');
      info('已导出布局包，不含固件或编译缓存。');
    } catch (error) {
      info(errorMessage(error));
    }
  }

  /** Checks the device runtime capabilities at the configured address. */
  async function connectDevice(): Promise<void> {
    try {
      const address = addressInput.value;
      const capabilities = await request<DeviceCapabilities>(
        '/api/deploy/device?address=' + encodeURIComponent(address),
      );
      info(
        `已连接 ${capabilities.board} · 布局版本 ${String(capabilities.revision)} · 协议 ${capabilities.protocol}`,
      );
    } catch (error) {
      info(errorMessage(error));
    }
  }

  /** Deploys the current draft package over the device HTTP API. */
  async function deployLayout(): Promise<void> {
    const button = query<HTMLButtonElement>('#deploy-layout');
    button.disabled = true;
    try {
      const document = snapshot().document;
      packLayout(document);
      info('正在下发并写入设备布局分区…');
      const result = await request<DeviceCapabilities>('/api/deploy/layout', {
        method: 'POST',
        body: {
          address: addressInput.value,
          token: tokenInput.value,
          document,
        },
      });
      if (result.accepted !== true) throw new Error('设备未接受布局');
      info(`设备已接收 ${result.bytes} 字节，等待屏幕切换确认…`);
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
        const capabilities = await request<DeviceCapabilities>(
          '/api/deploy/device?address=' + encodeURIComponent(addressInput.value),
        );
        if (capabilities.revision !== result.previousRevision) {
          info(`部署完成 · 设备布局版本 ${String(capabilities.revision)} · 重启后保留`);
          notify('布局已部署到设备');
          return;
        }
      }
      throw new Error('数据已接收，但未确认屏幕采用新布局，请检查设备状态');
    } catch (error) {
      info(errorMessage(error));
    } finally {
      button.disabled = false;
    }
  }

  /** Loads the available serial ports into the flashing selector. */
  async function refreshPorts(): Promise<void> {
    try {
      const result = await request<SerialPortsResponse>('/api/deploy/ports');
      portSelect.replaceChildren(...result.ports.map((port) => new Option(`${port.port} · ${port.name}`, port.port)));
      info(result.ports.length ? '选择 ESP32 数据线对应串口' : '未发现串口，请连接数据线');
    } catch (error) {
      info(errorMessage(error));
    }
  }

  /** Writes the current draft layout to the device over USB. */
  async function deployUsbLayout(): Promise<void> {
    try {
      if (!portSelect.value) throw new Error('请刷新并选择 ESP32 串口');
      usbLayoutButton.disabled = true;
      await request('/api/deploy/usb-layout', {
        method: 'POST',
        body: {port: portSelect.value, document: snapshot().document},
      });
      await pollFlash();
      startPolling();
    } catch (error) {
      info(errorMessage(error));
      usbLayoutButton.disabled = false;
    }
  }

  /** Installs or updates the base ESP32 firmware over USB. */
  async function flashRuntime(): Promise<void> {
    try {
      if (!portSelect.value) throw new Error('请刷新并选择 ESP32 串口');
      flashRuntimeButton.disabled = true;
      await request('/api/deploy/flash', {
        method: 'POST',
        body: {port: portSelect.value},
      });
      await pollFlash();
      startPolling();
    } catch (error) {
      info(errorMessage(error));
      flashRuntimeButton.disabled = false;
    }
  }

  query<HTMLButtonElement>('#open-deploy').addEventListener('click', openDialog);
  query<HTMLButtonElement>('#deploy-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stopPolling);
  query<HTMLButtonElement>('#export-layout').addEventListener('click', exportLayout);
  query<HTMLButtonElement>('#export-package').addEventListener('click', exportPackage);
  query<HTMLButtonElement>('#connect-device').addEventListener('click', () => void connectDevice());
  query<HTMLButtonElement>('#deploy-layout').addEventListener('click', () => void deployLayout());
  query<HTMLButtonElement>('#refresh-ports').addEventListener('click', () => void refreshPorts());
  usbLayoutButton.addEventListener('click', () => void deployUsbLayout());
  flashRuntimeButton.addEventListener('click', () => void flashRuntime());
}
