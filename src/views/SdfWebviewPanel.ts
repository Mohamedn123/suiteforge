import * as vscode from 'vscode';
import type { SdfCommand } from '../data';
import { SdfCliRunner, CliRunEvent } from './sdfCliRunner';

export class SdfWebviewPanel {
    private static instance: SdfWebviewPanel | undefined;
    private panel: vscode.WebviewPanel;
    private runner: SdfCliRunner;
    private startTime = 0;

    private constructor(private readonly extensionUri: vscode.Uri) {
        this.runner = new SdfCliRunner();

        this.panel = vscode.window.createWebviewPanel(
            'suiteforge.sdfOutput',
            'SDF Output',
            vscode.ViewColumn.Two,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        this.panel.webview.html = buildHtml();

        this.panel.webview.onDidReceiveMessage((msg: { type: string }) => {
            if (msg.type === 'cancel') { this.runner.cancel(); }
        });

        this.panel.onDidDispose(() => {
            this.runner.cancel();
            SdfWebviewPanel.instance = undefined;
        });

        this.runner.on('output', (event: CliRunEvent) => {
            if (event.type === 'exit' || event.type === 'error') {
                const elapsed = Date.now() - this.startTime;
                const code = event.type === 'error' ? 1 : (event.code ?? 1);
                this.panel.webview.postMessage({ type: 'finish', code, elapsed, data: event.data });
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

    runCommand(command: SdfCommand): void {
        this.startTime = Date.now();
        this.panel.webview.postMessage({
            type: 'start',
            label: command.label,
            description: command.description,
            flow: command.flow,
        });
        this.panel.title = `SDF: ${command.label}`;
        this.runner.run(command.id);
    }
}

function buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
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
</style>
</head>
<body>

<div class="toolbar">
    <span class="toolbar-title" id="toolbarTitle">SDF Output</span>
    <button class="btn-danger" id="btnCancel" style="display:none" onclick="post('cancel')">Cancel</button>
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
    <div class="log-toggle" id="logToggle" onclick="toggleLog()">
        <span class="chevron">&#9654;</span> Command output
    </div>
    <div class="log-content" id="logContent"></div>
</div>

<script>
const vscode = acquireVsCodeApi();
const animArea = document.getElementById('animArea');
const idle = document.getElementById('idle');
const logSection = document.getElementById('logSection');
const logToggle = document.getElementById('logToggle');
const logContent = document.getElementById('logContent');
const titleEl = document.getElementById('toolbarTitle');
const btnCancel = document.getElementById('btnCancel');

let logOpen = false;

function post(type){ vscode.postMessage({type}); }

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

/* ── SVG builders ───────────────────────────── */
const deviceSvg = '<svg viewBox="0 0 48 48" width="48" height="48"><rect class="device-icon" x="8" y="8" width="32" height="24" rx="3" opacity=".15"/><rect x="8" y="8" width="32" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><line x1="18" y1="36" x2="30" y2="36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="24" y1="32" x2="24" y2="36" stroke="currentColor" stroke-width="2"/></svg>';

const cloudSvg = '<svg viewBox="0 0 48 48" width="48" height="48"><path class="cloud-icon" d="M14 34c-4.4 0-8-3.6-8-8 0-3.7 2.5-6.8 6-7.7C12.7 13.8 16.8 10 22 10c5.5 0 10 4 10.7 9.2C36 19.7 38 22.6 38 26c0 4.4-3.6 8-8 8H14z" opacity=".15"/><path d="M14 34c-4.4 0-8-3.6-8-8 0-3.7 2.5-6.8 6-7.7C12.7 13.8 16.8 10 22 10c5.5 0 10 4 10.7 9.2C36 19.7 38 22.6 38 26c0 4.4-3.6 8-8 8H14z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

const CURVE_FWD = 'M 80 60 C 130 20, 210 20, 260 60';
const CURVE_REV = 'M 260 60 C 210 20, 130 20, 80 60';

function svgDots(pathD, count, dur){
    let out = '';
    for(let i = 0; i < count; i++){
        const delay = (dur / count * i).toFixed(2);
        out += '<circle r="3.5" fill="var(--accent)" opacity=".85">' +
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
let currentFlow = 'local';

window.addEventListener('message', (event) => {
    const msg = event.data;

    switch(msg.type){
        case 'start': {
            currentFlow = msg.flow || 'local';
            titleEl.textContent = msg.label;
            idle.style.display = 'none';
            logSection.style.display = 'flex';
            logContent.innerHTML = '';
            btnCancel.style.display = '';

            animArea.classList.remove('hidden');
            animArea.innerHTML = buildScene(currentFlow) +
                '<div class="status-text animate">' + msg.label + '...</div>' +
                '<div class="progress-bar"><div class="shimmer"></div></div>';
            break;
        }

        case 'log': {
            appendLog(msg.data, 'line-' + msg.logType);
            break;
        }

        case 'finish': {
            btnCancel.style.display = 'none';
            const ok = msg.code === 0;

            if(currentFlow === 'local'){
                animArea.innerHTML =
                    '<div style="position:relative;display:inline-block">' + deviceSvg + '</div>' +
                    (ok ? showSuccess() : showError()) +
                    '<div class="status-text animate" style="color:' + (ok ? 'var(--success)' : 'var(--error)') + '">' +
                    (ok ? 'Completed Successfully' : 'Failed') + '</div>' +
                    '<div class="duration">' + fmtDuration(msg.elapsed) + '</div>';
            } else {
                const solidLine = ok
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
                    (ok ? showSuccess() : showError()) +
                    '<div class="status-text animate" style="color:' + (ok ? 'var(--success)' : 'var(--error)') + '">' +
                    (ok ? 'Completed Successfully' : 'Failed') + '</div>' +
                    '<div class="duration">' + fmtDuration(msg.elapsed) + '</div>';
            }

            if(ok) spawnParticles('var(--success)');
            appendLog(msg.data, ok ? 'line-stdout' : 'line-error');
            break;
        }
    }
});
</script>
</body>
</html>`;
}
