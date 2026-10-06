import * as vscode from 'vscode';
import { canOpenInVsCode, FigmaLink } from './figmaLinks';

const FIGMA_EXTENSION = 'figma.figma-vscode-extension';
/**
 * Command of the Figma extension that opens a file: (fileKey, fileName, nodeId). It is the one its own
 * "Open Design File" command runs after parsing a URL; not part of a documented API, so any failure falls
 * back to the browser
 */
const OPEN_FILE_COMMAND = 'figma.openFile';

export function isFigmaExtensionInstalled(): boolean {
  return !!vscode.extensions.getExtension(FIGMA_EXTENSION);
}

async function openInVsCode(link: FigmaLink): Promise<boolean> {
  const extension = vscode.extensions.getExtension(FIGMA_EXTENSION);
  if (!extension || !canOpenInVsCode(link)) {
    return false;
  }
  try {
    await extension.activate();
    if (!(await vscode.commands.getCommands(true)).includes(OPEN_FILE_COMMAND)) {
      return false;
    }
    // The node ID is passed as the Figma extension does with URLs, but it does not select the node
    // (version 0.4.7): only the file opens. The browser button opens the exact frame
    await vscode.commands.executeCommand(OPEN_FILE_COMMAND, link.fileKey, link.name, link.nodeId);
    return true;
  } catch {
    return false;
  }
}

/** Lets the user pick one of the links when there are several */
async function pickLink(links: FigmaLink[]): Promise<FigmaLink | undefined> {
  if (links.length <= 1) {
    return links.at(0);
  }
  const picked = await vscode.window.showQuickPick(
    links.map((link) => ({
      label: `$(file-media) ${link.name}`,
      description: [link.kind, link.nodeId && `node ${link.nodeId}`].filter(Boolean).join(' · '),
      detail: link.url,
      link,
    })),
    { title: 'Figma designs of the work item', placeHolder: 'Select the design to open' }
  );
  return picked?.link;
}

/**
 * Opens a Figma design of the work item: in the Figma extension for VS Code when it is installed
 * (designs only; prototypes, FigJam and Make files open in the browser), otherwise in the browser
 */
export async function openFigmaLinks(links: FigmaLink[], inBrowser = false): Promise<void> {
  const link = await pickLink(links);
  if (!link) {
    return;
  }
  if (!inBrowser && (await openInVsCode(link))) {
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(link.url));
}
