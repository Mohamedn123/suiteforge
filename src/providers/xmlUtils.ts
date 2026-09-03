import * as vscode from 'vscode';
import { SDF_OBJECTS } from '../generators/sdfObjectRegistry';

const SDF_ROOT_TAGS = new Set(SDF_OBJECTS.map(object => object.rootTag.toLowerCase()));

export function isLikelySdfDocument(document: vscode.TextDocument): boolean {
    const normalizedPath = document.uri.path.replace(/\\/g, '/').toLowerCase();
    if (normalizedPath.includes('/objects/')) { return true; }
    const rootTag = getFirstElementTagName(document.getText());
    return rootTag ? SDF_ROOT_TAGS.has(rootTag) : false;
}

/** Finds the actual root element, ignoring comments, CDATA and declarations. */
function getFirstElementTagName(text: string): string | null {
    let index = 0;
    while (index < text.length) {
        const open = text.indexOf('<', index);
        if (open < 0) { return null; }

        if (text.startsWith('<!--', open)) {
            const end = text.indexOf('-->', open + 4);
            if (end < 0) { return null; }
            index = end + 3;
            continue;
        }
        if (text.startsWith('<![CDATA[', open)) {
            const end = text.indexOf(']]>', open + 9);
            if (end < 0) { return null; }
            index = end + 3;
            continue;
        }
        if (text.startsWith('<?', open) || text.startsWith('<!', open)) {
            const end = text.indexOf('>', open + 2);
            if (end < 0) { return null; }
            index = end + 1;
            continue;
        }

        const match = /^<\s*([A-Za-z][A-Za-z0-9_.-]*)\b/.exec(text.slice(open));
        if (match) { return match[1].toLowerCase(); }
        index = open + 1;
    }
    return null;
}

/**
 * Returns the name of the innermost XML element whose opening tag appears
 * before the cursor and whose closing tag has not yet appeared.
 *
 * We walk the text from the start of the document up to the cursor and
 * maintain a tag stack — push on open tags, pop on close tags. Whatever is
 * left on top of the stack when we reach the cursor is the enclosing element.
 *
 * The whole prefix is scanned (not just a window of lines) because SDF
 * objects like saved searches or custom records can easily have more than
 * 50 lines between an element's opening and closing tag.
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
    const textBeforeCursor = document.getText(
        new vscode.Range(new vscode.Position(0, 0), position),
    );

    const stack: string[] = [];
    let index = 0;
    while (index < textBeforeCursor.length) {
        const open = textBeforeCursor.indexOf('<', index);
        if (open < 0) { break; }

        if (textBeforeCursor.startsWith('<!--', open)) {
            const end = textBeforeCursor.indexOf('-->', open + 4);
            index = end < 0 ? textBeforeCursor.length : end + 3;
            continue;
        }
        if (textBeforeCursor.startsWith('<![CDATA[', open)) {
            const end = textBeforeCursor.indexOf(']]>', open + 9);
            index = end < 0 ? textBeforeCursor.length : end + 3;
            continue;
        }
        if (textBeforeCursor.startsWith('<?', open) || textBeforeCursor.startsWith('<!', open)) {
            const end = textBeforeCursor.indexOf('>', open + 2);
            index = end < 0 ? textBeforeCursor.length : end + 1;
            continue;
        }

        let cursor = open + 1;
        const isClosing = textBeforeCursor[cursor] === '/';
        if (isClosing) { cursor++; }
        const nameMatch = /^[A-Za-z][A-Za-z0-9_.-]*/.exec(textBeforeCursor.slice(cursor));
        if (!nameMatch) {
            index = open + 1;
            continue;
        }
        const tagName = nameMatch[0].toLowerCase();
        cursor += nameMatch[0].length;

        let quote: '"' | "'" | null = null;
        let end = -1;
        for (; cursor < textBeforeCursor.length; cursor++) {
            const char = textBeforeCursor[cursor];
            if (quote) {
                if (char === quote) { quote = null; }
            } else if (char === '"' || char === "'") {
                quote = char;
            } else if (char === '>') {
                end = cursor;
                break;
            }
        }
        if (end < 0) { break; }

        const isSelfClosing = /\/\s*$/.test(textBeforeCursor.slice(open + 1, end));
        if (isClosing) {
            const matchingIndex = stack.lastIndexOf(tagName);
            if (matchingIndex >= 0) { stack.splice(matchingIndex); }
        } else if (!isSelfClosing) {
            stack.push(tagName);
        }
        index = end + 1;
    }

    return stack.length > 0 ? stack[stack.length - 1] : null;
}
