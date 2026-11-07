/**
 * Zest (https://github.com/chjj/zest)
 * A css selector engine.
 * Copyright (c) 2011-2012, Christopher Jeffrey. (MIT Licensed)
 */

// TODO
// - Recognize the TR subject selector when parsing.
// - Pass context to scope.
// - Add :column pseudo-classes.

;(function() {

/**
 * Shared
 */

var window = this
  , document = this.document
  , old = this.zest;

// -- begin shared code (also built into domino; see Makefile) --

/**
 * Helpers
 */

var compareDocumentPosition = function(a, b) {
  if (a.compareDocumentPosition) {
    return a.compareDocumentPosition(b);
  }

  var el = a.ownerDocument.getElementsByTagName('*')
    , i = el.length;

  while (i--) {
    if (el[i] === a) return 2;
    if (el[i] === b) return 4;
  }

  return 1;
};

var order = function(a, b) {
  /* jshint bitwise: false */
  return compareDocumentPosition(a, b) & 2 ? 1 : -1;
};

var next = function(el) {
  while ((el = el.nextSibling)
         && el.nodeType !== 1);
  return el;
};

var prev = function(el) {
  while ((el = el.previousSibling)
         && el.nodeType !== 1);
  return el;
};

var child = function(el) {
  /*jshint -W084 */
  if (el = el.firstChild) {
    while (el.nodeType !== 1
           && (el = el.nextSibling));
  }
  return el;
};

var lastChild = function(el) {
  /*jshint -W084 */
  if (el = el.lastChild) {
    while (el.nodeType !== 1
           && (el = el.previousSibling));
  }
  return el;
};

var parentIsElement = function(n) {
  if (!n.parentNode) { return false; }
  var nodeType = n.parentNode.nodeType;
  // The root `html` element can be a first- or last-child, too.
  return nodeType === 1 || nodeType === 9;
};

var unquote = function(str) {
  if (!str) return str;
  var ch = str[0];
  if (ch === '"' || ch === '\'') {
    if (str[str.length-1] === ch) {
      str = str.slice(1, -1);
    } else {
      // bad string.
      str = str.slice(1);
    }
    return str.replace(rules.str_escape, function(s) {
      var m = /^\\(?:([0-9A-Fa-f]+)|([\r\n\f]+))/.exec(s);
      if (!m) { return s.slice(1); }
      if (m[2]) { return ''; /* escaped newlines are ignored in strings. */ }
      var cp = parseInt(m[1], 16);
      return String.fromCodePoint ? String.fromCodePoint(cp) :
        // Not all JavaScript implementations have String.fromCodePoint yet.
        String.fromCharCode(cp);
    });
  } else if (rules.ident.test(str)) {
    return decodeid(str);
  } else {
    // NUMBER, PERCENTAGE, DIMENSION, etc
    return str;
  }
};

var decodeid = function(str) {
  return str.replace(rules.escape, function(s) {
    var m = /^\\([0-9A-Fa-f]+)/.exec(s);
    if (!m) { return s[1]; }
    var cp = parseInt(m[1], 16);
    return String.fromCodePoint ? String.fromCodePoint(cp) :
      // Not all JavaScript implementations have String.fromCodePoint yet.
      String.fromCharCode(cp);
  });
};

var indexOf = (function() {
  if (Array.prototype.indexOf) {
    return Array.prototype.indexOf;
  }
  return function(obj, item) {
    var i = this.length;
    while (i--) {
      if (this[i] === item) return i;
    }
    return -1;
  };
})();

var makeInside = function(start, end) {
  var regex = rules.inside.source
    .replace(/</g, start)
    .replace(/>/g, end);

  return new RegExp(regex);
};

var replace = function(regex, name, val) {
  regex = regex.source;
  regex = regex.replace(name, val.source || val);
  return new RegExp(regex);
};

var truncateUrl = function(url, num) {
  return url
    .replace(/^(?:\w+:\/\/|\/+)/, '')
    .replace(/(?:\/+|\/*#.*?)$/, '')
    .split('/', num)
    .join('/');
};

/**
 * Handle `nth` Selectors
 */

var parseNth = function(param_, test) {
  var param = param_.replace(/\s+/g, '')
    , cap;

  if (param === 'even') {
    param = '2n+0';
  } else if (param === 'odd') {
    param = '2n+1';
  } else if (param.indexOf('n') === -1) {
    param = '0n' + param;
  }

  cap = /^([+-])?(\d+)?n([+-])?(\d+)?$/.exec(param);

  return {
    group: cap[1] === '-'
      ? -(cap[2] || 1)
      : +(cap[2] || 1),
    offset: cap[4]
      ? (cap[3] === '-' ? -cap[4] : +cap[4])
      : 0
  };
};

var nth = function(param_, test, last) {
  var param = parseNth(param_)
    , group = param.group
    , offset = param.offset
    , find = !last ? child : lastChild
    , advance = !last ? next : prev;

  return function(el) {
    if (!parentIsElement(el)) return;

    var rel = find(el.parentNode)
      , pos = 0;

    while (rel) {
      if (test(rel, el)) pos++;
      if (rel === el) {
        pos -= offset;
        return group && pos
          ? (pos % group) === 0 && (pos < 0 === group < 0)
          : !pos;
      }
      rel = advance(rel);
    }
  };
};

/**
 * Languages
 * https://www.w3.org/TR/selectors-4/#the-lang-pseudo
 */

var HTML_NS = 'http://www.w3.org/1999/xhtml'
  , SVG_NS = 'http://www.w3.org/2000/svg'
  , XML_NS = 'http://www.w3.org/XML/1998/namespace';

// The local name of an HTML element, or null for any other node.
var htmlName = function(el) {
  return el && el.nodeType === 1 && el.namespaceURI === HTML_NS
    ? el.localName : null;
};

var asciiLowerCase = function(str) {
  return str.replace(/[A-Z]+/g, function(s) { return s.toLowerCase(); });
};

// The language of `el` from the `lang` and `xml:lang` attributes on it
// and its ancestors.  If none has one, this is null when `el` is in a
// document, whose default language then applies, and '' (unknown) when
// it is not.
// https://html.spec.whatwg.org/multipage/dom.html#language
var contentLanguage = function(el) {
  var lang;
  for (; el && el.nodeType === 1; el = el.parentNode) {
    lang = el.getAttributeNS(XML_NS, 'lang');
    if (lang == null && (el.namespaceURI === HTML_NS
                         || el.namespaceURI === SVG_NS)) {
      lang = el.getAttribute('lang');
    }
    if (lang != null) return lang;
  }
  return el && el.nodeType === 9 ? null : '';
};

// The pragma-set default language of `doc`, from the last
// Content-Language pragma which sets one, or '' if none does.
// https://html.spec.whatwg.org/multipage/semantics.html#pragma-set-default-language
var pragmaLanguage = function(doc) {
  var metas = find('meta[http-equiv="content-language" i][content]' +
                   ':not([content*=","])', doc)
    , lang
    , i;
  for (i = metas.length - 1; i >= 0; i--) {
    lang = /^[\t\n\f\r ]*([^\t\n\f\r ]*)/
      .exec(metas[i].getAttribute('content'))[1];
    // The type selector matches a `meta` in any namespace.
    if (lang && htmlName(metas[i]) === 'meta') return lang;
  }
  return '';
};

// Extended filtering, from RFC 4647 section 3.3.2.  Both `lang` and
// `range` must already be in ASCII lowercase.
// https://www.w3.org/TR/selectors-4/#the-lang-pseudo
var langMatches = function(lang, range) {
  if (range === '' || lang === '') return range === lang;
  if (!/^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/.test(lang)
      || !/^(?:[a-z]{1,8}|\*)(?:-(?:[a-z0-9]{1,8}|\*))*$/.test(range)) {
    return false;
  }
  var tag = lang.split('-')
    , subtags = range.split('-')
    , i = 1
    , j = 1;
  if (subtags[0] !== '*' && subtags[0] !== tag[0]) return false;
  while (i < subtags.length) {
    if (subtags[i] === '*') {
      i++;
    } else if (j >= tag.length) {
      return false;
    } else if (subtags[i] === tag[j]) {
      i++;
      j++;
    } else if (tag[j].length === 1) {
      return false;
    } else {
      j++;
    }
  }
  return true;
};

/**
 * HTML Forms
 *
 * The HTML spec's form pseudo-classes, as they apply to elements
 * built from markup: we take each control's state (its value,
 * checkedness, and so on) from its content attributes.  A control
 * whose state a user has changed is beyond us, and so is anything
 * which depends on that, like `tooLong` and `tooShort`.
 * https://html.spec.whatwg.org/multipage/semantics-other.html#pseudo-classes
 */

// A test for the HTML elements which match `sel`, compiled when it's
// first used.  (A type selector matches an element in any namespace.)
var htmlMatcher = function(sel) {
  var test;
  return function(el) {
    test = test || compileGroup(sel);
    return el.namespaceURI === HTML_NS && !!test(el);
  };
};

// A selector for the `input` elements whose type isn't one of `types`.
// (A missing or invalid type is the Text state.)
var inputNotOfType = function(types) {
  return 'input:not([type="' + types.join('" i], [type="') + '" i])';
};

// A control disabled by its own `disabled` attribute or by a disabled
// fieldset's, outside that fieldset's first legend.
var isDisabledControl = htmlMatcher(
    ':is(button, input, select, textarea, fieldset)'
    + ':is([disabled], fieldset[disabled] > :not(legend:first-of-type),'
    + ' fieldset[disabled] > :not(legend:first-of-type) *)')
  // The elements to which the `readonly` attribute applies.
  , isReadonlyApplicable = htmlMatcher('textarea, ' + inputNotOfType([
      'hidden', 'range', 'color', 'checkbox', 'radio', 'file', 'submit',
      'image', 'reset', 'button']))
  // The elements to which the `required` attribute applies.
  , isRequirable = htmlMatcher('select, textarea, ' + inputNotOfType([
      'hidden', 'range', 'color', 'submit', 'image', 'reset', 'button']));

// The HTML elements under `root` which match `sel` and, if it's given,
// pass `test`, in tree order.
var findHtml = function(sel, root, test) {
  var els = find(sel, root)
    , result = []
    , i;
  for (i = 0; i < els.length; i++) {
    if (els[i].namespaceURI === HTML_NS && (!test || test(els[i]))) {
      result.push(els[i]);
    }
  }
  return result;
};

var CHECKABLE = 'input:is([type="checkbox" i], [type="radio" i])'
  , SUBMIT_BUTTON = 'button:not([type="reset" i], [type="button" i]),'
    + ' input[type="submit" i], input[type="image" i]';

var isCheckbox = htmlMatcher('input[type="checkbox" i]')
  , isRadio = htmlMatcher('input[type="radio" i]')
  , isCheckable = htmlMatcher(CHECKABLE)
  , isSubmitButton = htmlMatcher(SUBMIT_BUTTON)
  , isValuelessProgress = htmlMatcher('progress:not([value])')
  , isDefaultChecked = htmlMatcher(
      'option[selected], ' + CHECKABLE + '[checked]')
  // The elements which can be disabled.
  , isDisableable = htmlMatcher(
      'button, input, select, textarea, optgroup, option, fieldset');

var treeRoot = function(el) {
  while (el.parentNode) el = el.parentNode;
  return el;
};

// The select whose list of options includes this option (or optgroup).
var nearestSelect = function(el) {
  var optgroup = false;
  while ((el = el.parentNode)) {
    switch (htmlName(el)) {
      case 'select': return el;
      case 'datalist': case 'hr': case 'option': return null;
      case 'optgroup':
        if (optgroup) return null;
        optgroup = true;
    }
  }
  return null;
};

var isDisabledOption = function(el) {
  if (el.hasAttribute('disabled')) return true;
  while ((el = el.parentNode)) {
    switch (htmlName(el)) {
      case 'select': case 'datalist': case 'hr': case 'option': return false;
      case 'optgroup': return el.hasAttribute('disabled');
    }
  }
  return false;
};

// https://html.spec.whatwg.org/multipage/semantics-other.html#concept-element-disabled
var isActuallyDisabled = function(el) {
  var select;
  switch (htmlName(el)) {
    case 'option':
      if (isDisabledOption(el)) return true;
      break;
    case 'optgroup':
      if (el.hasAttribute('disabled')) return true;
      break;
    default:
      return isDisabledControl(el);
  }
  select = nearestSelect(el);
  return !!select && isDisabledControl(select);
};

var formOwner = function(el) {
  var id = el.getAttribute('form')
    , els, i;
  if (id != null) {
    els = find('[id]', treeRoot(el));
    for (i = 0; i < els.length; i++) {
      if (els[i].getAttribute('id') === id) {
        return htmlName(els[i]) === 'form' ? els[i] : null;
      }
    }
    return null;
  }
  while ((el = el.parentNode)) {
    if (htmlName(el) === 'form') return el;
  }
  return null;
};

// The radio buttons in `el`'s group, including `el`, which match `sel`,
// if it's given, in tree order.  (A radio button with no name is in a
// group by itself.)
var radioGroup = function(el, sel) {
  var name = el.getAttribute('name')
    , form = name ? formOwner(el) : null;
  return findHtml('input[type="radio" i]' + (sel || ''), treeRoot(el),
    function(e) {
      return e === el || (!!name && e.getAttribute('name') === name
        && formOwner(e) === form);
    });
};

var isChecked = function(el) {
  var checked;
  if (!el.hasAttribute('checked')) return false;
  if (!isRadio(el)) return true;
  // Setting a radio button's checkedness unchecks the rest of its
  // group, so the last one with a `checked` attribute wins.
  checked = radioGroup(el, '[checked]');
  return !checked.length || checked[checked.length - 1] === el;
};

var radioGroupIsChecked = function(el) {
  return el.hasAttribute('checked') || !!radioGroup(el, '[checked]').length;
};

var displaySize = function(select) {
  var m = /^[\t\n\f\r ]*\+?(\d+)/.exec(select.getAttribute('size') || '');
  return m ? +m[1] : select.hasAttribute('multiple') ? 4 : 1;
};

var listOfOptions = function(select) {
  return findHtml('option', select, function(e) {
    return nearestSelect(e) === select;
  });
};

// https://html.spec.whatwg.org/multipage/form-elements.html#selectedness-setting-algorithm
var selectedOptions = function(select) {
  var options = listOfOptions(select)
    , selected = []
    , i;
  for (i = 0; i < options.length; i++) {
    if (options[i].hasAttribute('selected')) selected.push(options[i]);
  }
  if (select.hasAttribute('multiple')) return selected;
  if (selected.length) return selected.slice(-1);
  if (displaySize(select) === 1) {
    for (i = 0; i < options.length; i++) {
      if (!isDisabledOption(options[i])) return [options[i]];
    }
  }
  return [];
};

var isSelected = function(option) {
  var select = nearestSelect(option);
  if (!select) return option.hasAttribute('selected');
  return indexOf.call(selectedOptions(select), option) !== -1;
};

/**
 * Constraint Validation
 * https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constraints
 */

var inputTypes = /^(?:hidden|text|search|tel|url|email|password|date|month|week|time|datetime-local|number|range|color|checkbox|radio|file|submit|image|reset|button)$/
  , patternApplies = /^(?:text|search|tel|url|email|password)$/;

var inputType = function(el) {
  var type = asciiLowerCase(el.getAttribute('type') || '');
  return inputTypes.test(type) ? type : 'text';
};

var stripNewlines = function(str) {
  return str.replace(/[\r\n]+/g, '');
};

var trimWhitespace = function(str) {
  return str.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
};

var validFloat = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

// The rules for parsing floating-point number values, which ignore
// leading whitespace and anything after the number.
var parseFloatValue = function(str) {
  var m = /^[\t\n\f\r ]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(str)
    , n = m ? parseFloat(m[1]) : NaN;
  return isFinite(n) ? n + 0 : null;
};

var daysInMonth = function(year, month) {
  return month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : (month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31);
};

// Milliseconds since 1970-01-01, or null if that's out of range.
var utc = function(year, month, day) {
  var d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d.getTime();
};

var parseDate = function(str) {
  var m = /^(\d{4,})-(\d\d)-(\d\d)$/.exec(str);
  if (!m || +m[1] < 1 || +m[2] < 1 || +m[2] > 12 || +m[3] < 1
      || +m[3] > daysInMonth(+m[1], +m[2])) {
    return null;
  }
  return utc(+m[1], +m[2], +m[3]);
};

var parseTime = function(str) {
  var m = /^(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?$/.exec(str);
  if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] || 0) > 59) return null;
  return ((m[1] * 60 + Number(m[2])) * 60 + Number(m[3] || 0)) * 1000
    + Number(((m[4] || '') + '00').slice(0, 3));
};

// How each input type turns a string into a number (or null), its
// default step, its step scale factor, and its default step base.
var numericTypes = {
  number: {
    parse: function(str) {
      return parseFloatValue(str);
    },
    step: 1, scale: 1
  },
  range: {
    parse: function(str) {
      return parseFloatValue(str);
    },
    step: 1, scale: 1
  },
  date: {
    parse: parseDate,
    step: 1, scale: 86400000
  },
  month: {
    parse: function(str) {
      var m = /^(\d{4,})-(\d\d)$/.exec(str);
      if (!m || +m[1] < 1 || +m[2] < 1 || +m[2] > 12) return null;
      return (m[1] - 1970) * 12 + (m[2] - 1);
    },
    step: 1, scale: 1
  },
  week: {
    parse: function(str) {
      var m = /^(\d{4,})-W(\d\d)$/.exec(str)
        , year, jan1, weeks;
      if (!m || +m[1] < 1) return null;
      year = +m[1];
      jan1 = utc(year, 1, 1);
      if (jan1 == null) return null;
      jan1 = new Date(jan1).getUTCDay();
      weeks = jan1 === 4 || (jan1 === 3 && daysInMonth(year, 2) === 29)
        ? 53 : 52;
      if (+m[2] < 1 || +m[2] > weeks) return null;
      // Week 1 is the one with the year's first Thursday.
      return utc(year, 1, 4 - (jan1 + 2) % 7 + 7 * (+m[2] - 1));
    },
    step: 1, scale: 604800000, base: -259200000
  },
  time: {
    parse: parseTime,
    step: 60, scale: 1000, periodic: true
  },
  'datetime-local': {
    parse: function(str) {
      var m = /^([^T ]*)[T ](.*)$/.exec(str)
        , date = m && parseDate(m[1])
        , time = m && parseTime(m[2]);
      return date == null || time == null ? null : date + time;
    },
    step: 60, scale: 1000
  }
};

var validEmail = /^[a-zA-Z0-9.!#$%&'*+\/=?\^_`{|}~\-]+@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

var isAbsoluteUrl = function(str) {
  if (typeof URL === 'function') {
    try {
      new URL(str); // jshint ignore:line
      return true;
    } catch (e) {
      return false;
    }
  }
  return /^[a-zA-Z][a-zA-Z0-9+.\-]*:[^\t\n\f\r ]*$/.test(str);
};

var regexpFlags = (function() {
  try {
    new RegExp('', 'v'); // jshint ignore:line
    return 'v';
  } catch (e) {
    return 'u';
  }
})();

// The input's value: its `value` attribute, after value sanitization.
var inputValue = function(el, type) {
  var value = el.getAttribute('value') || ''
    , numeric = numericTypes[type];
  if (type === 'email') {
    return el.hasAttribute('multiple')
      ? value.split(',').map(trimWhitespace).join(',')
      : trimWhitespace(stripNewlines(value));
  }
  if (type === 'url') return trimWhitespace(stripNewlines(value));
  if (type === 'number' || type === 'range') {
    return validFloat.test(value) ? value : '';
  }
  if (numeric) return numeric.parse(value) == null ? '' : value;
  return stripNewlines(value);
};

var isCandidateControl = htmlMatcher(
  ':is(button:not([type="reset" i], [type="button" i]), select, textarea, '
  + inputNotOfType(['hidden', 'reset', 'button']) + '):not(datalist *)');

// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#candidate-for-constraint-validation
var isCandidate = function(el) {
  return isCandidateControl(el) && !isDisabledControl(el)
    && !(isReadonlyApplicable(el) && el.hasAttribute('readonly'));
};

// Is `el`, a candidate for constraint validation, out of range?
var rangeState = function(el) {
  var type = inputType(el)
    , numeric = numericTypes[type];
  if (!numeric) return null;
  var min = numeric.parse(el.getAttribute('min') || '')
    , max = numeric.parse(el.getAttribute('max') || '');
  if (type === 'range') {
    // https://html.spec.whatwg.org/multipage/input.html#range-state-(type=range)
    min = min == null ? 0 : min;
    max = max == null ? 100 : max;
  }
  if (min == null && max == null) return null;
  // A range input's value is always clamped and stepped.
  if (type === 'range') return { inRange: true };
  var value = inputValue(el, type);
  value = value === '' ? null : numeric.parse(value);
  if (value == null) return { inRange: true };
  if (numeric.periodic && min != null && max != null && max < min) {
    return { inRange: !(value > max && value < min) };
  }
  return { inRange: !(min != null && value < min)
           && !(max != null && value > max) };
};

var stepMismatch = function(el, type, value) {
  var numeric = numericTypes[type]
    , step = el.getAttribute('step')
    , base;
  if (step != null && asciiLowerCase(step) === 'any') return false;
  step = step == null ? null : parseFloatValue(step);
  step = (step > 0 ? step : numeric.step) * numeric.scale;
  base = numeric.parse(el.getAttribute('min') || '');
  if (base == null) base = numeric.parse(el.getAttribute('value') || '');
  if (base == null) base = numeric.base || 0;
  var n = (numeric.parse(value) - base) / step;
  return Math.abs(n - Math.round(n)) > 1e-9 * Math.max(1, Math.abs(n));
};

var valueMissing = function(el) {
  var name = htmlName(el)
    , type, selected;
  if (name === 'textarea') {
    return el.hasAttribute('required') && el.textContent === '';
  }
  if (name === 'select') {
    if (!el.hasAttribute('required')) return false;
    selected = selectedOptions(el);
    return !selected.length || (selected.length === 1 && isPlaceholder(el, selected[0]));
  }
  type = inputType(el);
  if (type === 'radio') {
    return !radioGroupIsChecked(el) && (el.hasAttribute('required')
      || !!radioGroup(el, '[required]').length);
  }
  if (!isRequirable(el) || !el.hasAttribute('required')) return false;
  if (type === 'checkbox') return !isChecked(el);
  // We have no files.
  if (type === 'file') return true;
  return inputValue(el, type) === '';
};

var isPlaceholder = function(select, option) {
  if (displaySize(select) !== 1 || option !== listOfOptions(select)[0]
      || optionValue(option) !== '') {
    return false;
  }
  for (var p = option.parentNode; p !== select; p = p.parentNode) {
    if (htmlName(p) === 'optgroup') return false;
  }
  return true;
};

var optionValue = function(option) {
  var value = option.getAttribute('value');
  return value != null ? value
    : trimWhitespace((option.textContent || '').replace(/[\t\n\f\r ]+/g, ' '));
};

// Does `el`, a candidate for constraint validation, satisfy its
// constraints?
var isValid = function(el) {
  if (htmlName(el) !== 'input') return !valueMissing(el);
  var type = inputType(el)
    , value = inputValue(el, type)
    , values, pattern, range, i;
  if (valueMissing(el)) return false;
  if (value === '') return true;
  values = type === 'email' && el.hasAttribute('multiple')
    ? value.split(',') : [value];
  for (i = 0; i < values.length; i++) {
    if (type === 'email' && !validEmail.test(values[i])) return false;
    if (type === 'url' && !isAbsoluteUrl(values[i])) return false;
  }
  if (patternApplies.test(type) && el.hasAttribute('pattern')) {
    try {
      pattern = new RegExp('^(?:' + el.getAttribute('pattern') + ')$', regexpFlags);
    } catch (e) {
      // An invalid pattern is ignored.
    }
    for (i = 0; pattern && i < values.length; i++) {
      if (!pattern.test(values[i])) return false;
    }
  }
  range = rangeState(el);
  if (range && !range.inRange) return false;
  return !(numericTypes[type] && type !== 'range'
           && stepMismatch(el, type, value));
};

var isInvalidCandidate = function(el) {
  return isCandidate(el) && !isValid(el);
};

// Has `el`, a form or fieldset, any controls which don't validate?
var hasInvalidControl = function(el) {
  var controls = 'button, input, select, textarea';
  if (htmlName(el) === 'fieldset') {
    return !!findHtml(controls, el, isInvalidCandidate).length;
  }
  return !!findHtml(controls, treeRoot(el), function(e) {
    return isInvalidCandidate(e) && formOwner(e) === el;
  }).length;
};

// Is `el` a user-alterable element?
// https://html.spec.whatwg.org/multipage/semantics-other.html#selector-read-write
var isReadWrite = function(el) {
  var doc, value;
  if (isReadonlyApplicable(el)) {
    return !el.hasAttribute('readonly') && !isDisabledControl(el);
  }
  if (htmlName(el) === 'input') return false;
  for (; htmlName(el); el = el.parentNode) {
    value = el.getAttribute('contenteditable');
    if (value != null) {
      value = asciiLowerCase(value);
      if (value === '' || value === 'true' || value === 'plaintext-only') {
        return true;
      }
      if (value === 'false') return false;
    }
  }
  doc = el && el.nodeType === 9 ? el : null;
  return !!doc && doc.designMode === 'on';
};

/**
 * Simple Selectors
 */

var selectors = {
  '*': (function() {
    if (document && function() {
      var el = document.createElement('div');
      el.appendChild(document.createComment(''));
      return !!el.getElementsByTagName('*')[0];
    }()) {
      return function(el) {
        if (el.nodeType === 1) return true;
      };
    }
    return function() {
      return true;
    };
  })(),
  'type': function(type) {
    type = type.toLowerCase();
    return function(el) {
      return el.nodeName.toLowerCase() === type;
    };
  },
  'attr': function(key, op, val, i) {
    op = operators[op];
    if (!op) { throw new SyntaxError('Unknown attribute operator.'); }
    return function(el) {
      var attr;
      // Selectors match attributes, not the corresponding DOM properties
      // (`htmlFor`, `className`, `value`, `checked`, ...), and an empty
      // attribute is present, not missing.
      if (!el.getAttribute) return;
      if (el.hasAttribute && !el.hasAttribute(key)) return;
      attr = el.getAttribute(key);
      if (attr == null) return;
      attr = attr + '';
      if (i) {
        attr = attr.toLowerCase();
        val = val.toLowerCase();
      }
      return op(attr, val);
    };
  },
  ':first-child': function(el) {
    return !prev(el) && parentIsElement(el);
  },
  ':last-child': function(el) {
    return !next(el) && parentIsElement(el);
  },
  ':only-child': function(el) {
    return !prev(el) && !next(el) && parentIsElement(el);
  },
  ':nth-child': function(param, last) {
    return nth(param, function() {
      return true;
    }, last);
  },
  ':nth-last-child': function(param) {
    return selectors[':nth-child'](param, true);
  },
  ':root': function(el) {
    return el.ownerDocument.documentElement === el;
  },
  ':empty': function(el) {
    return !el.firstChild;
  },
  ':not': function(sel) {
    var test = compileGroup(sel);
    return function(el) {
      return !test(el);
    };
  },
  ':first-of-type': function(el) {
    if (!parentIsElement(el)) return;
    var type = el.nodeName;
    /*jshint -W084 */
    while (el = prev(el)) {
      if (el.nodeName === type) return;
    }
    return true;
  },
  ':last-of-type': function(el) {
    if (!parentIsElement(el)) return;
    var type = el.nodeName;
    /*jshint -W084 */
    while (el = next(el)) {
      if (el.nodeName === type) return;
    }
    return true;
  },
  ':only-of-type': function(el) {
    return selectors[':first-of-type'](el)
        && selectors[':last-of-type'](el);
  },
  ':nth-of-type': function(param, last) {
    return nth(param, function(rel, el) {
      return rel.nodeName === el.nodeName;
    }, last);
  },
  ':nth-last-of-type': function(param) {
    return selectors[':nth-of-type'](param, true);
  },
  ':checked': function(el) {
    if (isCheckable(el)) return isChecked(el);
    return htmlName(el) === 'option' && isSelected(el);
  },
  ':indeterminate': function(el) {
    if (isCheckbox(el)) return el.indeterminate === true;
    if (isRadio(el)) return !radioGroupIsChecked(el);
    return isValuelessProgress(el);
  },
  ':enabled': function(el) {
    return isDisableable(el) && !isActuallyDisabled(el);
  },
  ':disabled': function(el) {
    return isActuallyDisabled(el);
  },
  ':target': function(el) {
    return el.id === window.location.hash.substring(1);
  },
  ':focus': function(el) {
    return el === el.ownerDocument.activeElement;
  },
  ':is': function(sel) {
    return compileGroup(sel);
  },
  // :matches is an older name for :is; see
  // https://github.com/w3c/csswg-drafts/issues/3258
  ':matches': function(sel) {
    return selectors[':is'](sel);
  },
  ':nth-match': function(param, last) {
    var args = param.split(/\s*,\s*/)
      , arg = args.shift()
      , test = compileGroup(args.join(','));

    return nth(arg, test, last);
  },
  ':nth-last-match': function(param) {
    return selectors[':nth-match'](param, true);
  },
  ':links-here': function(el) {
    return el + '' === window.location + '';
  },
  ':lang': function(param) {
    // A comma-separated list of language ranges, each an ident or a
    // string.  (`tok` has unquoted a lone string for us.)
    var ranges = (param.indexOf(',') === -1 ? [param]
      : param.split(',').map(function(range) {
        return decodeid(range.replace(/^\s*["']?|["']?\s*$/g, ''));
      })).map(asciiLowerCase);
    return function(el) {
      var lang = contentLanguage(el);
      if (lang === null) lang = pragmaLanguage(el.ownerDocument);
      lang = asciiLowerCase(lang);
      for (var i = 0; i < ranges.length; i++) {
        if (langMatches(lang, ranges[i])) return true;
      }
      return false;
    };
  },
  ':dir': function(param) {
    return function(el) {
      while (el) {
        if (el.dir) return el.dir === param;
        el = el.parentNode;
      }
    };
  },
  ':scope': function(el, con) {
    var context = con || el.ownerDocument;
    if (context.nodeType === 9) {
      return el === context.documentElement;
    }
    return el === context;
  },
  ':any-link': function(el) {
    return typeof el.href === 'string';
  },
  ':local-link': function(el) {
    if (el.nodeName) {
      return el.href && el.host === window.location.host;
    }
    var param = +el + 1;
    return function(el) {
      if (!el.href) return;

      var url = window.location + ''
        , href = el + '';

      return truncateUrl(url, param) === truncateUrl(href, param);
    };
  },
  ':default': function(el) {
    var form;
    if (isDefaultChecked(el)) return true;
    // The first submit button of its form
    form = isSubmitButton(el) && formOwner(el);
    return !!form && el === findHtml(SUBMIT_BUTTON, treeRoot(form),
      function(e) { return formOwner(e) === form; })[0];
  },
  ':valid': function(el) {
    var name = htmlName(el);
    if (name === 'form' || name === 'fieldset') return !hasInvalidControl(el);
    return isCandidate(el) && isValid(el);
  },
  ':invalid': function(el) {
    var name = htmlName(el);
    if (name === 'form' || name === 'fieldset') return hasInvalidControl(el);
    return isInvalidCandidate(el);
  },
  ':in-range': function(el) {
    var range = htmlName(el) === 'input' && isCandidate(el) && rangeState(el);
    return !!range && range.inRange;
  },
  ':out-of-range': function(el) {
    var range = htmlName(el) === 'input' && isCandidate(el) && rangeState(el);
    return !!range && !range.inRange;
  },
  ':required': function(el) {
    return isRequirable(el) && el.hasAttribute('required');
  },
  ':optional': function(el) {
    return isRequirable(el) && !el.hasAttribute('required');
  },
  ':read-only': function(el) {
    return !!htmlName(el) && !isReadWrite(el);
  },
  ':read-write': function(el) {
    return isReadWrite(el);
  },
  ':hover': function() {
    throw new Error(':hover is not supported.');
  },
  ':active': function() {
    throw new Error(':active is not supported.');
  },
  ':link': function() {
    throw new Error(':link is not supported.');
  },
  ':visited': function() {
    throw new Error(':visited is not supported.');
  },
  ':column': function() {
    throw new Error(':column is not supported.');
  },
  ':nth-column': function() {
    throw new Error(':nth-column is not supported.');
  },
  ':nth-last-column': function() {
    throw new Error(':nth-last-column is not supported.');
  },
  ':current': function() {
    throw new Error(':current is not supported.');
  },
  ':past': function() {
    throw new Error(':past is not supported.');
  },
  ':future': function() {
    throw new Error(':future is not supported.');
  },
  // Non-standard, for compatibility purposes.
  ':contains': function(param) {
    return function(el) {
      var text = el.innerText || el.textContent || el.value || '';
      return text.indexOf(param) !== -1;
    };
  },
  ':has': function(param) {
    return function(el) {
      return find(param, el).length > 0;
    };
  }
  // Potentially add more pseudo selectors for
  // compatibility with sizzle and most other
  // selector engines (?).
};

/**
 * Attribute Operators
 */

var operators = {
  '-': function() {
    return true;
  },
  '=': function(attr, val) {
    return attr === val;
  },
  // https://drafts.csswg.org/selectors-4/#attribute-substrings
  // For *=, ^=, and $=, if "val" is the empty string the selector
  // does not represent anything.
  '*=': function(attr, val) {
    return val !== '' && attr.indexOf(val) !== -1;
  },
  '~=': function(attr, val) {
    var i
      , s
      , f
      , l;

    // https://drafts.csswg.org/selectors-4/#attribute-representation
    // If "val" contains whitespace or is the empty string, it will
    // never represent anything.
    if (val === '' || /[ \t\n\r\f]/.test(val)) return false;

    for (s = 0; true; s = i + 1) {
      i = attr.indexOf(val, s);
      if (i === -1) return false;
      f = attr[i - 1];
      l = attr[i + val.length];
      if ((!f || /[ \t\n\r\f]/.test(f)) && (!l || /[ \t\n\r\f]/.test(l))) {
        return true;
      }
    }
  },
  '|=': function(attr, val) {
    var i = attr.indexOf(val)
      , l;

    if (i !== 0) return;
    l = attr[i + val.length];

    return l === '-' || !l;
  },
  '^=': function(attr, val) {
    return val !== '' && attr.indexOf(val) === 0;
  },
  '$=': function(attr, val) {
    var i = attr.lastIndexOf(val);
    return val !== '' && i !== -1 && i + val.length === attr.length;
  },
  // non-standard
  '!=': function(attr, val) {
    return attr !== val;
  }
};

/**
 * Combinator Logic
 */

var combinators = {
  ' ': function(test) {
    return function(el) {
      /*jshint -W084 */
      while (el = el.parentNode) {
        if (test(el)) return el;
      }
    };
  },
  '>': function(test) {
    return function(el) {
      /*jshint -W084 */
      if (el = el.parentNode) {
        return test(el) && el;
      }
    };
  },
  '+': function(test) {
    return function(el) {
      /*jshint -W084 */
      if (el = prev(el)) {
        return test(el) && el;
      }
    };
  },
  '~': function(test) {
    return function(el) {
      /*jshint -W084 */
      while (el = prev(el)) {
        if (test(el)) return el;
      }
    };
  },
  'noop': function(test) {
    return function(el) {
      return test(el) && el;
    };
  },
  'ref': function(test, name) {
    var node;

    function ref(el) {
      var doc = el.ownerDocument
        , nodes = doc.getElementsByTagName('*')
        , i = nodes.length;

      while (i--) {
        node = nodes[i];
        if (ref.test(el)) {
          node = null;
          return true;
        }
      }

      node = null;
    }

    ref.combinator = function(el) {
      if (!node || !node.getAttribute) return;

      var attr = node.getAttribute(name) || '';
      if (attr[0] === '#') attr = attr.substring(1);

      if (attr === el.id && test(node)) {
        return node;
      }
    };

    return ref;
  }
};

/**
 * Grammar
 */

var rules = {
  escape: /\\(?:[^0-9A-Fa-f\r\n]|[0-9A-Fa-f]{1,6}[\r\n\t ]?)/g,
  str_escape: /(escape)|\\(\n|\r\n?|\f)/g,
  nonascii: /[\u00A0-\uFFFF]/,
  cssid: /(?:(?!-?[0-9])(?:escape|nonascii|[-_a-zA-Z0-9])+)/,
  qname: /^ *(cssid|\*)/,
  simple: /^(?:([.#]cssid)|pseudo|attr)/,
  ref: /^ *\/(cssid)\/ */,
  combinator: /^(?: +([^ \w*.#\\]) +|( )+|([^ \w*.#\\]))(?! *$)/,
  attr: /^\[(cssid)(?:([^\w]?=|\/)(inside))?\]/,
  pseudo: /^(:cssid)(?:\((inside)\))?/,
  inside: /(?:"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|<[^"'>]*>|\\["'>]|[^"'>])*/,
  ident: /^(cssid)$/
};

rules.cssid = replace(rules.cssid, 'nonascii', rules.nonascii);
rules.cssid = replace(rules.cssid, 'escape', rules.escape);
rules.qname = replace(rules.qname, 'cssid', rules.cssid);
rules.simple = replace(rules.simple, 'cssid', rules.cssid);
rules.ref = replace(rules.ref, 'cssid', rules.cssid);
rules.attr = replace(rules.attr, 'cssid', rules.cssid);
rules.pseudo = replace(rules.pseudo, 'cssid', rules.cssid);
rules.inside = replace(rules.inside, '[^"\'>]*', rules.inside);
rules.attr = replace(rules.attr, 'inside', makeInside('\\[', '\\]'));
rules.pseudo = replace(rules.pseudo, 'inside', makeInside('\\(', '\\)'));
rules.simple = replace(rules.simple, 'pseudo', rules.pseudo);
rules.simple = replace(rules.simple, 'attr', rules.attr);
rules.ident = replace(rules.ident, 'cssid', rules.cssid);
rules.str_escape = replace(rules.str_escape, 'escape', rules.escape);

/**
 * Compiling
 */

var compile = function(sel_) {
  var sel = sel_.replace(/^\s+|\s+$/g, '')
    , test
    , filter = []
    , buff = []
    , subject
    , qname
    , cap
    , op
    , ref;

  /*jshint -W084 */
  while (sel) {
    if (cap = rules.qname.exec(sel)) {
      sel = sel.substring(cap[0].length);
      qname = decodeid(cap[1]);
      buff.push(tok(qname, true));
    } else if (cap = rules.simple.exec(sel)) {
      sel = sel.substring(cap[0].length);
      qname = '*';
      buff.push(tok(qname, true));
      buff.push(tok(cap));
    } else {
      throw new SyntaxError('Invalid selector.');
    }

    while (cap = rules.simple.exec(sel)) {
      sel = sel.substring(cap[0].length);
      buff.push(tok(cap));
    }

    if (sel[0] === '!') {
      sel = sel.substring(1);
      subject = makeSubject();
      subject.qname = qname;
      buff.push(subject.simple);
    }

    if (cap = rules.ref.exec(sel)) {
      sel = sel.substring(cap[0].length);
      ref = combinators.ref(makeSimple(buff), decodeid(cap[1]));
      filter.push(ref.combinator);
      buff = [];
      continue;
    }

    if (cap = rules.combinator.exec(sel)) {
      sel = sel.substring(cap[0].length);
      op = cap[1] || cap[2] || cap[3];
      if (op === ',') {
        filter.push(combinators.noop(makeSimple(buff)));
        break;
      }
    } else {
      op = 'noop';
    }

    if (!combinators[op]) { throw new SyntaxError('Bad combinator.'); }
    filter.push(combinators[op](makeSimple(buff)));
    buff = [];
  }

  test = makeTest(filter);
  test.qname = qname;
  test.sel = sel;

  if (subject) {
    subject.lname = test.qname;

    subject.test = test;
    subject.qname = subject.qname;
    subject.sel = test.sel;
    test = subject;
  }

  if (ref) {
    ref.test = test;
    ref.qname = test.qname;
    ref.sel = test.sel;
    test = ref;
  }

  return test;
};

var tok = function(cap, qname) {
  // qname
  if (qname) {
    return cap === '*'
      ? selectors['*']
      : selectors.type(cap);
  }

  // class/id
  if (cap[1]) {
    return cap[1][0] === '.'
	  // XXX unescape here?  or in attr?
      ? selectors.attr('class', '~=', decodeid(cap[1].substring(1)), false)
      : selectors.attr('id', '=', decodeid(cap[1].substring(1)), false);
  }

  // pseudo-name
  // inside-pseudo
  if (cap[2]) {
    return cap[3]
      ? selectors[decodeid(cap[2])](unquote(cap[3]))
      : selectors[decodeid(cap[2])];
  }

  // attr name
  // attr op
  // attr value
  if (cap[4]) {
    var value = cap[6];
    var i = /["'\s]\s*I$/i.test(value);
    if (i) {
      value = value.replace(/\s*I$/i, '');
    }
    return selectors.attr(decodeid(cap[4]), cap[5] || '-', unquote(value), i);
  }

  throw new SyntaxError('Unknown Selector.');
};

var makeSimple = function(func) {
  var l = func.length
    , i;

  // Potentially make sure
  // `el` is truthy.
  if (l < 2) return func[0];

  return function(el) {
    if (!el) return;
    for (i = 0; i < l; i++) {
      if (!func[i](el)) return;
    }
    return true;
  };
};

var makeTest = function(func) {
  if (func.length < 2) {
    return function(el) {
      return !!func[0](el);
    };
  }
  return function(el) {
    var i = func.length;
    while (i--) {
      if (!(el = func[i](el))) return;
    }
    return true;
  };
};

var makeSubject = function() {
  var target;

  function subject(el) {
    var node = el.ownerDocument
      , scope = node.getElementsByTagName(subject.lname)
      , i = scope.length;

    while (i--) {
      if (subject.test(scope[i]) && target === el) {
        target = null;
        return true;
      }
    }

    target = null;
  }

  subject.simple = function(el) {
    target = el;
    return true;
  };

  return subject;
};

var compileGroup = function(sel) {
  var test = compile(sel)
    , tests = [ test ];

  while (test.sel) {
    test = compile(test.sel);
    tests.push(test);
  }

  if (tests.length < 2) return test;

  return function(el) {
    var l = tests.length
      , i = 0;

    for (; i < l; i++) {
      if (tests[i](el)) return true;
    }
  };
};

/**
 * Selection
 */

var find = function(sel, node) {
  var results = []
    , test = compile(sel)
    , scope = node.getElementsByTagName(test.qname)
    , i = 0
    , el;

  /*jshint -W084 */
  while (el = scope[i++]) {
    if (test(el)) results.push(el);
  }

  if (test.sel) {
    while (test.sel) {
      test = compile(test.sel);
      scope = node.getElementsByTagName(test.qname);
      i = 0;
      /*jshint -W084 */
      while (el = scope[i++]) {
        if (test(el) && indexOf.call(results, el) === -1) {
          results.push(el);
        }
      }
    }
    results.sort(order);
  }

  return results;
};

// -- end shared code --

/**
 * Native
 */

var select = (function() {
  var slice = (function() {
    try {
      Array.prototype.slice.call(document.getElementsByTagName('zest'));
      return Array.prototype.slice;
    } catch(e) {
      e = null;
      return function() {
        var a = [], i = 0, l = this.length;
        for (; i < l; i++) a.push(this[i]);
        return a;
      };
    }
  })();

  if (document.querySelectorAll) {
    return function(sel, node) {
      try {
        return slice.call(node.querySelectorAll(sel));
      } catch(e) {
        return find(sel, node);
      }
    };
  }

  return function(sel, node) {
    try {
      if (sel[0] === '#' && /^#[\w\-]+$/.test(sel)) {
        return [node.getElementById(sel.substring(1))];
      }
      if (sel[0] === '.' && /^\.[\w\-]+$/.test(sel)) {
        sel = node.getElementsByClassName(sel.substring(1));
        return slice.call(sel);
      }
      if (/^[\w\-]+$/.test(sel)) {
        return slice.call(node.getElementsByTagName(sel));
      }
    } catch(e) {
      ;
    }
    return find(sel, node);
  };
})();

/**
 * Zest
 */

var zest = function(sel, node) {
  try {
    sel = select(sel, node || document);
  } catch(e) {
    if (window.ZEST_DEBUG) {
      console.log(e.stack || e + '');
    }
    sel = [];
  }
  return sel;
};

/**
 * Expose
 */

zest.selectors = selectors;
zest.operators = operators;
zest.combinators = combinators;
zest.compile = compileGroup;

zest.matches = function(el, sel) {
  return !!compileGroup(sel)(el);
};

zest.cache = function() {
  if (compile.raw) return;

  var raw = compile
    , cache = {};

  compile = function(sel) {
    return cache[sel]
      || (cache[sel] = raw(sel));
  };

  compile.raw = raw;
  zest._cache = cache;
};

zest.noCache = function() {
  if (!compile.raw) return;
  compile = compile.raw;
  delete zest._cache;
};

zest.noConflict = function() {
  window.zest = old;
  return zest;
};

zest.noNative = function() {
  select = find;
};

if (typeof module !== 'undefined') {
  module.exports = zest;
} else {
  this.zest = zest;
}

if (window.ZEST_DEBUG) {
  zest.noNative();
} else {
  zest.cache();
}

}).call(function() {
  return this || (typeof window !== 'undefined' ? window : global);
}());
