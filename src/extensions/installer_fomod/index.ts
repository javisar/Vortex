import {
  IExtensionContext,
  IInstallResult,
  ISupportedResult,
  ProgressDelegate,
} from '../../types/IExtensionContext';
import { DataInvalid, UserCanceled, SetupError } from '../../util/CustomErrors';
import * as fs from '../../util/fs';
import getVortexPath from '../../util/getVortexPath';
import lazyRequire from '../../util/lazyRequire';
import {truthy} from '../../util/util';

import { endDialog, setInstallerDataPath } from './actions/installerUI';
import Core from './delegates/Core';
import { installerUIReducer } from './reducers/installerUI';
import {
  getPluginPath,
  getStopPatterns,
} from './util/gameSupport';
import InstallerDialog from './views/InstallerDialog';

import * as Promise from 'bluebird';
import * as edgeT from 'electron-edge-js';
const edge = lazyRequire<typeof edgeT>(() => require('electron-edge-js'));
import * as path from 'path';
import * as util from 'util';

let testSupportedLib;
let installLib;

const basePath = path.join(getVortexPath('modules_unpacked'), 'fomod-installer', 'dist');

function transformError(err: any): Error {
  if (typeof(err) === 'string') {
    // I hope these errors aren't localised or something...
    if (err === 'The operation was cancelled.') {
      // weeell, we don't actually know if it was the user who cancelled...
      return new UserCanceled();
    } else {
      return new Error(err);
    }
  } else if (err.name === 'System.IO.PathTooLongException') {
    let error = new SetupError('The installer tried to access a file with a path longer than 260 characters. '
                             + 'This usually means that your mod staging path is too long.');
    error.stack = err.StackTrace;
    return error;
  } else if ((err.StackTrace.indexOf('XNodeValidator.ValidationCallback') !== -1)
             || (err.StackTrace.indexOf('XmlTextReaderImpl.ParseXmlDeclaration') !== -1)
             || (err.StackTrace.indexOf('XmlTextReaderImpl.ParseAttributes') !== -1)
             || (err.StackTrace.indexOf('XmlScriptType.GetXmlScriptVersion') !== -1)
             ) {
    return new DataInvalid('Invalid installer script: ' + err.message);
  } else {
    return new Error('unknown error: ' + util.inspect(err));
  }
}

function testSupported(files: string[]): Promise<ISupportedResult> {
  if (testSupportedLib === undefined) {
    testSupportedLib = edge.func({
      assemblyFile: path.join(basePath, 'ModInstaller.dll'),
      typeName: 'FomodInstaller.ModInstaller.InstallerProxy',
      methodName: 'TestSupported',
    });
  }

  return new Promise<ISupportedResult>((resolve, reject) => {
    testSupportedLib({files}, (err: Error, result: ISupportedResult) => {
      if ((err !== null) && (err !== undefined)) {
        reject(transformError(err));
      } else {
        resolve(result);
      }
    });
  });
}

let currentInstallPromise: Promise<any> = Promise.resolve();

function install(files: string[],
                 stopPatterns: string[],
                 pluginPath: string,
                 scriptPath: string,
                 progressDelegate: ProgressDelegate,
                 coreDelegates: Core): Promise<IInstallResult> {
  if (installLib === undefined) {
    installLib = edge.func({
      assemblyFile: path.join(basePath, 'ModInstaller.dll'),
      typeName: 'FomodInstaller.ModInstaller.InstallerProxy',
      methodName: 'Install',
    });
  }

  currentInstallPromise = new Promise((resolve, reject) => {
    installLib({ files, stopPatterns, pluginPath,
                 scriptPath, progressDelegate, coreDelegates },
      (err: Error, result: any) => {
        if ((err !== null) && (err !== undefined)) {
          reject(transformError(err));
        } else {
          resolve(result);
        }
      });
  }).finally(() => {
    currentInstallPromise = Promise.resolve();
  });
  return currentInstallPromise;
}

function processAttributes(input: any, modPath: string): Promise<any> {
  if (modPath === undefined) {
    return Promise.resolve({});
  }
  return fs.readFileAsync(path.join(modPath, 'fomod', 'info.xml'))
      .then((data: Buffer) => {
        let offset = 0;
        let encoding = 'utf8';
        if (data.readUInt16LE(0) === 0xFEFF) {
          encoding = 'utf16le';
          offset = 2;
        } else if (data.compare(Buffer.from([0xEF, 0xBB, 0xBF]), 0, 3, 0, 3) === 0) {
          offset = 3;
        }
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(data.slice(offset).toString(encoding), 'text/xml');
        const name: Element = xmlDoc.querySelector('fomod Name');
        return truthy(name)
          ? {
            customFileName: name.childNodes[0].nodeValue,
          } : {};
      })
      .catch(err => ({}));
}

function init(context: IExtensionContext): boolean {
  context.registerInstaller(
    'fomod', 100, testSupported, (files, scriptPath, gameId, progressDelegate) => {
      const coreDelegates = new Core(context.api, gameId);
      const stopPatterns = getStopPatterns(gameId);
      const pluginPath = getPluginPath(gameId);
      return currentInstallPromise
        .then(() => {
          context.api.store.dispatch(setInstallerDataPath(scriptPath));
          return install(files, stopPatterns, pluginPath,
                         scriptPath, progressDelegate, coreDelegates);
        })
        .catch((err) => {
          context.api.store.dispatch(endDialog());
          return Promise.reject(err);
        })
        .finally(() => coreDelegates.detach());
      });

  context.registerDialog('fomod-installer', InstallerDialog);
  context.registerReducer(['session', 'fomod', 'installer', 'dialog'], installerUIReducer);

  context.registerAttributeExtractor(75, processAttributes);

  return true;
}

export default init;
