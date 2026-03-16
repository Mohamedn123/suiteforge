import * as vscode from 'vscode';
import { sdfCommandCategories } from '../data';

export class SdfSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'suiteforge.sdfCommandsView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._buildHtml();

        webviewView.webview.onDidReceiveMessage((msg: { type: string; commandId?: string }) => {
            if (msg.type === 'runCommand' && msg.commandId) {
                const allCmds = sdfCommandCategories.flatMap(c => c.commands);
                const cmd = allCmds.find(c => c.id === msg.commandId);
                if (cmd) {
                    vscode.commands.executeCommand('suiteforge.runSdfCommand', cmd);
                }
            }
        });
    }

    private _buildHtml(): string {
        const dataJson = JSON.stringify(sdfCommandCategories);
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
    font-family:var(--vscode-font-family);
    font-size:var(--vscode-font-size);
    color:var(--vscode-foreground);
    background:transparent;
    padding:0;
    overflow-x:hidden;
}

/* ── Search ─────────────────────────────────── */
.search-wrap{
    position:sticky;top:0;z-index:10;
    padding:8px 12px;
    background:var(--vscode-sideBar-background);
}
.search-wrap input{
    width:100%;
    padding:5px 8px 5px 28px;
    border:1px solid var(--vscode-input-border,transparent);
    background:var(--vscode-input-background);
    color:var(--vscode-input-foreground);
    border-radius:4px;
    font-size:12px;
    outline:none;
}
.search-wrap input:focus{
    border-color:var(--vscode-focusBorder);
}
.search-wrap .search-icon{
    position:absolute;left:18px;top:50%;transform:translateY(-50%);
    opacity:.5;font-size:14px;pointer-events:none;
}

/* ── Categories ─────────────────────────────── */
.category{margin-bottom:2px}
.cat-header{
    display:flex;align-items:center;gap:6px;
    padding:8px 12px;
    cursor:pointer;
    user-select:none;
    font-size:11px;
    font-weight:600;
    text-transform:uppercase;
    letter-spacing:.5px;
    color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));
    background:var(--vscode-sideBarSectionHeader-background,transparent);
    border-top:1px solid var(--vscode-sideBarSectionHeader-border,transparent);
}
.cat-header:hover{opacity:.85}
.cat-header .chevron{
    transition:transform .2s ease;
    font-size:12px;
}
.cat-header.collapsed .chevron{transform:rotate(-90deg)}
.cat-body{
    overflow:hidden;
    transition:max-height .25s ease, opacity .2s ease;
    max-height:500px;opacity:1;
}
.cat-body.collapsed{max-height:0;opacity:0}

/* ── Command rows ───────────────────────────── */
.cmd-row{
    display:flex;align-items:center;gap:8px;
    padding:6px 12px 6px 20px;
    cursor:pointer;
    border-radius:0;
    transition:background .12s ease;
    position:relative;
}
.cmd-row:hover{
    background:var(--vscode-list-hoverBackground);
}
.cmd-row:active{
    background:var(--vscode-list-activeSelectionBackground);
    color:var(--vscode-list-activeSelectionForeground);
}
.cmd-row .cmd-icon{
    font-size:16px;flex-shrink:0;
    opacity:.7;width:18px;text-align:center;
}
.cmd-row .cmd-label{
    font-size:12.5px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.cmd-row .cmd-desc{
    display:none;
    position:absolute;left:12px;top:100%;
    background:var(--vscode-editorHoverWidget-background,var(--vscode-editorWidget-background));
    border:1px solid var(--vscode-editorHoverWidget-border,var(--vscode-widget-border));
    color:var(--vscode-editorHoverWidget-foreground,var(--vscode-foreground));
    padding:6px 10px;
    font-size:11.5px;line-height:1.4;
    border-radius:4px;
    z-index:20;width:calc(100% - 24px);
    box-shadow:0 2px 8px rgba(0,0,0,.2);
    pointer-events:none;
}
.cmd-row:hover .cmd-desc{display:block}

/* ── Flow badge ─────────────────────────────── */
.flow-badge{
    margin-left:auto;flex-shrink:0;
    font-size:10px;opacity:.45;
}

/* ── Empty state ────────────────────────────── */
.empty-state{
    padding:24px 16px;text-align:center;
    color:var(--vscode-descriptionForeground);
    font-size:12px;
}
</style>
</head>
<body>

<div class="search-wrap">
    <span class="search-icon codicon codicon-search"></span>
    <input type="text" id="searchInput" placeholder="Search commands..." />
</div>

<div id="commandList"></div>
<div id="emptyState" class="empty-state" style="display:none">No matching commands</div>

<script>
const vscode = acquireVsCodeApi();
const categories = ${dataJson};

const listEl = document.getElementById('commandList');
const emptyEl = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');

function render(filter) {
    const q = (filter || '').toLowerCase();
    listEl.innerHTML = '';
    let total = 0;

    categories.forEach(cat => {
        const cmds = cat.commands.filter(c =>
            !q || c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
        );
        if (cmds.length === 0) return;
        total += cmds.length;

        const section = document.createElement('div');
        section.className = 'category';

        const header = document.createElement('div');
        header.className = 'cat-header';
        header.innerHTML = '<span class="chevron codicon codicon-chevron-down"></span>' + cat.category;
        header.onclick = () => {
            header.classList.toggle('collapsed');
            body.classList.toggle('collapsed');
        };

        const body = document.createElement('div');
        body.className = 'cat-body';

        cmds.forEach(cmd => {
            const row = document.createElement('div');
            row.className = 'cmd-row';
            row.innerHTML =
                '<span class="cmd-icon codicon codicon-' + cmd.icon + '"></span>' +
                '<span class="cmd-label">' + cmd.label + '</span>' +
                '<span class="flow-badge">' + flowLabel(cmd.flow) + '</span>' +
                '<span class="cmd-desc">' + cmd.description + '</span>';
            row.onclick = () => vscode.postMessage({ type: 'runCommand', commandId: cmd.id });
            body.appendChild(row);
        });

        section.appendChild(header);
        section.appendChild(body);
        listEl.appendChild(section);
    });

    emptyEl.style.display = total === 0 ? 'block' : 'none';
}

function flowLabel(f) {
    if (f === 'upload') return '\\u2191';
    if (f === 'download') return '\\u2193';
    return '\\u2022';
}

searchInput.addEventListener('input', () => render(searchInput.value));
render('');
</script>
</body>
</html>`;
    }
}
