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
  return !!compile(sel)(el);
};


