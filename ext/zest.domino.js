/**
 * Expose
 */

module.exports = exports = function(sel, context) {
  /* when context isn't a DocumentFragment and the selector is simple: */
  if (context.nodeType !== 11 && !~sel.indexOf(' ')) {
    if (sel[0] === '#' && context.rooted && /^#\w+$/.test(sel)) {
      return [context.doc.getElementById(sel.substring(1))];
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
