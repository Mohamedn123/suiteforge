import * as vscode from 'vscode';
import type { SdfCommand } from '../data';
import { SdfCliRunner, CliRunEvent } from './sdfCliRunner';
import {
    parseValidateOutput,
    publishValidationDiagnostics,
    clearValidationDiagnostics,
} from './validationParser';

export type SdfOperationKind = 'validation' | 'deployment' | 'generic';

export interface SdfRunPresentation {
    accountAuthId?: string;
}

export function operationKindForCommand(commandId: string): SdfOperationKind {
    if (commandId === 'project:validate') { return 'validation'; }
    if (commandId === 'project:deploy' || commandId === 'file:upload') { return 'deployment'; }
    return 'generic';
}

export class SdfWebviewPanel {
    private static instance: SdfWebviewPanel | undefined;
    private panel: vscode.WebviewPanel;
    private runner: SdfCliRunner;
    private startTime = 0;
    private disposed = false;
    private validating = false;
    private validateBuffer = '';
    private activeWorkspaceRoot: vscode.Uri | undefined;
    private starting = false;
    private pendingStart: ReturnType<typeof setTimeout> | undefined;
    private static readonly MAX_VALIDATE_OUTPUT = 5 * 1024 * 1024;

    private constructor(private readonly extensionUri: vscode.Uri) {
        this.runner = new SdfCliRunner();

        this.panel = vscode.window.createWebviewPanel(
            'suiteforge.sdfOutput',
            'SDF Output',
            vscode.ViewColumn.Two,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        this.panel.webview.html = buildHtml(this.panel.webview, extensionUri);

        this.panel.webview.onDidReceiveMessage((msg: { type: string }) => {
            if (msg.type === 'cancel') { this.cancelCurrentCommand(); }
        });

        this.panel.onDidDispose(() => {
            this.disposed = true;
            if (this.pendingStart) {
                clearTimeout(this.pendingStart);
                this.pendingStart = undefined;
            }
            this.starting = false;
            this.runner.cancel();
            this.runner.removeAllListeners('output');
            SdfWebviewPanel.instance = undefined;
        });

        this.runner.on('output', (event: CliRunEvent) => {
            if (this.disposed) { return; }

            if (this.validating && (event.type === 'stdout' || event.type === 'stderr')) {
                this.validateBuffer += event.data;
                if (this.validateBuffer.length > SdfWebviewPanel.MAX_VALIDATE_OUTPUT) {
                    this.validateBuffer = this.validateBuffer.slice(-SdfWebviewPanel.MAX_VALIDATE_OUTPUT);
                }
            }

            if (event.type === 'exit' || event.type === 'error') {
                this.starting = false;
                // Publish Problems-panel diagnostics when a validate run ends.
                if (this.validating) {
                    // A cancelled run only contains a partial report. Preserve
                    // the last complete validation result instead of replacing
                    // it with misleading partial diagnostics.
                    if (!event.cancelled) { this.publishValidationResults(event); }
                    this.validating = false;
                }
                const elapsed = Date.now() - this.startTime;
                const code = event.type === 'error' ? 1 : (event.code ?? 1);
                this.panel.webview.postMessage({
                    type: 'finish',
                    code,
                    elapsed,
                    data: event.data,
                    cancelled: event.cancelled === true,
                });
            } else {
                this.panel.webview.postMessage({ type: 'log', logType: event.type, data: event.data });
            }
        });
    }

    static getOrCreate(extensionUri: vscode.Uri): SdfWebviewPanel {
        if (SdfWebviewPanel.instance) {
            SdfWebviewPanel.instance.panel.reveal(vscode.ViewColumn.Two);
            return SdfWebviewPanel.instance;
        }
        SdfWebviewPanel.instance = new SdfWebviewPanel(extensionUri);
        return SdfWebviewPanel.instance;
    }

    static get commandIsRunning(): boolean {
        return Boolean(SdfWebviewPanel.instance?.starting || SdfWebviewPanel.instance?.runner.isRunning);
    }

    runCommand(
        command: SdfCommand,
        args?: string[],
        workspaceRoot?: vscode.Uri,
        presentation: SdfRunPresentation = {},
    ): void {
        if (this.starting || this.runner.isRunning) {
            vscode.window.showWarningMessage('SuiteForge: A command is already running. Cancel it before starting another.');
            return;
        }
        // Post 'start' BEFORE spawning. run() may refuse to start (command
        // already running, no workspace) and will then emit an 'error' event
        // which the webview renders as a failed finish — so the panel can
        // never get stuck in its "running" animation. The spawn itself is
        // deferred to the next tick so the webview always processes 'start'
        // (including its log reset) before any stdout banner lines arrive.
        this.startTime = Date.now();
        this.starting = true;
        this.activeWorkspaceRoot = workspaceRoot;

        // project:validate output is captured and turned into Problems-panel
        // diagnostics when the run finishes.
        this.validating = command.id === 'project:validate';
        this.validateBuffer = '';

        this.panel.webview.postMessage({
            type: 'start',
            label: command.label,
            description: command.description,
            flow: command.flow,
            operation: operationKindForCommand(command.id),
            projectName: workspaceRoot
                ? (vscode.workspace.getWorkspaceFolder(workspaceRoot)?.name ?? workspaceRoot.path.split('/').pop())
                : undefined,
            accountAuthId: presentation.accountAuthId,
        });
        this.panel.title = `SDF: ${command.label}`;
        this.pendingStart = setTimeout(() => {
            this.pendingStart = undefined;
            if (this.disposed) { return; }
            this.starting = false;
            this.runner.run(command.id, args, workspaceRoot);
        }, 0);
    }

    private cancelCurrentCommand(): void {
        if (!this.starting) {
            this.runner.cancel();
            return;
        }

        if (this.pendingStart) {
            clearTimeout(this.pendingStart);
            this.pendingStart = undefined;
        }
        this.starting = false;
        this.validating = false;
        this.panel.webview.postMessage({
            type: 'finish',
            code: 1,
            elapsed: Date.now() - this.startTime,
            data: 'Command cancelled.\n',
            cancelled: true,
        });
    }

    private publishValidationResults(event: CliRunEvent): void {
        const projectRoot = this.activeWorkspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!projectRoot) { return; }

        // Prepend the banner too — some CLI versions put the error list in
        // stderr, and the buffer already contains both streams in order.
        const fullOutput = this.validateBuffer;
        if (event.type === 'error' || fullOutput.trim().length === 0) {
            // CLI failed to start / produced nothing — clear any stale results.
            clearValidationDiagnostics();
            return;
        }

        const issues = parseValidateOutput(fullOutput, projectRoot);
        publishValidationDiagnostics(issues);

        if (issues.length > 0) {
            vscode.window.showInformationMessage(
                `SuiteForge: Validation found ${issues.length} problem${issues.length > 1 ? 's' : ''}. See the Problems panel for details.`,
            );
        }
    }
}

export function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    // Serve the codicon font from the extension so the webview can render icons.
    const codiconsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'assets', 'webview', 'codicon.css'),
    );
    const csp = [
        `default-src 'none'`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `font-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="stylesheet" href="${codiconsUri}">
<style>
:root{
    --bg:var(--vscode-editor-background);
    --fg:var(--vscode-editor-foreground);
    --border:var(--vscode-panel-border);
    --btn-bg:var(--vscode-button-background);
    --btn-fg:var(--vscode-button-foreground);
    --btn-hover:var(--vscode-button-hoverBackground);
    --error:var(--vscode-errorForeground);
    --success:#4ec9b0;
    --muted:var(--vscode-descriptionForeground);
    --accent:var(--vscode-progressBar-background,#0078d4);
}
*{margin:0;padding:0;box-sizing:border-box}
body{
    font-family:var(--vscode-font-family);
    font-size:var(--vscode-editor-font-size,13px);
    background:var(--bg);color:var(--fg);
    height:100vh;display:flex;flex-direction:column;
}

/* ── Toolbar ────────────────────────────────── */
.toolbar{
    display:flex;align-items:center;gap:8px;
    padding:8px 16px;border-bottom:1px solid var(--border);flex-shrink:0;
}
.toolbar-title{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toolbar button{
    background:var(--btn-bg);color:var(--btn-fg);border:none;
    padding:4px 14px;cursor:pointer;border-radius:3px;font-size:12px;
}
.toolbar button:hover{background:var(--btn-hover)}
.toolbar .btn-danger{background:var(--vscode-inputValidation-errorBackground,#5a1d1d)}

/* ── Animation area ─────────────────────────── */
.anim-area{
    flex-shrink:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;padding:32px 16px 16px;min-height:220px;
    position:relative;overflow:hidden;
}
.anim-area.hidden{display:none}

/* SVG scene */
.scene{width:340px;height:120px}
.device-icon,.cloud-icon{fill:var(--fg);opacity:.8}
.conn-line{stroke:var(--muted);stroke-width:2;stroke-dasharray:6 4;fill:none}

/* Animated dots are SVG circles with <animateMotion> — no CSS needed */

/* Validation document scanner */
.validation-scene{
    width:300px;height:124px;position:relative;
    display:flex;align-items:center;justify-content:center;
}
.validation-document{
    width:92px;height:112px;position:relative;border:1px solid var(--border);
    border-radius:6px;background:var(--vscode-editorWidget-background,var(--bg));
    box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:1;
}
.validation-document::before,.validation-document::after{
    content:"";position:absolute;width:82px;height:102px;
    border:1px solid var(--border);border-radius:6px;
    background:var(--vscode-editorWidget-background,var(--bg));z-index:-1;
}
.validation-document::before{left:-13px;top:8px;transform:rotate(-5deg)}
.validation-document::after{right:-13px;top:8px;transform:rotate(5deg)}
.document-fold{
    position:absolute;right:0;top:0;width:20px;height:20px;
    background:linear-gradient(225deg,var(--bg) 49%,var(--border) 50%,transparent 54%);
}
.code-lines{position:absolute;inset:22px 14px 12px;display:flex;flex-direction:column;gap:8px}
.code-line{height:3px;border-radius:2px;background:var(--muted);opacity:.42}
.code-line:nth-child(2){width:72%}.code-line:nth-child(3){width:88%}.code-line:nth-child(4){width:58%}
.scan-beam{
    position:absolute;left:8px;right:8px;top:18px;height:2px;
    background:var(--accent);box-shadow:0 0 9px var(--accent),0 7px 18px color-mix(in srgb,var(--accent) 28%,transparent);
    animation:scanDocument 2.2s ease-in-out infinite;
}
.scan-badge{
    position:absolute;right:71px;bottom:13px;width:30px;height:30px;
    display:grid;place-items:center;border-radius:50%;
    color:var(--vscode-button-foreground);background:var(--accent);
    box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 18%,transparent);
    animation:badgePulse 1.6s ease-in-out infinite;
}
@keyframes scanDocument{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(72px);opacity:1}}
@keyframes badgePulse{0%,100%{transform:scale(.94)}50%{transform:scale(1.06)}}

/* Deployment package flight */
.deployment-scene{
    width:360px;height:124px;position:relative;
    display:flex;align-items:center;justify-content:space-between;
}
.deployment-scene .endpoint{position:relative;z-index:2;width:52px;height:52px}
.deployment-scene .deploy-cloud{animation:cloudBreathe 2s ease-in-out infinite}
.deploy-route{
    position:absolute;left:51px;right:51px;top:61px;height:2px;
    border-top:2px dashed var(--muted);opacity:.5;
}
.deploy-packet{
    position:absolute;left:52px;top:53px;z-index:3;width:25px;height:25px;
    display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--accent) 70%,var(--border));
    border-radius:5px;color:var(--vscode-button-foreground);background:var(--accent);
    box-shadow:0 5px 16px rgba(0,0,0,.2);
    animation:deployPacket 2.4s cubic-bezier(.4,0,.2,1) infinite;
}
.deploy-packet.packet-two{animation-delay:.8s}
.deploy-packet.packet-three{animation-delay:1.6s}
@keyframes deployPacket{
    0%{left:52px;top:53px;opacity:0;transform:scale(.75) rotate(-8deg)}
    12%{opacity:1}
    50%{top:23px;transform:scale(1) rotate(2deg)}
    88%{opacity:1}
    100%{left:284px;top:53px;opacity:0;transform:scale(.75) rotate(8deg)}
}
@keyframes cloudBreathe{0%,100%{transform:scale(.96);opacity:.8}50%{transform:scale(1.05);opacity:1}}

.operation-context{
    min-height:18px;margin-top:8px;display:flex;align-items:center;
    justify-content:center;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:11px;
}
.operation-context span:empty{display:none}
.operation-context span+span{padding-left:12px;border-left:1px solid var(--border)}

/* Pulsing ring for local commands */
@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.8);opacity:0}}
.pulse-ring{
    position:absolute;width:60px;height:60px;border-radius:50%;
    border:2px solid var(--accent);
    left:calc(50% - 30px);top:calc(50% - 42px);
    animation:pulse 1.5s ease-out infinite;
    pointer-events:none;
}

/* Status text */
.status-text{
    margin-top:12px;font-size:13px;font-weight:500;
    text-align:center;
}
@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.status-text.animate{animation:fadeInUp .4s ease}

/* Progress shimmer */
.progress-bar{
    width:200px;height:3px;border-radius:2px;
    background:var(--vscode-input-background,#333);
    margin-top:10px;overflow:hidden;position:relative;
}
.progress-bar .shimmer{
    position:absolute;top:0;left:-50%;width:50%;height:100%;
    background:linear-gradient(90deg,transparent,var(--accent),transparent);
    animation:shimmer 1.2s ease-in-out infinite;
}
@keyframes shimmer{0%{left:-50%}100%{left:100%}}

.live-duration{margin-top:6px;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}

/* ── Result icon ────────────────────────────── */
.result-icon{margin-top:8px;width:48px;height:48px}
.result-icon svg{width:48px;height:48px}

/* Checkmark draw */
@keyframes drawCheck{to{stroke-dashoffset:0}}
.check-path{
    fill:none;stroke:var(--success);stroke-width:3;stroke-linecap:round;stroke-linejoin:round;
    stroke-dasharray:44;stroke-dashoffset:44;
    animation:drawCheck .5s ease forwards .1s;
}
.check-circle{
    fill:none;stroke:var(--success);stroke-width:2;opacity:.3;
}

/* X draw */
@keyframes drawX{to{stroke-dashoffset:0}}
.x-path{
    fill:none;stroke:var(--error);stroke-width:3;stroke-linecap:round;
    stroke-dasharray:20;stroke-dashoffset:20;
    animation:drawX .4s ease forwards .1s;
}
.x-circle{fill:none;stroke:var(--error);stroke-width:2;opacity:.3}

/* Shake */
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.shake{animation:shake .35s ease .1s}

/* Duration label */
.duration{margin-top:4px;font-size:11px;color:var(--muted)}

/* ── Particles ──────────────────────────────── */
@keyframes particle{
    0%{opacity:1;transform:translate(0,0) scale(1)}
    100%{opacity:0;transform:translate(var(--px),var(--py)) scale(0)}
}
.particle{
    position:absolute;width:5px;height:5px;border-radius:50%;
    pointer-events:none;
    animation:particle .8s ease-out forwards;
}

/* ── Log section ────────────────────────────── */
.log-section{
    flex:1;display:flex;flex-direction:column;
    border-top:1px solid var(--border);overflow:hidden;
}
.log-toggle{
    padding:6px 16px;cursor:pointer;user-select:none;
    font-size:12px;color:var(--muted);
    display:flex;align-items:center;gap:6px;
    flex-shrink:0;
}
.log-toggle:hover{color:var(--fg)}
.log-toggle .chevron{transition:transform .2s;font-size:10px}
.log-toggle.open .chevron{transform:rotate(90deg)}
.log-content{
    flex:1;overflow-y:auto;padding:4px 16px;
    font-family:var(--vscode-editor-font-family,monospace);
    font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;
    display:none;
}
.log-content.open{display:block}
.line-stdout{color:var(--fg)}
.line-stderr{color:var(--error)}
.line-error{color:var(--error);font-weight:600}

/* ── Idle state ─────────────────────────────── */
.idle-state{
    flex:1;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:8px;
    color:var(--muted);
}
.idle-state svg{width:48px;height:48px;opacity:.3}
.idle-state span{font-size:13px}

@media (prefers-reduced-motion: reduce){
    .pulse-ring,.scan-beam,.scan-badge,.deploy-cloud,.deploy-packet,.progress-bar .shimmer,
    .status-text.animate,.check-path,.x-path,.shake,.particle{animation:none!important}
    .motion-dot{display:none}
    .scan-beam{transform:translateY(36px);opacity:.8}
    .deploy-packet{display:none}
    .progress-bar .shimmer{left:0;width:100%;opacity:.65}
}
</style>
</head>
<body>

<div class="toolbar">
    <span class="toolbar-title" id="toolbarTitle">SDF Output</span>
    <button class="btn-danger" id="btnCancel" style="display:none">Cancel</button>
</div>

<div id="idle" class="idle-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
        <path d="M8 12l3 3 5-5"/>
    </svg>
    <span>Select a command from the sidebar to run</span>
</div>

<div class="anim-area hidden" id="animArea"></div>

<div class="log-section" id="logSection" style="display:none">
    <div class="log-toggle" id="logToggle">
        <span class="chevron">&#9654;</span> Command output
    </div>
    <div class="log-content" id="logContent"></div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const animArea = document.getElementById('animArea');
const idle = document.getElementById('idle');
const logSection = document.getElementById('logSection');
const logToggle = document.getElementById('logToggle');
const logContent = document.getElementById('logContent');
const titleEl = document.getElementById('toolbarTitle');
const btnCancel = document.getElementById('btnCancel');

btnCancel.addEventListener('click', () => {
    btnCancel.disabled = true;
    setRunningStatus('Cancelling command...');
    vscode.postMessage({ type: 'cancel' });
});
logToggle.addEventListener('click', () => toggleLog());

let logOpen = false;
let currentFlow = 'local';
let currentOperation = 'generic';
let receivedOutput = false;
let runningStartedAt = 0;
let elapsedTimer;

function toggleLog(){
    logOpen = !logOpen;
    logToggle.classList.toggle('open', logOpen);
    logContent.classList.toggle('open', logOpen);
}

function appendLog(text, cls){
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    logContent.appendChild(s);
    if(logOpen) logContent.scrollTop = logContent.scrollHeight;
}

function fmtDuration(ms){
    const s = Math.floor(ms/1000);
    if(s < 60) return s + 's';
    return Math.floor(s/60) + 'm ' + (s%60) + 's';
}

function setRunningStatus(text){
    const status = animArea.querySelector('.status-text');
    if(!status) return;
    status.textContent = text;
    status.classList.remove('animate');
    void status.offsetWidth;
    status.classList.add('animate');
}

function updateElapsed(){
    const elapsed = animArea.querySelector('.live-duration');
    if(elapsed) elapsed.textContent = 'Elapsed ' + fmtDuration(Date.now() - runningStartedAt);
}

function startElapsedTimer(){
    if(elapsedTimer) clearInterval(elapsedTimer);
    runningStartedAt = Date.now();
    updateElapsed();
    elapsedTimer = setInterval(updateElapsed, 1000);
}

function stopElapsedTimer(){
    if(elapsedTimer){
        clearInterval(elapsedTimer);
        elapsedTimer = undefined;
    }
}

/* ── SVG builders ───────────────────────────── */
const deviceSvg = '<svg viewBox="0 0 48 48" width="48" height="48"><rect class="device-icon" x="8" y="8" width="32" height="24" rx="3" opacity=".15"/><rect x="8" y="8" width="32" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><line x1="18" y1="36" x2="30" y2="36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="24" y1="32" x2="24" y2="36" stroke="currentColor" stroke-width="2"/></svg>';

const cloudSvg = '<svg viewBox="0 0 48 48" width="48" height="48"><path class="cloud-icon" d="M14 34c-4.4 0-8-3.6-8-8 0-3.7 2.5-6.8 6-7.7C12.7 13.8 16.8 10 22 10c5.5 0 10 4 10.7 9.2C36 19.7 38 22.6 38 26c0 4.4-3.6 8-8 8H14z" opacity=".15"/><path d="M14 34c-4.4 0-8-3.6-8-8 0-3.7 2.5-6.8 6-7.7C12.7 13.8 16.8 10 22 10c5.5 0 10 4 10.7 9.2C36 19.7 38 22.6 38 26c0 4.4-3.6 8-8 8H14z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

const CURVE_FWD = 'M 80 60 C 130 20, 210 20, 260 60';
const CURVE_REV = 'M 260 60 C 210 20, 130 20, 80 60';

function svgDots(pathD, count, dur){
    let out = '';
    for(let i = 0; i < count; i++){
        const delay = (dur / count * i).toFixed(2);
        out += '<circle class="motion-dot" r="3.5" fill="var(--accent)" opacity=".85">' +
            '<animateMotion dur="' + dur + 's" repeatCount="indefinite" begin="' + delay + 's">' +
            '<mpath href="#dotPath"/>' +
            '</animateMotion></circle>';
    }
    return '<defs><path id="dotPath" d="' + pathD + '"/></defs>' + out;
}

function buildScene(flow){
    if(flow === 'local'){
        return '<div style="position:relative;display:inline-block">' +
            deviceSvg +
            '<div class="pulse-ring"></div>' +
            '<div class="pulse-ring" style="animation-delay:.5s"></div>' +
            '</div>';
    }
    const curveD = flow === 'download' ? CURVE_REV : CURVE_FWD;
    return '<div class="scene" style="position:relative;display:flex;align-items:center;justify-content:space-between">' +
        '<div>' + deviceSvg + '</div>' +
        '<svg style="position:absolute;left:0;top:0;width:100%;height:100%" viewBox="0 0 340 120">' +
        '<path class="conn-line" d="' + CURVE_FWD + '"/>' +
        svgDots(curveD, 4, 1.6) +
        '</svg>' +
        '<div>' + cloudSvg + '</div>' +
        '</div>';
}

function buildValidationScene(running){
    return '<div class="validation-scene' + (running ? '' : ' settled') + '" aria-hidden="true">' +
        '<div class="validation-document">' +
        '<div class="document-fold"></div>' +
        '<div class="code-lines"><div class="code-line"></div><div class="code-line"></div>' +
        '<div class="code-line"></div><div class="code-line"></div></div>' +
        (running ? '<div class="scan-beam"></div>' : '') +
        '</div>' +
        (running ? '<div class="scan-badge"><span class="codicon codicon-search"></span></div>' : '') +
        '</div>';
}

function buildDeploymentScene(running){
    return '<div class="deployment-scene" aria-hidden="true">' +
        '<div class="endpoint">' + deviceSvg + '</div>' +
        '<div class="deploy-route"></div>' +
        (running
            ? '<div class="deploy-packet packet-one"><span class="codicon codicon-package"></span></div>' +
              '<div class="deploy-packet packet-two"><span class="codicon codicon-package"></span></div>' +
              '<div class="deploy-packet packet-three"><span class="codicon codicon-package"></span></div>'
            : '') +
        '<div class="endpoint' + (running ? ' deploy-cloud' : '') + '">' + cloudSvg + '</div>' +
        '</div>';
}

function buildOperationScene(operation, flow, running){
    if(operation === 'validation') return buildValidationScene(running);
    if(operation === 'deployment') return buildDeploymentScene(running);
    return buildScene(flow);
}

function runningLabel(operation, hasOutput){
    if(operation === 'validation') return hasOutput ? 'Validating SuiteCloud project...' : 'Preparing validation...';
    if(operation === 'deployment') return hasOutput ? 'Deploying to NetSuite...' : 'Preparing deployment...';
    return hasOutput ? 'Command in progress...' : 'Preparing command...';
}

function resultLabel(operation, ok, cancelled){
    if(cancelled){
        if(operation === 'validation') return 'Validation cancelled';
        if(operation === 'deployment') return 'Deployment cancelled';
        return 'Command cancelled';
    }
    if(operation === 'validation') return ok ? 'Validation completed' : 'Validation failed';
    if(operation === 'deployment') return ok ? 'Deployment completed' : 'Deployment failed';
    return ok ? 'Completed successfully' : 'Command failed';
}

function buildRunningMarkup(operation, flow){
    return buildOperationScene(operation, flow, true) +
        '<div class="operation-context"><span id="projectContext"></span><span id="accountContext"></span></div>' +
        '<div class="status-text animate" role="status" aria-live="polite"></div>' +
        '<div class="progress-bar" aria-hidden="true"><div class="shimmer"></div></div>' +
        '<div class="live-duration">Elapsed 0s</div>';
}

function setOperationContext(projectName, accountAuthId){
    const project = animArea.querySelector('#projectContext');
    const account = animArea.querySelector('#accountContext');
    if(project) project.textContent = projectName ? 'Project: ' + projectName : '';
    if(account) account.textContent = accountAuthId ? 'Account: ' + accountAuthId : '';
}

function showSuccess(){
    return '<div class="result-icon"><svg viewBox="0 0 48 48">' +
        '<circle cx="24" cy="24" r="22" class="check-circle"/>' +
        '<path class="check-path" d="M14 24 l7 7 l13 -13"/>' +
        '</svg></div>';
}

function showError(){
    return '<div class="result-icon shake"><svg viewBox="0 0 48 48">' +
        '<circle cx="24" cy="24" r="22" class="x-circle"/>' +
        '<path class="x-path" d="M16 16 l16 16"/>' +
        '<path class="x-path" d="M32 16 l-16 16" style="animation-delay:.2s"/>' +
        '</svg></div>';
}

function spawnParticles(color){
    for(let i=0;i<12;i++){
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.background = color;
        const angle = (Math.PI*2/12)*i;
        const dist = 30 + Math.random()*30;
        p.style.setProperty('--px', Math.cos(angle)*dist + 'px');
        p.style.setProperty('--py', Math.sin(angle)*dist + 'px');
        p.style.left = '50%';
        p.style.top = '50%';
        animArea.appendChild(p);
        setTimeout(() => p.remove(), 900);
    }
}

/* ── Message handler ────────────────────────── */
window.addEventListener('message', (event) => {
    const msg = event.data;

    switch(msg.type){
        case 'start': {
            currentFlow = msg.flow || 'local';
            currentOperation = msg.operation || 'generic';
            receivedOutput = false;
            titleEl.textContent = msg.label;
            idle.style.display = 'none';
            logSection.style.display = 'flex';
            logContent.innerHTML = '';
            btnCancel.style.display = '';
            btnCancel.disabled = false;

            animArea.classList.remove('hidden');
            animArea.innerHTML = buildRunningMarkup(currentOperation, currentFlow);
            setOperationContext(msg.projectName, msg.accountAuthId);
            setRunningStatus(runningLabel(currentOperation, false));
            startElapsedTimer();
            break;
        }

        case 'log': {
            appendLog(msg.data, 'line-' + msg.logType);
            if(!receivedOutput){
                receivedOutput = true;
                setRunningStatus(runningLabel(currentOperation, true));
            }
            break;
        }

        case 'finish': {
            stopElapsedTimer();
            btnCancel.style.display = 'none';
            const ok = msg.code === 0;
            const cancelled = msg.cancelled === true;
            const statusColor = cancelled ? 'var(--muted)' : (ok ? 'var(--success)' : 'var(--error)');
            const finalScene = buildOperationScene(currentOperation, currentFlow, false);
            const finalLabel = resultLabel(currentOperation, ok, cancelled);
            const resultGraphic = cancelled ? '' : (ok ? showSuccess() : showError());

            if(currentOperation === 'validation' || currentOperation === 'deployment'){
                animArea.innerHTML = finalScene +
                    resultGraphic +
                    '<div class="status-text animate" style="color:' + statusColor + '"></div>' +
                    '<div class="duration">' + fmtDuration(msg.elapsed) + '</div>';
                animArea.querySelector('.status-text').textContent = finalLabel;
            } else if(currentFlow === 'local'){
                animArea.innerHTML =
                    '<div style="position:relative;display:inline-block">' + deviceSvg + '</div>' +
                    resultGraphic +
                    '<div class="status-text animate" style="color:' + statusColor + '"></div>' +
                    '<div class="duration">' + fmtDuration(msg.elapsed) + '</div>';
                animArea.querySelector('.status-text').textContent = finalLabel;
            } else {
                const solidLine = cancelled
                    ? '<path d="M 80 60 C 130 20, 210 20, 260 60" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="6 4"/>'
                    : ok
                    ? '<path d="M 80 60 C 130 20, 210 20, 260 60" fill="none" stroke="var(--success)" stroke-width="2.5"/>'
                    : '<path d="M 80 60 C 130 20, 170 20, 170 40" fill="none" stroke="var(--error)" stroke-width="2.5"/>' +
                      '<path d="M 170 40 C 170 20, 210 20, 260 60" fill="none" stroke="var(--error)" stroke-width="2.5" stroke-dasharray="4 4"/>';

                animArea.innerHTML =
                    '<div class="scene" style="position:relative;display:flex;align-items:center;justify-content:space-between">' +
                    '<div>' + deviceSvg + '</div>' +
                    '<svg style="position:absolute;left:0;top:0;width:100%;height:100%" viewBox="0 0 340 120">' +
                    solidLine + '</svg>' +
                    '<div>' + cloudSvg + '</div>' +
                    '</div>' +
                    resultGraphic +
                    '<div class="status-text animate" style="color:' + statusColor + '"></div>' +
                    '<div class="duration">' + fmtDuration(msg.elapsed) + '</div>';
                animArea.querySelector('.status-text').textContent = finalLabel;
            }

            if(ok && !cancelled && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
                spawnParticles('var(--success)');
            }
            appendLog(msg.data, ok ? 'line-stdout' : 'line-error');
            break;
        }
    }
});
</script>
</body>
</html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
