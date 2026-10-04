import type { PanelId } from '../../shared/types';
export function openWorkspaceWindow(panel?: PanelId): void {
  if (window.jarvisDesktop) {
    if (panel) void window.jarvisDesktop.openPanel(panel);
    else void window.jarvisDesktop.openWorkspace();
    return;
  }
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('window', crypto.randomUUID());
  url.searchParams.set('secondary', '1');
  if (panel) url.searchParams.set('panel', panel);
  window.open(url.href, '_blank', 'noopener,noreferrer,width=1280,height=900');
}
