/**
 * Expose
 */

module.exports = exports = function(sel, context) {
  /* when context isn't a DocumentFragment and the selector is simple: */
  var id, r;
  if (context.nodeType !== 11 && sel.indexOf(' ') === -1) {
    if (sel[0] === '#' && context.rooted && /^#[A-Z_][-A-Z0-9_]*$/i.test(sel)) {
      if (context.doc._hasMultipleElementsWithId) {
        id = sel.substring(1);
        if (!context.doc._hasMultipleElementsWithId(id)) {
          r = context.doc.getElementById(id);
          return r ? [r] : [];
        }
      }
    }
    if (sel[0] === '.' && /^\.\w+$/.test(sel)) {
      return context.getElementsByClassName(sel.substring(1));
    }
    if (/^\w+$/.test(sel)) {
      return context.getElementsByTagName(sel);
    }
  }
  /* do things the hard/slow way */
  return find(sel, context);
};

exports.selectors = selectors;
exports.operators = operators;
exports.combinators = combinators;

exports.matches = function(el, sel) {
  var test = { sel: sel };
  do {
    test = compile(test.sel);
    if (test(el)) { return true; }
  } while (test.sel);
  return false;
};
