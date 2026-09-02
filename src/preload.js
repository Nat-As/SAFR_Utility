'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('safrHost', {
  /** OS-level serial port scan; needs no user gesture. */
  listPorts: () => ipcRenderer.invoke('serial:listPorts'),

  /**
   * Tell the main process which port the next requestPort() should resolve to.
   * Pass null to make the next call cancel instead.
   */
  setDesiredPort: (portId) => ipcRenderer.invoke('serial:setDesiredPort', portId),

  startLog: (defaultName, header) => ipcRenderer.invoke('log:start', { defaultName, header }),
  appendLog: (rows) => ipcRenderer.invoke('log:append', rows),
  stopLog: () => ipcRenderer.invoke('log:stop'),

  version: () => ipcRenderer.invoke('app:version'),
  platform: process.platform
});
