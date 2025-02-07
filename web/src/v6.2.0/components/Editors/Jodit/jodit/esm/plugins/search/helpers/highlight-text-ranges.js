/*!
 * Jodit Editor (https://xdsoft.net/jodit/)
 * Released under MIT see LICENSE.txt in the project root for license information.
 * Copyright (c) 2013-2024 Valeriy Chupurnov. All rights reserved. https://xdsoft.net
 */
import { Dom } from "../../../core/dom/dom.js";
import { $$ } from "../../../core/helpers/utils/selector.js";
/**
 * @private
 */
const TMP_ATTR = 'jd-tmp-selection';
/**
 * @private
 */
export function highlightTextRanges(jodit, rng, restRanges, ci, root) {
    if (rng.startContainer.nodeValue == null ||
        rng.endContainer.nodeValue == null) {
        return;
    }
    if (jodit.o.search.useCustomHighlightAPI &&
        // @ts-ignore Because Highlight is not defined in the types TS 5.3.3
        typeof window.Highlight !== 'undefined') {
        const ranges = [rng, ...restRanges].map(rng => {
            const range = jodit.selection.createRange();
            range.setStart(rng.startContainer, rng.startOffset);
            range.setEnd(rng.endContainer, rng.endOffset);
            return range;
        });
        // @ts-ignore Because Highlight is not defined in the types TS 5.3.3
        const searchHighlight = new Highlight(...ranges);
        // @ts-ignore
        CSS.highlights.clear();
        // @ts-ignore
        CSS.highlights.set('jodit-search-result', searchHighlight);
        restRanges.length = 0;
        return;
    }
    const span = ci.element('span', {
        [TMP_ATTR]: true
    });
    Dom.markTemporary(span);
    const startText = rng.startContainer.nodeValue;
    let diff = 0;
    if (rng.startOffset !== 0) {
        const text = ci.text(startText.substring(0, rng.startOffset));
        rng.startContainer.nodeValue = startText.substring(rng.startOffset);
        Dom.before(rng.startContainer, text);
        if (rng.startContainer === rng.endContainer) {
            diff = rng.startOffset;
            rng.endOffset -= diff;
        }
        rng.startOffset = 0;
    }
    const endText = rng.endContainer.nodeValue;
    if (rng.endOffset !== endText.length) {
        const text = ci.text(endText.substring(rng.endOffset));
        rng.endContainer.nodeValue = endText.substring(0, rng.endOffset);
        Dom.after(rng.endContainer, text);
        for (const range of restRanges) {
            if (range.startContainer === rng.endContainer) {
                range.startContainer = text;
                range.startOffset = range.startOffset - rng.endOffset - diff;
                if (range.endContainer === rng.endContainer) {
                    range.endContainer = text;
                    range.endOffset = range.endOffset - rng.endOffset - diff;
                }
            }
            else {
                break;
            }
        }
        rng.endOffset = rng.endContainer.nodeValue.length;
    }
    let next = rng.startContainer;
    do {
        if (!next) {
            break;
        }
        if (Dom.isText(next) && !isSelectionWrapper(next.parentNode)) {
            Dom.wrap(next, span.cloneNode(), ci);
        }
        if (next === rng.endContainer) {
            break;
        }
        let step = next.firstChild || next.nextSibling;
        if (!step) {
            while (next && !next.nextSibling && next !== root) {
                next = next.parentNode;
            }
            step = next?.nextSibling;
        }
        next = step;
    } while (next && next !== root);
}
/**
 * @private
 */
export function getSelectionWrappers(root) {
    return $$(`[${TMP_ATTR}]`, root);
}
/**
 * @private
 */
export function clearSelectionWrappers(root) {
    getSelectionWrappers(root).forEach(span => Dom.unwrap(span));
}
/**
 * @private
 */
export function clearSelectionWrappersFromHTML(root) {
    return root.replace(RegExp(`<span[^>]+${TMP_ATTR}[^>]+>(.*?)</span>`, 'g'), '$1');
}
/**
 * @private
 */
export function isSelectionWrapper(node) {
    return Dom.isElement(node) && node.hasAttribute(TMP_ATTR);
}
