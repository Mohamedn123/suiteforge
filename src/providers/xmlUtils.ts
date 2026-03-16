import * as vscode from 'vscode';

/**
 * Returns the name of the innermost XML element whose opening tag appears
 * before the cursor and whose closing tag has not yet appeared.
 *
 * We walk a window of lines before the cursor and maintain a tag stack —
 * push on open tags, pop on close tags. Whatever is left on top of the
 * stack when we reach the cursor is the enclosing element.
 *
 * Example — cursor is on the "?" below:
 *   <fieldtype>?</fieldtype>   →  returns "fieldtype"
 *   <fieldtype>
 *       ?                      →  also returns "fieldtype"
 */
export function getEnclosingTagName(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | null {
    // Look back up to 50 lines. Larger window handles deeply nested records with
    // many fields above the cursor.
    const startLine = Math.max(0, position.line - 50);
    const textBeforeCursor = document.getText(
        new vscode.Range(new vscode.Position(startLine, 0), position),
    );

    // Match only real element tags — NOT processing instructions (<?xml?>),
    // comments (<!-- -->), or CDATA sections. The leading [a-zA-Z] after the
    // optional '/' ensures we skip <? and <! prefixes.
    const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9_.-]*)[^>]*>/g;
    const stack: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(textBeforeCursor)) !== null) {
        const isClosing    = match[1] === '/';        // captured the leading '/'
        const tagName      = match[2].toLowerCase();  // the element name
        const isSelfClose  = match[0].endsWith('/>');

        if (isClosing) {
            if (stack.length > 0 && stack[stack.length - 1] === tagName) {
                stack.pop();
            }
        } else if (!isSelfClose) {
            stack.push(tagName);
        }
    }

    return stack.length > 0 ? stack[stack.length - 1] : null;
}
