'use strict';

const fs = require('fs-extra'),
      path = require('path');

require('sugar')();

var osmosis = require('osmosis');

module.exports = function (opts) {
  console.log(opts);

  var partsDir = path.resolve(opts.base, opts.json);
  var cssDir = path.resolve(opts.base, opts.css);

  // fs.ensureDir(partsDir);

  osmosis.get(opts.url).set({
    'styles': osmosis.find('link[rel="stylesheet"]:first').config({ parse: false }).get(function (context) {
      return context.getAttribute('href');
    }).then(function (context, data, next) {
      next(context, context.toString());
    }),
    'script': osmosis.find('script[src^="https://uploads-ssl.webflow.com"]').config({ parse: false }).get(function (context) {
      return context.getAttribute('src');
    }).then(function (context, data, next) {
      next(context, context.toString());
    }),
    'fields': ['@data-field'],
    'elements': osmosis.find('body [class]').then(function (node, data, next) {
      data.keys = node.find('ancestor::*[class]').filter(function (n) {
        return n.nodeName.toLowerCase() != 'body';
      }).map(function (n) {
        return n.getAttribute('class').split(/\s+/);
      });

      data.keys.push(node.getAttribute('class').split(/\s+/));

      data.class = data.keys.map(function (keys) {
        return '.' + keys.join('.');
      }).join(' ');

      // data.html = node.toString(true);
      data.node = node;
      next(node, data);
    }),
  })
  .then(function (document) {
    document.get('[src="https://code.jquery.com/jquery-3.3.1.min.js"]').setAttribute('src', 'https://code.jquery.com/jquery-3.3.1.js');
  })
  .click('body')
  .then(function (document, data) {
    var window = document.defaultView,
        $ = window.jQuery;

    $('.webflow-page-label').remove();

    data.elements.forEach(function (c) {
      var loopAttr = (c.node.getAttribute('v-for') || c.node.getAttribute('foreach') || '').replace(/\\*"/g, '\'');

      if (loopAttr) {

        var children = [];

        c.node.children.forEach(function (child, index, arr) {
          if (child.nodeName) {
            children.push(child);
          }
        });

        var classes = children.map((c) => c.getAttribute('class')).compact(true).unique(),
            conditions = children.map((c) => c.getAttribute('if') || c.getAttribute('v-if')).compact(true);

        c.node.children[0].addPrevSibling(document.createTextNode('{% set item=\'\' %}{% for ' + loopAttr + ' %}{% if loop_context(loop, _key, _seq) %}{% set item = _seq[loop.index0] %}{% endif %}'));
        c.node.children[c.node.children.length - 1].addNextSibling(document.createTextNode('{% endfor %}'));

        if (children.length > 0 && conditions.length < 1) {
          children.forEach(function (child, index, arr) {
            child.setAttribute('v-if', 'loop.index0 % ' + arr.length + ' == ' + index + '');
          });
        }
      }
    });

    document.find('[if], [v-if]').forEach(function (node) {
      var condition = node.getAttribute('v-if');

      node.addPrevSibling(document.createTextNode('{% if ' + condition + ' %}'));
      node.addNextSibling(document.createTextNode('{% endif %}'));
    });

    document.find('[v-background-image]').forEach(function (node) {
      var value = node.getAttribute('v-background-image');

      node.setAttribute('style', 'background-image:url({{' + value + '}})');
    });

    document.find('[replace]').forEach(function (node) {
      var value = node.getAttribute('replace');

      $(node.children).remove();

      node.addChild(document.createTextNode('{{ ' + value + ' }}'));
    });

    data.elements.forEach(function (c) {
      c.node.addNextSibling(document.createTextNode('{{ webflow_render(' + JSON.stringify(c.node.getAttribute('class').split(/\s+/)).replace(/"/g, '\'') + ', _context) }}'));
      $(c.node).remove();
    });

    data.elements.forEach(function (c) {
      c.html = c.node.toString().replace(/(https?:\/\/)?%7B%7B%20/g, '{{ ').replace(/%20%7D%7D/g, ' }}');
      // console.log(c.html);
    });

    delete data.node;
  })
  .data(function (data) {
    console.log(data.elements);

    fs.writeJsonSync(path.resolve(opts.base, opts.json), data.elements);

    fs.outputFileSync(path.resolve(opts.base, opts.css), data.styles);

    if (opts.js) {
      fs.outputFileSync(path.resolve(opts.base, opts.js), data.script);
    }
  })
  .log(console.error)
  .error(console.error);

}