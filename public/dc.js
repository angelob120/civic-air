/*
 * Minimal template runtime for Civic Air.
 *
 * The prototype screens were authored against a template dialect that this file
 * reimplements in about 150 lines of plain browser JavaScript, so the app has no
 * build step and no framework dependency. Supported directives:
 *
 *   {{path}}                 interpolation in text and attributes
 *   {{fn('arg')}}            handler expression with literal string arguments
 *   <sc-for list="{{xs}}" as="x">   repeat children once per item
 *   <sc-if value="{{cond}}">        render children only when truthy
 *   sc-camel-on-click="..."  becomes an onClick style event listener
 *   sc-camel-view-box="..."  becomes a camelCased attribute (viewBox)
 *   sc-raw-table, sc-raw-tr  become the real tag name (the authoring tool could
 *                            not nest table tags directly)
 *
 * Re-rendering is a full rebuild of the root subtree. The screens are small
 * enough that this is imperceptible and it keeps the runtime honest: there is
 * one code path, so a stale node is not possible.
 */
(function (global) {
  'use strict';

  var CAMEL = /^sc-camel-(.+)$/;
  var RAW = /^sc-raw-(.+)$/;
  var BIND = /^\{\{(.*)\}\}$/;
  var CALL = /^([A-Za-z_$][\w$]*)\((.*)\)$/;

  function toCamel(s) {
    return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
  }

  function lookup(path, scope) {
    var parts = path.split('.');
    var cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // Evaluates one expression from inside {{ }}. Deliberately tiny: the screens
  // only ever use literals, dotted paths, and a call with string arguments.
  function evaluate(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'[^']*'$/.test(expr) || /^"[^"]*"$/.test(expr)) return expr.slice(1, -1);
    var call = CALL.exec(expr);
    if (call) {
      var fn = lookup(call[1], scope);
      if (typeof fn !== 'function') return undefined;
      var args = call[2].trim() === '' ? [] : call[2].split(',').map(function (a) {
        return evaluate(a, scope);
      });
      return fn.apply(null, args);
    }
    return lookup(expr, scope);
  }

  // A whole-value binding keeps its type (function, boolean, array). A value
  // with text around it is always stringified.
  function resolve(text, scope) {
    var whole = BIND.exec(text.trim());
    if (whole) return evaluate(whole[1], scope);
    return text.replace(/\{\{(.*?)\}\}/g, function (_, e) {
      var v = evaluate(e, scope);
      return v === undefined || v === null ? '' : String(v);
    });
  }

  function isEventAttr(name) {
    return /^on[A-Z]/.test(name);
  }

  function build(node, scope, out) {
    if (node.nodeType === 3) {
      var text = node.nodeValue;
      if (text.indexOf('{{') === -1) { out.appendChild(node.cloneNode(false)); return; }
      var v = resolve(text, scope);
      out.appendChild(document.createTextNode(v === undefined || v === null ? '' : String(v)));
      return;
    }
    if (node.nodeType !== 1) return;

    var tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      var list = resolve(node.getAttribute('list') || '', scope);
      var as = node.getAttribute('as') || 'item';
      if (!Array.isArray(list)) return;
      for (var i = 0; i < list.length; i++) {
        var child = Object.create(scope);
        child[as] = list[i];
        child[as + 'Index'] = i;
        buildChildren(node, child, out);
      }
      return;
    }

    if (tag === 'sc-if') {
      if (resolve(node.getAttribute('value') || '', scope)) buildChildren(node, scope, out);
      return;
    }

    var raw = RAW.exec(tag);
    var el = raw
      ? document.createElement(raw[1])
      : (node.namespaceURI === 'http://www.w3.org/2000/svg'
        ? document.createElementNS(node.namespaceURI, tag)
        : document.createElement(tag));

    for (var a = 0; a < node.attributes.length; a++) {
      var attr = node.attributes[a];
      var name = attr.name;
      var camel = CAMEL.exec(name);
      if (camel) name = toCamel(camel[1]);
      var value = resolve(attr.value, scope);

      if (isEventAttr(name) && typeof value === 'function') {
        var type = name.slice(2).toLowerCase();
        el.addEventListener(type, value);
        (el._dcEvents || (el._dcEvents = [])).push([type, value]);
        continue;
      }
      if (name === 'checked' || name === 'selected' || name === 'disabled') {
        if (value) el.setAttribute(name, ''); else el.removeAttribute(name);
        el[name] = !!value;
        continue;
      }
      if (value === undefined || value === null || value === false) continue;
      el.setAttribute(name, value === true ? '' : String(value));
    }

    buildChildren(node, scope, el);
    out.appendChild(el);

    // A select's value has to be applied after its options exist.
    if (el.tagName === 'SELECT' && el.hasAttribute('value')) el.value = el.getAttribute('value');
  }

  function buildChildren(node, scope, out) {
    for (var i = 0; i < node.childNodes.length; i++) build(node.childNodes[i], scope, out);
  }

  /*
   * The command center re-renders once a second for its clock. Replacing the
   * whole subtree each tick would drop focus, reset scroll position, and restart
   * CSS transitions, so a freshly built tree is morphed onto the live one and
   * only the nodes that actually differ are touched.
   */
  function morph(live, next) {
    var a = live.childNodes;
    // Snapshot the new children: inserting one moves it out of `next`, which
    // would otherwise renumber the list mid-loop. Nodes are moved rather than
    // cloned so their freshly bound listeners survive.
    var b = Array.prototype.slice.call(next.childNodes);
    var i;
    for (i = 0; i < b.length; i++) {
      var want = b[i];
      var have = a[i];
      if (!have) { live.appendChild(want); continue; }
      if (have.nodeType !== want.nodeType ||
        (have.nodeType === 1 && have.tagName !== want.tagName)) {
        live.replaceChild(want, have);
        continue;
      }
      if (have.nodeType === 3) {
        if (have.nodeValue !== want.nodeValue) have.nodeValue = want.nodeValue;
        continue;
      }
      if (have.nodeType !== 1) continue;
      morphAttrs(have, want);
      morph(have, want);
    }
    while (a.length > b.length) live.removeChild(live.lastChild);
  }

  function morphAttrs(have, want) {
    var i;
    for (i = have.attributes.length - 1; i >= 0; i--) {
      var name = have.attributes[i].name;
      if (!want.hasAttribute(name)) have.removeAttribute(name);
    }
    for (i = 0; i < want.attributes.length; i++) {
      var attr = want.attributes[i];
      if (have.getAttribute(attr.name) !== attr.value) have.setAttribute(attr.name, attr.value);
    }
    // Listeners live on the freshly built node, so they are carried over rather
    // than re-bound: the closures capture the current render's scope.
    if (want._dcEvents) {
      if (have._dcEvents) {
        have._dcEvents.forEach(function (h) { have.removeEventListener(h[0], h[1]); });
      }
      want._dcEvents.forEach(function (h) { have.addEventListener(h[0], h[1]); });
      have._dcEvents = want._dcEvents;
    }
    if (have.tagName === 'INPUT' && have.type === 'checkbox') have.checked = want.checked;
    if (have.tagName === 'SELECT' && have.value !== want.value) have.value = want.value;
  }

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) this.state[k] = patch[k];
    this.forceUpdate();
  };
  DCLogic.prototype.forceUpdate = function () {
    if (this._mount) global.DC.render(this);
  };
  DCLogic.prototype.renderVals = function () { return {}; };

  global.DCLogic = DCLogic;
  global.DC = {
    render: function (instance) {
      var vals = instance.renderVals() || {};
      var next = document.createElement('div');
      buildChildren(instance._template, vals, next);
      morph(instance._mount, next);
    },
    mount: function (Component) {
      var template = document.getElementById('dc-template');
      var mount = document.getElementById('dc-root');
      var instance = new Component({});
      instance._template = template.content;
      instance._mount = mount;
      global.DC.render(instance);
      if (typeof instance.componentDidMount === 'function') instance.componentDidMount();
      global.addEventListener('beforeunload', function () {
        if (typeof instance.componentWillUnmount === 'function') instance.componentWillUnmount();
      });
      return instance;
    }
  };
})(window);
